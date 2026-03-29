import { appendLog } from "./state.js";
import { endActivationAndPassTurn, isUnitEligibleForCurrentPhaseActivation, markUnitActivatedForCurrentPhase } from "./activation.js";
import { addEffect } from "./effects.js";
import { refreshAllSupply } from "./supply.js";

const MEDPACK_RANGE = 4;
const OPTICAL_FLARE_BASE_RANGE = 12;
const OPTICAL_FLARE_UPGRADED_RANGE = 16;
const GUARDIAN_SHIELD_RANGE = 4;
const POINT_DEFENSE_LASER_RANGE = 4;
const STIMPACK_SPEED_BONUS = 3;
const STIMPACK_NON_LETHAL_DAMAGE = 2;

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

function getStimpackProfile(unit) {
  if (!unit) return null;
  const templateId = (unit.templateId ?? unit.id ?? "").toLowerCase();
  const hasStimpackIdentity = unit.abilities?.includes("stimpack_drill")
    || templateId.includes("marine_t2")
    || templateId.includes("marauder")
    || templateId.includes("raider");
  if (!hasStimpackIdentity) return null;
  return {
    speedBonus: STIMPACK_SPEED_BONUS,
    precisionBonus: templateId.includes("marauder") ? 2 : 3,
    nonLethalDamage: STIMPACK_NON_LETHAL_DAMAGE
  };
}

