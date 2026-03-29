import { createInitialGameState } from "../engine/state.js";
import { beginGame } from "../engine/phases.js";
import { dispatch as engineDispatch } from "../engine/reducer.js";
import { bindInputHandlers, beginMoveInteraction, beginDeployInteraction, beginDisengageInteraction, beginRunInteraction, beginForceFieldInteraction, beginMedpackInteraction, beginOpticalFlareInteraction, beginDeclareRangedInteraction, beginDeclareChargeInteraction, cancelCurrentInteraction } from "./input.js";
import { renderAll } from "./renderer.js";
import { autoArrangeModels } from "../engine/coherency.js";
import { performBotTurn } from "../ai/bot.js";
import { screenToBoardPoint } from "./board.js";
import { getTacticalCard, TACTICAL_CARDS } from "../data/tactical_cards.js";
import { MISSION_DATA } from "../data/missions.js";
import { DEPLOYMENT_DATA } from "../data/deployments.js";
import { snapPointToGrid, distance } from "../engine/geometry.js";
import { getLegalMoveDestinations, getLegalDeployDestinations, getLegalDisengageDestinations, getLegalRunDestinations } from "../engine/legal_actions.js";
import { canBurrow, canHide, validateCloseRanks } from "../engine/statuses.js";
import { getCombatActivationPreview, getMeleeTargetSelection } from "../engine/combat.js";
import { importArmyBuilderRoster, isArmyBuilderPayload, buildSetupFromImportedRosters } from "../engine/army_builder_import.js";
import { canTargetWithRangedWeapon, getLeaderPoint, getLongRangeValue } from "../engine/visibility.js";
import { getObjectiveControlSnapshot } from "../engine/objectives.js";

const DEFAULT_SETUP = {
  missionId: "take_and_hold",
  deploymentId: "crossfire",
  firstPlayerMarkerHolder: "playerA",
  armyA: [
    { id: "swarm_kerrigan", templateId: "kerrigan" },
    { id: "swarm_raptor_t2", templateId: "raptor_t2" },
    { id: "swarm_roach_t3", templateId: "roach_t3" },
    { id: "swarm_zergling_t3", templateId: "zergling_t3" },
    { id: "swarm_zergling_t2", templateId: "zergling_t2" }
  ],
  armyB: [
    { id: "raiders_raynor", templateId: "jim_raynor" },
    { id: "raiders_marines_t2", templateId: "marine_t2" },
    { id: "raiders_marauder_1", templateId: "marauder_t1" },
    { id: "raiders_marauder_2", templateId: "marauder_t1" },
    { id: "raiders_marauder_3", templateId: "marauder_t1" },
    { id: "raiders_medic", templateId: "medic_t1" }
  ],
  tacticalCardsA: ["lair", "evolution_chamber", "roach_warren", "malignant_creep"],
  tacticalCardsB: ["barracks_proxy", "academy", "orbital_command"],
  rules: { gridMode: true }
};

const RULE_GLOSSARY = {
  "Anti-Evade": "Anti-Evade makes the defender's evade roll harder, so it is less likely to avoid hits after armour is resolved.",
  "Burst Fire": "Burst Fire adds extra attacks when the target is inside the weapon's close-range band.",
  "Close Ranks": "Close Ranks is the step where a burrowed unit surfaces and tightens formation so it can actually fight in melee above ground.",
  "Concentrated Fire": "Concentrated Fire limits how many casualties the attack can cause, and any excess damage beyond that cap is discarded.",
  "Critical Hit": "Critical Hit pushes wounds straight past armour before save rolls are made.",
  "Dodge": "Dodge cancels a limited number of hits that already bypassed armour before those hits become damage.",
  "Evade": "Evade is a late defensive roll that can avoid hits after armour results are known.",
  "Fighting Rank": "Fighting Rank is the set of models actually close enough to the enemy to contribute attacks in melee.",
  "Hidden": "Hidden protects a unit from normal ranged targeting at longer distance and can unlock special defensive behavior until the unit is revealed.",
  "Hits": "Hits adds automatic armour-pool hits. Those hits skip the normal hit and wound steps and do not generate Surge.",
  "Impact": "Impact happens after a successful charge. Eligible charging models roll impact dice before the main melee attack resolves.",
  "Indirect Fire": "Indirect Fire lets a ranged attack target without line of sight, though other targeting rules still matter.",
  "Instant": "Instant removes the defender's Overwatch reaction window against that charge.",
  "Life Support": "Life Support reduces damage after it gets through, which can keep models alive even after hits and failed saves are already known.",
  "Locked In": "Locked In adds attacks against a target that counts as stationary.",
  "Long Range": "Long Range extends a weapon beyond its base range band, but attacks in that outer band suffer a hit penalty.",
  "Overwatch": "Overwatch is a reaction shot triggered by an enemy charge declaration before the charge attack resolves.",
  "Pierce": "Pierce increases damage against targets with matching tags.",
  "Pinpoint": "Pinpoint allows ranged attacks to target engaged enemy units, overriding the normal restriction against shooting into an engagement.",
  "Precision": "Precision moves some failed hit dice directly into the armour pool, so they still count as hits without rolling to wound.",
  "Supporting Rank": "Supporting Rank models are not in direct contact with the enemy, but they can still help if they are in base contact with a fighting-rank model.",
  "Surge": "Surge converts matching wounds into hits that bypass armour after wounds are created.",
  "Zealous Round": "Zealous Round trades the unit's unused activation in the current phase for immediate damage reduction."
};

function createStore(initialState) {
  let state = initialState;
  const listeners = [];
  return {
    getState() { return state; },
    dispatch(action) {
      const result = engineDispatch(state, action);
      if (result.ok) {
        state = result.state;
        listeners.forEach(listener => listener(state, result.events ?? []));
      }
      return result;
    },
    replaceState(nextState) {
      state = nextState;
      listeners.forEach(listener => listener(state, []));
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    }
  };
}

const uiState = {
  selectedUnitId: null,
  selectedObjectiveId: null,
  mode: null,
  previewPath: null,
  previewUnit: null,
  locked: false,
  lastError: null,
  notifications: [],
  lastSeenLogCount: 0,
  legalDestinations: [],
  hoveredUnitId: null,
  hoveredObjectiveId: null,
  hoveredCombatQueueIndex: null,
  selectedCombatQueueIndex: null,
  boardHighlights: [],
  aftermathNarrative: null,
  compactActionBar: false,
  lastObjectiveSnapshot: null,
  pendingPass: false,
  storyModalQueue: [],
  activeStoryModal: null,
  activeGlossaryTerm: null,
  shownPhaseTeachingKeys: new Set(),
  pendingCombatChoice: null,
  setupModal: {
    open: false,
    missionId: DEFAULT_SETUP.missionId,
    deploymentId: DEFAULT_SETUP.deploymentId,
    firstPlayerMarkerHolder: DEFAULT_SETUP.firstPlayerMarkerHolder,
    rosters: {
      playerA: null,
      playerB: null
    },
    pendingImportSide: null
  }
};

let store;
let boardHighlightTimer = null;

function buildInitialState() {
  const state = createInitialGameState(DEFAULT_SETUP);
  beginGame(state);
  return state;
}

function buildStateFromSetup(setup) {
  const state = createInitialGameState(setup);
  beginGame(state);
  return state;
}

function selectUnit(unitId) {
  uiState.selectedUnitId = unitId;
  cancelCurrentInteraction(uiState);
  uiState.legalDestinations = [];
  uiState.hoveredUnitId = null;
  uiState.hoveredObjectiveId = null;
  uiState.hoveredCombatQueueIndex = null;
  uiState.selectedCombatQueueIndex = null;
  rerender();
}

function getSelectedUnit(state) {
  return uiState.selectedUnitId ? state.units[uiState.selectedUnitId] : null;
}

/* ── Compute legal destinations when entering a mode ── */
function computeLegalDestinations() {
  const state = store.getState();
  const unit = getSelectedUnit(state);
  if (!unit || unit.owner !== "playerA") { uiState.legalDestinations = []; return; }

  try {
    if (uiState.mode === "move") {
      uiState.legalDestinations = getLegalMoveDestinations(state, "playerA", unit.id, unit.leadingModelId);
    } else if (uiState.mode === "deploy") {
      uiState.legalDestinations = getLegalDeployDestinations(state, "playerA", unit.id, unit.leadingModelId);
    } else if (uiState.mode === "disengage") {
      uiState.legalDestinations = getLegalDisengageDestinations(state, "playerA", unit.id, unit.leadingModelId);
    } else if (uiState.mode === "run") {
      uiState.legalDestinations = getLegalRunDestinations(state, "playerA", unit.id, unit.leadingModelId);
    } else {
      uiState.legalDestinations = [];
    }
  } catch (_e) {
    uiState.legalDestinations = [];
  }
}

/* ── Auto-select next unactivated unit ── */
function autoSelectNextUnit() {
  const state = store.getState();
  if (state.activePlayer !== "playerA") return;
  const phase = state.phase;
  const allPlayerUnits = [
    ...state.players.playerA.battlefieldUnitIds,
    ...(phase === "movement" ? state.players.playerA.reserveUnitIds : [])
  ];
  for (const uid of allPlayerUnits) {
    const u = state.units[uid];
    if (!u) continue;
    const activated = phase === "movement" ? u.status.movementActivated
      : phase === "assault" ? u.status.assaultActivated
      : phase === "combat" ? u.status.combatActivated : true;
    if (!activated) {
      uiState.selectedUnitId = uid;
      return;
    }
  }
}

/* ── Phase checklist data ── */
function getPhaseChecklist() {
  const state = store.getState();
  if (state.activePlayer !== "playerA") return { total: 0, done: 0, remaining: [] };
  const phase = state.phase;
  const allIds = [
    ...state.players.playerA.battlefieldUnitIds,
    ...(phase === "movement" ? state.players.playerA.reserveUnitIds : [])
  ];
  let done = 0;
  const remaining = [];
  for (const uid of allIds) {
    const u = state.units[uid];
    if (!u) continue;
    const activated = phase === "movement" ? u.status.movementActivated
      : phase === "assault" ? u.status.assaultActivated
      : phase === "combat" ? u.status.combatActivated : true;
    if (activated) done++;
    else remaining.push(u.name);
  }
  return { total: allIds.length, done, remaining };
}

function getModeText() {
  if (uiState.lastError) return uiState.lastError;
  const state = store.getState();
  const unit = getSelectedUnit(state);
  const checklist = getPhaseChecklist();
  const progress = checklist.total > 0 ? ` [${checklist.done}/${checklist.total}]` : "";

  if (uiState.pendingPass) return "⚠ Press Pass again to confirm ending your phase. First to pass gets initiative next phase!";
  if (uiState.locked) return "⏳ Enemy is taking their turn…";
  if (state.activePlayer !== "playerA") return "Waiting for enemy turn…";

  if (uiState.mode === "deploy" && unit) {
    const avail = state.players.playerA.supplyPool - getPlayerSupply(state);
    return `Deploy ${unit.name} (${unit.currentSupplyValue} SP) — click a green square. Available supply: ${avail}.${progress}`;
  }
  if (uiState.mode === "move" && unit) {
    return `Move ${unit.name} — click a green square within ${unit.speed}" speed. Leader moves first, squad follows in coherency.${progress}`;
  }
  if (uiState.mode === "disengage" && unit) {
    return `Disengage ${unit.name} — models that can't clear engagement range are destroyed. Can't shoot/charge next phase unless supply exceeds engaged enemies.${progress}`;
  }
  if (uiState.mode === "run" && unit) {
    return `Run ${unit.name} — move up to ${unit.speed}" (same as normal move). Good for repositioning onto objectives when you can't attack.${progress}`;
  }
  if (uiState.mode === "force_field" && unit) {
    return `Solid-Field Projectors — place a Force Field token within 8". Size 2 or lower units cannot cross it, while Size 3+ units break it.${progress}`;
  }
  if (uiState.mode === "use_medpack" && unit) {
    return `Medpack — click another friendly biological unit within 4". Healing scales with nearby Medic models.${progress}`;
  }
  if (uiState.mode === "use_optical_flare" && unit) {
    const range = unit.abilities?.includes("a_13_flash_grenade_launcher") ? 16 : 12;
    return `Optical Flare — click an enemy within ${range}". It loses 4" of ranged weapon range this round and cannot use Long Range.${progress}`;
  }
  if (uiState.mode === "declare_ranged" && unit) {
    const wpn = unit.rangedWeapons?.[0];
    const rangeInfo = wpn ? ` ${wpn.name}: ${wpn.rangeInches}" range, ${wpn.hitTarget}+ to hit.` : "";
    return `Ranged Attack — click a red-highlighted enemy in range.${rangeInfo} Attack resolves in Combat Phase.${progress}`;
  }
  if (uiState.mode === "declare_charge" && unit) {
    return `Charge — click an enemy within 8". In Combat Phase, ${unit.name} will pile in and fight in melee. Charge distance = Speed + 1D6.${progress}`;
  }

  // Phase-specific guidance when no mode is active
  if (state.phase === "movement") {
    if (checklist.remaining.length > 0) {
      return `Movement Phase: Deploy reserves or Move/Hold battlefield units. Some units can also use movement abilities like Force Field placement.${progress}`;
    }
    return `All units moved. Pass to start the Assault Phase.${progress}`;
  }
  if (state.phase === "assault") {
    if (checklist.remaining.length > 0) {
      return `Assault Phase: Declare Ranged Attacks, Charges, Run to reposition, or Hold. Attacks resolve in Combat Phase.${progress}`;
    }
    return `All units assigned. Pass to start Combat.${progress}`;
  }
  if (state.phase === "combat") {
    if (checklist.remaining.length > 0) {
      return `Combat Phase: Review each unit's combat sequence, choose melee focus when tied into multiple enemies, then resolve the queued attacks in order.${progress}`;
    }
    return `All combat resolved. Pass to score objectives.${progress}`;
  }
  return `Select a unit to act.${progress}`;
}

function getPlayerSupply(state) {
  return state.players.playerA.battlefieldUnitIds.reduce((t, id) => t + state.units[id].currentSupplyValue, 0);
}

function rerender() {
  const handlers = {
    onUnitSelect: selectUnit,
    onBoardClick: handleBoardClick,
    onModelClick: handleModelClick,
    onModelHover: handleModelHover,
    onObjectiveHover: handleObjectiveHover,
    onObjectiveClick: handleObjectiveClick,
    onCombatQueueHover: handleCombatQueueHover,
    onCombatQueueClick: handleCombatQueueClick,
    onLogEntryFocus: handleLogEntryFocus,
    onToggleActionBarCompact: handleActionBarToggle,
    buildActionButtons,
    buildCardButtons,
    getModeText,
    getPhaseChecklist
  };
  renderAll(store.getState(), uiState, handlers);
  renderNotifications();
  renderStoryModal();
  renderCombatChoiceModal();
  renderSetupModal();
}

function getSetupSummaryText(side) {
  const roster = uiState.setupModal.rosters[side];
  if (!roster) return "Using the built-in demo force.";
  const label = side === "playerA" ? "Blue" : "Red";
  return `${label}: ${roster.factionName} • ${roster.summary.importedUnits} unit(s) • ${roster.summary.importedCards} tactical card(s)`;
}

function renderSetupRosterWarnings(roster) {
  if (!roster?.warnings?.length) return "";
  return `
    <div class="setup-warning-list">
      ${roster.warnings.map(warning => `<div class="setup-warning">${escapeHtml(warning)}</div>`).join("")}
    </div>
  `;
}

