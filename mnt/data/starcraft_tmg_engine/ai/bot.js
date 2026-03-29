import {
  getLegalActionsForPlayer,
  getLegalDeployDestinations,
  getLegalMoveDestinations,
  getLegalDisengageDestinations,
  getLegalRunDestinations
} from "../engine/legal_actions.js";
import { autoArrangeModels } from "../engine/coherency.js";
import { distance } from "../engine/geometry.js";

function getOpponent(playerId) {
  return playerId === "playerA" ? "playerB" : "playerA";
}

function nearestEnemyPoint(state, playerId) {
  const enemyUnits = Object.values(state.units).filter(
    unit => unit.owner === getOpponent(playerId) && unit.status.location === "battlefield"
  );
  if (!enemyUnits.length) return { x: state.board.widthInches / 2, y: state.board.heightInches / 2 };
  const points = enemyUnits.flatMap(unit =>
    Object.values(unit.models)
      .filter(m => m.alive && m.x != null && m.y != null)
      .map(m => ({ x: m.x, y: m.y }))
  );
  if (!points.length) return { x: state.board.widthInches / 2, y: state.board.heightInches / 2 };
  return points.sort((a, b) => a.x - b.x)[Math.floor(points.length / 2)];
}

function chooseUnitPriority(state, unitIds) {
  return [...unitIds].sort((a, b) => state.units[b].currentSupplyValue - state.units[a].currentSupplyValue);
}

function objectivePressureScore(state, point) {
  return state.deployment.missionMarkers.reduce((best, marker) => Math.max(best, Math.max(0, 4 - distance(point, marker))), 0);
}

function chooseBestRangedTarget(state, attacker) {
  const weapon = attacker.rangedWeapons?.[0];
  if (!weapon) return null;
  const attackerLeader = attacker.models[attacker.leadingModelId];
  if (!attackerLeader || attackerLeader.x == null || attackerLeader.y == null) return null;

  const enemies = Object.values(state.units).filter(unit => unit.owner !== attacker.owner && unit.status.location === "battlefield");
  let best = null;
  let bestScore = -Infinity;

  for (const target of enemies) {
    const targetLeader = target.models[target.leadingModelId];
    if (!targetLeader || targetLeader.x == null || targetLeader.y == null) continue;
    const range = distance(attackerLeader, targetLeader);
    if (range > weapon.rangeInches + 1e-6) continue;

    const supplyScore = target.currentSupplyValue * 3;
    const objectiveScore = objectivePressureScore(state, targetLeader) * 2;
    const proximityScore = Math.max(0, 10 - range);
    const score = supplyScore + objectiveScore + proximityScore;

    if (score > bestScore) {
      bestScore = score;
      best = target;
    }
  }

  return best;
}

function chooseBestChargeTarget(state, attacker) {
  const attackerLeader = attacker.models[attacker.leadingModelId];
  if (!attackerLeader || attackerLeader.x == null || attackerLeader.y == null) return null;
  const enemies = Object.values(state.units).filter(unit => unit.owner !== attacker.owner && unit.status.location === "battlefield");
  let best = null;
  let bestScore = -Infinity;

  for (const target of enemies) {
    const targetLeader = target.models[target.leadingModelId];
    if (!targetLeader || targetLeader.x == null || targetLeader.y == null) continue;
    const range = distance(attackerLeader, targetLeader);
    if (range > 8 + 1e-6) continue;

    const maxAliveWounds = target.modelIds.reduce((max, modelId) => {
      const model = target.models[modelId];
      if (!model.alive) return max;
      return Math.max(max, model.woundsRemaining);
    }, 0);
    const woundedModels = target.modelIds.filter(modelId => {
      const model = target.models[modelId];
      return model.alive && model.woundsRemaining < maxAliveWounds;
    }).length;
    const woundedBonus = woundedModels > 0 ? 3 : 0;
    const score = (target.currentSupplyValue * 2) + objectivePressureScore(state, targetLeader) + Math.max(0, 8 - range) + woundedBonus;
    if (score > bestScore) {
      bestScore = score;
      best = target;
    }
  }

  return best;
}

function chooseClosestPoint(points, target) {
  if (!points.length) return null;
  let best = points[0];
  let bestDistance = distance(points[0], target);
  for (const point of points.slice(1)) {
    const d = distance(point, target);
    if (d < bestDistance) {
      best = point;
      bestDistance = d;
    }
  }
  return best;
}

function chooseFarthestPoint(points, target) {
  if (!points.length) return null;
  let best = points[0];
  let bestDistance = distance(points[0], target);
  for (const point of points.slice(1)) {
    const d = distance(point, target);
    if (d > bestDistance) {
      best = point;
      bestDistance = d;
    }
  }
  return best;
}

