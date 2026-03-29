import { distance } from "./geometry.js";

export function getObjectiveControlRange(state) {
  return state.mission.objectiveControlRangeInches ?? 2;
}

export function isUnitWithinObjectiveRange(state, unit, range = getObjectiveControlRange(state)) {
  if (!unit || unit.status.location !== "battlefield") return false;
  return state.deployment.missionMarkers.some(objective =>
    unit.modelIds.some(modelId => {
      const model = unit.models[modelId];
      if (!model.alive || model.x == null || model.y == null) return false;
      return distance(model, objective) <= range + 1e-6;
    })
  );
}

function isUnitContestingObjective(unit, objective, range) {
  if (unit.status.location !== "battlefield") return false;
  if (unit.status.burrowed) return false;
  if (unit.tags?.includes("Flying") || unit.abilities?.includes("flying")) return false;
  return unit.modelIds.some(modelId => {
    const model = unit.models[modelId];
    if (!model.alive || model.x == null || model.y == null) return false;
    return distance(model, objective) <= range + 1e-6;
  });
}

export function getContestingSupplyForObjective(state, objectiveId, playerId) {
  const objective = state.deployment.missionMarkers.find(marker => marker.id === objectiveId);
  if (!objective) return 0;
  const range = getObjectiveControlRange(state);
  let total = 0;
  for (const unitId of state.players[playerId].battlefieldUnitIds) {
    const unit = state.units[unitId];
    if (isUnitContestingObjective(unit, objective, range)) total += unit.currentSupplyValue;
  }
  return total;
}

export function resolveObjectiveController(state, objectiveId) {
  const playerASupply = getContestingSupplyForObjective(state, objectiveId, "playerA");
  const playerBSupply = getContestingSupplyForObjective(state, objectiveId, "playerB");

  if (playerASupply === 0 && playerBSupply === 0) {
    return { objectiveId, controller: null, playerASupply, playerBSupply, contested: false };
  }
  if (playerASupply === playerBSupply) {
    return { objectiveId, controller: null, playerASupply, playerBSupply, contested: true };
  }

  return {
    objectiveId,
    controller: playerASupply > playerBSupply ? "playerA" : "playerB",
    playerASupply,
    playerBSupply,
    contested: false
  };
}

export function getObjectiveControlSnapshot(state) {
  const snapshot = {};
  for (const objective of state.deployment.missionMarkers) {
    snapshot[objective.id] = resolveObjectiveController(state, objective.id);
  }
  return snapshot;
}

export function scoreObjectivesForRound(state) {
  const snapshot = getObjectiveControlSnapshot(state);
  const vpPerObjective = state.mission.vpPerControlledObjective ?? 1;
  const gained = { playerA: 0, playerB: 0 };

  for (const objectiveResult of Object.values(snapshot)) {
    if (!objectiveResult.controller) continue;
    gained[objectiveResult.controller] += vpPerObjective;
  }

  state.players.playerA.vp += gained.playerA;
  state.players.playerB.vp += gained.playerB;
  state.objectiveControl = snapshot;

  return { snapshot, gained, vpPerObjective };
}

export function determineWinner(state) {
  if (state.players.playerA.vp === state.players.playerB.vp) return null;
  return state.players.playerA.vp > state.players.playerB.vp ? "playerA" : "playerB";
}