function renderSetupUpgradeBreakdown(roster) {
  const unitsWithUpgradeInfo = (roster?.army ?? []).filter(unit => (unit.selectedUpgrades?.length ?? 0) > 0);
  if (!unitsWithUpgradeInfo.length) return "";
  return `
    <div class="setup-upgrade-list">
      ${unitsWithUpgradeInfo.map(unit => `
        <div class="setup-upgrade-card">
          <div class="setup-upgrade-head">
            <div class="setup-upgrade-unit">${escapeHtml(unit.sourceName ?? unit.templateId)}</div>
            <div class="setup-upgrade-meta">${unit.upgradeSummary?.applied?.length ?? 0} applied • ${unit.upgradeSummary?.ignored?.length ?? 0} ignored</div>
          </div>
          <div class="setup-upgrade-row">
            <span class="setup-upgrade-label">Selected</span>
            <span>${escapeHtml((unit.selectedUpgrades ?? []).join(", "))}</span>
          </div>
          ${(unit.upgradeSummary?.applied?.length ?? 0) ? `
            <div class="setup-upgrade-row success">
              <span class="setup-upgrade-label">Applied</span>
              <span>${escapeHtml(unit.upgradeSummary.applied.join(", "))}</span>
            </div>
          ` : ""}
          ${(unit.upgradeSummary?.partial?.length ?? 0) ? `
            <div class="setup-upgrade-row partial">
              <span class="setup-upgrade-label">Partial</span>
              <span>${escapeHtml(unit.upgradeSummary.partial.join(", "))}</span>
            </div>
          ` : ""}
          ${(unit.upgradeSummary?.ignored?.length ?? 0) ? `
            <div class="setup-upgrade-row warn">
              <span class="setup-upgrade-label">Ignored</span>
              <span>${escapeHtml(unit.upgradeSummary.ignored.join(", "))}</span>
            </div>
          ` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderSetupModal() {
  const root = document.getElementById("setupModalRoot");
  if (!root) return;
  if (!uiState.setupModal.open) {
    root.className = "combat-choice-root";
    root.innerHTML = "";
    return;
  }

  const missionOptions = Object.values(MISSION_DATA).map(mission => `
    <option value="${escapeHtml(mission.id)}" ${mission.id === uiState.setupModal.missionId ? "selected" : ""}>${escapeHtml(mission.name)}</option>
  `).join("");
  const deploymentOptions = Object.values(DEPLOYMENT_DATA).map(deployment => `
    <option value="${escapeHtml(deployment.id)}" ${deployment.id === uiState.setupModal.deploymentId ? "selected" : ""}>${escapeHtml(deployment.name)}</option>
  `).join("");

  root.className = "combat-choice-root active";
  root.innerHTML = `
    <div class="combat-choice-backdrop"></div>
    <section class="combat-choice-modal setup-modal" role="dialog" aria-modal="true" aria-labelledby="setupModalTitle">
      <header class="combat-choice-header">
        <div>
          <div class="combat-choice-kicker">Battle Setup</div>
          <h2 id="setupModalTitle" class="combat-choice-title">Build the match from imported army-builder rosters or the demo forces.</h2>
          <div class="combat-choice-subtitle">Import a Blue roster, a Red roster, or both. Anything the engine does not support yet will be listed here before the game starts.</div>
        </div>
      </header>
      <div class="combat-choice-body">
        <div class="setup-config-grid">
          <label class="setup-field">
            <span class="setup-label">Mission</span>
            <select id="setupMissionSelect" class="setup-select">${missionOptions}</select>
          </label>
          <label class="setup-field">
            <span class="setup-label">Deployment</span>
            <select id="setupDeploymentSelect" class="setup-select">${deploymentOptions}</select>
          </label>
          <label class="setup-field">
            <span class="setup-label">First Player</span>
            <select id="setupFirstPlayerSelect" class="setup-select">
              <option value="playerA" ${uiState.setupModal.firstPlayerMarkerHolder === "playerA" ? "selected" : ""}>Blue</option>
              <option value="playerB" ${uiState.setupModal.firstPlayerMarkerHolder === "playerB" ? "selected" : ""}>Red</option>
            </select>
          </label>
        </div>
        <div class="setup-roster-grid">
          ${["playerA", "playerB"].map(side => {
            const roster = uiState.setupModal.rosters[side];
            const sideLabel = side === "playerA" ? "Blue" : "Red";
            return `
              <section class="setup-roster-card">
                <div class="setup-roster-head">
                  <div>
                    <div class="setup-roster-title">${sideLabel} Roster</div>
                    <div class="setup-roster-subtitle">${escapeHtml(getSetupSummaryText(side))}</div>
                  </div>
                  <div class="setup-roster-actions">
                    <button class="btn secondary btn-sm" data-import-side="${side}">Import JSON</button>
                    ${roster ? `<button class="btn secondary btn-sm" data-clear-side="${side}">Use Demo</button>` : ""}
                  </div>
                </div>
                ${roster ? `
                  <div class="setup-roster-stats">
                    ${renderStoryStat("Units", roster.summary.importedUnits, "success")}
                    ${renderStoryStat("Cards", roster.summary.importedCards)}
                    ${renderStoryStat("Skipped", roster.summary.skippedUnits + roster.summary.skippedCards, roster.warnings.length ? "warn" : "")}
                    ${renderStoryStat("Upgrades", roster.summary.appliedUpgrades, roster.summary.appliedUpgrades ? "success" : "")}
                    ${renderStoryStat("Partial", roster.summary.partialUpgrades, roster.summary.partialUpgrades ? "phase" : "")}
                    ${renderStoryStat("Ignored", roster.summary.ignoredUpgrades, roster.summary.ignoredUpgrades ? "warn" : "")}
                  </div>
                  ${renderSetupUpgradeBreakdown(roster)}
                  ${renderSetupRosterWarnings(roster)}
                ` : `
                  <div class="setup-empty">No imported roster yet. The match will use the built-in demo force for ${sideLabel.toLowerCase()} if you leave this alone.</div>
                `}
              </section>
            `;
          }).join("")}
        </div>
      </div>
      <footer class="combat-choice-footer">
        <div class="combat-choice-footer-copy">Army Builder exports can come straight from the JSON save button. Unsupported units and cards are skipped with warnings instead of crashing the setup.</div>
        <button id="setupCancelBtn" class="btn secondary">Cancel</button>
        <button id="setupStartBtn" class="btn primary">Start Battle</button>
      </footer>
    </section>
  `;

  root.querySelector(".combat-choice-backdrop")?.addEventListener("click", closeSetupModal);
  root.querySelector("#setupCancelBtn")?.addEventListener("click", closeSetupModal);
  root.querySelector("#setupMissionSelect")?.addEventListener("change", event => {
    uiState.setupModal.missionId = event.target.value;
  });
  root.querySelector("#setupDeploymentSelect")?.addEventListener("change", event => {
    uiState.setupModal.deploymentId = event.target.value;
  });
  root.querySelector("#setupFirstPlayerSelect")?.addEventListener("change", event => {
    uiState.setupModal.firstPlayerMarkerHolder = event.target.value;
  });
  root.querySelectorAll("[data-import-side]").forEach(button => {
    button.addEventListener("click", () => promptArmyImport(button.getAttribute("data-import-side")));
  });
  root.querySelectorAll("[data-clear-side]").forEach(button => {
    button.addEventListener("click", () => {
      uiState.setupModal.rosters[button.getAttribute("data-clear-side")] = null;
      rerender();
    });
  });
  root.querySelector("#setupStartBtn")?.addEventListener("click", startConfiguredBattle);
}

function showError(message) {
  uiState.lastError = message;
  pushToastNotification(message, "error");
  rerender();
  window.clearTimeout(showError.timer);
  showError.timer = window.setTimeout(() => {
    uiState.lastError = null;
    rerender();
  }, 4200);
}

function pushToastNotification(message, tone = "info", durationMs = 5200, options = {}) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  uiState.notifications.push({
    id,
    message,
    tone,
    prominent: Boolean(options.prominent),
    title: options.title ?? "Update"
  });
  if (uiState.notifications.length > 5) uiState.notifications.shift();
  rerender();
  window.setTimeout(() => {
    const index = uiState.notifications.findIndex(item => item.id === id);
    if (index >= 0) {
      uiState.notifications.splice(index, 1);
      rerender();
    }
  }, durationMs);
}

function renderNotifications() {
  const stack = document.getElementById("toastStack");
  if (!stack) return;
  stack.innerHTML = "";
  uiState.notifications.forEach(notification => {
    const toast = document.createElement("div");
    toast.className = `toast ${notification.tone} ${notification.prominent ? "prominent" : ""}`;
    toast.innerHTML = `
      <div class="toast-meta">${notification.title}</div>
      <div>${notification.message}</div>
    `;
    stack.appendChild(toast);
  });
}

function getStoryModalConfig(entry) {
  if (entry.type === "combat") {
    return {
      tone: "combat",
      kicker: "Combat Result",
      title: "Attack Resolved"
    };
  }
  if (entry.type === "card") {
    return {
      tone: "action",
      kicker: "Tactical Card",
      title: "Card Played"
    };
  }
  if (entry.type === "action") {
    return {
      tone: "action",
      kicker: "Key Action",
      title: entry.text.includes("attempts a charge") ? "Charge Roll" : "Action Resolved"
    };
  }
  if (entry.type === "score") {
    return {
      tone: "score",
      kicker: "Scoring",
      title: "Objectives Updated"
    };
  }
  return {
    tone: "phase",
    kicker: "Phase Update",
    title: entry.text.includes("Round") ? "New Round" : "Phase Change"
  };
}

function queueStoryModal(entry, state) {
  const isCustom = Object.prototype.hasOwnProperty.call(entry, "body");
  const config = isCustom
    ? { tone: entry.tone, kicker: entry.kicker, title: entry.title }
    : getStoryModalConfig(entry);
  uiState.storyModalQueue.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    entryType: entry.type ?? "custom",
    tone: config.tone,
    kicker: config.kicker,
    title: config.title,
    body: isCustom ? entry.body : entry.text,
    htmlBody: entry.htmlBody ?? null,
    subtitle: entry.subtitle ?? `Round ${state.round} • ${state.phase[0].toUpperCase()}${state.phase.slice(1)} Phase`,
    glossaryTerms: uniqueGlossaryTerms(entry.glossaryTerms ?? detectGlossaryTermsFromText(isCustom ? entry.body : entry.text))
  });
  if (!uiState.activeStoryModal) {
    uiState.activeStoryModal = uiState.storyModalQueue.shift();
    uiState.activeGlossaryTerm = null;
  }
}

function dismissStoryModal() {
  if (!uiState.activeStoryModal) return;
  uiState.activeStoryModal = uiState.storyModalQueue.shift() ?? null;
  uiState.activeGlossaryTerm = null;
  rerender();
  maybeRunBot();
}

function openCombatChoiceModal(selection) {
  uiState.pendingCombatChoice = selection;
  rerender();
}

function dismissCombatChoiceModal() {
  if (!uiState.pendingCombatChoice) return;
  uiState.pendingCombatChoice = null;
  rerender();
}

function resolveCombatForSelectedUnit(unitId) {
  const result = store.dispatch({
    type: "RESOLVE_COMBAT_UNIT",
    payload: { playerId: "playerA", unitId }
  });
  if (!result.ok) {
    showError(result.message);
    return;
  }
  uiState.pendingCombatChoice = null;
  autoSelectNextUnit();
  rerender();
}

function confirmCombatChoice(targetId) {
  const selection = uiState.pendingCombatChoice;
  if (!selection) return;
  if (!selection.options?.length) {
    resolveCombatForSelectedUnit(selection.unitId);
    return;
  }
  const retargetResult = store.dispatch({
    type: "SET_CHARGE_PRIMARY_TARGET",
    payload: { playerId: "playerA", unitId: selection.unitId, targetId }
  });
  if (!retargetResult.ok) {
    showError(retargetResult.message);
    return;
  }
  resolveCombatForSelectedUnit(selection.unitId);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderStoryStat(label, value, accent = "") {
  return `<div class="story-stat ${accent}"><div class="story-stat-label">${escapeHtml(label)}</div><div class="story-stat-value">${escapeHtml(value)}</div></div>`;
}

function getUnitName(state, unitId) {
  return state.units[unitId]?.name ?? unitId;
}

function getWeaponName(state, payload) {
  const attacker = state.units[payload.attackerId];
  if (!attacker) return payload.weaponId ?? "attack profile";
  const weaponPool = payload.mode === "melee" ? attacker.meleeWeapons : attacker.rangedWeapons;
  return weaponPool?.find(weapon => weapon.id === payload.weaponId)?.name ?? payload.weaponId ?? "attack profile";
}

function renderStorySection(title, items, accent = "") {
  if (!items?.length) return "";
  return `
    <div class="story-section ${accent}">
      <div class="story-section-title">${escapeHtml(title)}</div>
      <div class="story-summary-list">${items.map(item => `<div class="story-summary-item">${escapeHtml(item)}</div>`).join("")}</div>
    </div>
  `;
}

function normalizeGlossaryTerm(term) {
  return RULE_GLOSSARY[term] ? term : null;
}

function uniqueGlossaryTerms(terms) {
  return [...new Set((terms ?? []).map(normalizeGlossaryTerm).filter(Boolean))];
}

function detectGlossaryTermsFromText(text) {
  const source = String(text ?? "");
  const matches = [];
  for (const term of Object.keys(RULE_GLOSSARY)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(source)) matches.push(term);
  }
  return uniqueGlossaryTerms(matches);
}