function buildPlayCardAction(playerId, cardAction) {
  return {
    type: "PLAY_CARD",
    payload: {
      playerId,
      cardInstanceId: cardAction.cardInstanceId,
      targetUnitId: cardAction.targetUnitId ?? null
    }
  };
}

function chooseCardAction(state, playerId, actions) {
  const cardActions = actions.filter(action => action.type === "PLAY_CARD" && action.enabled);
  if (!cardActions.length) return null;

  if (state.phase === "movement") {
    const rapidRelocation = cardActions
      .filter(action => action.cardId === "rapid_relocation")
      .sort((a, b) => (state.units[b.targetUnitId]?.currentSupplyValue ?? 0) - (state.units[a.targetUnitId]?.currentSupplyValue ?? 0));

    for (const action of rapidRelocation) {
      const unit = state.units[action.targetUnitId];
      if (!unit || unit.status.location !== "battlefield" || unit.status.movementActivated) continue;
      return buildPlayCardAction(playerId, action);
    }
  }

  if (state.phase === "assault") {
    const focusedFire = cardActions
      .filter(action => action.cardId === "focused_fire")
      .sort((a, b) => (state.units[b.targetUnitId]?.currentSupplyValue ?? 0) - (state.units[a.targetUnitId]?.currentSupplyValue ?? 0));

    for (const action of focusedFire) {
      const unit = state.units[action.targetUnitId];
      if (!unit || unit.status.location !== "battlefield" || unit.status.assaultActivated) continue;
      if (!unit.rangedWeapons?.length || unit.status.cannotRangedAttackThisAssault) continue;
      return buildPlayCardAction(playerId, action);
    }
  }

  return null;
}

function tryBuildDeployAction(state, playerId, enemyCenter, unitId) {
  const unit = state.units[unitId];
  const legalPoints = getLegalDeployDestinations(state, playerId, unitId, unit.leadingModelId);
  const chosen = chooseClosestPoint(legalPoints, enemyCenter);
  if (!chosen) return null;
  return {
    type: "DEPLOY_UNIT",
    payload: {
      playerId,
      unitId,
      leadingModelId: unit.leadingModelId,
      entryPoint: chosen.entryPoint,
      path: [chosen.entryPoint, { x: chosen.x, y: chosen.y }],
      modelPlacements: autoArrangeModels(state, unitId, chosen)
    }
  };
}

function tryBuildDisengageAction(state, playerId, enemyCenter, unitId) {
  const unit = state.units[unitId];
  const legalPoints = getLegalDisengageDestinations(state, playerId, unitId, unit.leadingModelId);
  const chosen = chooseFarthestPoint(legalPoints, enemyCenter);
  if (!chosen) return null;
  const leader = unit.models[unit.leadingModelId];
  return {
    type: "DISENGAGE_UNIT",
    payload: {
      playerId,
      unitId,
      leadingModelId: unit.leadingModelId,
      path: [{ x: leader.x, y: leader.y }, { x: chosen.x, y: chosen.y }],
      modelPlacements: autoArrangeModels(state, unit.id, chosen)
    }
  };
}

function tryBuildMoveAction(state, playerId, enemyCenter, unitId) {
  const unit = state.units[unitId];
  const legalPoints = getLegalMoveDestinations(state, playerId, unitId, unit.leadingModelId);
  const chosen = chooseClosestPoint(legalPoints, enemyCenter);
  if (!chosen) return null;
  const leader = unit.models[unit.leadingModelId];
  return {
    type: "MOVE_UNIT",
    payload: {
      playerId,
      unitId,
      leadingModelId: unit.leadingModelId,
      path: [{ x: leader.x, y: leader.y }, { x: chosen.x, y: chosen.y }],
      modelPlacements: autoArrangeModels(state, unit.id, chosen)
    }
  };
}

function tryBuildRunAction(state, playerId, enemyCenter, unitId) {
  const unit = state.units[unitId];
  const legalPoints = getLegalRunDestinations(state, playerId, unitId, unit.leadingModelId);
  const chosen = chooseClosestPoint(legalPoints, enemyCenter);
  if (!chosen) return null;
  const leader = unit.models[unit.leadingModelId];
  return {
    type: "RUN_UNIT",
    payload: {
      playerId,
      unitId,
      leadingModelId: unit.leadingModelId,
      path: [{ x: leader.x, y: leader.y }, { x: chosen.x, y: chosen.y }],
      modelPlacements: autoArrangeModels(state, unit.id, chosen)
    }
  };
}

