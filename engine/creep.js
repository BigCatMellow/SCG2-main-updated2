import { appendLog } from "./state.js";
import { endActivationAndPassTurn, isUnitEligibleForMovementActivation, markUnitActivatedForMovement } from "./activation.js";
import { distance, pointInBoard, sampleSegment, pathLength, gridDistance } from "./geometry.js";

const CREEP_PLACE_RANGE = 6;
const CREEP_PATCH_RADIUS = 6;
const CREEP_SOURCE_RADIUS = 6;
const CREEP_TOKEN_RADIUS = 0.5;
const CREEP_DISPLACEMENT_RANGE = 1;

let creepPatchCounter = 1;

function nextCreepPatchId() {
  const id = `creep_patch_${creepPatchCounter}`;
  creepPatchCounter += 1;
  return id;
}

function getUnitLeader(unit) {
  const leader = unit?.models?.[unit?.leadingModelId];
  if (!leader || !leader.alive || leader.x == null || leader.y == null) return null;
  return { x: leader.x, y: leader.y };
}

function getEffectZoneCenter(state, effect) {
  if (effect?.target?.scope === "unit") {
    return getUnitLeader(state.units?.[effect.target.unitId]);
  }
  return effect?.zone?.center ?? null;
}

export function unitCanSourceCreep(unit) {
  return unit?.abilities?.includes("source_of_creep");
}

export function unitBenefitsFromCreep(unit) {
  const templateId = String(unit?.templateId ?? "");
  return /(zerg|roach|hydralisk|queen|kerrigan|raptor|omega_worm)/i.test(templateId)
    || unitCanSourceCreep(unit);
}

export function getCreepZones(state) {
  const placedZones = [...(state.board.creepZones ?? [])];
  const effectZones = (state.effects ?? [])
    .filter(effect => effect?.zone?.kind === "creep_field")
    .map(effect => {
      const center = getEffectZoneCenter(state, effect);
      if (!center) return null;
      return {
        id: `creep_field_${effect.id}`,
        kind: "creep_field",
        owner: effect.source?.owner ?? null,
        sourceUnitId: effect.target?.unitId ?? null,
        center,
        radius: effect.zone?.radius ?? CREEP_PATCH_RADIUS,
        tokenRadius: 0
      };
    })
    .filter(Boolean);
  const sourceZones = Object.values(state.units)
    .filter(unit => unit.status?.location === "battlefield" && unitCanSourceCreep(unit))
    .map(unit => {
      const center = getUnitLeader(unit);
      if (!center) return null;
      return {
        id: `creep_source_${unit.id}`,
        kind: "creep_source",
        owner: unit.owner,
        sourceUnitId: unit.id,
        center,
        radius: CREEP_SOURCE_RADIUS,
        tokenRadius: unit.base?.radiusInches ?? CREEP_TOKEN_RADIUS
      };
    })
    .filter(Boolean);
  return [...placedZones, ...effectZones, ...sourceZones];
}

function getPlacedCreepTumors(state) {
  return (state.board.creepZones ?? []).filter(zone => zone.kind !== "creep_source");
}

export function pointInsideCreepZone(point, zone) {
  if (!point || !zone?.center) return false;
  return distance(point, zone.center) <= (zone.radius ?? 0) + 1e-6;
}

export function pointInsideFriendlyCreep(state, playerId, point) {
  return getCreepZones(state).some(zone => zone.owner === playerId && pointInsideCreepZone(point, zone));
}

export function pathTouchesFriendlyCreep(state, playerId, path) {
  if (!path?.length) return false;
  const zones = getCreepZones(state).filter(zone => zone.owner === playerId);
  if (!zones.length) return false;
  for (let i = 1; i < path.length; i += 1) {
    const samples = sampleSegment(path[i - 1], path[i], 0.2);
    if (samples.some(sample => zones.some(zone => pointInsideCreepZone(sample, zone)))) return true;
  }
  return false;
}

export function getCreepMovementBonus(state, unit, path) {
  if (!unitBenefitsFromCreep(unit)) return 0;
  return pathTouchesFriendlyCreep(state, unit.owner, path) ? 2 : 0;
}

export function creepNegatesDifficultTerrain(state, unit, path) {
  return unitBenefitsFromCreep(unit) && pathTouchesFriendlyCreep(state, unit.owner, path);
}