function buildGlossaryPanel(terms) {
  const glossaryTerms = uniqueGlossaryTerms(terms);
  if (!glossaryTerms.length) return "";
  const activeTerm = glossaryTerms.includes(uiState.activeGlossaryTerm) ? uiState.activeGlossaryTerm : glossaryTerms[0];
  const definition = RULE_GLOSSARY[activeTerm] ?? "";
  return `
    <div class="story-glossary">
      <div class="story-section-title">Rules In Play</div>
      <div class="story-glossary-chip-row">
        ${glossaryTerms.map(term => `<button class="story-glossary-chip ${term === activeTerm ? "active" : ""}" data-glossary-term="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join("")}
      </div>
      <div class="story-glossary-definition">
        <div class="story-glossary-term">${escapeHtml(activeTerm)}</div>
        <div class="story-glossary-copy">${escapeHtml(definition)}</div>
      </div>
    </div>
  `;
}

function getPhaseTeachingConfig(state) {
  const phase = state.phase;
  if (phase === "movement") {
    return {
      title: "Movement Guide",
      kicker: "How To Play",
      tone: "phase",
      glossaryTerms: ["Hidden", "Burrowed", "Flying"],
      sections: {
        objective: [
          "Get units onto the board, reposition for objectives, and shape the next fight before attacks start.",
          "This is the safest time to improve board position because no attacks resolve in this phase."
        ],
        decisions: [
          "Deploy reserves where they can matter next turn without overexposing them.",
          "Move to claim angles, objective range, or support positions for abilities like Medpack and Force Field.",
          "Decide whether a unit should stay hidden, burrow, or hold back for later phases."
        ],
        watch: [
          "Units that end engaged or out of position can lose better options in Assault.",
          "Burrowed units trade board interaction for safety and special effects.",
          "Flying movement ignores some ground restrictions, but flying units still do not control objectives."
        ]
      }
    };
  }
  if (phase === "assault") {
    return {
      title: "Assault Guide",
      kicker: "How To Play",
      tone: "action",
      glossaryTerms: ["Overwatch", "Instant", "Pinpoint"],
      sections: {
        objective: [
          "Choose what each unit is trying to set up for Combat: run, hold, declare a ranged attack, or declare a charge.",
          "This phase is about declarations and positioning pressure, not immediate damage resolution."
        ],
        decisions: [
          "Declare ranged attacks when you want reliable combat queue pressure without risking a charge roll.",
          "Declare charges when the melee payoff is worth the risk of failing the distance roll or triggering Overwatch.",
          "Run only when the extra movement matters more than giving up ranged declarations this phase."
        ],
        watch: [
          "Charge declarations can trigger Overwatch unless Instant or another rule blocks that reaction.",
          "Target legality matters here: Hidden, engaged status, Pinpoint, and range bands can all change what is allowed.",
          "Every declaration here creates the queue that Combat will resolve next."
        ]
      }
    };
  }
  if (phase === "combat") {
    return {
      title: "Combat Guide",
      kicker: "How To Play",
      tone: "combat",
      glossaryTerms: ["Precision", "Surge", "Critical Hit", "Evade", "Close Ranks", "Fighting Rank", "Supporting Rank"],
      sections: {
        objective: [
          "Resolve the queued attacks in the right order and learn how the attack sequence turns declarations into damage.",
          "This is the phase where the game teaches the core combat math and special-rule timing."
        ],
        decisions: [
          "Pick the right unit to activate first when multiple attacks are queued.",
          "In split melees, choose the primary target that gets your fighting models focused where they matter most.",
          "Watch not just casualties, but also which defensive rules reduced damage and why."
        ],
        watch: [
          "The usual order is hit rolls, wound rolls, armour-pool effects, saves, then damage.",
          "Keywords like Precision, Hits, Surge, Critical Hit, Dodge, and Evade can change different steps of that sequence.",
          "Melee only counts models actually in fighting rank or supporting rank."
        ]
      }
    };
  }
  return null;
}

function buildPhaseTeachingHtml(config) {
  if (!config) return "";
  return `
    <div class="story-lead"><strong>${escapeHtml(config.title)}</strong></div>
    ${renderStorySection("What You Are Trying To Do", config.sections.objective, "teaching")}
    ${renderStorySection("Good Decisions To Look For", config.sections.decisions)}
    ${renderStorySection("Rules To Watch", config.sections.watch, "next")}
  `;
}

function buildCombatPayloadBlock(payload, state) {
  const attacker = getUnitName(state, payload.attackerId);
  const target = getUnitName(state, payload.targetId);
  const weapon = getWeaponName(state, payload);
  const actionLabel = payload.mode === "overwatch"
    ? "Overwatch"
    : payload.mode === "melee"
      ? "Charge Attack"
      : "Ranged Attack";
  const casualtiesAccent = payload.casualties > 0 ? "impact" : "";
  const chips = [
    actionLabel,
    payload.visible === false ? "Indirect Fire" : "",
    payload.longRangePenalty ? "Long Range Penalty" : "",
    payload.antiEvade ? `Anti-Evade ${payload.antiEvade}` : "",
    payload.automaticHits ? `Hits ${payload.automaticHits.count}` : "",
    payload.damagePerHit && payload.damagePerHit > 1 ? `Damage ${payload.damagePerHit}` : "",
    payload.primaryTargetFocus ? "Primary Target" : ""
  ].filter(Boolean);

  const statGrid = `
    <div class="story-stat-grid">
      ${renderStoryStat("Attacks", payload.attempts)}
      ${renderStoryStat("Hits", payload.hits)}
      ${payload.precision ? renderStoryStat("Precision", payload.precision, "success") : ""}
      ${payload.automaticHits ? renderStoryStat("Auto Hits", payload.automaticHits.count, "impact") : ""}
      ${renderStoryStat("Wounds", payload.wounds)}
      ${payload.criticalHit?.applied ? renderStoryStat("Crit", payload.criticalHit.applied, "impact") : ""}
      ${payload.surge?.applied ? renderStoryStat("Surge", payload.surge.applied, "impact") : ""}
      ${payload.dodge?.prevented ? renderStoryStat("Dodge", payload.dodge.prevented, "success") : ""}
      ${renderStoryStat("Saves", payload.saved)}
      ${payload.evade?.saved ? renderStoryStat("Evade", payload.evade.saved, "success") : ""}
      ${renderStoryStat("Damage", payload.totalDamage, payload.totalDamage > 0 ? "impact" : "")}
      ${renderStoryStat("Casualties", payload.casualties, casualtiesAccent)}
      ${payload.fightingRank != null ? renderStoryStat("Fight Rank", payload.fightingRank, "success") : ""}
      ${payload.supportingRank != null ? renderStoryStat("Support", payload.supportingRank, "success") : ""}
      ${payload.assignedModels != null ? renderStoryStat("Assigned", payload.assignedModels, "success") : ""}
    </div>
  `;

  const notes = [];
  if (payload.impact) {
    notes.push(payload.impact.preventedByHidden
      ? `Impact was negated because ${target} stayed hidden.`
      : `Impact rolled ${payload.impact.attempts} dice, landed ${payload.impact.hits} hits, and caused ${payload.impact.casualties} casualties before the main attack.`);
  }
  if (payload.surge?.applied) {
    notes.push(`Surge rolled ${payload.surge.roll} on ${payload.surge.dice} and turned ${payload.surge.applied} wound(s) into bypassed armour against ${payload.surge.matchedTags.join("/")}.`);
  }
  if (payload.automaticHits?.count) {
    notes.push(`Hits added ${payload.automaticHits.count} automatic armour-pool hit(s) at ${payload.automaticHits.damage} damage each, and they did not roll to wound or generate Surge.`);
  }
  if (payload.criticalHit?.applied) {
    notes.push(`Critical Hit pushed ${payload.criticalHit.applied} wound(s) straight past armour.`);
  }
  if (payload.dodge?.prevented) {
    notes.push(`${target} used Dodge to cancel ${payload.dodge.prevented} bypassed hit(s).`);
  }
  if (payload.evade?.saved) {
    notes.push(`${target} avoided ${payload.evade.saved} hit(s) on ${payload.evade.target}+ evade.`);
  }
  if (payload.ancillaryCarapace) {
    notes.push(`${target} improved its armour roll with Ancillary Carapace.`);
  }
  if (payload.objectiveDefenseBonus) {
    notes.push(`${target} gained +${payload.objectiveDefenseBonus} armour from objective positioning.`);
  }
  if (payload.burstFire?.bonusAttacks) {
    notes.push(`${attacker} gained +${payload.burstFire.bonusAttacks} attacks from Burst Fire at close range.`);
  }
  if (payload.lockedIn) {
    notes.push(`${attacker} gained +${payload.lockedIn} attacks because ${target} was stationary.`);
  }
  if (payload.lifeSupport?.reducedBy) {
    notes.push(`Life Support reduced the damage that got through by ${payload.lifeSupport.reducedBy}.`);
  }
  if (payload.zealousRound?.reducedBy) {
    notes.push(`Zealous Round reduced the damage that got through by ${payload.zealousRound.reducedBy} and activated ${target}.`);
  }
  if (payload.concentratedFire?.cap) {
    notes.push(
      payload.concentratedFire.discardedDamage > 0
        ? `Concentrated Fire capped casualties at ${payload.concentratedFire.cap} and discarded ${payload.concentratedFire.discardedDamage} excess damage.`
        : `Concentrated Fire capped casualties at ${payload.concentratedFire.cap}.`
    );
  }

  const ruleNotes = [
    `Attack order here is: hit rolls, wound rolls, armour-pool effects, saves, then damage.`,
    payload.precision ? `Precision moved ${payload.precision} failed hit dice straight into the armour pool, so those dice counted as hits without rolling to wound.` : null,
    payload.automaticHits?.count ? `Hits adds automatic armour-pool hits. Those dice skip the hit and wound steps and do not generate Surge.` : null,
    payload.surge?.applied ? `Surge happens after wounds are created. Matching wounds are pushed past armour before normal saves are rolled.` : null,
    payload.criticalHit?.applied ? `Critical Hit bypasses armour by moving wounds straight toward damage before save rolls.` : null,
    payload.dodge?.prevented ? `Dodge cancels a limited number of bypass-armour hits before damage is applied.` : null,
    payload.evade?.saved ? `Evade happens after armour results are known, letting the defender avoid hits that would otherwise deal damage.` : null,
    payload.visible === false ? `Indirect Fire let this attack ignore line of sight for targeting.` : null,
    payload.longRangePenalty ? `Long Range extended the shot beyond base range, but the attack paid a hit penalty to do it.` : null,
    payload.burstFire?.bonusAttacks ? `Burst Fire increases attack volume when the target is inside the weapon's close-range band.` : null,
    payload.lockedIn ? `Locked In adds attacks because the target counted as stationary when this shot was resolved.` : null,
    payload.antiEvade ? `Anti-Evade makes the defender's evade roll harder.` : null,
    payload.fightingRank != null ? `Only models in fighting rank, plus models supporting them from base contact, were allowed to contribute to this melee batch.` : null
  ].filter(Boolean);

  const nextStepNotes = [
    payload.casualties > 0 ? `${target} lost ${payload.casualties} model(s), so its supply and board presence may have changed immediately.` : `${target} kept all of its models alive through this exchange.`,
    payload.mode === "melee"
      ? (payload.totalDamage > 0 ? `This was a melee resolution, so the result can change who stays engaged and who can strike back next.` : `No damage got through in melee, so the units may stay tied up for later combat activations.`)
      : `This attack was queued from Assault and resolved in Combat, so the next important step is the next combat activation or reaction already in queue.`
  ].filter(Boolean);

  return `
    <div class="story-lead"><strong>${escapeHtml(attacker)}</strong> resolved a ${escapeHtml(actionLabel.toLowerCase())} into <strong>${escapeHtml(target)}</strong> with <strong>${escapeHtml(weapon)}</strong>.</div>
    ${statGrid}
    <div class="story-note-row">
      ${chips.map(chip => `<span class="story-chip">${escapeHtml(chip)}</span>`).join("")}
    </div>
    ${renderStorySection("What Happened", notes)}
    ${renderStorySection("Why It Worked", ruleNotes, "teaching")}
    ${renderStorySection("What This Means", nextStepNotes, "next")}
  `;
}

function getCombatPayloadGlossaryTerms(payload) {
  return uniqueGlossaryTerms([
    payload.mode === "overwatch" ? "Overwatch" : null,
    payload.impact ? "Impact" : null,
    payload.surge?.applied ? "Surge" : null,
    payload.automaticHits ? "Hits" : null,
    payload.precision ? "Precision" : null,
    payload.criticalHit?.applied ? "Critical Hit" : null,
    payload.dodge?.prevented ? "Dodge" : null,
    payload.evade?.saved ? "Evade" : null,
    payload.visible === false ? "Indirect Fire" : null,
    payload.longRangePenalty ? "Long Range" : null,
    payload.burstFire?.bonusAttacks ? "Burst Fire" : null,
    payload.lockedIn ? "Locked In" : null,
    payload.antiEvade ? "Anti-Evade" : null,
    payload.concentratedFire?.cap ? "Concentrated Fire" : null,
    payload.lifeSupport?.reducedBy ? "Life Support" : null,
    payload.zealousRound?.reducedBy ? "Zealous Round" : null,
    payload.fightingRank != null ? "Fighting Rank" : null,
    payload.supportingRank != null ? "Supporting Rank" : null
  ]);
}

