import { getObjectiveControlSnapshot } from "../engine/objectives.js";
import { getTacticalCard } from "../data/tactical_cards.js";
import { distance } from "../engine/geometry.js";

const RULE_NOTE_COPY = {
  anti_evade: "Makes evade rolls harder for the defender.",
  AntiEvade: "Makes evade rolls harder for the defender.",
  burrowed_regen: "Heals while activated underground; it does not restore destroyed models.",
  burst_fire: "Adds extra attacks at close range.",
  combat_shield: "Improves melee survivability by enabling evade-style defense in close combat.",
  concentrated_fire: "Caps casualties and discards excess damage beyond the cap.",
  critical_hit: "Pushes wounds past armour before save rolls are made.",
  dodge: "Cancels a limited number of hits that already bypassed armour.",
  evade: "Late defensive roll that can avoid hits after armour results are known.",
  flying: "Ignores many ground movement and line-of-sight restrictions, but does not control objectives.",
  hallucination: "Supports nearby units with extra ranged defense.",
  hidden: "Harder to target at range until revealed.",
  impact: "Rolls charge impact dice before the main melee attack resolves.",
  indirect_fire: "Can target without line of sight.",
  instant: "Blocks Overwatch reactions against that charge.",
  life_support: "Reduces damage after hits and saves are already known.",
  locked_in: "Adds attacks against stationary targets.",
  long_range: "Extends range, usually with a hit penalty in the outer band.",
  lurking: "Improves the first ranged evade while stationary.",
  pinpoint: "Allows ranged attacks into engaged enemy units.",
  pierce: "Increases damage against matching target tags.",
  precision: "Moves failed hit dice straight into the armour pool.",
  solid_field_projectors: "Can place a force field that blocks smaller units.",
  surge: "Converts matching wounds into hits that bypass armour.",
  veteran_of_tarsonis: "Improves armour while near an objective.",
  zealous_round: "Trades an unused activation for immediate damage reduction."
};

function formatPlayerName(playerId) {
  return playerId === "playerA" ? "Blue" : "Red";
}

function formatSupply(pool) {
  return pool === Infinity ? "∞" : String(pool);
}

function formatControl(result) {
  if (!result.controller) return result.contested ? "Contested" : "Uncontrolled";
  return `${formatPlayerName(result.controller)} (${result.playerASupply}-${result.playerBSupply})`;
}

function renderStatePill(label, value, extraClass = "") {
  return `
    <div class="state-pill ${extraClass}">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
    </div>
  `;
}

