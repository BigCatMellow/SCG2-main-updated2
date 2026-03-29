import { appendLog } from "./state.js";
import { endActivationAndPassTurn, isUnitEligibleForCurrentPhaseActivation, markUnitActivatedForCurrentPhase } from "./activation.js";

const MEDPACK_RANGE = 4;
const OPTICAL_FLARE_BASE_RANGE = 12;
const OPTICAL_FLARE_UPGRADED_RANGE = 16;

function getAliveModels(unit) {
  return unit?.modelIds?.map(modelId => unit.models[modelId]).filter(model => model?.alive && model.x != null && model.y != null) ?? [];
}

function getDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getLeaderPoint(unit) {
  const leader = unit?.models?.[unit?.leadingModelId];
  if (!leader || !leader.alive || leader.x == null || leader.y == null) return null;
  return { x: leader.x, y: leader.y };
}

function canUseSupportAction(state, playerId, unitId) {
  const unit = state.units[unitId];
  if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
  if (state.phase !== "movement") return { ok: false, code: "WRONG_PHASE", message: "Support abilities are only available in the Movement Phase." };
  if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
  if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Only battlefield units can use support abilities." };
  if (!isUnitEligibleForCurrentPhaseActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
  return { ok: true, unit };
}

function isBiological(unit) {
  return unit?.tags?.includes("Biological");
}

function countModelsWithinRange(sourceUnit, targetUnit, range) {
  const sourceModels = getAliveModels(sourceUnit);
  const targetModels = getAliveModels(targetUnit);
  let count = 0;

  for (const sourceModel of sourceModels) {
    const inRange = targetModels.some(targetModel => getDistance(sourceModel, targetModel) <= range + 1e-6);
    if (inRange) count += 1;
  }

  if (sourceUnit?.abilities?.includes("stabilizer_medpacks")) count += 1;
  return count;
}

function healUnit(unit, amount) {
  let remaining = Math.max(0, Math.floor(amount));
  if (!remaining) return 0;

  let healed = 0;
  const models = unit.modelIds
    .map(modelId => unit.models[modelId])
    .filter(model => model.alive)
    .sort((a, b) => a.woundsRemaining - b.woundsRemaining);

  for (const model of models) {
    if (remaining <= 0) break;
    const missing = Math.max(0, unit.woundsPerModel - model.woundsRemaining);
    if (!missing) continue;
    const restored = Math.min(missing, remaining);
    model.woundsRemaining += restored;
    healed += restored;
    remaining -= restored;
  }

  return healed;
}

export function getOpticalFlareRange(unit) {
  return unit?.abilities?.includes("a_13_flash_grenade_launcher")
    ? OPTICAL_FLARE_UPGRADED_RANGE
    : OPTICAL_FLARE_BASE_RANGE;
}

export function getEffectiveRangedRange(state, unit, weapon) {
  if (!weapon) return 0;
  const opticalFlared = unit?.status?.opticalFlareRound === state.round;
  if (opticalFlared) {
    const baseRange = Number(weapon.rangeInches ?? 0);
    const debuffed = Math.max(0, baseRange - (unit.status.opticalFlareRangePenalty ?? 4));
    return debuffed;
  }
  return null;
}

export function validateUseMedpack(state, playerId, unitId, targetId) {
  const shared = canUseSupportAction(state, playerId, unitId);
  if (!shared.ok) return shared;
  const unit = shared.unit;
  if (!unit.abilities?.includes("stabilize_wounds")) {
    return { ok: false, code: "NO_ABILITY", message: "This unit does not have Medpack." };
  }

  const target = state.units[targetId];
  if (!target || target.owner !== playerId) return { ok: false, code: "BAD_TARGET", message: "Choose another friendly unit." };
  if (target.id === unit.id) return { ok: false, code: "BAD_TARGET", message: "Medpack must target another friendly unit." };
  if (target.status.location !== "battlefield") return { ok: false, code: "BAD_TARGET", message: "Target must be on the battlefield." };
  if (!isBiological(target)) return { ok: false, code: "BAD_TARGET", message: "Medpack can only target friendly biological units." };

  const supportModels = countModelsWithinRange(unit, target, MEDPACK_RANGE);
  if (supportModels <= 0) return { ok: false, code: "OUT_OF_RANGE", message: "No Medic models are within 4\" of that target." };

  return { ok: true, unit, target, derived: { supportModels } };
}

export function resolveUseMedpack(state, playerId, unitId, targetId) {
  const validation = validateUseMedpack(state, playerId, unitId, targetId);
  if (!validation.ok) return validation;

  const { unit, target } = validation;
  const healed = healUnit(target, validation.derived.supportModels);
  markUnitActivatedForCurrentPhase(state, unitId);
  appendLog(
    state,
    "action",
    `${unit.name} uses Medpack on ${target.name}: ${validation.derived.supportModels} support in range, ${healed} wound(s) restored.`
  );
  endActivationAndPassTurn(state);
  return { ok: true, state, events: [{ type: "medpack_used", payload: { unitId, targetId, healed } }] };
}

export function validateUseOpticalFlare(state, playerId, unitId, targetId) {
  const shared = canUseSupportAction(state, playerId, unitId);
  if (!shared.ok) return shared;
  const unit = shared.unit;
  if (!unit.abilities?.includes("stabilize_wounds")) {
    return { ok: false, code: "NO_ABILITY", message: "This unit does not have Optical Flare." };
  }

  const target = state.units[targetId];
  if (!target || target.owner === playerId) return { ok: false, code: "BAD_TARGET", message: "Choose an enemy unit." };
  if (target.status.location !== "battlefield") return { ok: false, code: "BAD_TARGET", message: "Target must be on the battlefield." };

  const sourcePoint = getLeaderPoint(unit);
  const targetPoint = getLeaderPoint(target);
  if (!sourcePoint || !targetPoint) return { ok: false, code: "BAD_TARGET", message: "Target or source is missing a valid leader position." };

  const range = getOpticalFlareRange(unit);
  if (getDistance(sourcePoint, targetPoint) > range + 1e-6) {
    return { ok: false, code: "OUT_OF_RANGE", message: `Optical Flare can only target enemies within ${range}\".` };
  }

  return { ok: true, unit, target, derived: { range } };
}

export function resolveUseOpticalFlare(state, playerId, unitId, targetId) {
  const validation = validateUseOpticalFlare(state, playerId, unitId, targetId);
  if (!validation.ok) return validation;

  const { unit, target } = validation;
  target.status.opticalFlareRound = state.round;
  target.status.opticalFlareRangePenalty = 4;
  markUnitActivatedForCurrentPhase(state, unitId);
  appendLog(
    state,
    "action",
    `${unit.name} uses Optical Flare on ${target.name}: Range -4 this round, no Long Range.`
  );
  endActivationAndPassTurn(state);
  return {
    ok: true,
    state,
    events: [{
      type: "optical_flare_used",
      payload: { unitId, targetId, range: validation.derived.range }
    }]
  };
}

export function resolveLifeSupport(state, target, totalDamage) {
  if (totalDamage <= 0 || !target || !isBiological(target) || target.status.location !== "battlefield") return null;

  const supportingUnits = Object.values(state.units).filter(unit =>
    unit.owner === target.owner &&
    unit.id !== target.id &&
    unit.status.location === "battlefield" &&
    unit.abilities?.includes("stabilize_wounds")
  );

  let reducedBy = 0;
  const contributions = [];
  for (const unit of supportingUnits) {
    const supportModels = countModelsWithinRange(unit, target, MEDPACK_RANGE);
    if (supportModels <= 0) continue;
    reducedBy += supportModels;
    contributions.push({ unitId: unit.id, name: unit.name, supportModels });
  }

  reducedBy = Math.min(totalDamage, reducedBy);
  if (reducedBy <= 0) return null;

  appendLog(
    state,
    "combat",
    `${target.name} gains Life Support: ${contributions.map(entry => `${entry.name} (${entry.supportModels})`).join(", ")} reduce incoming damage by ${reducedBy}.`
  );
  return { reducedBy, contributions };
}