function buildStoryBlock(text) {
  const combatMatch = text.match(/^(.*?) (attacks|fires overwatch at|charges) (.*?) with (.*?): (\d+) attacks, (\d+) hits(?: \(including (\d+) Precision\))?, (\d+) wounds(?:, Critical Hit (\d+) bypassed armour)?(?:, Surge (.*?) rolled (\d+) vs (.*?) -> (\d+) bypassed armour)?(?:, Dodge prevented (\d+) bypassed hits)?, (\d+) saves(?: \((cover)\))?(?:, (\d+) evade saves on (\d+)\+)?(?:, indirect fire without line of sight)?(?:, long range penalty applied)?(?:, Burst Fire \+(\d+))?(?:, Locked In \+(\d+))?(?:, Anti-Evade (\d+))?(?:, Pierce damage (\d+))?(?:, Zealous Round reduced damage by (\d+))?(?:, Concentrated Fire cap (\d+)(?: \(discarded (\d+) damage\))?)?(?:, Fighting Rank (\d+), Supporting Rank (\d+), Assigned Models (\d+)(?:, Primary Target Focus)?)?, (\d+) casualties\.$/);
  if (combatMatch) {
      const [, attacker, verb, target, weapon, attacks, hits, precisionApplied, wounds, criticalApplied, surgeDie, surgeRoll, surgeTags, surgeApplied, dodgePrevented, saves, cover, evadeSaved, evadeTarget, burstFireBonus, lockedInBonus, antiEvade, pierceDamage, zealousRoundReduced, concentratedFireCap, concentratedFireDiscarded, fightingRank, supportingRank, assignedModels, casualties] = combatMatch;
      const longRangeApplied = text.includes("long range penalty applied");
      const indirectFireApplied = text.includes("indirect fire without line of sight");
      const primaryTargetFocus = text.includes("Primary Target Focus");
      const actionLabel = verb === "fires overwatch at" ? "Overwatch" : verb === "charges" ? "Charge Attack" : "Ranged Attack";
      return `
        <div class="story-lead"><strong>${escapeHtml(attacker)}</strong> resolved a ${escapeHtml(actionLabel.toLowerCase())} into <strong>${escapeHtml(target)}</strong> with <strong>${escapeHtml(weapon)}</strong>.</div>
        <div class="story-stat-grid">
          ${renderStoryStat("Attacks", attacks)}
          ${renderStoryStat("Hits", hits)}
          ${precisionApplied ? renderStoryStat("Precision", precisionApplied, "success") : ""}
          ${renderStoryStat("Wounds", wounds)}
          ${criticalApplied ? renderStoryStat("Crit", criticalApplied, "impact") : ""}
          ${surgeApplied ? renderStoryStat("Surge", surgeApplied, Number(surgeApplied) > 0 ? "impact" : "") : ""}
          ${burstFireBonus ? renderStoryStat("Burst", burstFireBonus, "success") : ""}
          ${lockedInBonus ? renderStoryStat("Locked In", lockedInBonus, "success") : ""}
          ${zealousRoundReduced ? renderStoryStat("Zealous", zealousRoundReduced, "success") : ""}
          ${fightingRank ? renderStoryStat("Fight Rank", fightingRank, "success") : ""}
          ${supportingRank ? renderStoryStat("Support", supportingRank, "success") : ""}
          ${assignedModels ? renderStoryStat("Assigned", assignedModels, "success") : ""}
          ${dodgePrevented ? renderStoryStat("Dodge", dodgePrevented, "success") : ""}
          ${renderStoryStat("Saves", saves)}
          ${evadeSaved ? renderStoryStat("Evade", evadeSaved, "success") : ""}
          ${renderStoryStat("Casualties", casualties, Number(casualties) > 0 ? "impact" : "")}
        </div>
        <div class="story-note-row">
          <span class="story-chip">${escapeHtml(actionLabel)}</span>
          ${criticalApplied ? `<span class="story-chip">Critical Hit bypassed ${escapeHtml(criticalApplied)}</span>` : ""}
          ${surgeApplied ? `<span class="story-chip">Surge ${escapeHtml(surgeDie)} rolled ${escapeHtml(surgeRoll)} vs ${escapeHtml(surgeTags)}</span>` : ""}
          ${dodgePrevented ? `<span class="story-chip">Dodge cancelled ${escapeHtml(dodgePrevented)} bypass hits</span>` : ""}
          ${evadeSaved ? `<span class="story-chip">Evade ${escapeHtml(evadeSaved)} on ${escapeHtml(evadeTarget)}+</span>` : ""}
          ${indirectFireApplied ? '<span class="story-chip">Indirect Fire</span>' : ""}
          ${longRangeApplied ? '<span class="story-chip">Long Range Penalty</span>' : ""}
          ${burstFireBonus ? `<span class="story-chip">Burst Fire +${escapeHtml(burstFireBonus)}</span>` : ""}
          ${lockedInBonus ? `<span class="story-chip">Locked In +${escapeHtml(lockedInBonus)}</span>` : ""}
          ${zealousRoundReduced ? `<span class="story-chip">Zealous Round -${escapeHtml(zealousRoundReduced)} damage</span>` : ""}
          ${fightingRank ? `<span class="story-chip">Fighting Rank ${escapeHtml(fightingRank)}</span>` : ""}
          ${supportingRank ? `<span class="story-chip">Supporting Rank ${escapeHtml(supportingRank)}</span>` : ""}
          ${assignedModels ? `<span class="story-chip">Assigned Models ${escapeHtml(assignedModels)}</span>` : ""}
          ${primaryTargetFocus ? '<span class="story-chip">Primary Target</span>' : ""}
          ${antiEvade ? `<span class="story-chip">Anti-Evade ${escapeHtml(antiEvade)}</span>` : ""}
          ${pierceDamage ? `<span class="story-chip">Pierce Damage ${escapeHtml(pierceDamage)}</span>` : ""}
          ${concentratedFireCap ? `<span class="story-chip">Concentrated Fire ${escapeHtml(concentratedFireCap)}${concentratedFireDiscarded ? `, discarded ${escapeHtml(concentratedFireDiscarded)}` : ""}</span>` : ""}
          ${cover ? '<span class="story-chip">Target in Cover</span>' : ""}
        </div>
      `;
    }

  const hiddenImpactMatch = text.match(/^(.*?) triggers Impact against (.*?), but the target stays hidden and avoids the collision\.$/);
  if (hiddenImpactMatch) {
    const [, attacker, target] = hiddenImpactMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(target)}</strong> stayed concealed and avoided <strong>${escapeHtml(attacker)}</strong>'s impact strike.</div>
      <div class="story-note-row">
        <span class="story-chip">Impact Negated</span>
        <span class="story-chip">Hidden Target</span>
      </div>
    `;
  }

  const impactMatch = text.match(/^(.*?) triggers Impact against (.*?): (\d+) impact dice, (\d+) impact hits, (\d+) saves, (\d+) casualties\.$/);
  if (impactMatch) {
    const [, attacker, target, attempts, hits, saves, casualties] = impactMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(attacker)}</strong> crashed into <strong>${escapeHtml(target)}</strong> on the charge.</div>
      <div class="story-stat-grid">
        ${renderStoryStat("Impact Dice", attempts)}
        ${renderStoryStat("Impact Hits", hits)}
        ${renderStoryStat("Saves", saves)}
        ${renderStoryStat("Casualties", casualties, Number(casualties) > 0 ? "impact" : "")}
      </div>
      <div class="story-note-row">
        <span class="story-chip">Impact</span>
        <span class="story-chip">Damage 1</span>
      </div>
    `;
  }

  const chargeRollMatch = text.match(/^(.*?) attempts a charge on (.*?): distance ([\d.]+)", need (\d+)", rolled (\d+) \+ Speed (\d+) = (\d+)\. (Success|Failed) by (\d+)"\.$/);
  if (chargeRollMatch) {
    const [, attacker, target, distance, need, die, speed, total, resultWord, margin] = chargeRollMatch;
    const success = resultWord === "Success";
    return `
      <div class="story-lead"><strong>${escapeHtml(attacker)}</strong> tried to reach <strong>${escapeHtml(target)}</strong>.</div>
      <div class="story-stat-grid">
        ${renderStoryStat("Distance", `${distance}"`)}
        ${renderStoryStat("Needed", `${need}"`)}
        ${renderStoryStat("Die", die)}
        ${renderStoryStat("Speed", speed)}
        ${renderStoryStat("Total", total, success ? "success" : "warning")}
      </div>
      <div class="story-outcome ${success ? "success" : "warning"}">${success ? `Charge succeeded by ${margin}".` : `Charge failed by ${margin}".`}</div>
      ${renderStorySection("Why It Worked", [`Charge total = die + Speed. That total must meet or beat the distance needed to end in melee range.`], "teaching")}
    `;
  }

  const overwatchMatch = text.match(/^(.*?) sets Overwatch response against (.*?)\.$/);
  if (overwatchMatch) {
    const [, defender, attacker] = overwatchMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(defender)}</strong> has reacted to <strong>${escapeHtml(attacker)}</strong>.</div>
      <div class="story-outcome warning">An Overwatch attack is now queued and will resolve in Combat.</div>
      ${renderStorySection("Why It Worked", [`Overwatch is a reaction to a charge declaration. The defender gets to fire before the charge attack resolves unless another rule blocks that reaction.`], "teaching")}
    `;
  }

  const instantMatch = text.match(/^(.*?)'s (.*?) has Instant, so (.*?) cannot react with Overwatch\.$/);
  if (instantMatch) {
    const [, attacker, weapon, defender] = instantMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(attacker)}</strong> struck first with <strong>${escapeHtml(weapon)}</strong>.</div>
      <div class="story-outcome success"><strong>${escapeHtml(defender)}</strong> loses the Overwatch reaction window because of Instant.</div>
      <div class="story-note-row">
        <span class="story-chip">Instant</span>
        <span class="story-chip">Overwatch Blocked</span>
      </div>
    `;
  }

  const rangedDeclMatch = text.match(/^(.*?) declares ranged attack on (.*?) for Combat\.$/);
  if (rangedDeclMatch) {
    const [, attacker, target] = rangedDeclMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(attacker)}</strong> has targeted <strong>${escapeHtml(target)}</strong>.</div>
      <div class="story-outcome">That attack is locked into the Combat Phase queue.</div>
      ${renderStorySection("Why It Worked", [`Ranged attacks are declared in Assault, but they resolve later in Combat. This popup means the target was legal and the attack is now queued.`], "teaching")}
    `;
  }

  const chargeLockMatch = text.match(/^(.*?) locks in the charge and will fight (.*?) in Combat\.$/);
  if (chargeLockMatch) {
    const [, attacker, target] = chargeLockMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(attacker)}</strong> will make a melee attack against <strong>${escapeHtml(target)}</strong>.</div>
      <div class="story-outcome success">The charge is confirmed and queued for Combat.</div>
      ${renderStorySection("Why It Worked", [`The charge roll was high enough to reach melee range, so the unit gets a charge attack in Combat.`], "teaching")}
    `;
  }

  const chargeFailMatch = text.match(/^(.*?) fails the charge and will not make a melee attack this round\.$/);
  if (chargeFailMatch) {
    const [, attacker] = chargeFailMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(attacker)}</strong> did not get in.</div>
      <div class="story-outcome warning">No melee attack was queued from this charge attempt.</div>
      ${renderStorySection("Why It Worked", [`The charge total came up short, so the unit keeps its activation but does not gain a melee attack from that declaration.`], "teaching")}
    `;
  }

  const closeRanksMatch = text.match(/^(.*?) closes ranks and emerges from Burrowed formation(?: against (.*?))?\.$/);
  if (closeRanksMatch) {
    const [, unitName, targetName] = closeRanksMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(unitName)}</strong> surfaced and tightened formation${targetName ? ` before fighting <strong>${escapeHtml(targetName)}</strong>` : ""}.</div>
      <div class="story-outcome success">Burrowed and Hidden are removed, and the melee sequence continues above ground.</div>
      <div class="story-note-row">
        <span class="story-chip">Close Ranks</span>
        <span class="story-chip">Burrowed Removed</span>
      </div>
      ${renderStorySection("Why It Worked", [`A burrowed unit cannot stay concealed while completing melee above ground, so Close Ranks surfaces it before the attack finishes resolving.`], "teaching")}
    `;
  }

  const noAssignedModelsMatch = text.match(/^(.*?) has no models assigned to (.*?) after target allocation and cannot make melee attacks\.$/);
  if (noAssignedModelsMatch) {
    const [, attacker, target] = noAssignedModelsMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(attacker)}</strong> could not put any fighting or supporting models into <strong>${escapeHtml(target)}</strong>.</div>
      <div class="story-outcome warning">That melee batch was skipped after target allocation.</div>
      <div class="story-note-row">
        <span class="story-chip">Target Allocation</span>
        <span class="story-chip">No Assigned Models</span>
      </div>
    `;
  }

  const medpackMatch = text.match(/^(.*?) uses Medpack on (.*?): (\d+) support in range, (\d+) wound\(s\) restored\.$/);
  if (medpackMatch) {
    const [, source, target, supportPoints, healed] = medpackMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(source)}</strong> treated <strong>${escapeHtml(target)}</strong>.</div>
      <div class="story-stat-grid">
        ${renderStoryStat("Support", supportPoints, "success")}
        ${renderStoryStat("Healed", healed, Number(healed) > 0 ? "success" : "")}
      </div>
      <div class="story-outcome success">${escapeHtml(target)} regains ${escapeHtml(healed)} wound(s) right now.</div>
      ${renderStorySection("Why It Worked", [`Medpack checks nearby support first, then restores wounds immediately. It helps damaged models but does not bring destroyed models back.`], "teaching")}
    `;
  }

  const opticalFlareMatch = text.match(/^(.*?) uses Optical Flare on (.*?): Range -4 this round, no Long Range\.$/);
  if (opticalFlareMatch) {
    const [, source, target] = opticalFlareMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(source)}</strong> blinds <strong>${escapeHtml(target)}</strong> with Optical Flare.</div>
      <div class="story-outcome warning">${escapeHtml(target)} loses 4" of ranged weapon range for this round and cannot use Long Range.</div>
      <div class="story-note-row">
        <span class="story-chip">Range -4</span>
        <span class="story-chip">No Long Range</span>
        <span class="story-chip">Until End of Round</span>
      </div>
      ${renderStorySection("Why It Worked", [`Optical Flare is a ranged debuff. It shortens the target's ranged reach and shuts off Long Range for the rest of the round.`], "teaching")}
    `;
  }

  const lifeSupportMatch = text.match(/^(.*?) gains Life Support: (.*?) reduce incoming damage by (\d+)\.$/);
  if (lifeSupportMatch) {
    const [, target, sources, reducedBy] = lifeSupportMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(target)}</strong> is kept alive by nearby medics.</div>
      <div class="story-outcome success">Life Support cuts the incoming damage by ${escapeHtml(reducedBy)} before it is applied.</div>
      <div class="story-note-row">
        <span class="story-chip">${escapeHtml(sources)}</span>
      </div>
      ${renderStorySection("Why It Worked", [`Life Support reduces damage after the attack gets through, which can keep models alive even after hits and failed saves are already known.`], "teaching")}
    `;
  }

  const zealousRoundMatch = text.match(/^(.*?) uses Zealous Round, counts as activated in (.*?), and reduces incoming damage by (\d+)\.$/);
  if (zealousRoundMatch) {
    const [, target, phase, reducedBy] = zealousRoundMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(target)}</strong> spends Zealous Round to endure the hit.</div>
      <div class="story-outcome success">Incoming damage is reduced by ${escapeHtml(reducedBy)}, and the unit counts as activated in ${escapeHtml(phase)}.</div>
      <div class="story-note-row">
        <span class="story-chip">Activated in ${escapeHtml(phase)}</span>
        <span class="story-chip">Damage -${escapeHtml(reducedBy)}</span>
      </div>
      ${renderStorySection("Why It Worked", [`Zealous Round trades the unit's unused activation in this phase for damage reduction right now.`], "teaching")}
    `;
  }

  const burrowToggleMatch = text.match(/^(.*?) burrows and becomes Hidden\.$/);
  if (burrowToggleMatch) {
    const [, unitName] = burrowToggleMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(unitName)}</strong> burrows underground.</div>
      <div class="story-outcome success">The unit gains Burrowed and Hidden.</div>
      <div class="story-note-row">
        <span class="story-chip">Burrowed</span>
        <span class="story-chip">Hidden</span>
      </div>
    `;
  }

  const emergeMatch = text.match(/^(.*?) emerges and loses Burrowed\.$/);
  if (emergeMatch) {
    const [, unitName] = emergeMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(unitName)}</strong> emerges from underground.</div>
      <div class="story-outcome">Burrowed is removed, and the unit is no longer protected by that state.</div>
      <div class="story-note-row">
        <span class="story-chip">Burrowed Removed</span>
      </div>
    `;
  }

  const hiddenToggleMatch = text.match(/^(.*?) becomes Hidden\.$/);
  if (hiddenToggleMatch) {
    const [, unitName] = hiddenToggleMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(unitName)}</strong> slips out of sight.</div>
      <div class="story-outcome success">The unit becomes Hidden until it reveals itself or an enemy gets close enough.</div>
      <div class="story-note-row">
        <span class="story-chip">Hidden</span>
      </div>
    `;
  }

  const revealMatch = text.match(/^(.*?) reveals itself and loses Hidden\.$/);
  if (revealMatch) {
    const [, unitName] = revealMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(unitName)}</strong> is no longer concealed.</div>
      <div class="story-outcome">Hidden is removed, so the unit can be targeted normally again.</div>
      <div class="story-note-row">
        <span class="story-chip">Hidden Removed</span>
      </div>
    `;
  }

  const regenMatch = text.match(/^(.*?) regenerates (\d+) wounds? while burrowed\.$/);
  if (regenMatch) {
    const [, unitName, healed] = regenMatch;
    return `
      <div class="story-lead"><strong>${escapeHtml(unitName)}</strong> regenerates while underground.</div>
      <div class="story-outcome success">${escapeHtml(healed)} wound(s) are restored because the unit activated while Burrowed.</div>
      <div class="story-note-row">
        <span class="story-chip">Burrowed Regen</span>
      </div>
    `;
  }

  const cardMatch = text.match(/^(Blue|Red) plays (.*?)(?: on (.*?))?\.$/);
  if (cardMatch) {
    const [, player, cardName, target] = cardMatch;
    const cardEntry = Object.values(TACTICAL_CARDS).find(card => card?.name === cardName);
    const effectSummary = cardEntry ? describeTacticalCardForModal(cardEntry, target) : "Its effect is now active.";
    return `
      <div class="story-lead"><strong>${escapeHtml(player)}</strong> used <strong>${escapeHtml(cardName)}</strong>${target ? ` on <strong>${escapeHtml(target)}</strong>` : ""}.</div>
      <div class="story-outcome">${escapeHtml(effectSummary)}</div>
      ${renderStorySection("What To Watch For", [`The effect is now live on its allowed target and timing window. The next relevant roll, move, or phase step will use the modified values.`], "next")}
    `;
  }

  const sentences = text.split(/(?<=\.)\s+/).filter(Boolean);
  return sentences.map(sentence => `<div class="story-paragraph">${escapeHtml(sentence)}</div>`).join("");
}

function buildStoryModalBody(modal) {
  if (modal.htmlBody) return modal.htmlBody;
  const blocks = String(modal.body).split("\n").filter(Boolean);
  if (blocks.length <= 1) return buildStoryBlock(blocks[0] ?? "");
  return blocks.map((block, index) => `<div class="story-sequence-block ${index > 0 ? "stacked" : ""}">${buildStoryBlock(block)}</div>`).join("");
}

function renderStoryModal() {
  const root = document.getElementById("storyModalRoot");
  if (!root) return;
  root.className = uiState.activeStoryModal ? "story-modal-root active" : "story-modal-root";
  if (!uiState.activeStoryModal) {
    root.innerHTML = "";
    return;
  }

  const modal = uiState.activeStoryModal;
  const glossaryPanel = buildGlossaryPanel(modal.glossaryTerms);
  root.innerHTML = `
    <div class="story-modal-backdrop"></div>
    <section class="story-modal ${modal.tone}" role="dialog" aria-modal="true" aria-labelledby="storyModalTitle">
      <div class="story-modal-header">
        <div>
          <div class="story-modal-kicker">${modal.kicker}</div>
          <div id="storyModalTitle" class="story-modal-title">${modal.title}</div>
          <div class="story-modal-subtitle">${modal.subtitle}</div>
        </div>
      </div>
      <div class="story-modal-body">
        ${buildStoryModalBody(modal)}
        ${glossaryPanel}
      </div>
      <div class="story-modal-footer">
        <div class="story-modal-queue">${uiState.storyModalQueue.length ? `${uiState.storyModalQueue.length} more update(s) queued.` : "No more queued updates."}</div>
        <button id="storyModalCloseBtn" class="btn primary story-modal-close">Continue</button>
      </div>
    </section>
  `;

  root.querySelector(".story-modal-backdrop")?.addEventListener("click", dismissStoryModal);
  root.querySelector("#storyModalCloseBtn")?.addEventListener("click", dismissStoryModal);
  root.querySelectorAll("[data-glossary-term]").forEach(button => {
    button.addEventListener("click", () => {
      uiState.activeGlossaryTerm = button.getAttribute("data-glossary-term");
      rerender();
    });
  });
}

function renderCombatChoiceModal() {
  const root = document.getElementById("combatChoiceRoot");
  if (!root) return;

  const selection = uiState.pendingCombatChoice;
  if (!selection) {
    root.className = "combat-choice-root";
    root.innerHTML = "";
    return;
  }

  root.className = "combat-choice-root active";
  root.innerHTML = `
    <div class="combat-choice-backdrop"></div>
    <section class="combat-choice-modal" role="dialog" aria-modal="true" aria-labelledby="combatChoiceTitle">
      <header class="combat-choice-header">
        <div>
          <div class="combat-choice-kicker">Combat Sequence</div>
          <h2 id="combatChoiceTitle" class="combat-choice-title">Review how ${escapeHtml(selection.attackerName)} resolves this activation.</h2>
          <div class="combat-choice-subtitle">${selection.options?.length
            ? "This charge is tied into multiple enemies. Review the sequence, then pick the unit that gets primary target focus."
            : "Review the numbered steps below, then resolve the activation when you are ready."}</div>
        </div>
      </header>
      <div class="combat-choice-body">
        <div class="combat-choice-sequence">
          ${(selection.steps ?? []).map((step, index) => `
            <div class="combat-sequence-step ${step.kind === "close_ranks" ? "support" : ""}">
              <div class="combat-sequence-order">${index + 1}</div>
              <div class="combat-sequence-copy">
                <div class="combat-sequence-label">${escapeHtml(step.label)}</div>
                <div class="combat-sequence-detail">${escapeHtml(step.detail)}</div>
              </div>
              ${step.targetName ? `<span class="combat-choice-chip ${step.isPrimaryTarget ? "current" : ""}">${escapeHtml(step.targetName)}</span>` : ""}
            </div>
          `).join("")}
        </div>
        ${selection.options?.length ? '<div class="combat-choice-section-title">Choose Primary Target Focus</div>' : ""}
        ${(selection.options ?? []).map(option => `
          <button class="combat-choice-option ${option.isCurrentPrimary ? "current" : ""}" data-target-id="${escapeHtml(option.targetId)}">
            <div class="combat-choice-option-header">
              <div>
                <div class="combat-choice-option-name">${escapeHtml(option.name)}</div>
                <div class="combat-choice-option-meta">${option.isCurrentPrimary ? "Current focus" : "Available focus"}</div>
              </div>
              <span class="combat-choice-chip">${option.assignedModels} assigned</span>
            </div>
            <div class="combat-choice-stats">
              ${renderStoryStat("Fighting Rank", option.fightingRank)}
              ${renderStoryStat("Supporting Rank", option.supportingRank)}
              ${renderStoryStat("Assigned", option.assignedModels, option.isCurrentPrimary ? "success" : "")}
            </div>
          </button>
        `).join("")}
      </div>
      <footer class="combat-choice-footer">
        <div class="combat-choice-footer-copy">${selection.options?.length ? "Pick a target to resolve this melee sequence." : "Resolve this activation in the order shown above."}</div>
        ${selection.options?.length ? "" : '<button id="combatChoiceResolveBtn" class="btn primary">Resolve Sequence</button>'}
        <button id="combatChoiceCancelBtn" class="btn secondary">Cancel</button>
      </footer>
    </section>
  `;

  root.querySelector(".combat-choice-backdrop")?.addEventListener("click", dismissCombatChoiceModal);
  root.querySelector("#combatChoiceCancelBtn")?.addEventListener("click", dismissCombatChoiceModal);
  root.querySelector("#combatChoiceResolveBtn")?.addEventListener("click", () => confirmCombatChoice(null));
  root.querySelectorAll("[data-target-id]").forEach(button => {
    button.addEventListener("click", () => confirmCombatChoice(button.getAttribute("data-target-id")));
  });
}

function getNotificationTone(logEntryType) {
  if (["charge_declared", "combat_resolved", "phase_advanced", "round_scored", "game_won"].includes(logEntryType)) return "success";
  if (["disengage_failed", "invalid_action", "cannot_act", "coherency_warning"].includes(logEntryType)) return "warn";
  return "info";
}

function shouldUseModalForEntry(entry) {
  if (["combat", "phase", "score", "card"].includes(entry.type)) return true;
  if (entry.type !== "action") return false;
  return [
    "attempts a charge",
    "declares ranged attack",
    "has Instant",
    "closes ranks",
    "sets Overwatch",
    "locks in the charge",
    "fails the charge"
  ].some(fragment => entry.text.includes(fragment));
}

function isChargeSequenceAction(entry) {
  return entry.type === "action" && [
    "has Instant",
    "closes ranks",
    "sets Overwatch",
    "attempts a charge",
    "locks in the charge",
    "fails the charge"
  ].some(fragment => entry.text.includes(fragment));
}

function buildModalFromEntries(entries, state, title, kicker, tone, options = {}) {
  queueStoryModal({
    type: "custom",
    tone,
    kicker,
    title,
    body: entries.map(entry => entry.text).join("\n"),
    htmlBody: options.htmlBody ?? null,
    subtitle: `Round ${state.round} • ${state.phase[0].toUpperCase()}${state.phase.slice(1)} Phase`,
    glossaryTerms: options.glossaryTerms ?? []
  }, state);
}

function buildCombatModalFromEvents(events, state) {
  if (!events.length) return;
  const glossaryTerms = uniqueGlossaryTerms(events.flatMap(event => getCombatPayloadGlossaryTerms(event.payload)));
  buildModalFromEntries(
    [],
    state,
    events.length > 1 ? "Combat Sequence" : "Attack Resolved",
    "Combat Result",
    "combat",
    {
      htmlBody: events
        .map((event, index) => `<div class="story-sequence-block ${index > 0 ? "stacked" : ""}">${buildCombatPayloadBlock(event.payload, state)}</div>`)
        .join(""),
      glossaryTerms
    }
  );
}

function getToastConfig(entry) {
  if (entry.type === "action") {
    if (entry.text.includes("deploys")) return { title: "Deployment", prominent: true, durationMs: 7000 };
    if (entry.text.includes("moves")) return { title: "Movement", prominent: true, durationMs: 6500 };
    if (entry.text.includes("runs")) return { title: "Run", prominent: true, durationMs: 6500 };
    if (entry.text.includes("disengages")) return { title: "Disengage", prominent: true, durationMs: 7000 };
    if (entry.text.includes("holds position")) return { title: "Hold", prominent: false, durationMs: 4500 };
    if (entry.text.includes("declares ranged attack")) return { title: "Attack Declared", prominent: true, durationMs: 6500 };
    if (entry.text.includes("sets Overwatch")) return { title: "Overwatch", prominent: true, durationMs: 6500 };
    if (entry.text.includes("locks in the charge")) return { title: "Charge Confirmed", prominent: true, durationMs: 6500 };
    if (entry.text.includes("fails the charge")) return { title: "Charge Failed", prominent: true, durationMs: 7000 };
  }
  if (entry.type === "info") {
    return { title: "Battlefield", prominent: false, durationMs: 5200 };
  }
  return { title: "Update", prominent: false, durationMs: 5200 };
}

function getToastMessage(entry) {
  const text = entry.text;

  const deployMatch = text.match(/^(.*?) deploys from reserves(?: via deep strike)?\.(.*)$/);
  if (deployMatch) {
    const [, unitName, extra] = deployMatch;
    return `${unitName} enters the battlefield from reserves.${extra ? ` ${extra.trim()}` : ""}`.trim();
  }

  const moveMatch = text.match(/^(.*?) moves ([\d.]+)"\.(.*)$/);
  if (moveMatch) {
    const [, unitName, distanceMoved, extra] = moveMatch;
    return `${unitName} repositions ${distanceMoved}".${extra ? ` ${extra.trim()}` : ""}`.trim();
  }

  const runMatch = text.match(/^(.*?) runs ([\d.]+)" \(movement cost ([\d.]+) \/ max ([\d.]+)\)\.(.*)$/);
  if (runMatch) {
    const [, unitName, distanceMoved, cost, max, extra] = runMatch;
    return `${unitName} sprints ${distanceMoved}" across the battlefield (${cost}/${max} movement used).${extra ? ` ${extra.trim()}` : ""}`.trim();
  }

  const disengageMatch = text.match(/^(.*?) disengages\.(.*)$/);
  if (disengageMatch) {
    const [, unitName, extra] = disengageMatch;
    return `${unitName} pulls out of engagement.${extra ? ` ${extra.trim()}` : ""}`.trim();
  }

  const holdMatch = text.match(/^(.*?) holds position\.(.*)$/);
  if (holdMatch) {
    const [, unitName, extra] = holdMatch;
    return `${unitName} stays in place and keeps its current stance.${extra ? ` ${extra.trim()}` : ""}`.trim();
  }

  const forceFieldBreakMatch = text.match(/^(.*?) crashes through a Force Field and destroys it\.$/);
  if (forceFieldBreakMatch) {
    const [, unitName] = forceFieldBreakMatch;
    return `${unitName} is large enough to smash through the Force Field, removing it from play.`;
  }

  const burrowRegenMatch = text.match(/^(.*?) regenerates (\d+) wounds? while Burrowed\.$/);
  if (burrowRegenMatch) {
    const [, unitName, healed] = burrowRegenMatch;
    return `${unitName} heals ${healed} while staying Burrowed.`;
  }

  const passFirstMatch = text.match(/^(Blue|Red) player passes first and claims the First Player Marker for the next phase\.$/);
  if (passFirstMatch) {
    const [, player] = passFirstMatch;
    return `${player} passes first and will have initiative going into the next phase.`;
  }

  const passMatch = text.match(/^(Blue|Red) player passes\.$/);
  if (passMatch) {
    const [, player] = passMatch;
    return `${player} ends their remaining actions for this phase.`;
  }

  return text;
}