function chooseMovementPhaseAction(state, playerId) {
  const actions = getLegalActionsForPlayer(state, playerId);
  const cardAction = chooseCardAction(state, playerId, actions);
  if (cardAction) return cardAction;
  const enemyCenter = nearestEnemyPoint(state, playerId);

  const deployUnits = chooseUnitPriority(
    state,
    actions.filter(action => action.type === "DEPLOY_UNIT" && action.enabled).map(action => action.unitId)
  );
  for (const unitId of deployUnits) {
    const deployAction = tryBuildDeployAction(state, playerId, enemyCenter, unitId);
    if (deployAction) return deployAction;
  }

  const battlefieldUnits = Object.values(state.units).filter(
    unit => unit.owner === playerId && unit.status.location === "battlefield" && !unit.status.movementActivated
  );

  const engaged = battlefieldUnits.filter(unit => unit.status.engaged);
  for (const unit of engaged) {
    const disengageAction = tryBuildDisengageAction(state, playerId, enemyCenter, unit.id);
    if (disengageAction) return disengageAction;
  }

  const movers = battlefieldUnits.filter(unit => !unit.status.engaged);
  const orderedMovers = [...movers].sort((a, b) => {
    const aLeader = a.models[a.leadingModelId];
    const bLeader = b.models[b.leadingModelId];
    return distance(aLeader, enemyCenter) - distance(bLeader, enemyCenter);
  });
  for (const unit of orderedMovers) {
    const moveAction = tryBuildMoveAction(state, playerId, enemyCenter, unit.id);
    if (moveAction) return moveAction;
  }

  if (battlefieldUnits.length) {
    return { type: "HOLD_UNIT", payload: { playerId, unitId: battlefieldUnits[0].id } };
  }

  return { type: "PASS_PHASE", payload: { playerId } };
}

function chooseAssaultPhaseAction(state, playerId) {
  const enemyCenter = nearestEnemyPoint(state, playerId);
  const actions = getLegalActionsForPlayer(state, playerId);
  const cardAction = chooseCardAction(state, playerId, actions);
  if (cardAction) return cardAction;

  const rangedUnits = actions
    .filter(action => action.type === "DECLARE_RANGED_ATTACK" && action.enabled)
    .map(action => action.unitId);
  for (const unitId of chooseUnitPriority(state, rangedUnits)) {
    const attacker = state.units[unitId];
    const target = chooseBestRangedTarget(state, attacker);
    if (target) return { type: "DECLARE_RANGED_ATTACK", payload: { playerId, unitId, targetId: target.id } };
    return { type: "DECLARE_RANGED_ATTACK", payload: { playerId, unitId } };
  }

  const chargeUnits = actions
    .filter(action => action.type === "DECLARE_CHARGE" && action.enabled)
    .map(action => action.unitId);
  for (const unitId of chooseUnitPriority(state, chargeUnits)) {
    const attacker = state.units[unitId];
    const target = chooseBestChargeTarget(state, attacker);
    if (target) return { type: "DECLARE_CHARGE", payload: { playerId, unitId, targetId: target.id } };
  }

  const units = Object.values(state.units).filter(
    unit => unit.owner === playerId && unit.status.location === "battlefield" && !unit.status.assaultActivated
  );

  for (const unit of units) {
    const runAction = tryBuildRunAction(state, playerId, enemyCenter, unit.id);
    if (runAction) return runAction;
  }

  if (units.length) return { type: "HOLD_UNIT", payload: { playerId, unitId: units[0].id } };
  return { type: "PASS_PHASE", payload: { playerId } };
}

function chooseCombatPhaseAction(state, playerId) {
  const actions = getLegalActionsForPlayer(state, playerId);
  const resolvers = actions.filter(action => action.type === "RESOLVE_COMBAT_UNIT" && action.enabled);
  if (resolvers.length) {
    const [best] = chooseUnitPriority(state, resolvers.map(action => action.unitId));
    return { type: "RESOLVE_COMBAT_UNIT", payload: { playerId, unitId: best } };
  }

  const holds = actions.filter(action => action.type === "HOLD_UNIT" && action.enabled);
  if (holds.length) return { type: "HOLD_UNIT", payload: { playerId, unitId: holds[0].unitId } };
  return { type: "PASS_PHASE", payload: { playerId } };
}

export function chooseAction(state, playerId) {
  if (state.phase === "movement") return chooseMovementPhaseAction(state, playerId);
  if (state.phase === "assault") return chooseAssaultPhaseAction(state, playerId);
  if (state.phase === "combat") return chooseCombatPhaseAction(state, playerId);
  return { type: "PASS_PHASE", payload: { playerId } };
}

export async function performBotTurn(store, playerId) {
  const action = chooseAction(store.getState(), playerId);
  return store.dispatch(action);
}