function titleCase(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

function getRuleNote(term) {
  return RULE_NOTE_COPY[term] ?? RULE_NOTE_COPY[term?.toLowerCase?.()] ?? null;
}

function collectWeaponRuleNotes(weapon) {
  const notes = [];
  if (weapon.hits) notes.push(["Hits", "Adds automatic armour-pool hits that skip hit and wound rolls."]);
  if (weapon.surge) notes.push(["Surge", "Matching wounds bypass armour after the wound step."]);
  if (weapon.precision) notes.push(["Precision", "Failed hit dice can still become hits without rolling to wound."]);
  if (weapon.criticalHit) notes.push(["Critical Hit", "Some wounds skip armour entirely before saves."]);
  if (weapon.antiEvade) notes.push(["Anti-Evade", "Makes the defender's evade roll harder."]);
  if (weapon.burstFire) notes.push(["Burst Fire", "Adds extra attacks when the target is close enough."]);
  if (weapon.lockedIn) notes.push(["Locked In", "Adds attacks against stationary targets."]);
  if (weapon.concentratedFire) notes.push(["Concentrated Fire", "Limits casualties and discards overflow damage."]);
  if (weapon.bulky || weapon.keywords?.includes("bulky")) notes.push(["Bulky", "Cannot be used for ranged attacks while the attacker is engaged."]);
  if (weapon.instant || weapon.keywords?.includes("instant")) notes.push(["Instant", "Prevents Overwatch reactions against that charge."]);
  if (weapon.indirectFire) notes.push(["Indirect Fire", "Can target without line of sight."]);
  if (weapon.pinpoint || weapon.keywords?.includes("pinpoint")) notes.push(["Pinpoint", "Can target engaged enemy units at range."]);
  if (weapon.longRangeInches ?? weapon.longRange) notes.push(["Long Range", "Extends range into an outer band that applies a hit penalty."]);
  if (weapon.pierce) notes.push(["Pierce", "Raises damage against matching target tags."]);
  return notes;
}

function renderRuleNoteList(notes) {
  if (!notes.length) return "";
  return `
    <div class="rule-note-list">
      ${notes.map(([label, copy]) => `<div class="rule-note-item"><span class="rule-note-term">${label}:</span> ${copy}</div>`).join("")}
    </div>
  `;
}

/* ══════════════════════════════════════════════════════════════
   CARD DESCRIPTIONS — human-readable effect text
   ══════════════════════════════════════════════════════════════ */

function describeCardEffect(card) {
  const mods = card.effect?.modifiers ?? [];
  const parts = [];
  for (const mod of mods) {
    const sign = mod.value > 0 ? "+" : "";
    if (mod.key === "unit.speed") {
      parts.push(`${sign}${mod.value} Speed`);
    } else if (mod.key === "weapon.hitTarget") {
      // Lower hit target = easier to hit, so -1 to hitTarget is a buff
      parts.push(mod.value < 0 ? `+${Math.abs(mod.value)} to Hit (easier)` : `-${mod.value} to Hit (harder)`);
    } else if (mod.key === "weapon.shotsPerModel" || mod.key === "weapon.attacksPerModel") {
      parts.push(`${sign}${mod.value} attacks per model`);
    } else {
      parts.push(`${mod.key} ${sign}${mod.value}`);
    }
  }

  const effectText = parts.join(", ") || "No modifiers";

  // Duration
  const dur = card.effect?.duration;
  let durationText = "";
  if (dur?.type === "phase_starts") {
    durationText = `until ${titleCase(dur.phase)} Phase`;
  } else if (dur?.type === "events" && dur.eventType === "combat_attack_resolved") {
    durationText = "for next attack";
  } else if (dur?.type === "events" && dur.eventType === "unit_moved") {
    durationText = "for next move";
  } else if (dur) {
    durationText = `duration: ${dur.type}`;
  }

  // Phase
  const phaseText = `Play during ${titleCase(card.phase)} Phase`;

  // Target
  const targetText = card.target === "friendly_battlefield_unit"
    ? "Target: friendly unit on battlefield"
    : "Target: global";

  return { effectText, durationText, phaseText, targetText };
}

function describeCardTeaching(card) {
  const mods = card.effect?.modifiers ?? [];
  const affectsSpeed = mods.some(mod => mod.key === "unit.speed");
  const affectsHit = mods.some(mod => mod.key === "weapon.hitTarget");
  const affectsAttacks = mods.some(mod => mod.key === "weapon.shotsPerModel" || mod.key === "weapon.attacksPerModel");
  const usesNextAttackWindow = card.effect?.duration?.eventType === "combat_attack_resolved";
  const usesNextMoveWindow = card.effect?.duration?.eventType === "unit_moved";

  let timing = "Play it in the phase shown on the card before the affected action is locked in.";
  if (card.phase === "movement") {
    timing = "Play it before that unit moves, deploys, or repositions so the bonus applies to its movement choice this phase.";
  } else if (card.phase === "assault") {
    timing = "Play it before the unit declares its ranged attack or charge so the Combat queue is created with the buff in mind.";
  } else if (card.phase === "combat") {
    timing = "Play it right before that unit resolves its combat activation so the boost affects the attack that is about to happen.";
  }

  let bestUse = "Use this when one unit needs a focused boost to swing an important moment.";
  if (affectsSpeed && usesNextMoveWindow) {
    bestUse = "Best used when one move needs extra reach right now, like touching an objective, escaping danger, or setting up a charge lane.";
  } else if (affectsSpeed) {
    bestUse = "Best used early in Movement when extra speed will change where that unit can stand for the rest of the turn.";
  } else if (affectsHit && usesNextAttackWindow) {
    bestUse = "Best used on the unit whose next attack matters most, especially when you need reliability instead of gambling on dice.";
  } else if (affectsAttacks && usesNextAttackWindow) {
    bestUse = "Best used when attack volume matters, such as finishing a damaged target or forcing more saves through.";
  } else if (affectsHit) {
    bestUse = "Best used before a high-value attack where accuracy is the difference between pressure and a wasted activation.";
  } else if (affectsAttacks) {
    bestUse = "Best used before a unit commits to a big swing, because extra attacks scale with every surviving model in that unit.";
  }

  return { timing, bestUse };
}

/* ══════════════════════════════════════════════════════════════
   WEAPON FORMATTING — show what matters for decisions
   ══════════════════════════════════════════════════════════════ */

function formatWeaponFull(weapon) {
  const attacks = weapon.attacksPerModel ?? weapon.shotsPerModel ?? 1;
  const range = weapon.rangeInches != null ? `${weapon.rangeInches}"` : "Melee";
  const hit = weapon.hitTarget ?? "?";
  const dmg = weapon.damage ?? 1;
  const ap = weapon.armorPenetration ?? 0;
  const keywords = weapon.keywords?.length ? weapon.keywords.map(k => k.replace(/_/g, " ")).join(", ") : "";
  const surge = weapon.surge ? `${weapon.surge.tags.join(", ")} / ${weapon.surge.dice}` : "";
  const hits = weapon.hits
    ? (typeof weapon.hits === "number"
      ? `Hits ${weapon.hits} (${weapon.damage ?? 1})`
      : `Hits ${weapon.hits.count ?? weapon.hits.value ?? weapon.hits.hits ?? 0} (${weapon.hits.damage ?? weapon.damage ?? 1})`)
    : "";
  const longRange = weapon.longRangeInches ?? weapon.longRange ?? null;
  const precision = weapon.precision ? `Precision ${weapon.precision}` : "";
  const criticalHit = weapon.criticalHit ? `Critical ${weapon.criticalHit}` : "";
  const antiEvade = weapon.antiEvade ? `Anti-Evade ${weapon.antiEvade}` : "";
  const indirectFire = weapon.indirectFire ? "Indirect Fire" : "";
  const pinpoint = weapon.pinpoint || weapon.keywords?.includes("pinpoint") ? "Pinpoint" : "";
  const burstFireValue = weapon.burstFire
    ? (typeof weapon.burstFire === "number"
      ? { rangeInches: weapon.rangeInches, bonusAttacks: weapon.burstFire }
      : { rangeInches: weapon.burstFire.rangeInches ?? weapon.burstFire.range ?? weapon.rangeInches, bonusAttacks: weapon.burstFire.bonusAttacks ?? weapon.burstFire.attacks ?? weapon.burstFire.value ?? 0 })
    : null;
  const burstFire = burstFireValue ? `Burst Fire ${burstFireValue.rangeInches ?? "?"}" +${burstFireValue.bonusAttacks}` : "";
  const lockedIn = weapon.lockedIn ? `Locked In ${weapon.lockedIn}` : "";
  const concentratedFire = weapon.concentratedFire ? `Concentrated Fire ${weapon.concentratedFire}` : "";
  const bulky = weapon.bulky || weapon.keywords?.includes("bulky") ? "Bulky" : "";
  const instant = weapon.instant || weapon.keywords?.includes("instant") ? "Instant" : "";
  const pierce = weapon.pierce
    ? (Array.isArray(weapon.pierce) ? weapon.pierce : [weapon.pierce]).map(entry => `Pierce ${entry.tag} ${entry.damage}`).join(", ")
    : "";
  const extraRules = [hits, precision, criticalHit, antiEvade, burstFire, lockedIn, concentratedFire, bulky, instant, pinpoint, pierce, indirectFire, longRange ? `Long Range ${longRange}"` : ""].filter(Boolean).join(", ");
  const ruleNotes = renderRuleNoteList(collectWeaponRuleNotes(weapon));

  return `
    <div class="weapon-stat-grid">
      <div class="weapon-stat"><span class="ws-label">Range</span><span class="ws-val">${range}</span></div>
      <div class="weapon-stat"><span class="ws-label">Attacks</span><span class="ws-val">${attacks}/model</span></div>
      <div class="weapon-stat"><span class="ws-label">Hit</span><span class="ws-val">${hit}+</span></div>
      ${surge ? `<div class="weapon-stat"><span class="ws-label">Surge</span><span class="ws-val">${surge}</span></div>` : ""}
      <div class="weapon-stat"><span class="ws-label">Dmg</span><span class="ws-val">${dmg}</span></div>
      ${ap ? `<div class="weapon-stat"><span class="ws-label">AP</span><span class="ws-val">-${ap}</span></div>` : ""}
    </div>
    ${extraRules ? `<div class="weapon-keywords">${extraRules}</div>` : ""}
    ${keywords ? `<div class="weapon-keywords">${keywords}</div>` : ""}
    ${ruleNotes}
  `;
}

function formatWeaponOneLine(weapon) {
  const attacks = weapon.attacksPerModel ?? weapon.shotsPerModel ?? 1;
  const range = weapon.rangeInches != null ? `${weapon.rangeInches}"` : "Melee";
  const surge = weapon.surge ? `, Surge ${weapon.surge.tags.join("/")} ${weapon.surge.dice}` : "";
  const hits = weapon.hits
    ? `, Hits ${typeof weapon.hits === "number" ? weapon.hits : weapon.hits.count ?? weapon.hits.value ?? weapon.hits.hits ?? 0} (${typeof weapon.hits === "number" ? weapon.damage ?? 1 : weapon.hits.damage ?? weapon.damage ?? 1})`
    : "";
  const burstFireValue = weapon.burstFire
    ? (typeof weapon.burstFire === "number"
      ? { rangeInches: weapon.rangeInches, bonusAttacks: weapon.burstFire }
      : { rangeInches: weapon.burstFire.rangeInches ?? weapon.burstFire.range ?? weapon.rangeInches, bonusAttacks: weapon.burstFire.bonusAttacks ?? weapon.burstFire.attacks ?? weapon.burstFire.value ?? 0 })
    : null;
  const extras = [];
  if (weapon.precision) extras.push(`Precision ${weapon.precision}`);
  if (weapon.criticalHit) extras.push(`Crit ${weapon.criticalHit}`);
  if (weapon.antiEvade) extras.push(`Anti-Evade ${weapon.antiEvade}`);
  if (burstFireValue) extras.push(`Burst ${burstFireValue.rangeInches ?? "?"}" +${burstFireValue.bonusAttacks}`);
  if (weapon.lockedIn) extras.push(`Locked In ${weapon.lockedIn}`);
  if (weapon.concentratedFire) extras.push(`Concentrated ${weapon.concentratedFire}`);
  if (weapon.bulky || weapon.keywords?.includes("bulky")) extras.push("Bulky");
  if (weapon.instant || weapon.keywords?.includes("instant")) extras.push("Instant");
  if (weapon.indirectFire) extras.push("Indirect");
  if (weapon.pinpoint || weapon.keywords?.includes("pinpoint")) extras.push("Pinpoint");
  if (weapon.longRangeInches ?? weapon.longRange) extras.push(`Long ${weapon.longRangeInches ?? weapon.longRange}"`);
  if (weapon.pierce) {
    const entries = Array.isArray(weapon.pierce) ? weapon.pierce : [weapon.pierce];
    extras.push(entries.map(entry => `Pierce ${entry.tag} ${entry.damage}`).join("/"));
  }
  return `${range} range, ${attacks} atk/model, ${weapon.hitTarget ?? "?"}+ to hit, ${weapon.damage ?? 1} dmg${surge}${hits}${extras.length ? `, ${extras.join(", ")}` : ""}`;
}

/* ══════════════════════════════════════════════════════════════
   UNIT CARDS
   ══════════════════════════════════════════════════════════════ */

function buildUnitCard(unit, selectedUnitId, onClick, state) {
  const div = document.createElement("div");
  const phase = state?.phase;
  const activated = phase === "movement" ? unit.status.movementActivated
    : phase === "assault" ? unit.status.assaultActivated
    : phase === "combat" ? unit.status.combatActivated : false;
  const isOwn = unit.owner === "playerA";
  const needsAction = isOwn && !activated && state?.activePlayer === "playerA";

  div.className = `unit-card ${selectedUnitId === unit.id ? "selected" : ""} ${needsAction ? "needs-action" : ""} ${activated ? "activated" : ""}`;
  div.addEventListener("click", () => onClick(unit.id));

  const aliveCount = unit.modelIds.filter(id => unit.models[id].alive).length;
  const totalCount = unit.modelIds.length;

  // Quick weapon summary
  const rangedInfo = unit.rangedWeapons?.length
    ? unit.rangedWeapons.map(w => `${w.rangeInches ?? "?"}" ${w.hitTarget}+`).join(", ")
    : "";
  const meleeInfo = unit.meleeWeapons?.length
    ? unit.meleeWeapons.map(w => `${w.hitTarget}+ melee`).join(", ")
    : "";
  const weaponSummary = [rangedInfo, meleeInfo].filter(Boolean).join(" | ");

  div.innerHTML = `
    <div class="unit-card-row">
      <span class="unit-name">${unit.name}</span>
      <span class="phase-chip">${unit.currentSupplyValue} SP</span>
    </div>
    <div class="unit-card-stats">
      <span>Spd ${unit.speed}</span>
      <span>Models ${aliveCount}/${totalCount}</span>
      ${weaponSummary ? `<span>${weaponSummary}</span>` : ""}
    </div>
    <div class="badge-row">
      ${unit.status.engaged ? '<span class="badge warn">Engaged</span>' : ''}
      ${unit.status.outOfCoherency ? '<span class="badge warn">Coherency!</span>' : ''}
      ${needsAction ? '<span class="badge action-needed">Needs Action</span>' : ''}
      ${activated ? '<span class="badge good">Done</span>' : ''}
    </div>
  `;
  return div;
}

/* ══════════════════════════════════════════════════════════════
   TOP PANEL
   ══════════════════════════════════════════════════════════════ */

export function renderTopPanel(state) {
  const battleState = document.getElementById("battleState");
  const playerSupply = `${getPlayerSupply(state, "playerA")} / ${formatSupply(state.players.playerA.supplyPool)}`;
  const enemySupply = `${getPlayerSupply(state, "playerB")} / ${formatSupply(state.players.playerB.supplyPool)}`;
  const roundLimit = state.mission.pacing?.roundLimit ?? state.mission.roundLimit;
  battleState.innerHTML = `
    ${renderStatePill("Round", `${state.round} / ${roundLimit}`)}
    ${renderStatePill("Phase", titleCase(state.phase), "phase-pill")}
    ${renderStatePill("Blue VP", state.players.playerA.vp, "vp-blue")}
    ${renderStatePill("Red VP", state.players.playerB.vp, "vp-red")}
    ${renderStatePill("Queued Attacks", state.combatQueue.length)}
    ${state.winner ? renderStatePill("Winner", formatPlayerName(state.winner), "winner-pill") : renderStatePill("Mission", state.mission.name)}
  `;

  const objectiveControl = document.getElementById("objectiveControl");
  const snapshot = getObjectiveControlSnapshot(state);
  objectiveControl.innerHTML = "";
  for (const objective of state.deployment.missionMarkers) {
    const result = snapshot[objective.id];
    const line = document.createElement("div");
    line.className = "objective-control-line";
    line.innerHTML = `<span>${objective.id.toUpperCase()}</span><span>${formatControl(result)}</span>`;
    objectiveControl.appendChild(line);
  }

  const roundSummary = document.getElementById("roundSummary");
  roundSummary.innerHTML = "";
  const phaseSummary = getPhaseSummary(state, snapshot);
  const summaryCard = document.createElement("div");
  summaryCard.className = "summary-teaching-card";
  summaryCard.innerHTML = `
    <div class="summary-teaching-title">${phaseSummary.title}</div>
    <div class="summary-teaching-copy">${phaseSummary.overview}</div>
    ${phaseSummary.lines.map(line => `<div class="summary-teaching-copy"><span class="summary-teaching-label">What to watch:</span> ${line}</div>`).join("")}
  `;
  roundSummary.appendChild(summaryCard);
  if (!state.lastRoundSummary) {
    const emptyLine = document.createElement("div");
    emptyLine.className = "objective-control-line";
    emptyLine.innerHTML = "<span>Last Round</span><span>No completed round yet</span>";
    roundSummary.appendChild(emptyLine);
  } else {
    const scoreLine = document.createElement("div");
    scoreLine.className = "objective-control-line";
    scoreLine.innerHTML = `<span>R${state.lastRoundSummary.round} VP</span><span>Blue +${state.lastRoundSummary.scoring.gained.playerA} / Red +${state.lastRoundSummary.scoring.gained.playerB}</span>`;
    roundSummary.appendChild(scoreLine);
    const combatLine = document.createElement("div");
    combatLine.className = "objective-control-line";
    combatLine.innerHTML = `<span>Combat</span><span>${state.lastRoundSummary.combatEvents.length} attacks resolved</span>`;
    roundSummary.appendChild(combatLine);
  }

  document.getElementById("playerSupplyText").textContent = playerSupply;
  document.getElementById("enemySupplyText").textContent = enemySupply;
  document.getElementById("playerSupplyFill").style.width = `${fillPercent(state, "playerA")}%`;
  document.getElementById("enemySupplyFill").style.width = `${fillPercent(state, "playerB")}%`;
  const turnBanner = document.getElementById("turnBanner");
  turnBanner.textContent = `${formatPlayerName(state.activePlayer)} — ${titleCase(state.phase)} Phase`;
  turnBanner.className = `turn-banner ${state.activePlayer}`;
}

function getPlayerSupply(state, playerId) {
  return state.players[playerId].battlefieldUnitIds.reduce((total, unitId) => total + state.units[unitId].currentSupplyValue, 0);
}

function fillPercent(state, playerId) {
  const pool = state.players[playerId].supplyPool;
  if (pool === Infinity) return 100;
  if (pool <= 0) return 0;
  return Math.min(100, (getPlayerSupply(state, playerId) / pool) * 100);
}

function countControllingObjectives(snapshot, playerId) {
  return Object.values(snapshot).filter(result => result?.controller === playerId && !result?.contested).length;
}

function getQueuedAttackCounts(state, playerId) {
  return state.combatQueue.reduce((totals, entry) => {
    const attacker = state.units[entry.attackerId];
    if (!attacker || attacker.owner !== playerId) return totals;
    totals.total += 1;
    if (entry.type === "charge_attack") totals.melee += 1;
    else if (entry.type === "overwatch_attack") totals.overwatch += 1;
    else totals.ranged += 1;
    return totals;
  }, { total: 0, ranged: 0, melee: 0, overwatch: 0 });
}

function countUnactivatedUnits(state, playerId) {
  const ids = [
    ...state.players[playerId].battlefieldUnitIds,
    ...(state.phase === "movement" ? state.players[playerId].reserveUnitIds : [])
  ];
  return ids.reduce((total, unitId) => {
    const unit = state.units[unitId];
    if (!unit) return total;
    const activated = state.phase === "movement"
      ? unit.status.movementActivated
      : state.phase === "assault"
        ? unit.status.assaultActivated
        : state.phase === "combat"
          ? unit.status.combatActivated
          : true;
    return total + (activated ? 0 : 1);
  }, 0);
}

function getPhaseSummary(state, snapshot) {
  const blueObjectives = countControllingObjectives(snapshot, "playerA");
  const redObjectives = countControllingObjectives(snapshot, "playerB");
  const contestedObjectives = Object.values(snapshot).filter(result => result?.contested).length;
  const blueQueued = getQueuedAttackCounts(state, "playerA");
  const redQueued = getQueuedAttackCounts(state, "playerB");
  const blueUnactivated = countUnactivatedUnits(state, "playerA");
  const redUnactivated = countUnactivatedUnits(state, "playerB");

  if (state.phase === "movement") {
    return {
      title: "Live Phase Summary",
      overview: blueObjectives > redObjectives
        ? `Blue is currently ahead on board control with ${blueObjectives} objective${blueObjectives === 1 ? "" : "s"} to Red's ${redObjectives}.`
        : redObjectives > blueObjectives
          ? `Red currently has the stronger board grip with ${redObjectives} objective${redObjectives === 1 ? "" : "s"} to Blue's ${blueObjectives}.`
          : `Board control is currently even, with ${contestedObjectives ? `${contestedObjectives} contested objective${contestedObjectives === 1 ? "" : "s"}` : "no clear edge yet"}.`,
      lines: [
        `Blue still has ${blueUnactivated} unit${blueUnactivated === 1 ? "" : "s"} left to position this phase, while Red has ${redUnactivated} waiting for its own turn cycle.`,
        contestedObjectives
          ? `${contestedObjectives} objective${contestedObjectives === 1 ? " is" : "s are"} contested, so movement and spacing right now will directly shape future scoring.`
          : "Movement is deciding future lanes and objective access, even before attacks are declared."
      ]
    };
  }

  if (state.phase === "assault") {
    return {
      title: "Live Phase Summary",
      overview: blueQueued.total > redQueued.total
        ? `Blue has committed more attack pressure so far, with ${blueQueued.total} queued attack${blueQueued.total === 1 ? "" : "s"} to Red's ${redQueued.total}.`
        : redQueued.total > blueQueued.total
          ? `Red has committed more attack pressure so far, with ${redQueued.total} queued attack${redQueued.total === 1 ? "" : "s"} to Blue's ${blueQueued.total}.`
          : `Attack pressure is still even, with both sides having ${blueQueued.total} queued attack${blueQueued.total === 1 ? "" : "s"} so far.`,
      lines: [
        `Blue queue mix: ${blueQueued.ranged} ranged, ${blueQueued.melee} charge, ${blueQueued.overwatch} Overwatch. Red queue mix: ${redQueued.ranged} ranged, ${redQueued.melee} charge, ${redQueued.overwatch} Overwatch.`,
        blueUnactivated
          ? `Blue still has ${blueUnactivated} unit${blueUnactivated === 1 ? "" : "s"} left to commit, so the queue can still change before Combat starts.`
          : "Blue has finished declaring actions, so the next question is how the Combat queue will resolve."
      ]
    };
  }

  if (state.phase === "combat") {
    return {
      title: "Live Phase Summary",
      overview: state.combatQueue.length
        ? `${state.combatQueue.length} combat sequence${state.combatQueue.length === 1 ? " is" : "s are"} still waiting to resolve, so the board can swing before cleanup.`
        : "No combat sequences remain in queue, so the board state is close to its scoring shape for this round.",
      lines: [
        `Queued pressure remaining: Blue ${blueQueued.total}, Red ${redQueued.total}. That shows which side still has unresolved damage or melee pressure left.`,
        contestedObjectives
          ? `${contestedObjectives} objective${contestedObjectives === 1 ? " is" : "s are"} still contested, so each remaining combat can directly change scoring control.`
          : "With no contested objective, focus on whether the remaining fights remove supply or expose units before cleanup."
      ]
    };
  }

  return {
    title: "Live Phase Summary",
    overview: "Review the current board state and prepare for the next major shift in play.",
    lines: []
  };
}

function formatQueueType(type) {
  if (type === "ranged_attack") return "Ranged";
  if (type === "charge_attack") return "Charge";
  if (type === "overwatch_attack") return "Overwatch";
  return titleCase(type ?? "attack");
}

function getLeaderPoint(unit) {
  if (!unit?.leadingModelId) return null;
  const leader = unit.models?.[unit.leadingModelId];
  if (!leader || leader.x == null || leader.y == null) return null;
  return { x: leader.x, y: leader.y };
}

function getEnemyThreatGuidance(state, unit) {
  const leader = getLeaderPoint(unit);
  const enemyUnits = Object.values(state.units).filter(other =>
    other.owner === "playerA" &&
    other.status.location === "battlefield" &&
    getLeaderPoint(other)
  );
  const nearestEnemyDistance = leader && enemyUnits.length
    ? Math.min(...enemyUnits.map(other => distance(leader, getLeaderPoint(other))))
    : null;
  const bestRangedWeapon = (unit.rangedWeapons ?? []).reduce((best, weapon) => {
    if (!best) return weapon;
    const bestScore = (best.rangeInches ?? 0) + ((best.shotsPerModel ?? best.attacksPerModel ?? 1) * 0.1);
    const nextScore = (weapon.rangeInches ?? 0) + ((weapon.shotsPerModel ?? weapon.attacksPerModel ?? 1) * 0.1);
    return nextScore > bestScore ? weapon : best;
  }, null);
  const bestMeleeWeapon = (unit.meleeWeapons ?? []).reduce((best, weapon) => {
    if (!best) return weapon;
    return (weapon.attacksPerModel ?? 1) > (best.attacksPerModel ?? 1) ? weapon : best;
  }, null);
  const queuedAttack = state.combatQueue.find(entry => entry.attackerId === unit.id);
  const rangedReach = bestRangedWeapon?.longRangeInches ?? bestRangedWeapon?.longRange ?? bestRangedWeapon?.rangeInches ?? null;
  const likelyThreat = queuedAttack
    ? queuedAttack.type === "charge_attack"
      ? "This enemy already has a charge committed, so it is an immediate melee threat in Combat."
      : queuedAttack.type === "overwatch_attack"
        ? "This enemy already has an Overwatch shot committed, so it can punish a charge before melee lands."
        : "This enemy already has a ranged attack committed for Combat, so its pressure is already locked in."
    : bestRangedWeapon && nearestEnemyDistance != null && rangedReach != null && nearestEnemyDistance <= rangedReach + 1e-6
      ? `Its ranged threat is already live on the current board because ${bestRangedWeapon.name} can reach about ${rangedReach}".`
      : bestMeleeWeapon && nearestEnemyDistance != null && nearestEnemyDistance <= 8
        ? "Its melee threat is real if it gets an Assault activation with a legal charge lane."
        : "Its threat is more positional right now, because it still needs range, line, or timing before it can punish you cleanly.";
  const whatToRespect = [];
  if (bestRangedWeapon) whatToRespect.push(`${bestRangedWeapon.name} is its clearest ranged threat piece.`);
  if (bestMeleeWeapon) whatToRespect.push(`${bestMeleeWeapon.name} is its strongest melee follow-through if it reaches combat.`);
  if (unit.status.hidden) whatToRespect.push("It is Hidden, so normal ranged retaliation is harder until it reveals.");
  if (unit.status.burrowed) whatToRespect.push("It is Burrowed, so it is safer for now but may be setting up a later emerge or regeneration play.");
  if (unit.status.engaged) whatToRespect.push("It is currently engaged, which can pin it or force it to fight instead of taking a free reposition.");
  if (unit.abilities?.includes("stabilize_wounds")) whatToRespect.push("It has support tools, so it can trade its own activation to heal or debuff instead of only attacking.");
  if (unit.abilities?.includes("solid_field_projectors")) whatToRespect.push("It can shape movement lanes with a Force Field during Movement.");

  const opportunityWindows = [];
  if (unit.status.outOfCoherency) opportunityWindows.push("It is out of coherency, so its objective pressure is weaker until that gets fixed.");
  if (unit.status.burrowed) opportunityWindows.push("If it stays underground, its direct interaction is limited even though it stays safer.");
  if (unit.abilities?.includes("flying")) opportunityWindows.push("Flying ignores a lot of ground friction, so zoning it requires distance or damage, not just terrain.");
  if (nearestEnemyDistance != null) {
    if (bestRangedWeapon && rangedReach != null && nearestEnemyDistance > rangedReach + 1e-6) {
      opportunityWindows.push(`You are currently outside its most relevant ranged reach at about ${nearestEnemyDistance.toFixed(1)}".`);
    }
    if (bestMeleeWeapon && nearestEnemyDistance > 8) {
      opportunityWindows.push(`It is more than 8" from your nearest unit, so an immediate charge threat is not live right now.`);
    }
  }
  if (!opportunityWindows.length) {
    opportunityWindows.push("There is no obvious free punish window, so treat this unit as an active threat and plan around its next activation.");
  }

  return {
    role: "Enemy threat assessment",
    nextStep: likelyThreat,
    strengths: whatToRespect,
    warnings: opportunityWindows,
    threatStats: {
      nearestEnemyDistance,
      rangedReach,
      meleeThreat: bestMeleeWeapon ? 8 : null,
      queuedAttack: queuedAttack ? formatQueueType(queuedAttack.type) : null
    }
  };
}

function getUnitPhaseGuidance(state, unit) {
  const phase = state.phase;
  const isReserve = unit.status.location === "reserves";
  const isEngaged = Boolean(unit.status.engaged);
  const isBurrowed = Boolean(unit.status.burrowed);
  const hasRanged = Boolean(unit.rangedWeapons?.length);
  const hasMelee = Boolean(unit.meleeWeapons?.length);
  const hasQueuedCombat = state.combatQueue.some(entry => entry.attackerId === unit.id);

  const strengths = [];
  const warnings = [];
  let nextStep = "Pick the action that best supports your overall plan this phase.";

  if (hasRanged) strengths.push("Can project damage at range if it has line of sight and a legal target.");
  if (hasMelee) strengths.push("Can threaten melee if it reaches contact and has models in fighting rank.");
  if (unit.abilities?.includes("flying")) strengths.push("Flying lets it ignore many ground movement and line-of-sight restrictions.");
  if (unit.abilities?.includes("solid_field_projectors")) strengths.push("Can shape the board by placing a force field during Movement.");
  if (unit.abilities?.includes("stabilize_wounds")) strengths.push("Can support nearby allies with Medic tools instead of only acting for itself.");
  if (unit.status.hidden) strengths.push("Hidden makes ranged targeting harder and can improve survivability until the unit reveals itself.");
  if (unit.status.burrowed) strengths.push("Burrowed units stay safer underground and some of them heal when they activate.");

  if (isEngaged) warnings.push("It is engaged, so normal repositioning is limited until it disengages or fights.");
  if (isBurrowed) warnings.push("Burrowed units cannot declare normal ranged attacks or charges until they emerge.");
  if (unit.status.outOfCoherency) warnings.push("Out of coherency units lose objective pressure until the formation is fixed.");
  if (unit.abilities?.includes("flying")) warnings.push("Flying helps movement, but flying units do not control objectives.");
  if (unit.rangedWeapons?.some(weapon => weapon.bulky || weapon.keywords?.includes("bulky"))) warnings.push("Bulky ranged weapons cannot be used while the unit is engaged.");

  if (phase === "movement") {
    if (isReserve) {
      nextStep = "Deploy this reserve onto the battlefield so it can start contributing before the phase ends.";
    } else if (isEngaged) {
      nextStep = "Decide whether this unit should hold position for later or disengage now to free itself for future actions.";
    } else if (unit.abilities?.includes("solid_field_projectors")) {
      nextStep = "Consider whether a force field would block an approach lane before you spend the unit on a normal move or hold.";
    } else {
      nextStep = "Use Movement to claim space, line up later attacks, or hold this unit in a safe firing lane.";
    }
  } else if (phase === "assault") {
    if (isBurrowed) {
      nextStep = "This unit is underground, so decide whether to stay hidden for safety or reveal later when the fight matters more.";
    } else if (isEngaged) {
      nextStep = hasMelee
        ? "This unit is already tied up, so melee follow-through in Combat may matter more than new ranged plans."
        : "Because it is engaged, this unit has fewer clean Assault options and may need to hold or protect space.";
    } else if (hasRanged && hasMelee) {
      nextStep = "Choose whether this unit wants a safer ranged declaration or a higher-risk charge that can swing melee pressure.";
    } else if (hasRanged) {
      nextStep = "Look for the best legal ranged declaration now, because the attack will be locked into the Combat queue.";
    } else if (hasMelee) {
      nextStep = "If it can reach an enemy, a charge may set up this unit's strongest damage in Combat.";
    } else {
      nextStep = "Use Hold or Run to reposition this unit for a better board state before Combat begins.";
    }
  } else if (phase === "combat") {
    if (hasQueuedCombat) {
      nextStep = "Resolve this unit when you are ready. Review the queue and its sequence first so you know what rules will fire.";
    } else if (isBurrowed && isEngaged) {
      nextStep = "Close Ranks will surface the unit so it can actually participate in melee above ground.";
    } else {
      nextStep = "If this unit has no queued attack, use Hold or other legal combat actions while you finish the active fights elsewhere.";
    }
  }

  return {
    role: strengths.length
      ? strengths[0]
      : "This unit is a general-purpose piece, so its role depends on where you need pressure this turn.",
    strengths,
    warnings,
    nextStep
  };
}

function getCombatQueueTeachingCopy(entry, attacker, defender, weapon) {
  const attackerName = attacker?.name ?? "Attacker";
  const defenderName = defender?.name ?? "Defender";
  const weaponName = weapon?.name ?? "attack";

  if (entry.type === "overwatch_attack") {
    return {
      what: `${attackerName} will fire ${weaponName} into ${defenderName} before that charge finishes resolving.`,
      why: "Overwatch is a reaction attack. It can chip damage off the charger or soften the melee before the main fight begins."
    };
  }
  if (entry.type === "charge_attack") {
    return {
      what: `${attackerName} will resolve its charge into ${defenderName}, including impact if it has that rule, then fight in melee with models in fighting and supporting rank.`,
      why: "Charge attacks are where melee damage, impact dice, Close Ranks, and primary target focus matter most."
    };
  }
  return {
    what: `${attackerName} has declared ${weaponName} into ${defenderName}. This attack is locked into the Combat Phase queue and will resolve when that unit activates.`,
    why: "Ranged attacks are declared in Assault Phase, but the dice are rolled later in Combat. That gives both players time to understand what is coming."
  };
}

function getPhaseChecklistTeachingCopy(state, checklist) {
  const phase = state.phase;
  const remainingCount = checklist.remaining.length;
  if (phase === "movement") {
    return {
      goal: "Get your force into position. Deploy reserves, move onto objectives, or hold key units in place.",
      done: "A unit counts as finished once it deploys, moves, uses a movement ability, or holds.",
      next: remainingCount
        ? `You still have ${remainingCount} unit${remainingCount === 1 ? "" : "s"} to position before you can safely pass.`
        : "Everything is positioned. Passing will hand the game into Assault Phase."
    };
  }
  if (phase === "assault") {
    return {
      goal: "Decide what each unit is trying to accomplish next: shoot, charge, run, or hold.",
      done: "A unit counts as finished once it declares its attack or movement choice for the coming Combat Phase.",
      next: remainingCount
        ? `You still have ${remainingCount} unit${remainingCount === 1 ? "" : "s"} that need an Assault decision.`
        : "All attack declarations are locked in. Passing will start Combat and begin resolving the queue."
    };
  }
  if (phase === "combat") {
    return {
      goal: "Resolve the attacks and fights already set up earlier, one unit activation at a time.",
      done: "A unit counts as finished once its queued attacks or melee sequence have fully resolved in Combat.",
      next: remainingCount
        ? `You still have ${remainingCount} unit${remainingCount === 1 ? "" : "s"} left to resolve before scoring.`
        : "Combat is complete. Passing will move into cleanup and objective scoring."
    };
  }
  return {
    goal: "Resolve the current phase.",
    done: "Finish each eligible unit once.",
    next: remainingCount ? `${remainingCount} unit(s) remain.` : "You are ready to advance."
  };
}

function getLogTeachingCopy(entry) {
  if (entry.type === "combat") {
    return {
      title: "Combat Result",
      why: "This is where declared attacks finally turned into hits, saves, casualties, and rule interactions."
    };
  }
  if (entry.type === "phase") {
    return {
      title: "Phase Change",
      why: "A new phase changes what units are allowed to do and what decisions matter next."
    };
  }
  if (entry.type === "card") {
    return {
      title: "Tactical Card",
      why: "A temporary modifier is now active, so one unit or timing window has changed in your favor."
    };
  }
  if (entry.type === "scoring") {
    return {
      title: "Scoring Update",
      why: "This changed victory points or board pressure, so it affects who is actually winning."
    };
  }
  if (entry.type === "action") {
    return {
      title: "Unit Action",
      why: "This changed the board state or committed a unit's activation for the phase."
    };
  }
  return {
    title: titleCase(entry.type ?? "update"),
    why: "This entry records a rule or board-state change that may affect what happens next."
  };
}

function getLatestCombatEntryIndex(entries) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.type === "combat") return index;
  }
  return -1;
}