function overlapsExistingFriendlyPatch(state, playerId, point) {
  return getPlacedCreepTumors(state).some(zone =>
    zone.owner === playerId && distance(zone.center, point) <= (zone.radius + CREEP_PATCH_RADIUS - 0.5)
  );
}

export function validatePlaceCreep(state, playerId, unitId, point) {
  const unit = state.units[unitId];
  if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
  if (state.phase !== "movement") return { ok: false, code: "WRONG_PHASE", message: "Creep can only be placed in the Movement Phase." };
  if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
  if (!isUnitEligibleForMovementActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
  if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Only battlefield units can spread creep." };
  if (!unitCanSourceCreep(unit)) return { ok: false, code: "NO_CREEP_SOURCE", message: "This unit is not a source of creep." };
  const leader = getUnitLeader(unit);
  if (!leader) return { ok: false, code: "INVALID_LEADER", message: "Unit leader must be on the battlefield." };
  if (distance(leader, point) > CREEP_PLACE_RANGE + 1e-6) return { ok: false, code: "OUT_OF_RANGE", message: `Creep Tumor must be placed within ${CREEP_PLACE_RANGE}".` };
  if (!pointInBoard(point, state.board, CREEP_PATCH_RADIUS)) return { ok: false, code: "OFF_BOARD", message: "Creep Tumor aura must fit fully on the battlefield." };
  if (overlapsExistingFriendlyPatch(state, playerId, point)) return { ok: false, code: "ALREADY_COVERED", message: "That area is already covered by friendly creep." };
  return { ok: true, unit };
}

export function resolvePlaceCreep(state, playerId, unitId, point) {
  const validation = validatePlaceCreep(state, playerId, unitId, point);
  if (!validation.ok) return validation;
  const zone = {
    id: nextCreepPatchId(),
    kind: "creep_tumor",
    owner: playerId,
    sourceUnitId: unitId,
    center: { x: point.x, y: point.y },
    radius: CREEP_PATCH_RADIUS,
    tokenRadius: CREEP_TOKEN_RADIUS
  };
  state.board.creepZones.push(zone);
  markUnitActivatedForMovement(state, unitId);
  state.units[unitId].status.stationary = true;
  appendLog(state, "action", `${state.units[unitId].name} spawns a Creep Tumor within ${CREEP_PLACE_RANGE}".`);
  endActivationAndPassTurn(state);
  return {
    ok: true,
    state,
    events: [{ type: "creep_placed", payload: { unitId, creepId: zone.id, point: zone.center, radius: zone.radius } }]
  };
}

export function getCreepTravelHint(state, unit, path) {
  if (!path?.length) return null;
  const touched = pathTouchesFriendlyCreep(state, unit.owner, path);
  if (!touched || !unitBenefitsFromCreep(unit)) return null;
  const direct = state.rules?.gridMode ? gridDistance(path[0], path[path.length - 1]) : pathLength(path);
  return {
    movementBonus: 2,
    ignoresDifficultTerrain: true,
    travelCost: direct
  };
}

export function getDisplacedCreepTumors(state, unit) {
  if (!unit || unit.status?.location !== "battlefield") return [];
  const aliveModels = unit.modelIds
    .map(modelId => unit.models?.[modelId])
    .filter(model => model?.alive && model.x != null && model.y != null);
  if (!aliveModels.length) return [];
  return getPlacedCreepTumors(state).filter(zone => {
    if (!zone?.center || zone.owner === unit.owner) return false;
    const tokenRadius = zone.tokenRadius ?? CREEP_TOKEN_RADIUS;
    return aliveModels.some(model =>
      distance(model, zone.center) <= CREEP_DISPLACEMENT_RANGE + tokenRadius + (unit.base?.radiusInches ?? 0) + 1e-6
    );
  });
}

export function removeDisplacedCreepTumors(state, unit, actionLabel = "moves") {
  const displaced = getDisplacedCreepTumors(state, unit);
  if (!displaced.length) return [];
  const displacedIds = new Set(displaced.map(zone => zone.id));
  state.board.creepZones = (state.board.creepZones ?? []).filter(zone => !displacedIds.has(zone.id));
  displaced.forEach(() => {
    appendLog(
      state,
      "action",
      `${unit.name} ${actionLabel} within ${CREEP_DISPLACEMENT_RANGE}" of an enemy Creep Tumor and displaces it.`
    );
  });
  return displaced;
}