function getActivationRecap(state, events = []) {
  const actionable = events.find(event => [
    "unit_deployed",
    "unit_moved",
    "unit_disengaged",
    "unit_ran",
    "unit_held",
    "force_field_placed",
    "medpack_used",
    "optical_flare_used",
    "ranged_attack_declared",
    "unit_burrow_toggled",
    "unit_hidden_toggled",
    "unit_closed_ranks",
    "combat_attack_resolved"
  ].includes(event.type));
  if (!actionable) return null;

  if (actionable.type === "combat_attack_resolved") {
    const attacker = state.units[actionable.payload.attackerId];
    const target = state.units[actionable.payload.targetId];
    if (!attacker || attacker.owner !== "playerA" || !target) return null;
    const modeLabel = actionable.payload.mode === "melee"
      ? "melee attack"
      : actionable.payload.mode === "overwatch"
        ? "Overwatch attack"
        : "ranged attack";
    const casualties = actionable.payload.casualties ?? 0;
    return {
      title: "Activation Recap",
      message: casualties > 0
        ? `${attacker.name} completed its ${modeLabel} into ${target.name}, causing ${casualties} casualty(ies). Watch how that changes objective control, return attacks, or supply on the board next.`
        : `${attacker.name} completed its ${modeLabel} into ${target.name}, but no models were removed. Check whether the attack still forced position, reactions, or future combat pressure.`
    };
  }

  const unitId = actionable.payload?.unitId ?? actionable.payload?.attackerId ?? null;
  const unit = unitId ? state.units[unitId] : null;
  if (!unit || unit.owner !== "playerA") return null;

  switch (actionable.type) {
    case "unit_deployed":
      return {
        title: "Activation Recap",
        message: `${unit.name} entered from reserves and now contributes supply, board presence, and future activations. Check whether the drop opened a lane, threatened an objective, or exposed the unit to return pressure.`
      };
    case "unit_moved":
      return {
        title: "Activation Recap",
        message: `${unit.name} finished a Movement activation and changed its board position. The next thing to watch is whether that new location improves attacks, objective reach, or protection from enemy charges.`
      };
    case "unit_disengaged":
      return {
        title: "Activation Recap",
        message: `${unit.name} broke out of engagement. That matters because the unit is no longer pinned in melee, so check whether it has opened space or set up safer future actions.`
      };
    case "unit_ran":
      return {
        title: "Activation Recap",
        message: `${unit.name} used Assault to reposition instead of committing an attack. That usually means the value is in the new lane, objective angle, or threat setup rather than immediate damage.`
      };
    case "unit_held":
      return {
        title: "Activation Recap",
        message: `${unit.name} held position and spent its activation without moving. Watch whether staying put preserves concealment, keeps support coverage, or protects a stronger firing lane.`
      };
    case "force_field_placed":
      return {
        title: "Activation Recap",
        message: `${unit.name} placed a Force Field to reshape movement. The next thing to watch is which smaller units now have blocked paths and whether a large unit might try to break through it.`
      };
    case "medpack_used": {
      const target = state.units[actionable.payload.targetId];
      return {
        title: "Activation Recap",
        message: `${unit.name} restored ${actionable.payload.healed} wound(s) to ${target?.name ?? "a friendly unit"}. That activation traded tempo for durability, so check whether the healed unit can now survive or contest a key space longer.`
      };
    }
    case "optical_flare_used": {
      const target = state.units[actionable.payload.targetId];
      return {
        title: "Activation Recap",
        message: `${unit.name} blinded ${target?.name ?? "an enemy unit"} with Optical Flare. The next thing to watch is whether that target loses an important shot because its range shrank and Long Range is shut off this round.`
      };
    }
    case "ranged_attack_declared": {
      const target = state.units[actionable.payload.targetId];
      return {
        title: "Activation Recap",
        message: `${unit.name} queued a ranged attack into ${target?.name ?? "the target"} for Combat. That means the key question now is whether this declaration will resolve before the battlefield changes around it.`
      };
    }
    case "unit_burrow_toggled":
      return {
        title: "Activation Recap",
        message: actionable.payload.burrowed
          ? `${unit.name} burrowed and became harder to interact with directly. Watch whether that concealment protects the unit long enough to regenerate or hold space safely.`
          : `${unit.name} emerged from Burrowed. That matters because it is now easier to interact with, but it can take a more direct role on the battlefield again.`
      };
    case "unit_hidden_toggled":
      return {
        title: "Activation Recap",
        message: actionable.payload.hidden
          ? `${unit.name} became Hidden. The next thing to watch is whether enemies can still get close enough to reveal it or whether the concealment denies an important target.`
          : `${unit.name} revealed itself and lost Hidden. That means its position is now more exposed, so future enemy targeting becomes more straightforward.`
      };
    case "unit_closed_ranks":
      return {
        title: "Activation Recap",
        message: `${unit.name} used Close Ranks to surface and prepare for melee properly. The next thing to watch is whether that emergence leads directly into a stronger combat exchange.`
      };
    default:
      return null;
  }
}

function publishLogNotifications(state, events = []) {
  if (uiState.lastSeenLogCount >= state.log.length && !events.length) return;
  const newEntries = state.log.slice(uiState.lastSeenLogCount);
  uiState.lastSeenLogCount = state.log.length;
  const combatEvents = events.filter(event => event.type === "combat_attack_resolved");
  if (combatEvents.length) {
    buildCombatModalFromEvents(combatEvents, state);
  }
  for (let index = 0; index < newEntries.length; index += 1) {
    const entry = newEntries[index];

    if (isChargeSequenceAction(entry)) {
      const grouped = [entry];
      while (index + 1 < newEntries.length && isChargeSequenceAction(newEntries[index + 1])) {
        grouped.push(newEntries[index + 1]);
        index += 1;
      }
      buildModalFromEntries(grouped, state, "Charge Sequence", "Reaction Window", "action");
      continue;
    }

    if (entry.type === "combat") {
      if (combatEvents.length) continue;
      const grouped = [entry];
      while (index + 1 < newEntries.length && newEntries[index + 1].type === "combat" && grouped.length < 3) {
        grouped.push(newEntries[index + 1]);
        index += 1;
      }
      buildModalFromEntries(grouped, state, "Combat Sequence", "Combat Result", "combat");
      continue;
    }

    if (entry.type === "phase") {
      const teachingConfig = getPhaseTeachingConfig(state);
      const teachingKey = teachingConfig ? `${state.round}:${state.phase}` : null;
      if (teachingConfig && !uiState.shownPhaseTeachingKeys.has(teachingKey)) {
        uiState.shownPhaseTeachingKeys.add(teachingKey);
        buildModalFromEntries(
          [entry],
          state,
          teachingConfig.title,
          teachingConfig.kicker,
          teachingConfig.tone,
          {
            htmlBody: `${buildStoryBlock(entry.text)}<div class="story-sequence-block stacked">${buildPhaseTeachingHtml(teachingConfig)}</div>`,
            glossaryTerms: teachingConfig.glossaryTerms
          }
        );
        continue;
      }
    }

    if (shouldUseModalForEntry(entry)) {
      queueStoryModal(entry, state);
      continue;
    }
    const toastConfig = getToastConfig(entry);
    pushToastNotification(getToastMessage(entry), getNotificationTone(entry.type), toastConfig.durationMs, {
      prominent: toastConfig.prominent,
      title: toastConfig.title
    });
  }
  const activationRecap = getActivationRecap(state, events);
  if (activationRecap) {
    pushToastNotification(activationRecap.message, "info", 9000, {
      prominent: true,
      title: activationRecap.title
    });
  }
}