function buildTimelineCauseEffect(entry, recentEntries, index, uiState) {
  const aftermath = uiState?.aftermathNarrative;
  if (!aftermath) return null;

  const latestCombatIndex = getLatestCombatEntryIndex(recentEntries);
  if (entry.type === "combat" && index === latestCombatIndex) {
    return {
      label: "Cause And Effect",
      cause: aftermath.reason,
      effect: aftermath.teaching,
      metrics: aftermath.metrics ?? []
    };
  }

  if (entry.type === "scoring" && latestCombatIndex >= 0 && index >= latestCombatIndex) {
    return {
      label: "Board Swing",
      cause: "The scoring update followed a recent combat exchange, so casualties or survival likely changed who could still contest space.",
      effect: aftermath.teaching,
      metrics: aftermath.metrics ?? []
    };
  }

  return null;
}

function getTimelineFocusPayload(entry, recentEntries, index, uiState) {
  const aftermath = uiState?.aftermathNarrative;
  if (!aftermath) return null;
  const latestCombatIndex = getLatestCombatEntryIndex(recentEntries);
  const focusKey = `${entry.round}-${entry.phase}-${index}`;

  if (entry.type === "combat" && index === latestCombatIndex) {
    return {
      focusKey,
      attackerId: aftermath.attackerId ?? null,
      targetId: aftermath.targetId ?? null,
      objectiveIds: aftermath.objectiveIds ?? [],
      glossaryTerms: aftermath.glossaryTerms ?? []
    };
  }

  if (entry.type === "scoring" && latestCombatIndex >= 0 && index >= latestCombatIndex && (aftermath.objectiveIds?.length ?? 0)) {
    return {
      focusKey,
      attackerId: aftermath.attackerId ?? null,
      targetId: aftermath.targetId ?? null,
      objectiveIds: aftermath.objectiveIds ?? [],
      glossaryTerms: aftermath.glossaryTerms ?? []
    };
  }

  return null;
}