function applyNonLethalDamage(unit, amount) {
  let remaining = Math.max(0, Math.floor(amount));
  let applied = 0;
  const models = unit.modelIds
    .map(modelId => unit.models[modelId])
    .filter(model => model.alive)
    .sort((a, b) => b.woundsRemaining - a.woundsRemaining);

  for (const model of models) {
    if (remaining <= 0) break;
    const safeDamage = Math.max(0, model.woundsRemaining - 1);
    if (!safeDamage) continue;
    const dealt = Math.min(safeDamage, remaining);
    model.woundsRemaining -= dealt;
    remaining -= dealt;
    applied += dealt;
  }

  return applied;
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

export function getStimpackPrecisionBonus(state, unit) {
  const profile = getStimpackProfile(unit);
  if (!profile) return 0;
  return (state.effects ?? []).some(effect =>
    effect?.name === "Stimpack"
      && effect?.target?.scope === "unit"
      && effect?.target?.unitId === unit.id
      && effect?.duration?.type === "rounds"
      && effect.duration.remaining > 0
  ) ? profile.precisionBonus : 0;
}

export function getGuardianShieldZones(state, playerId = null) {
  return (state.effects ?? [])
    .filter(effect => effect?.zone?.kind === "guardian_shield_field")
    .filter(effect => playerId == null || effect?.source?.owner === playerId)
    .map(effect => {
      const center = getLeaderPoint(state.units?.[effect.target?.unitId]);
      if (!center) return null;
      return {
        id: `guardian_shield_${effect.id}`,
        owner: effect.source?.owner ?? null,
        center,
        radius: effect.zone?.radius ?? GUARDIAN_SHIELD_RANGE,
        sourceUnitId: effect.target?.unitId ?? null,
        sourceName: effect.name ?? "Guardian Shield"
      };
    })
    .filter(Boolean);
}

export function getGuardianShieldReduction(state, target, isMelee = false) {
  if (isMelee || !target || target.status.location !== "battlefield") return null;
  const targetPoint = getLeaderPoint(target);
  if (!targetPoint) return null;
  const activeZone = getGuardianShieldZones(state, target.owner).find(zone =>
    getDistance(zone.center, targetPoint) <= (zone.radius ?? GUARDIAN_SHIELD_RANGE) + 1e-6
  );
  if (!activeZone) return null;
  return {
    reducedBy: 1,
    sourceUnitId: activeZone.sourceUnitId,
    sourceName: state.units?.[activeZone.sourceUnitId]?.name ?? activeZone.sourceName ?? "Guardian Shield"
  };
}

function removeUnitFromBattlefield(state, unit) {
  const player = state.players[unit.owner];
  player.battlefieldUnitIds = player.battlefieldUnitIds.filter(id => id !== unit.id);
  unit.status.location = "destroyed";
  unit.currentSupplyValue = 0;
  for (const model of Object.values(unit.models ?? {})) {
    model.alive = false;
    model.woundsRemaining = 0;
    model.x = null;
    model.y = null;
  }
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

export function validateActivateGuardianShield(state, playerId, unitId) {
  const shared = canUseSupportAction(state, playerId, unitId);
  if (!shared.ok) return shared;
  const unit = shared.unit;
  if (!unit.abilities?.includes("guardian_shield")) {
    return { ok: false, code: "NO_ABILITY", message: "This unit does not have Guardian Shield." };
  }
  const activeShield = (state.effects ?? []).some(effect =>
    effect?.zone?.kind === "guardian_shield_field"
      && effect?.target?.scope === "unit"
      && effect?.target?.unitId === unitId
      && effect?.duration?.type === "rounds"
      && effect.duration.remaining > 0
  );
  if (activeShield) {
    return { ok: false, code: "ALREADY_ACTIVE", message: "Guardian Shield is already active on this unit." };
  }
  return { ok: true, unit };
}

export function validateActivateStimpack(state, playerId, unitId) {
  const shared = canUseSupportAction(state, playerId, unitId);
  if (!shared.ok) return shared;
  const unit = shared.unit;
  if (!unit.abilities?.includes("stimpack_drill")) {
    return { ok: false, code: "NO_ABILITY", message: "This unit does not have Stimpack." };
  }
  const profile = getStimpackProfile(unit);
  const alreadyActive = (state.effects ?? []).some(effect =>
    effect?.name === "Stimpack"
      && effect?.target?.scope === "unit"
      && effect?.target?.unitId === unitId
      && effect?.duration?.type === "rounds"
      && effect.duration.remaining > 0
  );
  if (alreadyActive) {
    return { ok: false, code: "ALREADY_ACTIVE", message: "Stimpack is already active on this unit." };
  }
  return { ok: true, unit, derived: profile };
}

export function resolveActivateStimpack(state, playerId, unitId) {
  const validation = validateActivateStimpack(state, playerId, unitId);
  if (!validation.ok) return validation;

  const { unit } = validation;
  const profile = validation.derived;
  const appliedNonLethalDamage = applyNonLethalDamage(unit, profile.nonLethalDamage);
  addEffect(state, {
    name: "Stimpack",
    source: { kind: "unit", id: unitId, owner: playerId },
    target: { scope: "unit", unitId },
    duration: { type: "rounds", remaining: 1 },
    modifiers: [{
      key: "unit.speed",
      operation: "add",
      value: profile.speedBonus
    }]
  });
  markUnitActivatedForCurrentPhase(state, unitId);
  appendLog(
    state,
    "action",
    `${unit.name} uses Stimpack: non-lethal damage ${profile.nonLethalDamage} (${appliedNonLethalDamage} applied), Speed +${profile.speedBonus}, Precision +${profile.precisionBonus} on ranged and melee weapons this round.`
  );
  endActivationAndPassTurn(state);
  return {
    ok: true,
    state,
    events: [{
      type: "stimpack_activated",
      payload: {
        unitId,
        nonLethalDamage: profile.nonLethalDamage,
        appliedNonLethalDamage,
        speedBonus: profile.speedBonus,
        precisionBonus: profile.precisionBonus
      }
    }]
  };
}

export function resolveActivateGuardianShield(state, playerId, unitId) {
  const validation = validateActivateGuardianShield(state, playerId, unitId);
  if (!validation.ok) return validation;

  const { unit } = validation;
  addEffect(state, {
    name: "Guardian Shield",
    source: { kind: "unit", id: unitId, owner: playerId },
    target: { scope: "unit", unitId },
    zone: { kind: "guardian_shield_field", radius: GUARDIAN_SHIELD_RANGE },
    duration: { type: "rounds", remaining: 1 }
  });
  markUnitActivatedForCurrentPhase(state, unitId);
  appendLog(
    state,
    "action",
    `${unit.name} activates Guardian Shield: ranged attacks targeting friendly units within ${GUARDIAN_SHIELD_RANGE}" lose 1 die from the attack pool this round.`
  );
  endActivationAndPassTurn(state);
  return {
    ok: true,
    state,
    events: [{
      type: "guardian_shield_activated",
      payload: { unitId, radius: GUARDIAN_SHIELD_RANGE }
    }]
  };
}

export function resolvePointDefenseLaser(state, attacker, target, weapon, isMelee, attempts) {
  if (isMelee || attempts <= 0 || !attacker || !target) return null;
  if (weapon?.instant || weapon?.keywords?.includes("instant")) return null;
  const targetPoint = getLeaderPoint(target);
  if (!targetPoint) return null;

  const drone = Object.values(state.units).find(unit => {
    if (unit.owner !== target.owner || unit.id === target.id) return false;
    if (unit.status.location !== "battlefield") return false;
    if (!unit.abilities?.includes("point_defense_laser")) return false;
    const unitPoint = getLeaderPoint(unit);
    return unitPoint && getDistance(unitPoint, targetPoint) <= POINT_DEFENSE_LASER_RANGE + 1e-6;
  });
  if (!drone) return null;

  const reducedBy = Math.min(2, attempts);
  removeUnitFromBattlefield(state, drone);
  refreshAllSupply(state);
  appendLog(
    state,
    "combat",
    `${drone.name} uses Point Defense Laser to protect ${target.name}, removing ${reducedBy} die from the attack pool before being removed from the battlefield.`
  );
  return {
    reducedBy,
    sourceUnitId: drone.id,
    sourceName: drone.name
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

export function resolveTransfusion(state, target, totalDamage) {
  if (totalDamage <= 0 || !target || !isBiological(target) || target.status.location !== "battlefield") return null;

  const targetModels = getAliveModels(target);
  if (!targetModels.length) return null;

  const nearbyQueens = Object.values(state.units).filter(unit =>
    unit.owner === target.owner &&
    unit.id !== target.id &&
    unit.status.location === "battlefield" &&
    unit.abilities?.includes("transfusion")
  ).map(unit => {
    const supportModels = getAliveModels(unit);
    const inRange = supportModels.some(sourceModel =>
      targetModels.some(targetModel => getDistance(sourceModel, targetModel) <= MEDPACK_RANGE + 1e-6)
    );
    return inRange ? unit : null;
  }).filter(Boolean);

  const source = nearbyQueens[0];
  if (!source) return null;

  const reducedBy = Math.min(2, totalDamage);
  appendLog(
    state,
    "combat",
    `${source.name} uses Transfusion on ${target.name}, reducing incoming damage by ${reducedBy}.`
  );
  return {
    reducedBy,
    sourceUnitId: source.id,
    sourceName: source.name
  };
}
