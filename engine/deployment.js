import { appendLog } from "./state.js";
import { markUnitActivatedForMovement, endActivationAndPassTurn, isUnitEligibleForMovementActivation } from "./activation.js";
import { moveUnitToBattlefield } from "./reserves.js";
import { pointOnEntryEdge, pointInsideEnemyZoneOfInfluence, pathTravelCost, gridDistance, pathBlockedForCircle, pointInBoard, circleOverlapsTerrain, circleOverlapsCircle, distance } from "./geometry.js";
import { autoArrangeModels, applyModelPlacementsAndResolveCoherency } from "./coherency.js";
import { refreshAllSupply, validateDeploySupply } from "./supply.js";
import { refreshEngagement } from "./movement.js";
import { getBlockingForceFieldCrossings, removeForceFieldsCrossedByUnit } from "./force_fields.js";
import { getCreepMovementBonus, creepNegatesDifficultTerrain, unitBenefitsFromCreep, removeDisplacedCreepTumors } from "./creep.js";
import { canWarpDeployUnit, pointInsideFriendlyPowerField, hasFriendlyPowerField } from "./warp_fields.js";

function getLeaderPoint(unit) {
  const leader = unit?.models?.[unit?.leadingModelId];
  if (!leader || !leader.alive || leader.x == null || leader.y == null) return null;
  return { x: leader.x, y: leader.y };
}

function getEffectZoneCenter(state, effect) {
  if (effect?.target?.scope === "unit") return getLeaderPoint(state.units?.[effect.target.unitId]);
  return effect?.zone?.center ?? null;
}

function isTerranReserveUnit(unit) {
  return /(marine|marauder|medic|goliath|raynor|point_defense_drone)/i.test(String(unit?.templateId ?? ""));
}

function isZergReserveUnit(unit) {
  return /(zerg|roach|hydralisk|queen|kerrigan|raptor|omega_worm|roachling)/i.test(String(unit?.templateId ?? ""));
}

function canDeployFromCardZone(unit, zone) {
  if (!unit || unit.status?.location !== "reserves" || unit.tags?.includes("Structure")) return false;
  if (zone.kind === "proxy_field") return isTerranReserveUnit(unit) && unit.tags?.includes("Infantry");
  if (zone.kind === "hatchery_field") return isZergReserveUnit(unit);
  return false;
}

export function getCardDeploymentZones(state, playerId, unit = null) {
  return (state.effects ?? [])
    .filter(effect => effect?.source?.owner === playerId && ["proxy_field", "hatchery_field"].includes(effect?.zone?.kind))
    .map(effect => {
      const center = getEffectZoneCenter(state, effect);
      if (!center) return null;
      return {
        id: `${effect.zone.kind}_${effect.id}`,
        owner: playerId,
        kind: effect.zone.kind,
        radius: effect.zone.radius ?? 6,
        center,
        effectId: effect.id,
        sourceUnitId: effect.target?.unitId ?? null,
        sourceKind: effect.name ?? effect.zone.kind
      };
    })
    .filter(zone => zone && (!unit || canDeployFromCardZone(unit, zone)));
}

