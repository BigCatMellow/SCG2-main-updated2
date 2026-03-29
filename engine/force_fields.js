import { appendLog } from "./state.js";
import { endActivationAndPassTurn, isUnitEligibleForMovementActivation, markUnitActivatedForMovement } from "./activation.js";
import { pointInBoard, circleOverlapsCircle, circleOverlapsRect, distance, sampleSegment } from "./geometry.js";

const FORCE_FIELD_RANGE = 8;
const FORCE_FIELD_HALF_SIZE = 0.5;

let forceFieldCounter = 1;

function nextForceFieldId() {
  const id = `force_field_${forceFieldCounter}`;
  forceFieldCounter += 1;
  return id;
}

function hasSolidFieldProjectors(unit) {
  return unit?.abilities?.includes("solid_field_projectors");
}

export function isForceFieldTerrain(terrain) {
  return terrain?.kind === "force_field";
}

function buildForceFieldRect(point) {
  return {
    minX: point.x - FORCE_FIELD_HALF_SIZE,
    maxX: point.x + FORCE_FIELD_HALF_SIZE,
    minY: point.y - FORCE_FIELD_HALF_SIZE,
    maxY: point.y + FORCE_FIELD_HALF_SIZE
  };
}

function unitCanCrossForceField(unit) {
  return Number(unit?.size ?? 0) >= 3;
}

function overlapsAnyModel(state, rect) {
  const center = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
  for (const unit of Object.values(state.units)) {
    for (const model of Object.values(unit.models)) {
      if (!model.alive || model.x == null || model.y == null) continue;
      if (circleOverlapsRect({ x: model.x, y: model.y }, unit.base.radiusInches, rect)) return true;
      if (circleOverlapsCircle(center, FORCE_FIELD_HALF_SIZE, { x: model.x, y: model.y }, unit.base.radiusInches)) return true;
    }
  }
  return false;
}

function overlapsExistingTerrain(state, rect) {
  return state.board.terrain.some(terrain => {
    const other = terrain.rect;
    return !(rect.maxX <= other.minX || rect.minX >= other.maxX || rect.maxY <= other.minY || rect.minY >= other.maxY);
  });
}

function getFieldPathCrossings(state, unit, path) {
  if (!path?.length) return [];
  const crossed = [];
  const seen = new Set();
  for (const terrain of state.board.terrain) {
    if (!isForceFieldTerrain(terrain)) continue;
    const blocks = !unitCanCrossForceField(unit);
    for (let i = 1; i < path.length; i += 1) {
      const samples = sampleSegment(path[i - 1], path[i], 0.15);
      const hit = samples.some(sample => circleOverlapsRect(sample, unit.base.radiusInches, terrain.rect));
      if (!hit) continue;
      if (!seen.has(terrain.id)) {
        seen.add(terrain.id);
        crossed.push({ terrain, blocks });
      }
      break;
    }
  }
  return crossed;
}

export function getBlockingForceFieldCrossings(state, unit, path) {
  return getFieldPathCrossings(state, unit, path).filter(entry => entry.blocks);
}

export function removeForceFieldsCrossedByUnit(state, unit, path) {
  const destroyed = getFieldPathCrossings(state, unit, path)
    .filter(entry => !entry.blocks)
    .map(entry => entry.terrain);
  if (!destroyed.length) return [];

  const ids = new Set(destroyed.map(entry => entry.id));
  state.board.terrain = state.board.terrain.filter(terrain => !ids.has(terrain.id));
  for (const field of destroyed) {
    appendLog(state, "action", `${unit.name} crashes through a Force Field and destroys it.`);
  }
  return destroyed;
}

export function validatePlaceForceField(state, playerId, unitId, point) {
  const unit = state.units[unitId];
  if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
  if (state.phase !== "movement") return { ok: false, code: "WRONG_PHASE", message: "Force Fields can only be placed in the Movement Phase." };
  if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
  if (!isUnitEligibleForMovementActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
  if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Only battlefield units can project a Force Field." };
  if (!hasSolidFieldProjectors(unit)) return { ok: false, code: "NO_FORCE_FIELD", message: "This unit does not have Solid-Field Projectors." };

  const leader = unit.models[unit.leadingModelId];
  if (!leader || leader.x == null || leader.y == null) return { ok: false, code: "INVALID_LEADER", message: "Unit leader must be on the battlefield." };
  if (distance(leader, point) > FORCE_FIELD_RANGE + 1e-6) return { ok: false, code: "OUT_OF_RANGE", message: `Force Field must be placed within ${FORCE_FIELD_RANGE}".` };

  const rect = buildForceFieldRect(point);
  const center = { x: point.x, y: point.y };
  if (!pointInBoard(center, state.board, FORCE_FIELD_HALF_SIZE)) return { ok: false, code: "OFF_BOARD", message: "Force Field must be wholly on the battlefield." };
  if (overlapsAnyModel(state, rect)) return { ok: false, code: "SPACE_OCCUPIED", message: "Force Field must be placed in an unoccupied space." };
  if (overlapsExistingTerrain(state, rect)) return { ok: false, code: "SPACE_OCCUPIED", message: "Force Field cannot overlap existing terrain or another token." };

  return { ok: true, unit, derived: { rect, center } };
}

export function resolvePlaceForceField(state, playerId, unitId, point) {
  const validation = validatePlaceForceField(state, playerId, unitId, point);
  if (!validation.ok) return validation;

  const field = {
    id: nextForceFieldId(),
    kind: "force_field",
    impassable: false,
    owner: playerId,
    sourceUnitId: unitId,
    rect: validation.derived.rect
  };
  state.board.terrain.push(field);
  markUnitActivatedForMovement(state, unitId);
  state.units[unitId].status.stationary = true;
  appendLog(
    state,
    "action",
    `${state.units[unitId].name} projects a Force Field within ${FORCE_FIELD_RANGE}" to block smaller units.`
  );
  endActivationAndPassTurn(state);
  return {
    ok: true,
    state,
    events: [{ type: "force_field_placed", payload: { unitId, terrainId: field.id, point: validation.derived.center } }]
  };
}
