import { appendLog } from "./state.js";
import { endActivationAndPassTurn, isUnitEligibleForCurrentPhaseActivation, markUnitActivatedForCurrentPhase } from "./activation.js";
import { pathLength, pathTravelCost, gridDistance, pathBlockedForCircle, pointInBoard, circleOverlapsTerrain, circleOverlapsCircle, distance } from "./geometry.js";
import { autoArrangeModels, applyModelPlacementsAndResolveCoherency } from "./coherency.js";
import { refreshAllSupply } from "./supply.js";
import { getModifiedValue } from "./effects.js";
import { refreshEngagement } from "./movement.js";

const RUN_BONUS = 2;
const CHARGE_DECLARE_RANGE = 8;

function getOpponent(playerId) {
  return playerId === "playerA" ? "playerB" : "playerA";
}

function findNearestEnemyUnitInRange(state, unit) {
  const primaryWeapon = unit.rangedWeapons?.[0] ?? null;
  if (!primaryWeapon) return null;
  const leader = unit.models[unit.leadingModelId];
  if (!leader || leader.x == null || leader.y == null) return null;
  const enemies = state.players[getOpponent(unit.owner)].battlefieldUnitIds
    .map(id => state.units[id])
    .filter(enemy => enemy.status.location === "battlefield")
    .map(enemy => {
      const enemyLeader = enemy.models[enemy.leadingModelId];
      if (!enemyLeader || enemyLeader.x == null || enemyLeader.y == null) return null;
      return { enemy, range: distance(leader, enemyLeader) };
    })
    .filter(Boolean)
    .filter(entry => entry.range <= primaryWeapon.rangeInches + 1e-6)
    .sort((a, b) => a.range - b.range);

  return enemies[0]?.enemy ?? null;
}

function findNearestEnemyUnitForCharge(state, unit) {
  const leader = unit.models[unit.leadingModelId];
  if (!leader || leader.x == null || leader.y == null) return null;
  const enemies = state.players[getOpponent(unit.owner)].battlefieldUnitIds
    .map(id => state.units[id])
    .filter(enemy => enemy.status.location === "battlefield")
    .map(enemy => {
      const enemyLeader = enemy.models[enemy.leadingModelId];
      if (!enemyLeader || enemyLeader.x == null || enemyLeader.y == null) return null;
      return { enemy, range: distance(leader, enemyLeader) };
    })
    .filter(Boolean)
    .filter(entry => entry.range <= CHARGE_DECLARE_RANGE + 1e-6)
    .sort((a, b) => a.range - b.range);

  return enemies[0]?.enemy ?? null;
}

