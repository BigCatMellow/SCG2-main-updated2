import { appendLog } from "./state.js";
import { markUnitActivatedForCurrentPhase, markUnitActivatedForMovement, endActivationAndPassTurn, isUnitEligibleForCurrentPhaseActivation } from "./activation.js";
import { pointInBoard, pathLength, pathBlockedForCircle, pathTravelCost, gridDistance, circleOverlapsTerrain, circleOverlapsCircle, distance } from "./geometry.js";
import { autoArrangeModels, applyModelPlacementsAndResolveCoherency } from "./coherency.js";
import { refreshAllSupply } from "./supply.js";
import { getModifiedValue } from "./effects.js";
import { applyBurrowedActivationEffects, removeStealthStatuses } from "./statuses.js";
import { getBlockingForceFieldCrossings, removeForceFieldsCrossedByUnit } from "./force_fields.js";
import { creepNegatesDifficultTerrain, getCreepMovementBonus, removeDisplacedCreepTumors } from "./creep.js";

const ENGAGEMENT_RANGE = 1;
const BLINK_RANGE = 6;
const PSIONIC_TRANSFER_RANGE = 6;

function getMovementBonus(unit) {
  let bonus = 0;
  if (unit?.abilities?.includes("leg_enhancements")) bonus += 2;
  return bonus;
}

function isFlyingUnit(unit) {
  return unit?.tags?.includes("Flying") || unit?.abilities?.includes("flying");
}

function getEnemyId(playerId) {
  return playerId === "playerA" ? "playerB" : "playerA";
}

function getModel(unit, modelId) {
  if (!unit.models[modelId]) throw new Error(`Unknown model ${modelId} in unit ${unit.id}`);
  return unit.models[modelId];
}

function updateUnitEngagementStatus(state) {
  for (const unit of Object.values(state.units)) {
    unit.status.engaged = false;
  }

  const battlefieldUnits = Object.values(state.units).filter(unit =>
    unit.status.location === "battlefield" && unit.tags.includes("Ground") && !isFlyingUnit(unit)
  );
  for (let i = 0; i < battlefieldUnits.length; i += 1) {
    for (let j = i + 1; j < battlefieldUnits.length; j += 1) {
      const a = battlefieldUnits[i];
      const b = battlefieldUnits[j];
      if (a.owner === b.owner) continue;
      let engaged = false;
      for (const aModel of Object.values(a.models)) {
        if (!aModel.alive || aModel.x == null || aModel.y == null) continue;
        for (const bModel of Object.values(b.models)) {
          if (!bModel.alive || bModel.x == null || bModel.y == null) continue;
          const edgeDistance = distance(aModel, bModel) - a.base.radiusInches - b.base.radiusInches;
          if (edgeDistance <= ENGAGEMENT_RANGE + 1e-6) {
            engaged = true;
            break;
          }
        }
        if (engaged) break;
      }
      if (engaged) {
        a.status.engaged = true;
        b.status.engaged = true;
      }
    }
  }
}