function actionButton(label, className, onClick, disabled = false, disabledReason = "") {
  const button = document.createElement("button");
  button.className = `btn ${className}`;
  button.textContent = label;
  button.disabled = disabled;
  button.dataset.actionLabel = label;
  if (disabled && disabledReason) {
    button.title = disabledReason;
    button.setAttribute("aria-label", `${label}. Disabled: ${disabledReason}`);
    button.dataset.disabledReason = disabledReason;
  }
  button.addEventListener("click", onClick);
  return button;
}

function getEnemyBattlefieldUnits(state, unit) {
  return Object.values(state.units).filter(other =>
    other.owner !== unit.owner &&
    other.status.location === "battlefield" &&
    getLeaderPoint(other)
  );
}

function hasObjectiveNearby(state, unit, maxDistance) {
  const leader = getLeaderPoint(unit);
  if (!leader) return false;
  return state.deployment.missionMarkers.some(marker => distance(leader, marker) <= maxDistance + 1e-6);
}

function hasDamagedFriendlyInRange(state, unit, maxDistance) {
  const leader = getLeaderPoint(unit);
  if (!leader) return false;
  return Object.values(state.units).some(other => {
    if (other.owner !== unit.owner || other.id === unit.id || other.status.location !== "battlefield") return false;
    const otherLeader = getLeaderPoint(other);
    if (!otherLeader) return false;
    const damagedModel = Object.values(other.models).some(model => model.alive && model.currentWounds < model.maxWounds);
    return damagedModel && distance(leader, otherLeader) <= maxDistance + 1e-6;
  });
}

function hasLegalRangedTarget(state, unit) {
  const weapon = unit.rangedWeapons?.[0];
  const attackerPoint = getLeaderPoint(unit);
  if (!weapon || !attackerPoint) return false;
  const maxRange = getLongRangeValue(weapon) ?? weapon.rangeInches ?? 0;
  return getEnemyBattlefieldUnits(state, unit).some(target => {
    const targetPoint = getLeaderPoint(target);
    if (!targetPoint) return false;
    if (distance(attackerPoint, targetPoint) > maxRange + 1e-6) return false;
    return canTargetWithRangedWeapon(state, unit, target, weapon).ok;
  });
}

function hasChargeTargetInRange(state, unit) {
  const attackerPoint = getLeaderPoint(unit);
  if (!attackerPoint || !(unit.meleeWeapons?.length)) return false;
  return getEnemyBattlefieldUnits(state, unit).some(target => {
    const targetPoint = getLeaderPoint(target);
    return targetPoint && distance(attackerPoint, targetPoint) <= 8 + 1e-6;
  });
}

function isPrimarilyMeleeUnit(unit) {
  const meleeVolume = (unit.meleeWeapons ?? []).reduce((total, weapon) => total + (weapon.attacksPerModel ?? 1), 0);
  const rangedVolume = (unit.rangedWeapons ?? []).reduce((total, weapon) => total + (weapon.shotsPerModel ?? weapon.attacksPerModel ?? 1), 0);
  return meleeVolume >= rangedVolume;
}

function getRecommendedAction(state, unit) {
  if (state.phase === "movement") {
    if (unit.status.location === "reserves") {
      return {
        label: "Deploy",
        title: "Recommended Action",
        reason: "Deploy this reserve now so its supply and board presence start mattering this round."
      };
    }
    if (unit.status.engaged) {
      return {
        label: "Disengage",
        title: "Recommended Action",
        reason: "This unit is tied up in melee, so breaking clear is the first priority before it can reposition or set up later attacks."
      };
    }
    if (unit.abilities?.includes("stabilize_wounds") && hasDamagedFriendlyInRange(state, unit, 4)) {
      return {
        label: "Medpack",
        title: "Recommended Action",
        reason: "A damaged friendly unit is close enough to heal, so this activation can immediately recover board strength."
      };
    }
    if (unit.abilities?.includes("solid_field_projectors") && (hasObjectiveNearby(state, unit, 6) || getEnemyBattlefieldUnits(state, unit).length)) {
      return {
        label: "Force Field",
        title: "Recommended Action",
        reason: "A force field can shape movement lanes here, which is especially useful near enemies or contested objectives."
      };
    }
    if (hasObjectiveNearby(state, unit, unit.speed + 2)) {
      return {
        label: "Move",
        title: "Recommended Action",
        reason: "This unit is close enough to reposition toward an objective or stronger board position during Movement."
      };
    }
    if (canBurrow(unit) && unit.abilities?.includes("burrowed_regen")) {
      const wounded = Object.values(unit.models).some(model => model.alive && model.currentWounds < model.maxWounds);
      if (wounded && !unit.status.burrowed) {
        return {
          label: "Burrow",
          title: "Recommended Action",
          reason: "Burrowing now can protect the unit and set up regeneration on a later activation."
        };
      }
    }
    return {
      label: "Move",
      title: "Recommended Action",
      reason: "Movement is usually the safest default here because it improves position without spending combat options early."
    };
  }

  if (state.phase === "assault") {
    if (unit.status.burrowed && canBurrow(unit)) {
      return {
        label: "Emerge",
        title: "Recommended Action",
        reason: "This unit is currently burrowed, so emerging is the first step if you want it to interact more directly this phase."
      };
    }
    const hasCharge = hasChargeTargetInRange(state, unit);
    const hasRanged = hasLegalRangedTarget(state, unit);
    if (hasCharge && isPrimarilyMeleeUnit(unit)) {
      return {
        label: "Charge",
        title: "Recommended Action",
        reason: "A charge is available, and this unit is built to get more value from melee pressure than from staying back."
      };
    }
    if (hasRanged) {
      return {
        label: "Ranged",
        title: "Recommended Action",
        reason: "There is already a legal ranged target, so you can queue reliable pressure without gambling on a charge roll."
      };
    }
    if (hasCharge) {
      return {
        label: "Charge",
        title: "Recommended Action",
        reason: "No clean ranged shot is available, but a charge declaration can still create pressure and force reactions."
      };
    }
    if (!unit.status.engaged) {
      return {
        label: "Run",
        title: "Recommended Action",
        reason: "No strong attack is available, so using Assault to reposition is better than wasting the activation."
      };
    }
    return {
      label: "Hold",
      title: "Recommended Action",
      reason: "Holding is the clean fallback when this unit has no better legal assault action right now."
    };
  }

  if (state.phase === "combat") {
    if (validateCloseRanks(state, "playerA", unit.id).ok) {
      return {
        label: "Close Ranks",
        title: "Recommended Action",
        reason: "This unit needs to surface and tighten formation before its melee role makes sense in Combat."
      };
    }
    const hasQueuedAttacks = state.combatQueue.some(entry =>
      ["ranged_attack", "charge_attack", "overwatch_attack"].includes(entry.type) && entry.attackerId === unit.id
    );
    if (hasQueuedAttacks) {
      return {
        label: "Review Combat",
        title: "Recommended Action",
        reason: "This unit already has combat committed, so resolving that sequence is the most important thing it can do now."
      };
    }
    return {
      label: "Hold",
      title: "Recommended Action",
      reason: "This unit has no combat sequence waiting, so holding cleanly spends the activation."
    };
  }

  return null;
}

function applyRecommendedActionMetadata(buttons, recommendation) {
  if (!recommendation) return;
  const match = buttons.find(button => !button.disabled && (button.dataset.actionLabel ?? "") === recommendation.label);
  if (!match) return;
  match.dataset.recommended = "true";
  match.dataset.recommendationTitle = recommendation.title;
  match.dataset.recommendationReason = recommendation.reason;
  match.classList.add("recommended-action");
}

function describeTacticalCard(card) {
  const modifiers = card.effect?.modifiers ?? [];
  const modifierText = modifiers.map(modifier => {
    const sign = modifier.operation === "add" && modifier.value > 0 ? "+" : "";
    return `${modifier.key} ${modifier.operation} ${sign}${modifier.value}`;
  }).join("; ");
  const timingText = card.effect?.timings?.join(", ") ?? "none";
  const duration = card.effect?.duration;
  const durationText = duration
    ? `${duration.type}${duration.phase ? `:${duration.phase}` : ""}${duration.eventType ? `:${duration.eventType}` : ""}`
    : "none";
  return `Phase: ${card.phase}. Target: ${card.target.replace(/_/g, " ")}. Modifiers: ${modifierText || "none"}. Timings: ${timingText}. Duration: ${durationText}.`;
}

function describeTacticalCardForModal(card, targetName = null) {
  const modifiers = card.effect?.modifiers ?? [];
  const duration = card.effect?.duration ?? null;
  const durationText = duration?.eventType === "combat_attack_resolved"
    ? "for the next resolved attack"
    : duration?.phase
      ? `until ${duration.phase} begins`
      : duration?.eventType === "unit_moved"
        ? "for the next move"
        : "for its active timing window";

  const pieces = modifiers.map(modifier => {
    const targetLabel = targetName ? `${targetName}` : "the target";
    if (modifier.key === "weapon.hitTarget" && modifier.operation === "add" && modifier.value < 0) {
      return `${targetLabel} improves its hit roll by ${Math.abs(modifier.value)} ${durationText}`;
    }
    if (modifier.key === "weapon.attacksPerModel" && modifier.operation === "add" && modifier.value > 0) {
      return `${targetLabel} gains +${modifier.value} melee attack per model ${durationText}`;
    }
    if (modifier.key === "weapon.shotsPerModel" && modifier.operation === "add" && modifier.value > 0) {
      return `${targetLabel} gains +${modifier.value} ranged shot per model ${durationText}`;
    }
    if (modifier.key === "unit.speed" && modifier.operation === "add" && modifier.value > 0) {
      return `${targetLabel} gains +${modifier.value}" speed ${durationText}`;
    }
    return null;
  }).filter(Boolean);

  if (pieces.length) {
    return `${pieces.join(". ")}. Rule timing: this card is played in the ${card.phase} phase and lasts ${durationText}.`;
  }
  return `This card changes ${card.target.replace(/_/g, " ")} behavior ${durationText}. Rule timing: play it in the ${card.phase} phase.`;
}

function buildActionButtons() {
  const state = store.getState();
  const unit = getSelectedUnit(state);
  const buttons = [];

  if (!unit) return buttons;

  buttons.push(actionButton("Cancel", "secondary", () => {
    cancelCurrentInteraction(uiState);
    uiState.legalDestinations = [];
    rerender();
  }, !uiState.mode, "No active interaction to cancel."));

  if (state.activePlayer !== "playerA") return buttons;
  if (unit.owner !== "playerA") return buttons;

  const activatedInPhase = state.phase === "movement"
    ? unit.status.movementActivated
    : state.phase === "assault"
      ? unit.status.assaultActivated
      : state.phase === "combat"
        ? unit.status.combatActivated
        : false;

  if (activatedInPhase) return buttons;

  if (state.phase === "movement" && unit.status.location === "reserves") {
    buttons.unshift(actionButton("Deploy", "primary", () => {
      beginDeployInteraction(state, uiState, unit.id);
      computeLegalDestinations();
      rerender();
    }));
    applyRecommendedActionMetadata(buttons, getRecommendedAction(state, unit));
    return buttons;
  }

  buttons.unshift(actionButton("Hold", "secondary", () => {
    const result = store.dispatch({ type: "HOLD_UNIT", payload: { playerId: "playerA", unitId: unit.id } });
    if (!result.ok) showError(result.message);
    else { autoSelectNextUnit(); rerender(); }
  }));

  if (state.phase === "movement") {
    if (canBurrow(unit)) {
      buttons.unshift(actionButton(unit.status.burrowed ? "Emerge" : "Burrow", "secondary", () => {
        const result = store.dispatch({ type: "TOGGLE_BURROW", payload: { playerId: "playerA", unitId: unit.id } });
        if (!result.ok) showError(result.message);
        else { autoSelectNextUnit(); rerender(); }
      }, unit.status.engaged, "Unit must be unengaged to burrow or emerge."));
    }

    if (canHide(unit)) {
      buttons.unshift(actionButton(unit.status.hidden ? "Reveal" : "Hide", "secondary", () => {
        const result = store.dispatch({ type: "TOGGLE_HIDDEN", payload: { playerId: "playerA", unitId: unit.id } });
        if (!result.ok) showError(result.message);
        else { autoSelectNextUnit(); rerender(); }
      }, unit.status.engaged || unit.status.burrowed, unit.status.burrowed ? "Burrowed units are already Hidden." : "Unit must be unengaged to hide or reveal."));
    }

    buttons.unshift(actionButton("Move", "primary", () => {
      beginMoveInteraction(state, uiState, unit.id);
      computeLegalDestinations();
      rerender();
    }, unit.status.engaged, "Unit is engaged. Disengage before moving."));

    if (unit.abilities?.includes("solid_field_projectors")) {
      buttons.unshift(actionButton("Force Field", "secondary", () => {
        beginForceFieldInteraction(uiState);
        uiState.legalDestinations = [];
        rerender();
      }));
    }

    if (unit.abilities?.includes("stabilize_wounds")) {
      buttons.unshift(actionButton("Medpack", "secondary", () => {
        beginMedpackInteraction(uiState);
        uiState.legalDestinations = [];
        rerender();
      }));
      buttons.unshift(actionButton("Optical Flare", "secondary", () => {
        beginOpticalFlareInteraction(uiState);
        uiState.legalDestinations = [];
        rerender();
      }));
    }

    buttons.unshift(actionButton("Disengage", "warn", () => {
      beginDisengageInteraction(state, uiState, unit.id);
      computeLegalDestinations();
      rerender();
    }, !unit.status.engaged, "Unit must be engaged to disengage."));

    applyRecommendedActionMetadata(buttons, getRecommendedAction(state, unit));
    return buttons;
  }

  if (state.phase === "assault") {
    if (canBurrow(unit)) {
      buttons.unshift(actionButton(unit.status.burrowed ? "Emerge" : "Burrow", "secondary", () => {
        const result = store.dispatch({ type: "TOGGLE_BURROW", payload: { playerId: "playerA", unitId: unit.id } });
        if (!result.ok) showError(result.message);
        else { autoSelectNextUnit(); rerender(); }
      }, unit.status.engaged, "Unit must be unengaged to burrow or emerge."));
    }

    if (canHide(unit)) {
      buttons.unshift(actionButton(unit.status.hidden ? "Reveal" : "Hide", "secondary", () => {
        const result = store.dispatch({ type: "TOGGLE_HIDDEN", payload: { playerId: "playerA", unitId: unit.id } });
        if (!result.ok) showError(result.message);
        else { autoSelectNextUnit(); rerender(); }
      }, unit.status.engaged || unit.status.burrowed, unit.status.burrowed ? "Burrowed units are already Hidden." : "Unit must be unengaged to hide or reveal."));
    }

    buttons.unshift(actionButton("Charge", "warn", () => {
      beginDeclareChargeInteraction(uiState);
      uiState.legalDestinations = [];
      rerender();
    }, !(unit.meleeWeapons?.length) || unit.status.cannotChargeThisAssault || unit.status.burrowed, unit.status.burrowed ? "Burrowed units cannot charge." : unit.status.cannotChargeThisAssault ? "This unit cannot charge again this assault phase." : "This unit has no melee weapons."));

    buttons.unshift(actionButton("Ranged", "secondary", () => {
      beginDeclareRangedInteraction(uiState);
      uiState.legalDestinations = [];
      rerender();
    }, !(unit.rangedWeapons?.length) || unit.status.cannotRangedAttackThisAssault || unit.status.burrowed, unit.status.burrowed ? "Burrowed units cannot make ranged declarations." : unit.status.cannotRangedAttackThisAssault ? "This unit has already made a ranged declaration this assault phase." : "This unit has no ranged weapons."));

    buttons.unshift(actionButton("Run", "primary", () => {
      beginRunInteraction(state, uiState, unit.id);
      computeLegalDestinations();
      rerender();
    }, unit.status.engaged, "Unit is engaged. Disengage before running."));
    applyRecommendedActionMetadata(buttons, getRecommendedAction(state, unit));
    return buttons;
  }

  if (state.phase === "combat") {
    const hasQueuedAttacks = state.combatQueue.some(entry =>
      ["ranged_attack", "charge_attack", "overwatch_attack"].includes(entry.type) && entry.attackerId === unit.id
    );
    const canCloseRanksNow = validateCloseRanks(state, "playerA", unit.id).ok;
    const combatPreview = getCombatActivationPreview(state, unit.id);

    buttons.unshift(actionButton("Review Combat", "primary", () => {
      const selection = getMeleeTargetSelection(state, unit.id);
      if (combatPreview) {
        openCombatChoiceModal({
          ...combatPreview,
          currentPrimaryTargetId: selection?.currentPrimaryTargetId ?? null,
          options: selection?.options ?? []
        });
        return;
      }
      resolveCombatForSelectedUnit(unit.id);
    }, !hasQueuedAttacks, "No queued attacks for this unit."));
    buttons.unshift(actionButton("Close Ranks", "warn", () => {
      const result = store.dispatch({
        type: "CLOSE_RANKS",
        payload: { playerId: "playerA", unitId: unit.id }
      });
      if (!result.ok) showError(result.message);
      else { autoSelectNextUnit(); rerender(); }
    }, !canCloseRanksNow, unit.status.burrowed ? "Burrowed units must be engaged and ready to activate." : "Only engaged Burrowed units can close ranks."));
    applyRecommendedActionMetadata(buttons, getRecommendedAction(state, unit));
    return buttons;
  }

  applyRecommendedActionMetadata(buttons, getRecommendedAction(state, unit));
  return buttons;
}