function validateShared(state, playerId, unitId) {
  const unit = state.units[unitId];
  if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
  if (state.phase !== "assault") return { ok: false, code: "WRONG_PHASE", message: "Action is only available in the Assault Phase." };
  if (!isUnitEligibleForCurrentPhaseActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
  if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
  if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Only battlefield units can activate in Assault." };
  return { ok: true, unit };
}

function overlappingModelsAtPoint(state, unit, point, ignoreModelIds = new Set()) {
  for (const otherUnit of Object.values(state.units)) {
    for (const otherModel of Object.values(otherUnit.models)) {
      if (!otherModel.alive || otherModel.x == null || otherModel.y == null || ignoreModelIds.has(otherModel.id)) continue;
      if (circleOverlapsCircle(point, unit.base.radiusInches, { x: otherModel.x, y: otherModel.y }, otherUnit.base.radiusInches)) return otherModel.id;
    }
  }
  return null;
}

export function validateRun(state, playerId, unitId, leadingModelId, path, modelPlacements = null) {
  const shared = validateShared(state, playerId, unitId);
  if (!shared.ok) return shared;
  const unit = shared.unit;
  if (unit.status.engaged) return { ok: false, code: "UNIT_ENGAGED", message: "Engaged units cannot Run." };
  if (!path || path.length < 2) return { ok: false, code: "NO_PATH", message: "Run requires a path." };
  const leader = unit.models[leadingModelId];
  if (!leader || leader.x == null || leader.y == null) return { ok: false, code: "INVALID_LEADER", message: "Leading model must be on the battlefield." };
  const start = path[0];
  if (Math.abs(start.x - leader.x) > 0.01 || Math.abs(start.y - leader.y) > 0.01) return { ok: false, code: "BAD_PATH_START", message: "Path must begin at the leader's current position." };
  const maxDistance = unit.speed + RUN_BONUS;
  const travelCost = state.rules?.gridMode ? gridDistance(path[0], path[path.length - 1]) : pathTravelCost(path, state.board.terrain);
  if (travelCost - maxDistance > 1e-6) return { ok: false, code: "TOO_FAR", message: `${unit.name} can only Run ${maxDistance}" (difficult terrain costs extra movement).` };
  const ignore = new Set(unit.modelIds);
  if (pathBlockedForCircle(path, unit.base.radiusInches, state, ignore)) return { ok: false, code: "PATH_BLOCKED", message: "Path crosses blocked ground, terrain, or bases." };
  const end = path[path.length - 1];
  if (!pointInBoard(end, state.board, unit.base.radiusInches)) return { ok: false, code: "OFF_BOARD", message: "Leading model must end fully on the battlefield." };
  if (circleOverlapsTerrain(end, unit.base.radiusInches, state.board.terrain)) return { ok: false, code: "TERRAIN_OVERLAP", message: "Leading model cannot end overlapping impassable terrain." };
  if (overlappingModelsAtPoint(state, unit, end, ignore)) return { ok: false, code: "BASE_OVERLAP", message: "Leading model would overlap another base." };
  const placements = modelPlacements ?? autoArrangeModels(state, unitId, end);
  return { ok: true, derived: { end, placements, runDistance: pathLength(path), travelCost, maxDistance } };
}

export function resolveRun(state, playerId, unitId, leadingModelId, path, modelPlacements = null) {
  const validation = validateRun(state, playerId, unitId, leadingModelId, path, modelPlacements);
  if (!validation.ok) return validation;

  const unit = state.units[unitId];
  unit.leadingModelId = leadingModelId;
  const leader = unit.models[leadingModelId];
  leader.x = validation.derived.end.x;
  leader.y = validation.derived.end.y;
  const coherency = applyModelPlacementsAndResolveCoherency(state, unitId, validation.derived.placements);

  unit.status.stationary = false;
  unit.status.cannotRangedAttackNextAssault = true;
  markUnitActivatedForCurrentPhase(state, unitId);
  refreshEngagement(state);
  refreshAllSupply(state);

  appendLog(
    state,
    "action",
    `${unit.name} runs ${validation.derived.runDistance.toFixed(1)}" (movement cost ${validation.derived.travelCost.toFixed(1)} / max ${validation.derived.maxDistance}").${coherency.outOfCoherency ? " Unit is out of coherency." : ""}`
  );

  endActivationAndPassTurn(state);
  return { ok: true, state, events: [{ type: "unit_ran", payload: { unitId } }] };
}

function validateSpecifiedTarget(state, unit, targetUnitId) {
  const target = state.units[targetUnitId];
  if (!target) return { ok: false, code: "BAD_TARGET", message: "Target unit does not exist." };
  if (target.owner === unit.owner) return { ok: false, code: "BAD_TARGET", message: "Cannot target a friendly unit." };
  if (target.status.location !== "battlefield") return { ok: false, code: "BAD_TARGET", message: "Target must be on the battlefield." };
  const targetLeader = target.models[target.leadingModelId];
  const leader = unit.models[unit.leadingModelId];
  const primaryWeapon = unit.rangedWeapons?.[0] ?? null;
  if (!primaryWeapon) return { ok: false, code: "NO_RANGED_PROFILE", message: "Unit has no ranged attack profile." };
  if (!targetLeader || targetLeader.x == null || targetLeader.y == null || !leader || leader.x == null || leader.y == null) {
    return { ok: false, code: "BAD_TARGET", message: "Target or attacker does not have a valid leader position." };
  }
  if (distance(leader, targetLeader) > primaryWeapon.rangeInches + 1e-6) {
    return { ok: false, code: "BAD_TARGET", message: "Selected target is out of range." };
  }
  return { ok: true, target };
}

function validateSpecifiedChargeTarget(state, unit, targetUnitId) {
  const target = state.units[targetUnitId];
  if (!target) return { ok: false, code: "BAD_TARGET", message: "Target unit does not exist." };
  if (target.owner === unit.owner) return { ok: false, code: "BAD_TARGET", message: "Cannot target a friendly unit." };
  if (target.status.location !== "battlefield") return { ok: false, code: "BAD_TARGET", message: "Target must be on the battlefield." };
  const targetLeader = target.models[target.leadingModelId];
  const leader = unit.models[unit.leadingModelId];
  if (!targetLeader || targetLeader.x == null || targetLeader.y == null || !leader || leader.x == null || leader.y == null) {
    return { ok: false, code: "BAD_TARGET", message: "Target or attacker does not have a valid leader position." };
  }
  if (distance(leader, targetLeader) > CHARGE_DECLARE_RANGE + 1e-6) {
    return { ok: false, code: "BAD_TARGET", message: `Selected target is outside ${CHARGE_DECLARE_RANGE}" charge declaration range.` };
  }
  return { ok: true, target };
}

export function validateDeclareRangedAttack(state, playerId, unitId, targetUnitId = null) {
  const shared = validateShared(state, playerId, unitId);
  if (!shared.ok) return shared;
  const unit = shared.unit;
  if (!unit.rangedWeapons?.length) return { ok: false, code: "NO_RANGED_PROFILE", message: "Unit has no ranged attack profile." };
  const rangedPermission = getModifiedValue(state, {
    timing: "assault_declare_ranged",
    unitId: unit.id,
    key: "assault.canDeclareRanged",
    baseValue: !unit.status.cannotRangedAttackThisAssault
  });
  if (!rangedPermission.value) return { ok: false, code: "RANGED_BLOCKED", message: "This unit cannot declare ranged attacks this Assault Phase." };

  if (targetUnitId) {
    const specified = validateSpecifiedTarget(state, unit, targetUnitId);
    if (!specified.ok) return specified;
    return { ok: true, derived: { targetId: targetUnitId } };
  }

  const target = findNearestEnemyUnitInRange(state, unit);
  if (!target) return { ok: false, code: "NO_TARGET", message: "No enemy unit in range to declare a ranged attack." };
  return { ok: true, derived: { targetId: target.id } };
}

export function resolveDeclareRangedAttack(state, playerId, unitId, targetUnitId = null) {
  const validation = validateDeclareRangedAttack(state, playerId, unitId, targetUnitId);
  if (!validation.ok) return validation;

  const unit = state.units[unitId];
  const weaponId = unit.rangedWeapons?.[0]?.id ?? null;
  state.combatQueue.push({ type: "ranged_attack", attackerId: unitId, targetId: validation.derived.targetId, weaponId });
  markUnitActivatedForCurrentPhase(state, unitId);

  appendLog(state, "action", `${unit.name} declares ranged attack on ${state.units[validation.derived.targetId].name} for Combat.`);

  endActivationAndPassTurn(state);
  return { ok: true, state, events: [{ type: "ranged_attack_declared", payload: { attackerId: unitId, targetId: validation.derived.targetId } }] };
}

export function validateDeclareCharge(state, playerId, unitId, targetUnitId = null) {
  const shared = validateShared(state, playerId, unitId);
  if (!shared.ok) return shared;
  const unit = shared.unit;
  if (!unit.meleeWeapons?.length) return { ok: false, code: "NO_MELEE_PROFILE", message: "Unit has no melee profile." };
  if (unit.status.cannotChargeThisAssault) {
    return { ok: false, code: "CHARGE_BLOCKED", message: "This unit cannot declare charge this Assault Phase." };
  }

  if (targetUnitId) {
    const specified = validateSpecifiedChargeTarget(state, unit, targetUnitId);
    if (!specified.ok) return specified;
    return { ok: true, derived: { targetId: targetUnitId } };
  }

  const target = findNearestEnemyUnitForCharge(state, unit);
  if (!target) return { ok: false, code: "NO_TARGET", message: `No enemy unit within ${CHARGE_DECLARE_RANGE}" to declare a charge.` };
  return { ok: true, derived: { targetId: target.id } };
}

export function resolveDeclareCharge(state, playerId, unitId, targetUnitId = null) {
  const validation = validateDeclareCharge(state, playerId, unitId, targetUnitId);
  if (!validation.ok) return validation;

  const unit = state.units[unitId];
  const targetUnit = state.units[validation.derived.targetId];
  const weaponId = unit.meleeWeapons?.[0]?.id ?? null;
  const overwatchWeaponId = targetUnit.rangedWeapons?.[0]?.id ?? null;

  if (overwatchWeaponId && !targetUnit.status.overwatchUsedThisRound) {
    state.combatQueue.push({ type: "overwatch_attack", attackerId: targetUnit.id, targetId: unitId, weaponId: overwatchWeaponId });
    targetUnit.status.overwatchUsedThisRound = true;
    appendLog(state, "action", `${targetUnit.name} sets Overwatch response against ${unit.name}.`);
  }

  state.combatQueue.push({ type: "charge_attack", attackerId: unitId, targetId: validation.derived.targetId, weaponId });
  markUnitActivatedForCurrentPhase(state, unitId);

  appendLog(state, "action", `${unit.name} declares charge on ${targetUnit.name} for Combat.`);

  endActivationAndPassTurn(state);
  return { ok: true, state, events: [{ type: "charge_declared", payload: { attackerId: unitId, targetId: validation.derived.targetId } }] };
}
