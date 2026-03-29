import { getUnitTemplate, summarizeImportedUpgrades } from "../data/units.js";
import { getTacticalCard } from "../data/tactical_cards.js";

const UNIT_TEMPLATE_MAP = {
  zerg: {
    kerrigan: { T2: "kerrigan" },
    hydralisk: { T1: "hydralisk", T2: "hydralisk", T3: "hydralisk" },
    raptor: { T2: "raptor_t2", T3: "raptor_t2" },
    "kerrigan-raptor": { T2: "raptor_t2" },
    roach: { T2: "roach_t3", T3: "roach_t3" },
    corpser: { T2: "roach_t3" },
    zergling: { T2: "zergling_t2", T3: "zergling_t3" },
    queen: { T2: "queen" },
    "omega-worm": { T2: "omega_worm" },
    roachling: { T2: "roachling" }
  },
  terran: {
    "jim-raynor": { T2: "jim_raynor" },
    goliath: { T2: "goliath" },
    marine: { T2: "marine_t2", T3: "marine_t2" },
    "raynors_raider": { T2: "marine_t2" },
    "raynors-raider": { T2: "marine_t2" },
    marauder: { T1: "marauder_t1", T2: "marauder_t1", T3: "marauder_t1" },
    medic: { T1: "medic_t1", T2: "medic_t1" },
    "point-defense-drone": { T2: "point_defense_drone" }
  },
  protoss: {
    artanis: { T2: "artanis" },
    zealot: { T1: "zealot_squad", T2: "zealot_squad" },
    "praetor-guard": { T1: "zealot_squad", T2: "zealot_squad" },
    stalker: { T2: "stalker", T3: "stalker" },
    adept: { T1: "adept", T2: "adept" },
    sentry: { T1: "sentry", T2: "sentry" },
    dragoon: { T1: "dragoon", T2: "dragoon" },
    pylon: { T2: "pylon" }
  }
};

const FACTION_HINTS = {
  zerg: ["zerg", "kerrigan", "swarm", "roach", "zergling", "hydralisk", "queen", "raptor"],
  terran: ["terran", "raynor", "marine", "marauder", "medic", "goliath", "raider"],
  protoss: ["protoss", "khalai", "zealot", "stalker", "adept", "sentry", "praetor", "artanis"]
};

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeTier(tier) {
  const raw = String(tier?.level ?? tier?.tier ?? tier ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw === "T1" || raw === "T2" || raw === "T3") return raw;
  return "T2";
}

function inferFactionKey(payload) {
  const haystacks = [
    payload?.faction,
    payload?.factionCard?.id,
    payload?.factionCard?.name,
    ...(payload?.units ?? []).flatMap(unit => [unit?.unitId, unit?.name, unit?.role])
  ]
    .filter(Boolean)
    .map(normalizeText)
    .join(" ");

  for (const [factionKey, hints] of Object.entries(FACTION_HINTS)) {
    if (hints.some(hint => haystacks.includes(normalizeText(hint)))) {
      return factionKey;
    }
  }
  return null;
}

function resolveUnitTemplateId(factionKey, unitId, tier) {
  const factionMap = UNIT_TEMPLATE_MAP[factionKey] ?? {};
  const unitMap = factionMap[unitId] ?? factionMap[String(unitId).replace(/_/g, "-")];
  if (!unitMap) return null;
  return unitMap[tier] ?? unitMap.T2 ?? unitMap.T1 ?? unitMap.T3 ?? null;
}

function canUseTemplate(templateId) {
  try {
    getUnitTemplate(templateId);
    return true;
  } catch {
    return false;
  }
}

function resolveCardId(cardLike) {
  const rawId = typeof cardLike === "string" ? cardLike : cardLike?.id;
  const direct = normalizeText(rawId);
  const candidates = [direct, direct.replace(/_/g, "-"), direct.replace(/-/g, "_")].filter(Boolean);
  for (const candidate of candidates) {
    try {
      getTacticalCard(candidate);
      return candidate;
    } catch {
      // try the next normalized form
    }
  }
  return null;
}

export function isArmyBuilderPayload(payload) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    Array.isArray(payload.units) &&
    (Array.isArray(payload.tacticalCards) || Array.isArray(payload.tactical))
  );
}

