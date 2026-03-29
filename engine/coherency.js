import { distance, pointInBoard, circleOverlapsTerrain, circleOverlapsCircle, makeCirclePlacementRing } from "./geometry.js";

const COHERENCY_DISTANCE = 3;
const ENGAGEMENT_RANGE = 1;

function modelCircle(model, radius) {
  return { x: model.x, y: model.y, radius };
}

export function isModelWhollyWithinLeadingModelRadius(leadingModel, otherModel, maxDistance, baseRadius) {
  return distance(leadingModel, otherModel) + baseRadius <= maxDistance + 1e-6;
}

export function canTraceCoherencyLink(unit, modelId) {
  const target = unit.models[modelId];
  const leader = unit.models[unit.leadingModelId];
  if (!target || !leader || !target.alive || !leader.alive) return false;
  return distance(leader, target) <= COHERENCY_DISTANCE + 1e-6;
}

function overlapsAnyOtherModel(state, unit, placement, ignoreModelId) {
  for (const otherUnit of Object.values(state.units)) {
    for (const otherModel of Object.values(otherUnit.models)) {
      if (!otherModel.alive || otherModel.x == null || otherModel.y == null) continue;
      if (otherModel.id === ignoreModelId) continue;
      if (unit.id === otherUnit.id && otherModel.id === unit.leadingModelId) {
        if (circleOverlapsCircle(placement, unit.base.radiusInches, { x: otherModel.x, y: otherModel.y }, unit.base.radiusInches)) return true;
        continue;
      }
      if (circleOverlapsCircle(placement, unit.base.radiusInches, { x: otherModel.x, y: otherModel.y }, otherUnit.base.radiusInches)) return true;
    }
  }
  return false;
}

function withinEnemyEngagement(state, unit, placement) {
  for (const otherUnit of Object.values(state.units)) {
    if (otherUnit.owner === unit.owner) continue;
    if (!otherUnit.tags.includes("Ground")) continue;
    for (const otherModel of Object.values(otherUnit.models)) {
      if (!otherModel.alive || otherModel.x == null || otherModel.y == null) continue;
      const edgeDistance = distance(placement, otherModel) - unit.base.radiusInches - otherUnit.base.radiusInches;
      if (edgeDistance < ENGAGEMENT_RANGE - 1e-6) return true;
    }
  }
  return false;
}

export function validateCoherency(unit) {
  const leader = unit.models[unit.leadingModelId];
  if (!leader || leader.x == null || leader.y == null) {
    return { inCoherency: false, outOfCoherencyModelIds: unit.modelIds.filter(id => id !== unit.leadingModelId), removedModelIds: [] };
  }
  const out = [];
  for (const modelId of unit.modelIds) {
    if (modelId === unit.leadingModelId) continue;
    const model = unit.models[modelId];
    if (!model.alive || model.x == null || model.y == null) continue;
    if (!canTraceCoherencyLink(unit, modelId) || !isModelWhollyWithinLeadingModelRadius(leader, model, COHERENCY_DISTANCE, unit.base.radiusInches)) out.push(modelId);
  }
  return { inCoherency: out.length === 0, outOfCoherencyModelIds: out, removedModelIds: [] };
}

export function autoArrangeModels(state, unitId, leaderPoint) {
  const unit = state.units[unitId];
  const aliveFollowers = unit.modelIds.filter(id => id !== unit.leadingModelId && unit.models[id].alive);
  const placements = makeCirclePlacementRing(leaderPoint, aliveFollowers.length, unit.base.radiusInches, 2.8);
  return aliveFollowers.map((modelId, index) => ({ modelId, x: placements[index]?.x ?? leaderPoint.x, y: placements[index]?.y ?? leaderPoint.y }));
}

export function applyModelPlacementsAndResolveCoherency(state, unitId, placements) {
  const unit = state.units[unitId];
  const leader = unit.models[unit.leadingModelId];
  const removedModelIds = [];
  let outOfCoherency = false;

  for (const placement of placements) {
    const model = unit.models[placement.modelId];
    if (!model || !model.alive) continue;
    const point = { x: placement.x, y: placement.y };
    const withinBoard = pointInBoard(point, state.board, unit.base.radiusInches);
    const blocksTerrain = circleOverlapsTerrain(point, unit.base.radiusInches, state.board.terrain);
    const overlapsOtherModel = overlapsAnyOtherModel(state, unit, point, placement.modelId);
    const insideEnemyRange = withinEnemyEngagement(state, unit, point);
    const validLink = isModelWhollyWithinLeadingModelRadius(leader, point, COHERENCY_DISTANCE, unit.base.radiusInches);

    if (withinBoard && !blocksTerrain && !overlapsOtherModel && !insideEnemyRange && validLink) {
      model.x = point.x;
      model.y = point.y;
      continue;
    }

    const directionX = point.x - leader.x;
    const directionY = point.y - leader.y;
    const len = Math.hypot(directionX, directionY) || 1;
    const fallback = {
      x: leader.x + (directionX / len) * Math.min(2.7, COHERENCY_DISTANCE - unit.base.radiusInches),
      y: leader.y + (directionY / len) * Math.min(2.7, COHERENCY_DISTANCE - unit.base.radiusInches)
    };
    const fallbackWithinBoard = pointInBoard(fallback, state.board, unit.base.radiusInches);
    const fallbackBlocksTerrain = circleOverlapsTerrain(fallback, unit.base.radiusInches, state.board.terrain);
    const fallbackOverlap = overlapsAnyOtherModel(state, unit, fallback, placement.modelId);
    const fallbackEnemyRange = withinEnemyEngagement(state, unit, fallback);

    if (fallbackWithinBoard && !fallbackBlocksTerrain && !fallbackOverlap && !fallbackEnemyRange) {
      model.x = fallback.x;
      model.y = fallback.y;
      outOfCoherency = true;
      continue;
    }

    model.alive = false;
    model.x = null;
    model.y = null;
    removedModelIds.push(model.id);
  }

  const check = validateCoherency(unit);
  unit.status.outOfCoherency = outOfCoherency || !check.inCoherency;
  return { ok: true, removedModelIds, outOfCoherency: unit.status.outOfCoherency };
}