function validateShared(state, playerId, unitId) {
  const unit = state.units[unitId];
  if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
  if (!isUnitEligibleForCurrentPhaseActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
  if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
  return { ok: true, unit };
}

function overlappingModelsAtPoint(state, unit, point, ignoreModelIds = new Set()) {
  for (const otherUnit of Object.values(state.units)) {
    if (otherUnit.status?.burrowed) continue;
    for (const otherModel of Object.values(otherUnit.models)) {
      if (!otherModel.alive || otherModel.x == null || otherModel.y == null || ignoreModelIds.has(otherModel.id)) continue;
      if (circleOverlapsCircle(point, unit.base.radiusInches, { x: otherModel.x, y: otherModel.y }, otherUnit.base.radiusInches)) return otherModel.id;
    }
  }
  return null;
}

function pointWithinEnemyGroundEngagement(state, unit, point) {
  if (isFlyingUnit(unit)) return false;
  for (const otherUnit of Object.values(state.units)) {
    if (otherUnit.owner === unit.owner || !otherUnit.tags.includes("Ground")) continue;
    if (isFlyingUnit(otherUnit)) continue;
    for (const otherModel of Object.values(otherUnit.models)) {
      if (!otherModel.alive || otherModel.x == null || otherModel.y == null) continue;
      const edgeDistance = distance(point, otherModel) - unit.base.radiusInches - otherUnit.base.radiusInches;
      if (edgeDistance < ENGAGEMENT_RANGE - 1e-6) return true;
    }
  }
  return false;
}

function getEngagedEnemyUnits(state, unit) {
  if (isFlyingUnit(unit)) return [];
  const enemies = new Set();
  for (const otherUnit of Object.values(state.units)) {
    if (otherUnit.owner === unit.owner) continue;
    if (isFlyingUnit(otherUnit)) continue;
    let engaged = false;
    for (const model of Object.values(unit.models)) {
      if (!model.alive || model.x == null || model.y == null) continue;
      for (const otherModel of Object.values(otherUnit.models)) {
        if (!otherModel.alive || otherModel.x == null || otherModel.y == null) continue;
        const edgeDistance = distance(model, otherModel) - unit.base.radiusInches - otherUnit.base.radiusInches;
        if (edgeDistance <= ENGAGEMENT_RANGE + 1e-6) {
          engaged = true;
          break;
        }
      }
      if (engaged) break;
    }
    if (engaged) enemies.add(otherUnit.id);
  }
  return [...enemies].map(id => state.units[id]);
}

function finalPointFromPath(path) {
  return path[path.length - 1];
}

function getMovementCost(state, unit, path) {
  if (isFlyingUnit(unit)) {
    return state.rules?.gridMode ? gridDistance(path[0], path[path.length - 1]) : pathLength(path);
  }
  if (creepNegatesDifficultTerrain(state, unit, path)) {
    return state.rules?.gridMode ? gridDistance(path[0], path[path.length - 1]) : pathLength(path);
  }
  if (state.rules?.gridMode) return gridDistance(path[0], path[path.length - 1]);
  return pathTravelCost(path, state.board.terrain);
}

export function validateHold(state, playerId, unitId) {
  const shared = validateShared(state, playerId, unitId);
  if (!shared.ok) return shared;
  if (shared.unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Only battlefield units can Hold." };
  return { ok: true };
}

export function resolveHold(state, playerId, unitId) {
  const validation = validateHold(state, playerId, unitId);
  if (!validation.ok) return validation;
  const unit = state.units[unitId];
  applyBurrowedActivationEffects(state, unit);
  unit.status.stationary = true;
  markUnitActivatedForCurrentPhase(state, unitId);
  appendLog(state, "action", `${unit.name} holds position.${unit.status.burrowed ? " Burrowed maintained." : unit.status.hidden ? " Hidden maintained." : ""}`);
  endActivationAndPassTurn(state);
  return { ok: true, state, events: [{ type: "unit_held", payload: { unitId } }] };
}

export function validateMove(state, playerId, unitId, leadingModelId, path, modelPlacements = null) {
  const shared = validateShared(state, playerId, unitId);
  if (!shared.ok) return shared;
  const unit = shared.unit;
  if (state.phase !== "movement") return { ok: false, code: "WRONG_PHASE", message: "Move is only available in the Movement Phase." };
  if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Unit is not on the battlefield." };
  if (unit.status.engaged) return { ok: false, code: "UNIT_ENGAGED", message: "Engaged units cannot make a normal Move." };
  if (!path || path.length < 2) return { ok: false, code: "NO_PATH", message: "Move requires a path." };
  const leader = getModel(unit, leadingModelId);
  if (leader.x == null || leader.y == null) return { ok: false, code: "INVALID_LEADER", message: "Leading model must be on the battlefield." };
  const start = path[0];
  if (Math.abs(start.x - leader.x) > 0.01 || Math.abs(start.y - leader.y) > 0.01) return { ok: false, code: "BAD_PATH_START", message: "Path must begin at the leader's current position." };
  const modifiedSpeed = getModifiedValue(state, {
    timing: "movement_move",
    unitId: unit.id,
    key: "unit.speed",
    baseValue: unit.speed
  }).value + getMovementBonus(unit) + getCreepMovementBonus(state, unit, path);
  const travelCost = getMovementCost(state, unit, path);
  if (travelCost - modifiedSpeed > 1e-6) return { ok: false, code: "TOO_FAR", message: `${unit.name} can only move ${modifiedSpeed}" (difficult terrain costs extra movement).` };
  const ignore = new Set(unit.modelIds);
  if (!isFlyingUnit(unit) && pathBlockedForCircle(path, unit.base.radiusInches, state, ignore)) return { ok: false, code: "PATH_BLOCKED", message: "Path crosses blocked ground, terrain, or bases." };
  if (getBlockingForceFieldCrossings(state, unit, path).length) return { ok: false, code: "FORCE_FIELD_BLOCKED", message: "A Force Field blocks units of Size 2 or lower from crossing there." };
  const end = finalPointFromPath(path);
  if (!pointInBoard(end, state.board, unit.base.radiusInches)) return { ok: false, code: "OFF_BOARD", message: "Leading model must end fully on the battlefield." };
  if (!isFlyingUnit(unit) && circleOverlapsTerrain(end, unit.base.radiusInches, state.board.terrain)) return { ok: false, code: "TERRAIN_OVERLAP", message: "Leading model cannot end overlapping impassable terrain." };
  if (overlappingModelsAtPoint(state, unit, end, ignore)) return { ok: false, code: "BASE_OVERLAP", message: "Leading model would overlap another base." };
  if (pointWithinEnemyGroundEngagement(state, unit, end)) return { ok: false, code: "ENDS_ENGAGED", message: "Normal Move cannot end within 1\" of an enemy ground unit." };
  const placements = modelPlacements ?? autoArrangeModels(state, unitId, end);
  return { ok: true, derived: { placements, end } };
}

export function resolveMove(state, playerId, unitId, leadingModelId, path, modelPlacements = null) {
  const validation = validateMove(state, playerId, unitId, leadingModelId, path, modelPlacements);
  if (!validation.ok) return validation;
  const unit = state.units[unitId];
  applyBurrowedActivationEffects(state, unit);
  unit.leadingModelId = leadingModelId;
  const leader = unit.models[leadingModelId];
  leader.x = validation.derived.end.x;
  leader.y = validation.derived.end.y;
  const coherency = applyModelPlacementsAndResolveCoherency(state, unitId, validation.derived.placements);
  const brokeStealth = removeStealthStatuses(unit);
  unit.status.stationary = false;
  markUnitActivatedForMovement(state, unitId);
  removeForceFieldsCrossedByUnit(state, unit, path);
  updateUnitEngagementStatus(state);
  refreshAllSupply(state);
  const displacedCreep = removeDisplacedCreepTumors(state, unit, "moves");
  const removedText = coherency.removedModelIds.length ? ` ${coherency.removedModelIds.length} model(s) removed during placement.` : "";
  const coherencyText = coherency.outOfCoherency ? " Out of coherency." : "";
  appendLog(state, "action", `${unit.name} moves ${pathLength(path).toFixed(1)}".${brokeStealth ? " Hidden/Burrowed removed." : ""}${removedText}${coherencyText}`);
  endActivationAndPassTurn(state);
  return {
    ok: true,
    state,
    events: [
      { type: "unit_moved", payload: { unitId } },
      ...displacedCreep.map(zone => ({ type: "creep_displaced", payload: { unitId, creepId: zone.id } }))
    ]
  };
}

function validateTeleportReposition(state, playerId, unitId, point, modelPlacements, { range, abilityName, label }) {
  const shared = validateShared(state, playerId, unitId);
  if (!shared.ok) return shared;
  const unit = shared.unit;
  if (state.phase !== "movement") return { ok: false, code: "WRONG_PHASE", message: `${label} is only available in the Movement Phase.` };
  if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Unit is not on the battlefield." };
  if (!unit.abilities?.includes(abilityName)) return { ok: false, code: "NO_ABILITY", message: `${unit.name} cannot use ${label}.` };
  if (unit.status.burrowed) return { ok: false, code: "BURROWED", message: `Burrowed units cannot use ${label}.` };
  const leader = getModel(unit, unit.leadingModelId);
  if (leader.x == null || leader.y == null) return { ok: false, code: "INVALID_LEADER", message: "Leading model must be on the battlefield." };
  if (distance(leader, point) > range + 1e-6) return { ok: false, code: "OUT_OF_RANGE", message: `${label} must end within ${range}".` };
  if (!pointInBoard(point, state.board, unit.base.radiusInches)) return { ok: false, code: "OFF_BOARD", message: "Leading model must end fully on the battlefield." };
  if (!isFlyingUnit(unit) && circleOverlapsTerrain(point, unit.base.radiusInches, state.board.terrain)) return { ok: false, code: "TERRAIN_OVERLAP", message: "Destination overlaps impassable terrain." };
  if (overlappingModelsAtPoint(state, unit, point, new Set(unit.modelIds))) return { ok: false, code: "BASE_OVERLAP", message: "Destination overlaps another base." };
  if (pointWithinEnemyGroundEngagement(state, unit, point)) return { ok: false, code: "ENDS_ENGAGED", message: `${label} cannot end within 1" of an enemy ground unit.` };
  const placements = modelPlacements ?? autoArrangeModels(state, unitId, point);
  return { ok: true, derived: { end: point, placements } };
}

function resolveTeleportReposition(state, playerId, unitId, point, modelPlacements, { range, abilityName, label, eventType }) {
  const validation = validateTeleportReposition(state, playerId, unitId, point, modelPlacements, { range, abilityName, label });
  if (!validation.ok) return validation;
  const unit = state.units[unitId];
  applyBurrowedActivationEffects(state, unit);
  const leader = unit.models[unit.leadingModelId];
  const start = { x: leader.x, y: leader.y };
  leader.x = validation.derived.end.x;
  leader.y = validation.derived.end.y;
  const coherency = applyModelPlacementsAndResolveCoherency(state, unitId, validation.derived.placements);
  const brokeStealth = removeStealthStatuses(unit);
  unit.status.stationary = false;
  markUnitActivatedForMovement(state, unitId);
  refreshEngagement(state);
  refreshAllSupply(state);
  const displacedCreep = removeDisplacedCreepTumors(state, unit, `${label.toLowerCase()}s`);
  appendLog(state, "action", `${unit.name} uses ${label} to reposition ${distance(start, validation.derived.end).toFixed(1)}".${brokeStealth ? " Hidden/Burrowed removed." : ""}${coherency.outOfCoherency ? " Out of coherency." : ""}`);
  endActivationAndPassTurn(state);
  return {
    ok: true,
    state,
    events: [
      { type: eventType, payload: { unitId, point: validation.derived.end } },
      ...displacedCreep.map(zone => ({ type: "creep_displaced", payload: { unitId, creepId: zone.id } }))
    ]
  };
}

export function validateBlink(state, playerId, unitId, point, modelPlacements = null) {
  return validateTeleportReposition(state, playerId, unitId, point, modelPlacements, {
    range: BLINK_RANGE,
    abilityName: "blink",
    label: "Blink"
  });
}

export function resolveBlink(state, playerId, unitId, point, modelPlacements = null) {
  return resolveTeleportReposition(state, playerId, unitId, point, modelPlacements, {
    range: BLINK_RANGE,
    abilityName: "blink",
    label: "Blink",
    eventType: "unit_blinked"
  });
}

export function validatePsionicTransfer(state, playerId, unitId, point, modelPlacements = null) {
  return validateTeleportReposition(state, playerId, unitId, point, modelPlacements, {
    range: PSIONIC_TRANSFER_RANGE,
    abilityName: "psionic_transfer",
    label: "Psionic Transfer"
  });
}

export function resolvePsionicTransfer(state, playerId, unitId, point, modelPlacements = null) {
  return resolveTeleportReposition(state, playerId, unitId, point, modelPlacements, {
    range: PSIONIC_TRANSFER_RANGE,
    abilityName: "psionic_transfer",
    label: "Psionic Transfer",
    eventType: "unit_psionic_transfer"
  });
}

export function validateDisengage(state, playerId, unitId, leadingModelId, path, modelPlacements = null) {
  const shared = validateShared(state, playerId, unitId);
  if (!shared.ok) return shared;
  const unit = shared.unit;
  if (state.phase !== "movement") return { ok: false, code: "WRONG_PHASE", message: "Disengage is only available in the Movement Phase." };
  if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Unit is not on the battlefield." };
  if (!unit.status.engaged) return { ok: false, code: "NOT_ENGAGED", message: "Only engaged units can Disengage." };
  if (!path || path.length < 2) return { ok: false, code: "NO_PATH", message: "Disengage requires a path." };
  const leader = getModel(unit, leadingModelId);
  if (leader.x == null || leader.y == null) return { ok: false, code: "INVALID_LEADER", message: "Leading model must be on the battlefield." };
  const modifiedSpeed = getModifiedValue(state, {
    timing: "movement_disengage",
    unitId: unit.id,
    key: "unit.speed",
    baseValue: unit.speed
  }).value + getMovementBonus(unit) + getCreepMovementBonus(state, unit, path);
  const travelCost = getMovementCost(state, unit, path);
  if (travelCost - modifiedSpeed > 1e-6) return { ok: false, code: "TOO_FAR", message: `${unit.name} can only move ${modifiedSpeed}" (difficult terrain costs extra movement).` };
  const ignore = new Set(unit.modelIds);
  if (!isFlyingUnit(unit) && pathBlockedForCircle(path, unit.base.radiusInches, state, ignore)) return { ok: false, code: "PATH_BLOCKED", message: "Path crosses blocked ground, terrain, or bases." };
  if (getBlockingForceFieldCrossings(state, unit, path).length) return { ok: false, code: "FORCE_FIELD_BLOCKED", message: "A Force Field blocks units of Size 2 or lower from crossing there." };
  const end = finalPointFromPath(path);
  if (!pointInBoard(end, state.board, unit.base.radiusInches)) return { ok: false, code: "OFF_BOARD", message: "Leading model must end fully on the battlefield." };
  const placements = modelPlacements ?? autoArrangeModels(state, unitId, end);
  const engagedEnemies = getEngagedEnemyUnits(state, unit);
  const enemySupplyTotal = engagedEnemies.reduce((total, enemy) => total + enemy.currentSupplyValue, 0);
  const tacticalMass = unit.currentSupplyValue > enemySupplyTotal;
  return { ok: true, derived: { end, placements, tacticalMass, engagedEnemies } };
}

export function resolveDisengage(state, playerId, unitId, leadingModelId, path, modelPlacements = null) {
  const validation = validateDisengage(state, playerId, unitId, leadingModelId, path, modelPlacements);
  if (!validation.ok) return validation;
  const unit = state.units[unitId];
  applyBurrowedActivationEffects(state, unit);
  unit.leadingModelId = leadingModelId;
  const leader = unit.models[leadingModelId];
  leader.x = validation.derived.end.x;
  leader.y = validation.derived.end.y;
  const coherency = applyModelPlacementsAndResolveCoherency(state, unitId, validation.derived.placements);
  const brokeStealth = removeStealthStatuses(unit);
  updateUnitEngagementStatus(state);
  const stillEngaged = pointWithinEnemyGroundEngagement(state, unit, { x: leader.x, y: leader.y });
  if (stillEngaged) {
    leader.alive = false;
    leader.x = null;
    leader.y = null;
    appendLog(state, "action", `${unit.name} fails to break clear; the leading model is removed during Disengage.`);
  }

  for (const modelId of unit.modelIds) {
    if (modelId === leadingModelId) continue;
    const model = unit.models[modelId];
    if (!model.alive || model.x == null || model.y == null) continue;
    if (pointWithinEnemyGroundEngagement(state, unit, { x: model.x, y: model.y })) {
      model.alive = false;
      model.x = null;
      model.y = null;
      appendLog(state, "info", `${unit.name} loses a model that could not clear engagement.`);
    }
  }

  if (!validation.derived.tacticalMass) {
    unit.status.cannotRangedAttackNextAssault = true;
    unit.status.cannotChargeNextAssault = true;
  } else {
    unit.status.cannotRangedAttackNextAssault = false;
    unit.status.cannotChargeNextAssault = false;
  }

  unit.status.stationary = false;
  markUnitActivatedForMovement(state, unitId);
  removeForceFieldsCrossedByUnit(state, unit, path);
  updateUnitEngagementStatus(state);
  refreshAllSupply(state);
  const displacedCreep = removeDisplacedCreepTumors(state, unit, "disengages");
  appendLog(state, "action", `${unit.name} disengages.${brokeStealth ? " Hidden/Burrowed removed." : ""}${validation.derived.tacticalMass ? " Tactical Mass ignores the next-Assault penalty." : " Cannot Ranged Attack or Charge next Assault."}${coherency.outOfCoherency ? " Out of coherency." : ""}`);
  endActivationAndPassTurn(state);
  return {
    ok: true,
    state,
    events: [
      { type: "unit_disengaged", payload: { unitId } },
      ...displacedCreep.map(zone => ({ type: "creep_displaced", payload: { unitId, creepId: zone.id } }))
    ]
  };
}

export function refreshEngagement(state) {
  updateUnitEngagementStatus(state);
}
