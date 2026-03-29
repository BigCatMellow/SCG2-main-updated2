export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function gridDistance(a, b) {
  return Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
}

export function snapPointToGrid(point, board) {
  return {
    x: clamp(Math.round(point.x), 0, board.widthInches),
    y: clamp(Math.round(point.y), 0, board.heightInches)
  };
}

export function pathLength(path = []) {
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += distance(path[i - 1], path[i]);
  return total;
}

export function pointInBoard(point, board, radius = 0) {
  return point.x - radius >= 0 && point.y - radius >= 0 && point.x + radius <= board.widthInches && point.y + radius <= board.heightInches;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function nearestPointOnRect(point, rect) {
  return {
    x: clamp(point.x, rect.minX, rect.maxX),
    y: clamp(point.y, rect.minY, rect.maxY)
  };
}

export function circleOverlapsCircle(aCenter, aRadius, bCenter, bRadius) {
  return distance(aCenter, bCenter) < (aRadius + bRadius) - 1e-6;
}

export function circleOverlapsRect(center, radius, rect) {
  const nearest = nearestPointOnRect(center, rect);
  return distance(center, nearest) < radius - 1e-6;
}

export function circleOverlapsTerrain(center, radius, terrainList = []) {
  return terrainList.some(terrain => {
    if (!terrain.impassable) return false;
    return circleOverlapsRect(center, radius, terrain.rect);
  });
}

export function pointInsideRect(point, rect) {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
}

export function pointInsideDifficultTerrain(point, terrainList = []) {
  return terrainList.some(terrain => terrain.kind === "cover" && pointInsideRect(point, terrain.rect));
}

export function sampleSegment(segmentStart, segmentEnd, step = 0.2) {
  const len = distance(segmentStart, segmentEnd);
  const count = Math.max(1, Math.ceil(len / step));
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    points.push({
      x: segmentStart.x + (segmentEnd.x - segmentStart.x) * t,
      y: segmentStart.y + (segmentEnd.y - segmentStart.y) * t
    });
  }
  return points;
}

export function pathBlockedForCircle(path, radius, state, ignoreModelIds = new Set(), options = {}) {
  if (!path || path.length < 2) return false;
  const allowStartOutside = options.allowStartOutside ?? false;
  for (let i = 1; i < path.length; i += 1) {
    const samples = sampleSegment(path[i - 1], path[i]);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const isFirstPathPoint = allowStartOutside && i === 1 && index === 0;
      if (!isFirstPathPoint && !pointInBoard(sample, state.board, radius)) return true;
      if (circleOverlapsTerrain(sample, radius, state.board.terrain)) return true;
      for (const unit of Object.values(state.units)) {
        if (unit.status?.burrowed) continue;
        for (const model of Object.values(unit.models)) {
          if (!model.alive || model.x == null || model.y == null || ignoreModelIds.has(model.id)) continue;
          if (circleOverlapsCircle(sample, radius, { x: model.x, y: model.y }, unit.base.radiusInches)) return true;
        }
      }
    }
  }
  return false;
}

export function pathTravelCost(path = [], terrainList = [], difficultMultiplier = 2) {
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const samples = sampleSegment(path[i - 1], path[i], 0.15);
    for (let j = 1; j < samples.length; j += 1) {
      const prev = samples[j - 1];
      const curr = samples[j];
      const mid = { x: (prev.x + curr.x) / 2, y: (prev.y + curr.y) / 2 };
      const multiplier = pointInsideDifficultTerrain(mid, terrainList) ? difficultMultiplier : 1;
      total += distance(prev, curr) * multiplier;
    }
  }
  return total;
}

export function pointOnEntryEdge(deployment, playerId, point, tolerance = 0.15) {
  const side = deployment.entryEdges[playerId]?.side;
  if (!side) return false;
  if (side === "west") return Math.abs(point.x - 0) <= tolerance && point.y >= 0 && point.y <= deployment.boardHeightInches;
  if (side === "east") return Math.abs(point.x - deployment.boardWidthInches) <= tolerance && point.y >= 0 && point.y <= deployment.boardHeightInches;
  if (side === "north") return Math.abs(point.y - 0) <= tolerance && point.x >= 0 && point.x <= deployment.boardWidthInches;
  if (side === "south") return Math.abs(point.y - deployment.boardHeightInches) <= tolerance && point.x >= 0 && point.x <= deployment.boardWidthInches;
  return false;
}

export function pointInsideEnemyZoneOfInfluence(state, playerId, point, radius = 0) {
  const enemyId = playerId === "playerA" ? "playerB" : "playerA";
  const enemyEdge = state.deployment.entryEdges[enemyId]?.side;
  const depth = state.deployment.zoneOfInfluenceDepth;
  if (enemyEdge === "west") return point.x - radius < depth;
  if (enemyEdge === "east") return point.x + radius > state.board.widthInches - depth;
  if (enemyEdge === "north") return point.y - radius < depth;
  if (enemyEdge === "south") return point.y + radius > state.board.heightInches - depth;
  return false;
}

export function unitBaseRadius(unit) {
  return unit.base.radiusInches;
}

export function centroid(points) {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export function makeCirclePlacementRing(center, count, baseRadius, maxRadius = 2.8) {
  if (count <= 0) return [];
  const placements = [];
  const spacing = Math.max(baseRadius * 2.2, 0.9);
  const rings = [Math.min(1.25, maxRadius), Math.min(2.0, maxRadius), Math.min(2.8, maxRadius)];
  let generated = 0;
  for (const ringRadius of rings) {
    const circumference = Math.max(1, Math.floor((Math.PI * 2 * ringRadius) / spacing));
    for (let i = 0; i < circumference && generated < count; i += 1) {
      const angle = (Math.PI * 2 * i) / circumference;
      placements.push({
        x: center.x + Math.cos(angle) * ringRadius,
        y: center.y + Math.sin(angle) * ringRadius
      });
      generated += 1;
    }
    if (generated >= count) break;
  }
  return placements.slice(0, count);
}