export function importArmyBuilderRoster(payload, playerId = "playerA") {
  if (!isArmyBuilderPayload(payload)) {
    throw new Error("This file is not a supported Army Builder export.");
  }

  const warnings = [];
  const factionKey = inferFactionKey(payload);
  if (!factionKey) {
    warnings.push("Could not confidently identify the faction for this roster.");
  }

  const importedUnits = [];
  const sourceUnits = payload.units ?? [];
  let appliedUpgradeCount = 0;
  let partialUpgradeCount = 0;
  let ignoredUpgradeCount = 0;
  sourceUnits.forEach((entry, index) => {
    const sourceUnitId = normalizeText(entry?.unitId);
    const tier = normalizeTier(entry?.tier);
    const templateId = factionKey ? resolveUnitTemplateId(factionKey, sourceUnitId, tier) : null;
    if (!templateId || !canUseTemplate(templateId)) {
      warnings.push(`Skipped unsupported unit: ${entry?.name ?? entry?.unitId ?? `Unit ${index + 1}`} (${tier}).`);
      return;
    }

    const selectedUpgrades = (entry?.selectedUpgrades ?? []).map(upgrade => upgrade?.name).filter(Boolean);
    const upgradeSummary = summarizeImportedUpgrades(templateId, selectedUpgrades);
    appliedUpgradeCount += upgradeSummary.applied.length;
    partialUpgradeCount += upgradeSummary.partial.length;
    ignoredUpgradeCount += upgradeSummary.ignored.length;

    importedUnits.push({
      id: `${playerId}_${templateId}_${index + 1}`,
      templateId,
      sourceUnitId,
      sourceName: entry?.name ?? sourceUnitId,
      tier,
      selectedUpgrades,
      upgradeSummary
    });
  });

  const rawCards = payload.tacticalCards ?? payload.tactical ?? [];
  const tacticalCards = [];
  rawCards.forEach((entry, index) => {
    const cardId = resolveCardId(entry);
    if (!cardId) {
      warnings.push(`Skipped unsupported tactical card: ${entry?.name ?? entry?.id ?? `Card ${index + 1}`}.`);
      return;
    }
    tacticalCards.push(cardId);
  });

  if (sourceUnits.length && !importedUnits.length) {
    warnings.push("No supported units from this roster are currently implemented in the engine.");
  }

  return {
    source: "army_builder",
    playerId,
    factionKey,
    factionName: payload?.faction ?? payload?.factionCard?.name ?? "Imported Roster",
    scaleName: payload?.scale ?? null,
    army: importedUnits,
    tacticalCards,
    warnings,
    summary: {
      importedUnits: importedUnits.length,
      skippedUnits: Math.max(0, sourceUnits.length - importedUnits.length),
      importedCards: tacticalCards.length,
      skippedCards: Math.max(0, rawCards.length - tacticalCards.length),
      appliedUpgrades: appliedUpgradeCount,
      partialUpgrades: partialUpgradeCount,
      ignoredUpgrades: ignoredUpgradeCount
    }
  };
}

export function buildSetupFromImportedRosters({
  baseSetup,
  missionId,
  deploymentId,
  firstPlayerMarkerHolder = "playerA",
  rosterA = null,
  rosterB = null
}) {
  return {
    ...baseSetup,
    missionId: missionId ?? baseSetup.missionId,
    deploymentId: deploymentId ?? baseSetup.deploymentId,
    firstPlayerMarkerHolder,
    armyA: rosterA?.army?.length ? rosterA.army.map(unit => ({ id: unit.id, templateId: unit.templateId, selectedUpgrades: unit.selectedUpgrades ?? [] })) : baseSetup.armyA,
    armyB: rosterB?.army?.length ? rosterB.army.map(unit => ({ id: unit.id, templateId: unit.templateId, selectedUpgrades: unit.selectedUpgrades ?? [] })) : baseSetup.armyB,
    tacticalCardsA: rosterA?.tacticalCards?.length ? rosterA.tacticalCards : baseSetup.tacticalCardsA,
    tacticalCardsB: rosterB?.tacticalCards?.length ? rosterB.tacticalCards : baseSetup.tacticalCardsB
  };
}