function renderTimelineCauseEffect(causeEffect) {
  if (!causeEffect) return "";
  return `
    <div class="log-cause-effect">
      <div class="log-cause-effect-title">${causeEffect.label}</div>
      <div class="log-cause-effect-row">
        <span class="log-cause-effect-label">What caused it:</span>
        <span>${causeEffect.cause}</span>
      </div>
      <div class="log-cause-effect-row">
        <span class="log-cause-effect-label">What changed next:</span>
        <span>${causeEffect.effect}</span>
      </div>
      ${(causeEffect.metrics?.length ?? 0)
        ? `
          <div class="log-cause-effect-metrics">
            ${causeEffect.metrics.map(metric => `<span class="log-cause-effect-chip">${metric}</span>`).join("")}
          </div>
        `
        : ""}
    </div>
  `;
}

function getTimelineGlossaryDefinition(term) {
  const exact = {
    "Overwatch": "Overwatch is a reaction shot that happens during an enemy charge before the melee lands.",
    "Impact": "Impact dice resolve after a successful charge and before the main melee attack.",
    "Surge": "Surge turns matching wounds into hits that bypass armour after the wound step.",
    "Hits": "Hits adds automatic armour-pool hits that skip hit and wound rolls.",
    "Precision": "Precision lets failed hit dice still become armour-pool hits without rolling to wound.",
    "Critical Hit": "Critical Hit pushes wounds past armour before saves are rolled.",
    "Dodge": "Dodge cancels a limited number of bypassed hits before they become damage.",
    "Evade": "Evade is a late defensive roll that can still avoid hits after armour results are known.",
    "Indirect Fire": "Indirect Fire allows targeting without line of sight.",
    "Long Range": "Long Range extends reach into an outer band, usually with a hit penalty.",
    "Burst Fire": "Burst Fire adds extra attacks when the target is inside the close-range band.",
    "Locked In": "Locked In adds attacks against a stationary target.",
    "Anti-Evade": "Anti-Evade makes the defender's evade roll harder.",
    "Concentrated Fire": "Concentrated Fire caps casualties and discards overflow damage.",
    "Life Support": "Life Support reduces damage after the attack already got through.",
    "Zealous Round": "Zealous Round spends an unused activation to reduce incoming damage immediately.",
    "Fighting Rank": "Fighting Rank is the set of models actually close enough to contribute attacks in melee.",
    "Supporting Rank": "Supporting Rank models assist from behind if they are linked to the front line."
  };
  return exact[term] ?? getRuleNote(term) ?? "This rule affected the exchange that was just highlighted.";
}