function buildCardButtons() {
  const state = store.getState();
  const buttons = [];
  if (state.activePlayer !== "playerA") return buttons;
  if (state.players.playerA.hasPassedThisPhase) return buttons;

  const selectedUnit = getSelectedUnit(state);
  for (const cardEntry of state.players.playerA.hand ?? []) {
    const card = getTacticalCard(cardEntry.cardId);
    if (card.phase !== state.phase) continue;

    if (card.target === "friendly_battlefield_unit") {
      const hasValidSelection = selectedUnit && selectedUnit.owner === "playerA" && selectedUnit.status.location === "battlefield";
      const label = hasValidSelection ? `Play ${card.name} on ${selectedUnit.name}` : `Play ${card.name} (select a unit first)`;
      buttons.push(actionButton(label, "secondary", () => {
        const result = store.dispatch({
          type: "PLAY_CARD",
          payload: { playerId: "playerA", cardInstanceId: cardEntry.instanceId, targetUnitId: selectedUnit.id }
        });
        if (!result.ok) showError(result.message);
      }, !hasValidSelection, "Select a friendly battlefield unit first."));
      continue;
    }

    buttons.push(actionButton(`Play ${card.name}`, "secondary", () => {
      const result = store.dispatch({
        type: "PLAY_CARD",
        payload: { playerId: "playerA", cardInstanceId: cardEntry.instanceId, targetUnitId: null }
      });
      if (!result.ok) showError(result.message);
    }));
  }

  return buttons;
}



function computeDeployEntryPoint(state, point) {
  const side = state.deployment.entryEdges.playerA.side;
  if (side === "west") return { x: 0, y: point.y };
  if (side === "east") return { x: state.board.widthInches, y: point.y };
  if (side === "north") return { x: point.x, y: 0 };
  return { x: point.x, y: state.board.heightInches };
}

function canDeepStrike(unit) {
  return unit.abilities?.includes("deep_strike");
}

function maybeSnapPoint(state, point) {
  if (!state.rules?.gridMode) return point;
  return snapPointToGrid(point, state.board);
}

function handleBoardClick(point) {
  // Cancel pending pass on any board click
  if (uiState.pendingPass) {
    uiState.pendingPass = false;
    rerender();
    return;
  }

  const state = store.getState();
  const snappedPoint = maybeSnapPoint(state, point);
  const unit = getSelectedUnit(state);
  if (!unit || state.activePlayer !== "playerA") return;

  if (uiState.mode === "deploy") {
    const entryPoint = canDeepStrike(unit) ? snappedPoint : computeDeployEntryPoint(state, snappedPoint);
    const path = canDeepStrike(unit) ? [entryPoint, entryPoint] : [entryPoint, snappedPoint];
    const result = store.dispatch({
      type: "DEPLOY_UNIT",
      payload: {
        playerId: "playerA", unitId: unit.id, leadingModelId: unit.leadingModelId,
        entryPoint, path, modelPlacements: autoArrangeModels(state, unit.id, snappedPoint)
      }
    });
    if (!result.ok) return showError(result.message);
    cancelCurrentInteraction(uiState);
    uiState.legalDestinations = [];
    autoSelectNextUnit();
    rerender();
    return;
  }

  if (uiState.mode === "move") {
    const leader = unit.models[unit.leadingModelId];
    const path = [{ x: leader.x, y: leader.y }, snappedPoint];
    const result = store.dispatch({
      type: "MOVE_UNIT",
      payload: {
        playerId: "playerA", unitId: unit.id, leadingModelId: unit.leadingModelId,
        path, modelPlacements: autoArrangeModels(state, unit.id, snappedPoint)
      }
    });
    if (!result.ok) return showError(result.message);
    cancelCurrentInteraction(uiState);
    uiState.legalDestinations = [];
    autoSelectNextUnit();
    rerender();
    return;
  }

  if (uiState.mode === "run") {
    const leader = unit.models[unit.leadingModelId];
    const path = [{ x: leader.x, y: leader.y }, snappedPoint];
    const result = store.dispatch({
      type: "RUN_UNIT",
      payload: {
        playerId: "playerA", unitId: unit.id, leadingModelId: unit.leadingModelId,
        path, modelPlacements: autoArrangeModels(state, unit.id, snappedPoint)
      }
    });
    if (!result.ok) return showError(result.message);
    cancelCurrentInteraction(uiState);
    uiState.legalDestinations = [];
    autoSelectNextUnit();
    rerender();
    return;
  }

  if (uiState.mode === "force_field") {
    const result = store.dispatch({
      type: "PLACE_FORCE_FIELD",
      payload: {
        playerId: "playerA",
        unitId: unit.id,
        point: snappedPoint
      }
    });
    if (!result.ok) return showError(result.message);
    cancelCurrentInteraction(uiState);
    uiState.legalDestinations = [];
    autoSelectNextUnit();
    rerender();
    return;
  }

  if (uiState.mode === "disengage") {
    const leader = unit.models[unit.leadingModelId];
    const path = [{ x: leader.x, y: leader.y }, snappedPoint];
    const result = store.dispatch({
      type: "DISENGAGE_UNIT",
      payload: {
        playerId: "playerA", unitId: unit.id, leadingModelId: unit.leadingModelId,
        path, modelPlacements: autoArrangeModels(state, unit.id, snappedPoint)
      }
    });
    if (!result.ok) return showError(result.message);
    cancelCurrentInteraction(uiState);
    uiState.legalDestinations = [];
    autoSelectNextUnit();
    rerender();
  }
}


function handleModelClick(unitId) {
  // Cancel pending pass
  if (uiState.pendingPass) {
    uiState.pendingPass = false;
    rerender();
  }

  const state = store.getState();
  const selected = getSelectedUnit(state);
  const clickedUnit = state.units[unitId];

  if (uiState.mode === "declare_ranged" && selected && clickedUnit && selected.owner === "playerA" && clickedUnit.owner === "playerB") {
    const result = store.dispatch({
      type: "DECLARE_RANGED_ATTACK",
      payload: { playerId: "playerA", unitId: selected.id, targetId: clickedUnit.id }
    });
    if (!result.ok) { showError(result.message); return; }
    cancelCurrentInteraction(uiState);
    uiState.legalDestinations = [];
    autoSelectNextUnit();
    rerender();
    return;
  }

  if (uiState.mode === "declare_charge" && selected && clickedUnit && selected.owner === "playerA" && clickedUnit.owner === "playerB") {
    const result = store.dispatch({
      type: "DECLARE_CHARGE",
      payload: { playerId: "playerA", unitId: selected.id, targetId: clickedUnit.id }
    });
    if (!result.ok) { showError(result.message); return; }
    cancelCurrentInteraction(uiState);
    uiState.legalDestinations = [];
    autoSelectNextUnit();
    rerender();
    return;
  }

  if (uiState.mode === "use_medpack" && selected && clickedUnit && selected.owner === "playerA" && clickedUnit.owner === "playerA") {
    const result = store.dispatch({
      type: "USE_MEDPACK",
      payload: { playerId: "playerA", unitId: selected.id, targetId: clickedUnit.id }
    });
    if (!result.ok) { showError(result.message); return; }
    cancelCurrentInteraction(uiState);
    uiState.legalDestinations = [];
    autoSelectNextUnit();
    rerender();
    return;
  }

  if (uiState.mode === "use_optical_flare" && selected && clickedUnit && selected.owner === "playerA" && clickedUnit.owner === "playerB") {
    const result = store.dispatch({
      type: "USE_OPTICAL_FLARE",
      payload: { playerId: "playerA", unitId: selected.id, targetId: clickedUnit.id }
    });
    if (!result.ok) { showError(result.message); return; }
    cancelCurrentInteraction(uiState);
    uiState.legalDestinations = [];
    autoSelectNextUnit();
    rerender();
    return;
  }

  selectUnit(unitId);
}

function handleModelHover(unitId) {
  uiState.hoveredUnitId = unitId ?? null;
  rerender();
}

async function maybeRunBot() {
  if (uiState.locked) return;
  if (uiState.activeStoryModal || uiState.storyModalQueue.length) return;
  if (uiState.pendingCombatChoice) return;
  const state = store.getState();
  if (state.activePlayer !== "playerB") return;
  if (!["movement", "assault", "combat"].includes(state.phase)) return;
  uiState.locked = true;
  rerender();
  await new Promise(resolve => setTimeout(resolve, 420));
  const logBefore = store.getState().log.length;
  const result = await performBotTurn(store, "playerB");
  if (!result.ok) showError(result.message);
  uiState.locked = false;
  // After bot finishes its full turn cycle, auto-select for player
  if (store.getState().activePlayer === "playerA") {
    autoSelectNextUnit();
  }
  rerender();
  if (store.getState().activePlayer === "playerB" && ["movement", "assault", "combat"].includes(store.getState().phase)) {
    maybeRunBot();
  }
}

function resetUiForLoadedState(nextState) {
  window.clearTimeout(boardHighlightTimer);
  uiState.selectedUnitId = null;
  uiState.legalDestinations = [];
  uiState.hoveredUnitId = null;
  uiState.hoveredObjectiveId = null;
  uiState.hoveredCombatQueueIndex = null;
  uiState.selectedCombatQueueIndex = null;
  uiState.boardHighlights = [];
  uiState.aftermathNarrative = null;
  uiState.compactActionBar = false;
  uiState.lastObjectiveSnapshot = getObjectiveControlSnapshot(nextState);
  uiState.pendingPass = false;
  uiState.storyModalQueue = [];
  uiState.activeStoryModal = null;
  uiState.activeGlossaryTerm = null;
  uiState.shownPhaseTeachingKeys = new Set();
  uiState.pendingCombatChoice = null;
  cancelCurrentInteraction(uiState);
  uiState.lastSeenLogCount = nextState.log.length;
  store.replaceState(nextState);
  document.getElementById("gridModeBtn").textContent = `Grid: ${store.getState().rules.gridMode ? "On" : "Off"}`;
}

function resetGame() {
  resetUiForLoadedState(buildInitialState());
}

function openSetupModal() {
  uiState.setupModal.open = true;
  rerender();
}

function openArmyBuilder() {
  window.open("./Army%20Builder/index.html", "_blank", "noopener,noreferrer");
}

function closeSetupModal() {
  uiState.setupModal.open = false;
  uiState.setupModal.pendingImportSide = null;
  rerender();
}

function promptArmyImport(side) {
  uiState.setupModal.pendingImportSide = side;
  const input = document.getElementById("armyImportFileInput");
  if (!input) return;
  input.value = "";
  input.click();
}

function importArmyBuilderFile(file) {
  if (!file) return;
  const side = uiState.setupModal.pendingImportSide;
  if (!side) {
    showError("Pick whether the roster is for Blue or Red first.");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!isArmyBuilderPayload(parsed)) {
        showError("That file is not an Army Builder roster export.");
        return;
      }
      const roster = importArmyBuilderRoster(parsed, side);
      uiState.setupModal.rosters[side] = roster;
      uiState.setupModal.pendingImportSide = null;
      const skipped = roster.summary.skippedUnits + roster.summary.skippedCards;
      pushToastNotification(
        skipped
          ? `${side === "playerA" ? "Blue" : "Red"} roster imported with ${skipped} unsupported item(s) skipped.`
          : `${side === "playerA" ? "Blue" : "Red"} roster imported.`,
        skipped ? "warn" : "success",
        5600,
        { prominent: true }
      );
      rerender();
    } catch {
      showError("Could not read this army roster.");
    }
  };
  reader.onerror = () => showError("Failed to load army roster file.");
  reader.readAsText(file);
}

function startConfiguredBattle() {
  const setup = buildSetupFromImportedRosters({
    baseSetup: DEFAULT_SETUP,
    missionId: uiState.setupModal.missionId,
    deploymentId: uiState.setupModal.deploymentId,
    firstPlayerMarkerHolder: uiState.setupModal.firstPlayerMarkerHolder,
    rosterA: uiState.setupModal.rosters.playerA,
    rosterB: uiState.setupModal.rosters.playerB
  });
  resetUiForLoadedState(buildStateFromSetup(setup));
  uiState.setupModal.open = false;
  pushToastNotification("Battle setup applied.", "success");
}

function sanitizeSaveFilenamePart(value) {
  return value.replace(/[^a-z0-9_-]/gi, "_");
}