function validateShared(state, playerId, unitId) {
  const unit = state.units[unitId];
  if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
  if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
  if (!isUnitEligibleForMovementActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
  if (unit.status.location !== "reserves") return { ok: false, code: "NOT_IN_RESERVES", message: "Only reserve units can Deploy." };
  return { ok: true, unit };
}

function overlapsAnyModel(state, unit, point, ignoreIds = new Set()) {
  for (const otherUnit of Object.values(state.units)) {
    for (const model of Object.values(otherUnit.models)) {
      if (!model.alive || model.x == null || model.y == null || ignoreIds.has(model.id)) continue;
      if (circleOverlapsCircle(point, unit.base.radiusInches, { x: model.x, y: model.y }, otherUnit.base.radiusInches)) return true;
    }
  }
  return false;
}

export function getLegalEntryEdgeSegments(state, playerId) {
  const side = state.deployment.entryEdges[playerId]?.side;
  const maxX = state.board.widthInches;
  const maxY = state.board.heightInches;
  if (side === "west") return [{ start: { x: 0, y: 0 }, end: { x: 0, y: maxY } }];
  if (side === "east") return [{ start: { x: maxX, y: 0 }, end: { x: maxX, y: maxY } }];
  if (side === "north") return [{ start: { x: 0, y: 0 }, end: { x: maxX, y: 0 } }];
  if (side === "south") return [{ start: { x: 0, y: maxY }, end: { x: maxX, y: maxY } }];
  return [];
}

function hasReserveDropAbility(unit) {
  return unit.abilities?.includes("deep_strike");
}

export function getFriendlyOmegaWormEntrySources(state, playerId, unit) {
  if (!unitBenefitsFromCreep(unit) || unit.currentSupplyValue > 2) return [];
  return Object.values(state.units)
    .filter(other =>
      other.owner === playerId &&
      other.status?.location === "battlefield" &&
      other.templateId === "omega_worm"
    )
    .map(other => {
      const leader = other.models?.[other.leadingModelId];
      if (!leader || !leader.alive || leader.x == null || leader.y == null) return null;
      return {
        unitId: other.id,
        center: { x: leader.x, y: leader.y },
        radius: other.base?.radiusInches ?? 0
      };
    })
    .filter(Boolean);
}

function getOmegaWormEntrySourceAtPoint(state, playerId, unit, point) {
  return getFriendlyOmegaWormEntrySources(state, playerId, unit).find(source =>
    distance(source.center, point) <= source.radius + (unit.base?.radiusInches ?? 0) + 1e-6
  ) ?? null;
}

export function canUseBoardEntryDeploy(state, playerId, unit) {
  return hasReserveDropAbility(unit)
    || (canWarpDeployUnit(unit) && hasFriendlyPowerField(state, playerId))
    || getCardDeploymentZones(state, playerId, unit).length > 0;
}

function pointTooCloseToEnemy(state, playerId, point, minDistance = 6) {
  for (const enemyUnitId of state.players[playerId === "playerA" ? "playerB" : "playerA"].battlefieldUnitIds) {
    const enemy = state.units[enemyUnitId];
    if (!enemy) continue;
    for (const model of Object.values(enemy.models)) {
      if (!model.alive || model.x == null || model.y == null) continue;
      if (distance(point, model) - enemy.base.radiusInches < minDistance - 1e-6) return true;
    }
  }
  return false;
}

export function validateDeploy(state, playerId, unitId, leadingModelId, entryPoint, path, modelPlacements = null) {
  const shared = validateShared(state, playerId, unitId);
  if (!shared.ok) return shared;
  const unit = shared.unit;
  const supplyValidation = validateDeploySupply(state, playerId, unitId);
  if (!supplyValidation.ok) return { ok: false, code: "SUPPLY_BLOCKED", message: supplyValidation.reason };
  const reserveDrop = hasReserveDropAbility(unit);
  const warpDeploy = !reserveDrop && canWarpDeployUnit(unit) && pointInsideFriendlyPowerField(state, playerId, entryPoint);
  const cardDeployZone = !reserveDrop && !warpDeploy
    ? getCardDeploymentZones(state, playerId, unit).find(zone => distance(zone.center, entryPoint) <= zone.radius + 1e-6) ?? null
    : null;
  const omegaWormEntry = !reserveDrop && !warpDeploy ? getOmegaWormEntrySourceAtPoint(state, playerId, unit, entryPoint) : null;
  if (!reserveDrop && !warpDeploy && !cardDeployZone && !omegaWormEntry && !pointOnEntryEdge(state.deployment, playerId, entryPoint)) return { ok: false, code: "BAD_ENTRY_EDGE", message: "Entry point must be on your entry edge, inside a friendly deployment field, inside a friendly Power Field, or on a friendly Omega Worm base." };
  if ((reserveDrop || warpDeploy || cardDeployZone) && !pointInBoard(entryPoint, state.board, unit.base.radiusInches)) return { ok: false, code: "BAD_ENTRY_POINT", message: `${reserveDrop ? "Deep strike" : warpDeploy ? "Warp-in" : "Field deploy"} entry point must be on the battlefield.` };
  if (reserveDrop && pointTooCloseToEnemy(state, playerId, entryPoint)) return { ok: false, code: "DEEP_STRIKE_DENIED", message: "Deep strike entry must be at least 6\" from enemy models." };
  if (warpDeploy && pointTooCloseToEnemy(state, playerId, entryPoint)) return { ok: false, code: "WARP_FIELD_DENIED", message: "Warp-in point must be at least 6\" from enemy models." };
  if (cardDeployZone && pointTooCloseToEnemy(state, playerId, entryPoint)) return { ok: false, code: "FIELD_DEPLOY_DENIED", message: `${cardDeployZone.sourceKind} deployment must be at least 6" from enemy models.` };
  if (!path || path.length < 2) return { ok: false, code: "NO_PATH", message: "Deploy requires a path." };
  const start = path[0];
  if (Math.abs(start.x - entryPoint.x) > 0.01 || Math.abs(start.y - entryPoint.y) > 0.01) return { ok: false, code: "PATH_ENTRY_MISMATCH", message: "Path must start at the chosen entry point." };
  const travelCost = (reserveDrop || warpDeploy || cardDeployZone)
    ? 0
    : creepNegatesDifficultTerrain(state, unit, path)
    ? (state.rules?.gridMode ? gridDistance(path[0], path[path.length - 1]) : distance(path[0], path[path.length - 1]))
    : state.rules?.gridMode ? gridDistance(path[0], path[path.length - 1]) : pathTravelCost(path, state.board.terrain);
  const allowedSpeed = (reserveDrop || warpDeploy || cardDeployZone) ? Infinity : unit.speed + getCreepMovementBonus(state, unit, path);
  if (travelCost - allowedSpeed > 1e-6) return { ok: false, code: "TOO_FAR", message: `${unit.name} can only deploy ${allowedSpeed}" (difficult terrain costs extra movement unless creep negates it).` };
  const side = state.deployment.entryEdges[playerId].side;
  const adjustedStart = { ...entryPoint };
  if (!reserveDrop && !warpDeploy && !cardDeployZone) {
    if (omegaWormEntry) {
      adjustedStart.x = entryPoint.x;
      adjustedStart.y = entryPoint.y;
    } else {
      if (side === "west") adjustedStart.x = unit.base.radiusInches;
      if (side === "east") adjustedStart.x = state.board.widthInches - unit.base.radiusInches;
      if (side === "north") adjustedStart.y = unit.base.radiusInches;
      if (side === "south") adjustedStart.y = state.board.heightInches - unit.base.radiusInches;
    }
  }
  const collisionPath = [adjustedStart, ...path.slice(1)];
  if (pathBlockedForCircle(collisionPath, unit.base.radiusInches, state, new Set(unit.modelIds))) return { ok: false, code: "PATH_BLOCKED", message: "Path crosses blocked ground, terrain, or bases." };
  if (getBlockingForceFieldCrossings(state, unit, collisionPath).length) return { ok: false, code: "FORCE_FIELD_BLOCKED", message: "A Force Field blocks units of Size 2 or lower from crossing there." };
  const end = path[path.length - 1];
  if (!pointInBoard(end, state.board, unit.base.radiusInches)) return { ok: false, code: "OFF_BOARD", message: "Leading model must end fully on the battlefield." };
  if (circleOverlapsTerrain(end, unit.base.radiusInches, state.board.terrain)) return { ok: false, code: "TERRAIN_OVERLAP", message: "Leading model cannot end overlapping impassable terrain." };
  if (overlapsAnyModel(state, unit, end)) return { ok: false, code: "BASE_OVERLAP", message: "Leading model would overlap an existing base." };
  if (reserveDrop && pointTooCloseToEnemy(state, playerId, end)) return { ok: false, code: "DEEP_STRIKE_DENIED", message: "Deep strike destination must be at least 6\" from enemy models." };
  if (warpDeploy && pointTooCloseToEnemy(state, playerId, end)) return { ok: false, code: "WARP_FIELD_DENIED", message: "Warp-in destination must be at least 6\" from enemy models." };
  if (cardDeployZone && pointTooCloseToEnemy(state, playerId, end)) return { ok: false, code: "FIELD_DEPLOY_DENIED", message: `${cardDeployZone.sourceKind} destination must be at least 6" from enemy models.` };
  if (pointInsideEnemyZoneOfInfluence(state, playerId, end, unit.base.radiusInches)) return { ok: false, code: "ZONE_OF_INFLUENCE", message: "Deploy cannot end inside the opponent's zone of influence." };
  const placements = modelPlacements ?? autoArrangeModels(state, unitId, end);
  return { ok: true, derived: { end, placements, reserveDrop, warpDeploy, cardDeployZone, omegaWormEntry } };
}

export function resolveDeploy(state, playerId, unitId, leadingModelId, entryPoint, path, modelPlacements = null) {
  const validation = validateDeploy(state, playerId, unitId, leadingModelId, entryPoint, path, modelPlacements);
  if (!validation.ok) return validation;
  const unit = state.units[unitId];
  moveUnitToBattlefield(state, unitId);
  unit.leadingModelId = leadingModelId;
  const leader = unit.models[leadingModelId];
  leader.x = validation.derived.end.x;
  leader.y = validation.derived.end.y;
  const coherency = applyModelPlacementsAndResolveCoherency(state, unitId, validation.derived.placements);
  unit.status.stationary = false;
  unit.status.outOfCoherency = coherency.outOfCoherency;
  markUnitActivatedForMovement(state, unitId);
  removeForceFieldsCrossedByUnit(state, unit, [entryPoint, ...path.slice(1)]);
  refreshEngagement(state);
  refreshAllSupply(state);
  const displacedCreep = removeDisplacedCreepTumors(state, unit, "deploys");
  appendLog(state, "action", `${unit.name} deploys from reserves${validation.derived.reserveDrop ? " via deep strike" : validation.derived.warpDeploy ? " through a Power Field" : validation.derived.cardDeployZone ? ` through ${validation.derived.cardDeployZone.sourceKind}` : validation.derived.omegaWormEntry ? " through an Omega Worm" : ""}.${coherency.outOfCoherency ? " Unit is out of coherency." : ""}`);
  endActivationAndPassTurn(state);
  return {
    ok: true,
    state,
    events: [
      { type: "unit_deployed", payload: { unitId } },
      ...displacedCreep.map(zone => ({ type: "creep_displaced", payload: { unitId, creepId: zone.id } }))
    ]
  };
}