function renderTimelineGlossary(terms, uiState) {
  const glossaryTerms = [...new Set((terms ?? []).filter(Boolean))];
  if (!glossaryTerms.length) return "";
  const activeTerm = glossaryTerms.includes(uiState?.activeGlossaryTerm) ? uiState.activeGlossaryTerm : glossaryTerms[0];
  const definition = getTimelineGlossaryDefinition(activeTerm);
  return `
    <div class="log-glossary">
      <div class="log-glossary-title">Rules In Play</div>
      <div class="log-glossary-chip-row">
        ${glossaryTerms.map(term => `<button class="log-glossary-chip ${term === activeTerm ? "active" : ""}" data-timeline-glossary="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join("")}
      </div>
      <div class="log-glossary-definition">
        <div class="log-glossary-term">${escapeHtml(activeTerm)}</div>
        <div class="log-glossary-copy">${escapeHtml(definition)}</div>
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════════════════
   UNIT LISTS
   ══════════════════════════════════════════════════════════════ */

function renderUnitList(containerId, units, state, uiState, onClick) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (!units.length) {
    container.innerHTML = '<div class="empty-state">None.</div>';
    return;
  }
  units.forEach(unit => container.appendChild(buildUnitCard(unit, uiState.selectedUnitId, onClick, state)));
}