function exportSaveFile() {
  const state = store.getState();
  const payload = { version: 1, exportedAt: new Date().toISOString(), state };
  const content = JSON.stringify(payload, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `starcraft-grid-save-${sanitizeSaveFilenamePart(state.mission.id ?? "mission")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  pushToastNotification("Save exported.", "success");
}

function isValidImportedState(nextState) {
  return Boolean(nextState && typeof nextState === "object" && nextState.board && nextState.players && nextState.units && Array.isArray(nextState.turnOrder));
}

function importSaveFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const importedState = parsed?.state ?? parsed;
      if (!isValidImportedState(importedState)) { showError("Invalid save file."); return; }
      uiState.selectedUnitId = null;
      uiState.legalDestinations = [];
      uiState.pendingPass = false;
      uiState.storyModalQueue = [];
      uiState.activeStoryModal = null;
      uiState.pendingCombatChoice = null;
      cancelCurrentInteraction(uiState);
      resetUiForLoadedState(importedState);
      pushToastNotification("Save loaded.", "success");
    } catch (_error) {
      showError("Could not read this save file.");
    }
  };
  reader.onerror = () => showError("Failed to load save file.");
  reader.readAsText(file);
}

function controller() {
  return {
    onNewGame: openSetupModal,
    onToggleGridMode: () => {
      const state = store.getState();
      state.rules.gridMode = !state.rules.gridMode;
      document.getElementById("gridModeBtn").textContent = `Grid: ${state.rules.gridMode ? "On" : "Off"}`;
      rerender();
    },
    onOpenArmyBuilder: openArmyBuilder,
    onExportSave: exportSaveFile,
    onImportSave: () => {
      const input = document.getElementById("importFileInput");
      if (!input) return;
      input.value = "";
      input.click();
    },
    onImportFileSelected: (event) => importSaveFile(event.target?.files?.[0]),
    onArmyImportFileSelected: (event) => importArmyBuilderFile(event.target?.files?.[0]),
    onPass: () => {
      // Two-click pass confirmation
      if (!uiState.pendingPass) {
        uiState.pendingPass = true;
        rerender();
        // Auto-cancel after 3 seconds
        window.clearTimeout(controller._passTimer);
        controller._passTimer = window.setTimeout(() => {
          uiState.pendingPass = false;
          rerender();
        }, 3000);
        return;
      }
      uiState.pendingPass = false;
      const result = store.dispatch({ type: "PASS_PHASE", payload: { playerId: "playerA" } });
      if (!result.ok) showError(result.message);
    }
  };
}
controller._passTimer = null;


function updatePreviewFromPoint(point) {
  const state = store.getState();
  const snappedPoint = maybeSnapPoint(state, point);
  const unit = getSelectedUnit(state);
  if (!unit) return;
  if (uiState.mode === "deploy") {
    const entryPoint = canDeepStrike(unit) ? snappedPoint : computeDeployEntryPoint(state, snappedPoint);
    uiState.previewPath = { path: canDeepStrike(unit) ? [entryPoint, entryPoint] : [entryPoint, snappedPoint], state };
    uiState.previewUnit = { unitId: unit.id, leader: snappedPoint, placements: autoArrangeModels(state, unit.id, snappedPoint) };
  }
  if (uiState.mode === "move" || uiState.mode === "disengage" || uiState.mode === "run") {
    const leader = unit.models[unit.leadingModelId];
    uiState.previewPath = { path: [{ x: leader.x, y: leader.y }, snappedPoint], state };
    uiState.previewUnit = { unitId: unit.id, leader: snappedPoint, placements: autoArrangeModels(state, unit.id, snappedPoint) };
  }
  if (uiState.mode === "force_field") {
    uiState.previewPath = null;
    uiState.previewUnit = { kind: "force_field", leader: snappedPoint };
  }
}

function handleObjectiveHover(objectiveId) {
  uiState.hoveredObjectiveId = objectiveId;
  if (!objectiveId && uiState.mode) {
    uiState.selectedObjectiveId = null;
  }
  rerender();
}

function handleObjectiveClick(objectiveId) {
  uiState.selectedObjectiveId = uiState.selectedObjectiveId === objectiveId ? null : objectiveId;
  rerender();
}

function handleCombatQueueHover(queueIndex) {
  uiState.hoveredCombatQueueIndex = queueIndex;
  rerender();
}

function handleCombatQueueClick(queueIndex) {
  uiState.selectedCombatQueueIndex = uiState.selectedCombatQueueIndex === queueIndex ? null : queueIndex;
  rerender();
}

function handleLogEntryFocus(focus) {
  if (!focus) return;
  const state = store.getState();
  const now = Date.now();
  pruneBoardHighlights();
  uiState.selectedCombatQueueIndex = null;
  uiState.hoveredCombatQueueIndex = null;
  uiState.selectedUnitId = focus.attackerId ?? uiState.selectedUnitId;
  uiState.hoveredUnitId = focus.targetId ?? null;
  uiState.selectedObjectiveId = focus.objectiveIds?.[0] ?? null;
  uiState.hoveredObjectiveId = focus.objectiveIds?.[0] ?? null;

  const attacker = focus.attackerId ? state.units[focus.attackerId] : null;
  const target = focus.targetId ? state.units[focus.targetId] : null;
  if (attacker) {
    pushBoardHighlight({
      kind: "unit",
      unitId: attacker.id,
      tone: "action",
      label: "Timeline",
      point: getBoardHighlightPointForUnit(attacker),
      startsAt: now,
      expiresAt: now + 3600
    });
  }
  if (target) {
    pushBoardHighlight({
      kind: "unit",
      unitId: target.id,
      tone: "attention",
      label: "Target",
      point: getBoardHighlightPointForUnit(target),
      startsAt: now + 120,
      expiresAt: now + 3600
    });
  }
  for (const objectiveId of focus.objectiveIds ?? []) {
    pushBoardHighlight({
      kind: "objective",
      objectiveId,
      tone: "pressure",
      label: "Timeline Focus",
      startsAt: now + 220,
      expiresAt: now + 3600
    });
  }
  scheduleBoardHighlightPrune();
  rerender();
}

function handleActionBarToggle() {
  uiState.compactActionBar = !uiState.compactActionBar;
  rerender();
}

function pruneBoardHighlights() {
  const now = Date.now();
  uiState.boardHighlights = (uiState.boardHighlights ?? []).filter(highlight => (highlight.expiresAt ?? 0) > now);
  if (uiState.aftermathNarrative && (uiState.aftermathNarrative.expiresAt ?? 0) <= now) {
    uiState.aftermathNarrative = null;
  }
}

function pushBoardHighlight(highlight) {
  pruneBoardHighlights();
  uiState.boardHighlights.push({
    startsAt: highlight.startsAt ?? Date.now(),
    ...highlight
  });
}

function getBoardHighlightPointForUnit(unit) {
  if (!unit) return null;
  const leader = unit.models?.[unit.leadingModelId];
  if (leader?.x != null && leader?.y != null) return { x: leader.x, y: leader.y };
  for (const model of Object.values(unit.models ?? {})) {
    if (model?.x != null && model?.y != null) return { x: model.x, y: model.y };
  }
  return null;
}

function scheduleBoardHighlightPrune() {
  window.clearTimeout(boardHighlightTimer);
  const now = Date.now();
  let nextRefreshAt = 0;
  for (const highlight of uiState.boardHighlights ?? []) {
    const startsAt = highlight?.startsAt ?? 0;
    const expiresAt = highlight?.expiresAt ?? 0;
    if (startsAt > now) {
      nextRefreshAt = !nextRefreshAt ? startsAt : Math.min(nextRefreshAt, startsAt);
    } else if (expiresAt > now) {
      nextRefreshAt = !nextRefreshAt ? expiresAt : Math.min(nextRefreshAt, expiresAt);
    }
  }
  if (!nextRefreshAt) return;
  const delay = Math.max(40, nextRefreshAt - now + 30);
  boardHighlightTimer = window.setTimeout(() => {
    pruneBoardHighlights();
    rerender();
    scheduleBoardHighlightPrune();
  }, delay);
}

function updateBoardHighlights(state, events) {
  const now = Date.now();
  const currentSnapshot = getObjectiveControlSnapshot(state);
  pruneBoardHighlights();
  let sequenceOffset = 0;
  const objectiveNarratives = [];
  const combatEvents = [];

  const queueAftermathHighlight = (highlight, { stepMs = 0 } = {}) => {
    const startsAt = now + sequenceOffset;
    pushBoardHighlight({
      startsAt,
      ...highlight,
      expiresAt: (highlight.expiresAt ?? now + 3200) + sequenceOffset
    });
    sequenceOffset += stepMs;
  };

  for (const event of events ?? []) {
    if (event.type === "combat_attack_resolved") {
      combatEvents.push(event);
      const payload = event.payload ?? {};
      const attacker = state.units[payload.attackerId] ?? null;
      const target = state.units[payload.targetId] ?? null;
      const attackerPoint = getBoardHighlightPointForUnit(attacker);
      const targetPoint = getBoardHighlightPointForUnit(target);
      const targetDestroyed = target && target.status?.location !== "battlefield";
      queueAftermathHighlight({
        kind: "unit",
        unitId: payload.attackerId,
        tone: "action",
        label: payload.mode === "melee" ? "Charged" : payload.mode === "overwatch" ? "Overwatch" : "Fired",
        point: attackerPoint,
        expiresAt: now + 3200
      });
      queueAftermathHighlight({
        kind: "unit",
        unitId: payload.targetId,
        tone: targetDestroyed ? "destroyed" : payload.casualties > 0 || payload.totalDamage > 0 ? "damage" : "attention",
        label: targetDestroyed ? "Destroyed" : payload.casualties > 0 ? `-${payload.casualties}` : payload.totalDamage > 0 ? `-${payload.totalDamage}` : "Defended",
        point: targetPoint,
        expiresAt: now + (targetDestroyed ? 4600 : 3200)
      }, { stepMs: targetDestroyed ? 420 : payload.casualties > 0 || payload.totalDamage > 0 ? 180 : 0 });
    }
  }

  const previousSnapshot = uiState.lastObjectiveSnapshot ?? {};
  const combatResolvedThisUpdate = (events ?? []).some(event => event.type === "combat_attack_resolved");
  for (const [objectiveId, result] of Object.entries(currentSnapshot)) {
    const previous = previousSnapshot[objectiveId] ?? {};
    const changedController = previous.controller !== result.controller;
    const changedContested = Boolean(previous.contested) !== Boolean(result.contested);
    const changedSupplyPressure = (previous.playerASupply ?? 0) !== (result.playerASupply ?? 0)
      || (previous.playerBSupply ?? 0) !== (result.playerBSupply ?? 0);
    if (changedController || changedContested) {
      const label = result.contested
        ? "Contested"
        : result.controller === "playerA"
          ? "Blue Control"
          : result.controller === "playerB"
            ? "Red Control"
            : "Uncontrolled";
      queueAftermathHighlight({
        kind: "objective",
        objectiveId,
        tone: result.contested ? "attention" : "score",
        label,
        expiresAt: now + 4200
      }, { stepMs: 220 });
      objectiveNarratives.push(
        `${objectiveId.toUpperCase()} is now ${result.contested
          ? "contested"
          : result.controller === "playerA"
            ? "under Blue control"
            : result.controller === "playerB"
              ? "under Red control"
              : "uncontrolled"} because the nearby supply changed from ${previous.playerASupply ?? 0}-${previous.playerBSupply ?? 0} to ${result.playerASupply ?? 0}-${result.playerBSupply ?? 0}.`
      );
      continue;
    }
    if (!combatResolvedThisUpdate || !changedSupplyPressure) continue;
    const blueLead = (result.playerASupply ?? 0) - (result.playerBSupply ?? 0);
    const previousLead = (previous.playerASupply ?? 0) - (previous.playerBSupply ?? 0);
    if (blueLead === previousLead) continue;
    const label = blueLead === 0
      ? "Pressure Even"
      : blueLead > 0
        ? "Blue Pressure"
        : "Red Pressure";
    queueAftermathHighlight({
      kind: "objective",
      objectiveId,
      tone: blueLead === 0 ? "attention" : "pressure",
      label,
      expiresAt: now + 3600
    }, { stepMs: 180 });
    objectiveNarratives.push(
      `${objectiveId.toUpperCase()} pressure shifted from ${previous.playerASupply ?? 0}-${previous.playerBSupply ?? 0} supply to ${result.playerASupply ?? 0}-${result.playerBSupply ?? 0}, so ${label.toLowerCase()} now matters there.`
    );
  }

  if (combatEvents.length) {
    const finalCombatEvent = combatEvents[combatEvents.length - 1];
    const payload = finalCombatEvent.payload ?? {};
    const attacker = state.units[payload.attackerId] ?? null;
    const target = state.units[payload.targetId] ?? null;
    const targetDestroyed = Boolean(target && target.status?.location !== "battlefield");
    const resultSummary = targetDestroyed
      ? `${target?.name ?? "The defender"} was destroyed.`
      : (payload.casualties ?? 0) > 0
        ? `${target?.name ?? "The defender"} lost ${payload.casualties} model(s).`
        : (payload.totalDamage ?? 0) > 0
          ? `${target?.name ?? "The defender"} took ${payload.totalDamage} damage but stayed in play.`
          : `${target?.name ?? "The defender"} absorbed the attack without losing a model.`;
    const metrics = [
      payload.mode === "melee" ? "Melee resolution" : payload.mode === "overwatch" ? "Overwatch resolution" : "Ranged resolution",
      `${payload.casualties ?? 0} casualties`,
      `${payload.totalDamage ?? 0} damage`
    ];
    if (targetDestroyed) metrics.push("Target removed");
    uiState.aftermathNarrative = {
      startsAt: now + 140,
      expiresAt: now + Math.max(5000, sequenceOffset + 3600),
      title: `${attacker?.name ?? "Attack"} → ${target?.name ?? "Target"}`,
      attackerId: payload.attackerId ?? null,
      targetId: payload.targetId ?? null,
      objectiveIds: Object.keys(currentSnapshot).filter(objectiveId => objectiveNarratives.some(copy => copy.startsWith(objectiveId.toUpperCase()))),
      metrics,
      reason: `${attacker?.name ?? "The attacker"} finished its ${payload.mode === "melee" ? "melee attack" : payload.mode === "overwatch" ? "Overwatch attack" : "ranged attack"}, and ${resultSummary}`,
      teaching: objectiveNarratives.length
        ? objectiveNarratives.join(" ")
        : "Watch the nearby objective circles next. Casualties can open supply gaps, remove contesting units, or change which side has the safer follow-up activation."
    };
  } else if (!uiState.aftermathNarrative || (uiState.aftermathNarrative.expiresAt ?? 0) <= now) {
    uiState.aftermathNarrative = null;
  }

  uiState.lastObjectiveSnapshot = currentSnapshot;
  scheduleBoardHighlightPrune();
}

function wirePreviewEvents() {
  const svg = document.getElementById("battlefield");
  svg.addEventListener("mousemove", event => {
    if (!uiState.mode) return;
    const point = screenToBoardPoint(svg, event.clientX, event.clientY);
    updatePreviewFromPoint(point);
    rerender();
  });
  svg.addEventListener("mouseleave", () => {
    if (!uiState.mode) return;
    uiState.previewPath = null;
    uiState.previewUnit = null;
    uiState.hoveredUnitId = null;
    uiState.hoveredObjectiveId = null;
    rerender();
  });
}

/* ── Keyboard shortcuts ── */
function wireKeyboardShortcuts() {
  document.addEventListener("keydown", event => {
    if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") return;
    if (uiState.activeStoryModal && ["Escape", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      dismissStoryModal();
      return;
    }
    if (uiState.pendingCombatChoice) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissCombatChoiceModal();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const targetId = uiState.pendingCombatChoice.currentPrimaryTargetId
          ?? uiState.pendingCombatChoice.options?.[0]?.targetId
          ?? null;
        confirmCombatChoice(targetId);
        return;
      }
    }
    const state = store.getState();
    const unit = getSelectedUnit(state);

    if (event.key === "Escape") {
      if (uiState.pendingPass) { uiState.pendingPass = false; rerender(); return; }
      if (uiState.mode) { cancelCurrentInteraction(uiState); uiState.legalDestinations = []; rerender(); return; }
      uiState.selectedUnitId = null; rerender();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      // Cycle through unactivated units
      const phase = state.phase;
      const allIds = [
        ...state.players.playerA.reserveUnitIds,
        ...state.players.playerA.battlefieldUnitIds
      ];
      const currentIdx = allIds.indexOf(uiState.selectedUnitId);
      for (let i = 1; i <= allIds.length; i++) {
        const nextId = allIds[(currentIdx + i) % allIds.length];
        const u = state.units[nextId];
        if (!u) continue;
        const activated = phase === "movement" ? u.status.movementActivated
          : phase === "assault" ? u.status.assaultActivated
          : phase === "combat" ? u.status.combatActivated : true;
        if (!activated) { selectUnit(nextId); return; }
      }
      // If all activated, just cycle
      if (allIds.length) {
        selectUnit(allIds[(currentIdx + 1) % allIds.length]);
      }
      return;
    }

    // Quick action keys
    if (state.activePlayer === "playerA" && unit && unit.owner === "playerA") {
      if (event.key === "m" && state.phase === "movement" && !unit.status.engaged && unit.status.location === "battlefield") {
        beginMoveInteraction(state, uiState, unit.id); computeLegalDestinations(); rerender();
      }
      if (event.key === "d" && state.phase === "movement" && unit.status.location === "reserves") {
        beginDeployInteraction(state, uiState, unit.id); computeLegalDestinations(); rerender();
      }
      if (event.key === "h") {
        const result = store.dispatch({ type: "HOLD_UNIT", payload: { playerId: "playerA", unitId: unit.id } });
        if (!result.ok) showError(result.message);
        else { autoSelectNextUnit(); rerender(); }
      }
      if (event.key === "r" && state.phase === "assault" && !unit.status.engaged) {
        beginRunInteraction(state, uiState, unit.id); computeLegalDestinations(); rerender();
      }
    }
  });
}

function init() {
  store = createStore(buildInitialState());
  bindInputHandlers(store, controller());
  document.getElementById("gridModeBtn").textContent = `Grid: ${store.getState().rules.gridMode ? "On" : "Off"}`;
  uiState.lastSeenLogCount = store.getState().log.length;
  uiState.lastObjectiveSnapshot = getObjectiveControlSnapshot(store.getState());
  store.subscribe((state, events) => {
    updateBoardHighlights(state, events ?? []);
    publishLogNotifications(state, events ?? []);
    rerender();
    maybeRunBot();
  });
  autoSelectNextUnit();
  rerender();
  wirePreviewEvents();
  wireKeyboardShortcuts();
}

init();