export function renderReserveTray(state, uiState, onSelect) {
  renderUnitList("playerReserves", state.players.playerA.reserveUnitIds.map(id => state.units[id]), state, uiState, onSelect);
  renderUnitList("enemyReserves", state.players.playerB.reserveUnitIds.map(id => state.units[id]), state, uiState, onSelect);
  renderUnitList("playerBattlefield", state.players.playerA.battlefieldUnitIds.map(id => state.units[id]), state, uiState, onSelect);
  renderUnitList("enemyBattlefield", state.players.playerB.battlefieldUnitIds.map(id => state.units[id]), state, uiState, onSelect);
}

/* ══════════════════════════════════════════════════════════════
   SELECTED UNIT PANEL — full combat stats
   ══════════════════════════════════════════════════════════════ */

export function renderSelectedUnit(state, uiState) {
  const panel = document.getElementById("selectedUnitPanel");
  const unit = uiState.selectedUnitId ? state.units[uiState.selectedUnitId] : null;
  if (!unit) {
    panel.innerHTML = '<div class="empty-state">No unit selected. Click a unit card or press <kbd>Tab</kbd> to cycle.</div>';
    return;
  }
  const alive = unit.modelIds.filter(id => unit.models[id].alive).length;
  const total = unit.modelIds.length;
  const abilities = unit.abilities?.length ? unit.abilities.map(a => titleCase(a)).join(", ") : "None";
  const abilityNotes = (unit.abilities ?? [])
    .map(ability => [titleCase(ability), getRuleNote(ability)])
    .filter(([, note]) => Boolean(note));
  const tags = unit.tags?.length ? unit.tags.join(", ") : "";
  const defense = unit.defense ?? {};
  const isFriendlyUnit = unit.owner === "playerA";
  const guidance = isFriendlyUnit ? getUnitPhaseGuidance(state, unit) : getEnemyThreatGuidance(state, unit);
  const guidanceTitle = isFriendlyUnit ? "How To Use This Unit Right Now" : "How To Read This Enemy Right Now";
  const guidanceRoleLabel = isFriendlyUnit ? "Role In This Phase" : "Main Threat Right Now";
  const guidanceNextStepLabel = isFriendlyUnit ? "Best Next Step" : "Most Likely Next Step";
  const guidanceStrengthsLabel = isFriendlyUnit ? "What It Does Well" : "What Makes It Dangerous";
  const guidanceWarningsLabel = isFriendlyUnit ? "What To Watch Out For" : "How To Play Around It";
  const threatStats = !isFriendlyUnit && guidance.threatStats
    ? [
        ["Nearest Friendly", guidance.threatStats.nearestEnemyDistance ? `${guidance.threatStats.nearestEnemyDistance}"` : "None nearby"],
        ["Ranged Reach", guidance.threatStats.rangedReach ? `${guidance.threatStats.rangedReach}"` : "No ranged threat"],
        ["Melee Threat", guidance.threatStats.meleeThreat ? `${guidance.threatStats.meleeThreat}"` : "No melee threat"],
        ["Queued Attack", guidance.threatStats.queuedAttack || "None queued"]
      ]
    : [];

  // Weapon sections with full stats
  const rangedHtml = unit.rangedWeapons?.length
    ? unit.rangedWeapons.map(w => `
      <div class="weapon-card">
        <div class="weapon-card-name">${w.name}</div>
        ${formatWeaponFull(w)}
      </div>`).join("")
    : '<div class="empty-state">No ranged weapons</div>';

  const meleeHtml = unit.meleeWeapons?.length
    ? unit.meleeWeapons.map(w => `
      <div class="weapon-card">
        <div class="weapon-card-name">${w.name}</div>
        ${formatWeaponFull(w)}
      </div>`).join("")
    : '<div class="empty-state">No melee weapons</div>';

  panel.innerHTML = `
    <div class="selected-panel-title">${unit.name} <span class="selected-owner badge ${unit.owner}">${formatPlayerName(unit.owner)}</span></div>
    ${tags ? `<div class="unit-tags">${tags}</div>` : ""}
    <div class="selected-stats">
      <div class="selected-stat"><div class="k">Speed</div><div class="v">${unit.speed}</div></div>
      <div class="selected-stat"><div class="k">Supply</div><div class="v">${unit.currentSupplyValue}</div></div>
      <div class="selected-stat"><div class="k">Models</div><div class="v">${alive}/${total}</div></div>
      <div class="selected-stat"><div class="k">Armor</div><div class="v">${defense.armorSave ?? "—"}+</div></div>
      <div class="selected-stat"><div class="k">Evade</div><div class="v">${defense.evadeTarget ? `${defense.evadeTarget}+` : "—"}</div></div>
      <div class="selected-stat"><div class="k">Tough</div><div class="v">${defense.toughness ?? "—"}</div></div>
      <div class="selected-stat"><div class="k">Location</div><div class="v">${titleCase(unit.status.location)}</div></div>
    </div>
    <div class="badge-row" style="margin-top:6px;">
      ${unit.status.engaged ? '<span class="badge warn">Engaged — must Disengage before moving</span>' : ''}
      ${unit.status.hidden ? '<span class="badge good">Hidden</span>' : ''}
      ${unit.status.burrowed ? '<span class="badge good">Burrowed</span>' : ''}
      ${unit.status.outOfCoherency ? '<span class="badge warn">Out of Coherency — cannot contest objectives</span>' : ''}
      ${unit.status.movementActivated ? '<span class="badge good">Movement ✓</span>' : ''}
      ${unit.status.assaultActivated ? '<span class="badge good">Assault ✓</span>' : ''}
      ${unit.status.combatActivated ? '<span class="badge good">Combat ✓</span>' : ''}
    </div>
    ${defense.dodge ? `<div class="selected-detail"><div class="k">Defense Rule</div><div class="v">Dodge ${defense.dodge}</div></div>` : ""}
    ${abilities !== "None" ? `<div class="selected-detail"><div class="k">Abilities</div><div class="v">${abilities}</div></div>` : ""}
    <div class="selected-detail teaching-detail">
      <div class="k">${guidanceTitle}</div>
      <div class="v">
        <div class="selected-guidance-grid">
          <div class="selected-guidance-card">
            <div class="selected-guidance-label">${guidanceRoleLabel}</div>
            <div>${guidance.role}</div>
          </div>
          <div class="selected-guidance-card">
            <div class="selected-guidance-label">${guidanceNextStepLabel}</div>
            <div>${guidance.nextStep}</div>
          </div>
        </div>
        ${threatStats.length ? `<div class="selected-guidance-list selected-threat-list"><div class="selected-guidance-label">Threat Readout</div><div class="selected-guidance-grid">${threatStats.map(([label, value]) => `<div class="selected-guidance-card selected-threat-card"><div class="selected-guidance-label">${label}</div><div>${value}</div></div>`).join("")}</div></div>` : ""}
        ${guidance.strengths.length ? `<div class="selected-guidance-list"><div class="selected-guidance-label">${guidanceStrengthsLabel}</div>${guidance.strengths.map(item => `<div class="selected-guidance-item">${item}</div>`).join("")}</div>` : ""}
        ${guidance.warnings.length ? `<div class="selected-guidance-list"><div class="selected-guidance-label">${guidanceWarningsLabel}</div>${guidance.warnings.map(item => `<div class="selected-guidance-item warning">${item}</div>`).join("")}</div>` : ""}
      </div>
    </div>
    ${abilityNotes.length ? `<div class="selected-detail"><div class="k">How These Rules Work</div><div class="v">${renderRuleNoteList(abilityNotes)}</div></div>` : ""}
    <div class="selected-detail">
      <div class="k">Ranged Weapons</div>
      <div class="v">${rangedHtml}</div>
    </div>
    <div class="selected-detail">
      <div class="k">Melee Weapons</div>
      <div class="v">${meleeHtml}</div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════════════════
   ACTION BUTTONS
   ══════════════════════════════════════════════════════════════ */

export function renderActionButtons(buttons) {
  const container = document.getElementById("actionButtons");
  container.innerHTML = "";
  if (!buttons.length) {
    container.innerHTML = '<div class="empty-state">Select a unit to see actions.</div>';
    return;
  }
  buttons.forEach(button => container.appendChild(button));

  const disabledReasons = buttons
    .filter(button => button.disabled && button.dataset?.disabledReason)
    .map(button => ({ label: button.dataset.actionLabel ?? button.textContent ?? "Action", reason: button.dataset.disabledReason }));
  const recommended = buttons.find(button => button.dataset?.recommended === "true");
  if (recommended || disabledReasons.length) {
    const summary = document.createElement("div");
    summary.className = "action-bar-note";
    const recommendedText = recommended
      ? `Recommended: ${recommended.dataset.actionLabel ?? recommended.textContent ?? "Action"}`
      : null;
    const blockedText = disabledReasons.length
      ? `${disabledReasons.length} blocked action${disabledReasons.length === 1 ? "" : "s"}`
      : null;
    summary.textContent = [recommendedText, blockedText].filter(Boolean).join(" • ");
    container.appendChild(summary);
  }
}

/* ══════════════════════════════════════════════════════════════
   TACTICAL CARDS — with human-readable descriptions
   ══════════════════════════════════════════════════════════════ */

export function renderTacticalCards(state, buttons) {
  const container = document.getElementById("tacticalCards");
  container.innerHTML = "";

  if (state.activePlayer !== "playerA") {
    container.innerHTML = '<div class="empty-state">Cards available on your turn.</div>';
    return;
  }
  if (state.players.playerA.hasPassedThisPhase) {
    container.innerHTML = '<div class="empty-state">Phase passed.</div>';
    return;
  }

  // Show all cards in hand with descriptions, even if not playable this phase
  const hand = state.players.playerA.hand ?? [];
  if (!hand.length) {
    container.innerHTML = '<div class="empty-state">No cards in hand.</div>';
    return;
  }

  for (const cardEntry of hand) {
    const card = getTacticalCard(cardEntry.cardId);
    const desc = describeCardEffect(card);
    const teaching = describeCardTeaching(card);
    const isPlayablePhase = card.phase === state.phase;
    const matchingButton = buttons.find(b => b.dataset?.cardId === cardEntry.instanceId);

    const wrap = document.createElement("div");
    wrap.className = `tactical-card-display ${isPlayablePhase ? "playable" : "inactive"}`;
    wrap.innerHTML = `
      <div class="tc-header">
        <span class="tc-name">${card.name}</span>
        <span class="tc-phase badge ${isPlayablePhase ? "good" : ""}">${titleCase(card.phase)}</span>
      </div>
      <div class="tc-effect">${desc.effectText}</div>
      <div class="tc-meta">
        <span>${desc.durationText}</span>
        <span>${desc.targetText}</span>
      </div>
      <div class="tc-teaching">
        <div class="tc-teaching-line"><span class="tc-teaching-label">Best used when:</span> ${teaching.bestUse}</div>
        <div class="tc-teaching-line"><span class="tc-teaching-label">Timing tip:</span> ${teaching.timing}</div>
      </div>
    `;

    if (matchingButton) {
      wrap.appendChild(matchingButton);
    } else if (isPlayablePhase) {
      // Find matching button from the buttons array by card name
      const btn = buttons.find(b => b.textContent?.includes(card.name));
      if (btn) wrap.appendChild(btn);
    }

    container.appendChild(wrap);
  }

  // If there are buttons not matched to cards (edge case), append them
  const usedButtons = new Set();
  container.querySelectorAll("button").forEach(b => usedButtons.add(b));
  for (const btn of buttons) {
    if (!usedButtons.has(btn)) {
      const extra = document.createElement("div");
      extra.className = "card-action-item";
      extra.appendChild(btn);
      container.appendChild(extra);
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   COMBAT QUEUE — with attack preview
   ══════════════════════════════════════════════════════════════ */

export function renderCombatQueue(state, uiState, handlers = {}) {
  const panel = document.getElementById("combatQueuePanel");
  if (!panel) return;
  panel.innerHTML = "";

  if (!state.combatQueue.length) {
    panel.innerHTML = '<div class="empty-state">No queued attacks. Declare Ranged or Charge in Assault Phase to queue attacks here.</div>';
    return;
  }

  const intro = document.createElement("div");
  intro.className = "combat-queue-intro";
  intro.innerHTML = `
    <div class="combat-queue-title">How to read this queue</div>
    <div class="combat-queue-copy">These are the attacks already committed for Combat. The top entry resolves first, and each card explains what kind of interaction will happen when that unit activates.</div>
  `;
  panel.appendChild(intro);

  state.combatQueue.forEach((entry, index) => {
    const attacker = state.units[entry.attackerId];
    const defender = state.units[entry.targetId];
    if (!attacker || !defender) return;

    const isYours = attacker.owner === "playerA";
    const attackerName = attacker.name;
    const defenderName = defender.name;

    // Find the weapon being used
    const isMelee = entry.type === "charge_attack";
    const weaponPool = isMelee ? attacker.meleeWeapons : attacker.rangedWeapons;
    const weapon = weaponPool?.find(w => w.id === entry.weaponId) ?? weaponPool?.[0];
    const weaponInfo = weapon ? formatWeaponOneLine(weapon) : "unknown weapon";

    const aliveModels = attacker.modelIds.filter(id => attacker.models[id].alive).length;
    const attackCount = aliveModels * (weapon?.attacksPerModel ?? weapon?.shotsPerModel ?? 1);
    const teachingCopy = getCombatQueueTeachingCopy(entry, attacker, defender, weapon);

    const row = document.createElement("div");
    const isFocused = uiState?.hoveredCombatQueueIndex === index || uiState?.selectedCombatQueueIndex === index;
    row.className = `combat-queue-entry ${isYours ? "queue-yours" : "queue-enemy"} ${isFocused ? "focused" : ""}`;
    row.addEventListener("mouseenter", () => handlers.onCombatQueueHover?.(index));
    row.addEventListener("mouseleave", () => handlers.onCombatQueueHover?.(null));
    row.addEventListener("click", () => handlers.onCombatQueueClick?.(index));
    row.innerHTML = `
      <div class="cq-header">
        <span class="cq-index">#${index + 1}</span>
        <span class="cq-type badge ${isMelee ? "warn" : ""}">${formatQueueType(entry.type)}</span>
        <span class="cq-direction">${attackerName} → ${defenderName}</span>
      </div>
      <div class="cq-detail">
        ${weapon ? `<div class="cq-weapon">${weapon.name}: ${weaponInfo}</div>` : ""}
        <div class="cq-preview">${aliveModels} models alive × ${weapon?.attacksPerModel ?? weapon?.shotsPerModel ?? 1} attacks = ${attackCount} dice in Attack Pool</div>
        <div class="cq-teaching-block">
          <div class="cq-teaching-line"><span class="cq-teaching-label">What happens:</span> ${teachingCopy.what}</div>
          <div class="cq-teaching-line"><span class="cq-teaching-label">Why it matters:</span> ${teachingCopy.why}</div>
          <div class="cq-teaching-line"><span class="cq-teaching-label">Board preview:</span> Hover or click this entry to highlight the attacker, target, and likely combat lane on the board.</div>
        </div>
      </div>
    `;
    panel.appendChild(row);
  });
}

/* ══════════════════════════════════════════════════════════════
   PHASE CHECKLIST
   ══════════════════════════════════════════════════════════════ */

export function renderPhaseChecklist(state, checklist) {
  const container = document.getElementById("phaseChecklist");
  if (!container) return;
  if (!checklist || state.activePlayer !== "playerA") {
    container.innerHTML = '<div class="empty-state">Waiting for your turn.</div>';
    return;
  }
  if (checklist.total === 0) {
    container.innerHTML = '<div class="empty-state">No units to activate.</div>';
    return;
  }

  const pct = checklist.total > 0 ? Math.round((checklist.done / checklist.total) * 100) : 0;
  const teachingCopy = getPhaseChecklistTeachingCopy(state, checklist);
  container.innerHTML = `
    <div class="checklist-teaching-card">
      <div class="checklist-teaching-title">${titleCase(state.phase)} Goal</div>
      <div class="checklist-teaching-copy">${teachingCopy.goal}</div>
      <div class="checklist-teaching-copy"><span class="checklist-teaching-label">What counts as done:</span> ${teachingCopy.done}</div>
      <div class="checklist-teaching-copy"><span class="checklist-teaching-label">What to do next:</span> ${teachingCopy.next}</div>
    </div>
    <div class="checklist-progress">
      <div class="checklist-bar"><div class="checklist-fill" style="width:${pct}%"></div></div>
      <div class="checklist-label">${checklist.done} / ${checklist.total} activated</div>
    </div>
    ${checklist.remaining.length > 0 ? `
      <div class="checklist-remaining">
        ${checklist.remaining.map(name => `<span class="checklist-unit">${name}</span>`).join("")}
      </div>
    ` : '<div class="checklist-done">All units activated — Pass to advance!</div>'}
  `;
}

/* ══════════════════════════════════════════════════════════════
   COMBAT LOG — with structured entries
   ══════════════════════════════════════════════════════════════ */

export function renderLog(state, uiState = {}, handlers = {}) {
  const panel = document.getElementById("logPanel");
  panel.innerHTML = "";
  const recentEntries = state.log.slice(-16);
  recentEntries.forEach((entry, index) => {
    const div = document.createElement("div");
    const isCombat = entry.type === "combat";
    const teaching = getLogTeachingCopy(entry);
    const causeEffect = buildTimelineCauseEffect(entry, recentEntries, index, uiState);
    const focusPayload = getTimelineFocusPayload(entry, recentEntries, index, uiState);
    const focusKey = `${entry.round}-${entry.phase}-${index}`;
    const showGlossary = focusPayload && uiState?.timelineFocusedKey === focusKey;
    div.className = `log-entry ${isCombat ? "log-combat" : ""} ${focusPayload ? "log-entry-focusable" : ""}`;
    div.innerHTML = `
      <div class="meta">R${entry.round} · ${titleCase(entry.phase)} · ${teaching.title}</div>
      <div class="log-body">${entry.text}</div>
      <div class="log-teaching"><span class="log-teaching-label">Why it matters:</span> ${teaching.why}</div>
      ${renderTimelineCauseEffect(causeEffect)}
      ${showGlossary ? renderTimelineGlossary(focusPayload.glossaryTerms, uiState) : ""}
    `;
    if (focusPayload) {
      div.addEventListener("click", () => handlers.onLogEntryFocus?.(focusPayload));
      div.title = "Click to highlight this interaction on the board.";
    }
    if (showGlossary) {
      div.querySelectorAll("[data-timeline-glossary]").forEach(button => {
        button.addEventListener("click", event => {
          event.stopPropagation();
          handlers.onTimelineGlossaryTerm?.(button.getAttribute("data-timeline-glossary"));
        });
      });
    }
    panel.appendChild(div);
  });
}
