import {
  getLegalActionsForPlayer,
  getLegalDeployDestinations,
  getLegalMoveDestinations,
  getLegalDisengageDestinations,
  getLegalRunDestinations
} from "../engine/legal_actions.js";
import { autoArrangeModels } from "../engine/coherency.js";
import { distance } from "../engine/geometry.js";
import { getObjectiveControlSnapshot, getObjectiveControlRange } from "../engine/objectives.js";
import { getTacticalCard } from "../data/tactical_cards.js";

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

function opponent(playerId) {
  return playerId === "playerA" ? "playerB" : "playerA";
}

function leaderPoint(unit) {
  const m = unit.models[unit.leadingModelId];
  return m && m.alive && m.x != null ? { x: m.x, y: m.y } : null;
}

function aliveModelCount(unit) {
  return unit.modelIds.filter(id => unit.models[id].alive).length;
}

function totalWoundsRemaining(unit) {
  return unit.modelIds.reduce((sum, id) => {
    const m = unit.models[id];
    return sum + (m.alive ? (m.woundsRemaining ?? 1) : 0);
  }, 0);
}

function isOnBattlefield(unit) {
  return unit.status.location === "battlefield";
}

/* ══════════════════════════════════════════════════════════════
   STRATEGIC ASSESSMENT
   ══════════════════════════════════════════════════════════════ */

function assessGameState(state, playerId) {
  const me = state.players[playerId];
  const them = state.players[opponent(playerId)];
  const vpDiff = me.vp - them.vp;
  const roundsLeft = (state.mission.pacing?.roundLimit ?? state.mission.roundLimit ?? 5) - state.round;
  const snapshot = getObjectiveControlSnapshot(state);

  // Count objectives controlled by each side
  let myObjectives = 0;
  let theirObjectives = 0;
  let contested = 0;
  let uncontrolled = 0;
  const objectiveDetails = [];

  for (const obj of state.deployment.missionMarkers) {
    const ctrl = snapshot[obj.id];
    if (ctrl.controller === playerId) myObjectives++;
    else if (ctrl.controller === opponent(playerId)) theirObjectives++;
    else if (ctrl.contested) contested++;
    else uncontrolled++;
    objectiveDetails.push({ ...ctrl, x: obj.x, y: obj.y, id: obj.id });
  }

  // Battlefield strength
  const mySupply = me.battlefieldUnitIds.reduce((s, id) => s + state.units[id].currentSupplyValue, 0);
  const theirSupply = them.battlefieldUnitIds.reduce((s, id) => s + state.units[id].currentSupplyValue, 0);

  // Strategy
  let strategy;
  if (vpDiff < -2 || (vpDiff < 0 && roundsLeft <= 1)) {
    strategy = "desperate_aggro"; // behind on VP, need to flip objectives NOW
  } else if (vpDiff < 0) {
    strategy = "aggressive"; // slightly behind, push hard
  } else if (vpDiff > 2 || (vpDiff > 0 && roundsLeft <= 1)) {
    strategy = "defensive"; // ahead, protect what we have
  } else {
    strategy = "balanced"; // even, play smart
  }

  return {
    vpDiff, roundsLeft, strategy,
    myObjectives, theirObjectives, contested, uncontrolled,
    objectiveDetails, snapshot,
    mySupply, theirSupply,
    supplyAdvantage: mySupply - theirSupply
  };
}

/* ══════════════════════════════════════════════════════════════
   OBJECTIVE SCORING - Where should a unit want to be?
   ══════════════════════════════════════════════════════════════ */

function scoreDestination(state, playerId, unit, point, assessment) {
  const controlRange = getObjectiveControlRange(state);
  let score = 0;

  // Objective proximity — the core driver
  for (const obj of assessment.objectiveDetails) {
    const dist = distance(point, obj);
    if (dist <= controlRange) {
      // On the objective
      if (obj.controller === playerId) {
        // Already ours — moderate value (defend)
        score += assessment.strategy === "defensive" ? 18 : 8;
      } else if (obj.controller === opponent(playerId)) {
        // Flip it — high value
        score += assessment.strategy === "desperate_aggro" ? 30 : 20;
      } else if (obj.contested) {
        // Break the tie
        score += 22;
      } else {
        // Unclaimed — grab it
        score += 25;
      }
    } else if (dist <= controlRange + 4) {
      // Near an objective — partial credit
      const nearScore = Math.max(0, (controlRange + 4 - dist) * 3);
      score += nearScore;
    }
  }

  // Enemy proximity scoring
  const enemies = Object.values(state.units).filter(u => u.owner === opponent(playerId) && isOnBattlefield(u));
  for (const enemy of enemies) {
    const ep = leaderPoint(enemy);
    if (!ep) continue;
    const dist = distance(point, ep);

    // Ranged units want to stay at weapon range, not in melee
    if (unit.rangedWeapons?.length && !unit.meleeWeapons?.length) {
      const maxRange = Math.max(...unit.rangedWeapons.map(w => w.rangeInches ?? 0));
      if (maxRange > 0) {
        // Sweet spot: 60-90% of max range
        const idealDist = maxRange * 0.75;
        const rangePenalty = Math.abs(dist - idealDist) * 0.5;
        score -= rangePenalty;
        if (dist <= 1.5) score -= 10; // danger close penalty for ranged units
      }
    } else if (unit.meleeWeapons?.length) {
      // Melee units want to close distance (but this is handled by charge/move toward)
      if (assessment.strategy !== "defensive") {
        score += Math.max(0, 6 - dist) * 0.5;
      }
    }
  }

  // Slight penalty for being at the edges (less tactical value)
  const edgeDist = Math.min(point.x, point.y, state.board.widthInches - point.x, state.board.heightInches - point.y);
  if (edgeDist < 2) score -= 3;

  return score;
}

function chooseBestDestination(points, state, playerId, unit, assessment) {
  if (!points.length) return null;
  let best = points[0];
  let bestScore = scoreDestination(state, playerId, unit, points[0], assessment);
  for (let i = 1; i < points.length; i++) {
    const s = scoreDestination(state, playerId, unit, points[i], assessment);
    if (s > bestScore) {
      bestScore = s;
      best = points[i];
    }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════
   TARGET SELECTION — Focus fire, pick off wounded targets
   ══════════════════════════════════════════════════════════════ */

function scoreRangedTarget(state, playerId, attacker, target, assessment) {
  const tLeader = leaderPoint(target);
  const aLeader = leaderPoint(attacker);
  if (!tLeader || !aLeader) return -Infinity;
  const weapon = attacker.rangedWeapons?.[0];
  if (!weapon) return -Infinity;
  const dist = distance(aLeader, tLeader);
  if (dist > (weapon.rangeInches ?? 0) + 1e-6) return -Infinity;

  let score = 0;

  // Focus fire — wounded units are priority kills
  const alive = aliveModelCount(target);
  const total = target.modelIds.length;
  if (alive < total) score += (total - alive) * 5; // wounded bonus
  if (alive === 1) score += 8; // finish it off

  // High-supply targets are valuable
  score += target.currentSupplyValue * 3;

  // Objective pressure — target units on objectives
  const controlRange = getObjectiveControlRange(state);
  for (const obj of assessment.objectiveDetails) {
    if (distance(tLeader, obj) <= controlRange) {
      if (obj.controller === opponent(playerId)) score += 10; // kill their obj holder
      else if (obj.contested) score += 6;
    }
  }

  // Proximity bonus (easier to hit closer targets conceptually)
  score += Math.max(0, 10 - dist);

  // Target low-wound-remaining units to secure kills
  const wounds = totalWoundsRemaining(target);
  if (wounds <= 2) score += 6;

  return score;
}

function scoreChargeTarget(state, playerId, attacker, target, assessment) {
  const tLeader = leaderPoint(target);
  const aLeader = leaderPoint(attacker);
  if (!tLeader || !aLeader) return -Infinity;
  const dist = distance(aLeader, tLeader);
  if (dist > 8 + 1e-6) return -Infinity;

  let score = 0;

  // Focus fire bonuses
  const alive = aliveModelCount(target);
  const total = target.modelIds.length;
  if (alive < total) score += (total - alive) * 4;
  if (alive === 1) score += 7;

  // Supply value
  score += target.currentSupplyValue * 2;

  // Objective presence
  const controlRange = getObjectiveControlRange(state);
  for (const obj of assessment.objectiveDetails) {
    if (distance(tLeader, obj) <= controlRange) {
      if (obj.controller === opponent(playerId)) score += 12;
      else if (obj.contested) score += 7;
    }
  }

  // Wounded targets
  const wounds = totalWoundsRemaining(target);
  if (wounds <= 2) score += 5;

  // Range bonus
  score += Math.max(0, 8 - dist);

  // Don't charge with a fragile ranged unit
  if (attacker.rangedWeapons?.length && !attacker.meleeWeapons?.length) {
    score -= 15;
  }

  // If we'd be charging a much stronger unit with our leader, be cautious
  if (target.currentSupplyValue >= attacker.currentSupplyValue * 2 && aliveModelCount(attacker) <= 2) {
    score -= 8;
  }

  return score;
}

function chooseBestRangedTarget(state, playerId, attacker, assessment) {
  const enemies = Object.values(state.units).filter(u => u.owner === opponent(playerId) && isOnBattlefield(u));
  let best = null;
  let bestScore = -Infinity;
  for (const target of enemies) {
    const s = scoreRangedTarget(state, playerId, attacker, target, assessment);
    if (s > bestScore) { bestScore = s; best = target; }
  }
  return best;
}

function chooseBestChargeTarget(state, playerId, attacker, assessment) {
  const enemies = Object.values(state.units).filter(u => u.owner === opponent(playerId) && isOnBattlefield(u));
  let best = null;
  let bestScore = -Infinity;
  for (const target of enemies) {
    const s = scoreChargeTarget(state, playerId, attacker, target, assessment);
    if (s > bestScore) { bestScore = s; best = target; }
  }
  return bestScore > 0 ? best : null; // Only charge if score is positive
}

/* ══════════════════════════════════════════════════════════════
   CARD PLAY — Use tactical cards on the best targets
   ══════════════════════════════════════════════════════════════ */

function chooseBestCardPlay(state, playerId, assessment) {
  const actions = getLegalActionsForPlayer(state, playerId);
  const cardActions = actions.filter(a => a.type === "PLAY_CARD" && a.enabled);
  if (!cardActions.length) return null;

  let bestCard = null;
  let bestScore = -1;

  for (const action of cardActions) {
    const card = getTacticalCard(action.cardId);
    let score = 5; // base value of playing a card

    // Movement speed cards — play on unit farthest from objectives
    if (card.effect?.modifiers?.some(m => m.key === "unit.speed")) {
      if (!action.targetUnitId) continue;
      const unit = state.units[action.targetUnitId];
      if (!unit || !isOnBattlefield(unit)) continue;
      const pt = leaderPoint(unit);
      if (!pt) continue;

      // Best on units that need to move far
      const nearestObjDist = Math.min(...assessment.objectiveDetails.map(o => distance(pt, o)));
      score += Math.min(15, nearestObjDist);

      // Extra value on high-supply units
      score += unit.currentSupplyValue * 1.5;

      // Speed boost value
      const speedBoost = card.effect.modifiers.find(m => m.key === "unit.speed")?.value ?? 0;
      score += speedBoost * 3;
    }

    // Attack bonus cards — play on units with queued combat or about to attack
    if (card.effect?.modifiers?.some(m => m.key === "weapon.hitTarget" || m.key === "weapon.attacksPerModel")) {
      if (!action.targetUnitId) continue;
      const unit = state.units[action.targetUnitId];
      if (!unit || !isOnBattlefield(unit)) continue;

      // Prefer units with more models alive (more attacks)
      score += aliveModelCount(unit) * 2;
      score += unit.currentSupplyValue * 2;

      // Extra if unit has queued combat
      const hasQueued = state.combatQueue.some(e => e.attackerId === action.targetUnitId);
      if (hasQueued) score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCard = action;
    }
  }

  if (!bestCard) return null;
  return {
    type: "PLAY_CARD",
    payload: {
      playerId,
      cardInstanceId: bestCard.cardInstanceId,
      targetUnitId: bestCard.targetUnitId ?? null
    }
  };
}

/* ══════════════════════════════════════════════════════════════
   PHASE ACTION BUILDERS
   ══════════════════════════════════════════════════════════════ */

function buildMovePath(unit, dest) {
  const leader = unit.models[unit.leadingModelId];
  return [{ x: leader.x, y: leader.y }, { x: dest.x, y: dest.y }];
}

function tryBuildDeployAction(state, playerId, unitId, assessment) {
  const unit = state.units[unitId];
  const legalPoints = getLegalDeployDestinations(state, playerId, unitId, unit.leadingModelId);
  const chosen = chooseBestDestination(legalPoints, state, playerId, unit, assessment);
  if (!chosen) return null;
  return {
    type: "DEPLOY_UNIT",
    payload: {
      playerId, unitId,
      leadingModelId: unit.leadingModelId,
      entryPoint: chosen.entryPoint,
      path: [chosen.entryPoint, { x: chosen.x, y: chosen.y }],
      modelPlacements: autoArrangeModels(state, unitId, chosen)
    }
  };
}

function tryBuildMoveAction(state, playerId, unitId, assessment) {
  const unit = state.units[unitId];
  const legalPoints = getLegalMoveDestinations(state, playerId, unitId, unit.leadingModelId);
  const chosen = chooseBestDestination(legalPoints, state, playerId, unit, assessment);
  if (!chosen) return null;
  return {
    type: "MOVE_UNIT",
    payload: {
      playerId, unitId,
      leadingModelId: unit.leadingModelId,
      path: buildMovePath(unit, chosen),
      modelPlacements: autoArrangeModels(state, unit.id, chosen)
    }
  };
}

function tryBuildDisengageAction(state, playerId, unitId, assessment) {
  const unit = state.units[unitId];
  const legalPoints = getLegalDisengageDestinations(state, playerId, unitId, unit.leadingModelId);
  // When disengaging, pick the best strategic destination (not just "farthest from enemy")
  const chosen = chooseBestDestination(legalPoints, state, playerId, unit, assessment);
  if (!chosen) return null;
  return {
    type: "DISENGAGE_UNIT",
    payload: {
      playerId, unitId,
      leadingModelId: unit.leadingModelId,
      path: buildMovePath(unit, chosen),
      modelPlacements: autoArrangeModels(state, unit.id, chosen)
    }
  };
}

function tryBuildRunAction(state, playerId, unitId, assessment) {
  const unit = state.units[unitId];
  const legalPoints = getLegalRunDestinations(state, playerId, unitId, unit.leadingModelId);
  const chosen = chooseBestDestination(legalPoints, state, playerId, unit, assessment);
  if (!chosen) return null;
  return {
    type: "RUN_UNIT",
    payload: {
      playerId, unitId,
      leadingModelId: unit.leadingModelId,
      path: buildMovePath(unit, chosen),
      modelPlacements: autoArrangeModels(state, unit.id, chosen)
    }
  };
}

/* ══════════════════════════════════════════════════════════════
   UNIT PRIORITY ORDERING
   ══════════════════════════════════════════════════════════════ */

function prioritizeUnits(state, playerId, unitIds, assessment) {
  return [...unitIds].sort((aId, bId) => {
    const a = state.units[aId];
    const b = state.units[bId];
    const aPt = leaderPoint(a);
    const bPt = leaderPoint(b);

    // Deploy reserves first (they're in reserves, no position yet)
    if (a.status.location === "reserves" && b.status.location !== "reserves") return -1;
    if (b.status.location === "reserves" && a.status.location !== "reserves") return 1;

    // Higher supply units act first — they matter more
    if (a.currentSupplyValue !== b.currentSupplyValue) {
      return b.currentSupplyValue - a.currentSupplyValue;
    }

    // Units closer to unclaimed objectives should move first
    if (aPt && bPt) {
      const aMinObjDist = Math.min(...assessment.objectiveDetails
        .filter(o => o.controller !== playerId)
        .map(o => distance(aPt, o)).concat([999]));
      const bMinObjDist = Math.min(...assessment.objectiveDetails
        .filter(o => o.controller !== playerId)
        .map(o => distance(bPt, o)).concat([999]));
      return aMinObjDist - bMinObjDist;
    }

    return 0;
  });
}

/* ══════════════════════════════════════════════════════════════
   PHASE DECISION FUNCTIONS
   ══════════════════════════════════════════════════════════════ */

function chooseMovementAction(state, playerId, assessment) {
  // Try playing a card first (speed boosts are movement phase)
  const cardAction = chooseBestCardPlay(state, playerId, assessment);
  if (cardAction) return cardAction;

  const actions = getLegalActionsForPlayer(state, playerId);

  // Deploy reserves
  const deployUnitIds = actions
    .filter(a => a.type === "DEPLOY_UNIT" && a.enabled)
    .map(a => a.unitId);
  const orderedDeploys = prioritizeUnits(state, playerId, deployUnitIds, assessment);
  for (const unitId of orderedDeploys) {
    const action = tryBuildDeployAction(state, playerId, unitId, assessment);
    if (action) return action;
  }

  // Battlefield units
  const battleUnits = Object.values(state.units).filter(
    u => u.owner === playerId && isOnBattlefield(u) && !u.status.movementActivated
  );
  const orderedUnits = prioritizeUnits(state, playerId, battleUnits.map(u => u.id), assessment);

  for (const unitId of orderedUnits) {
    const unit = state.units[unitId];

    // Engaged units: disengage if ranged unit or if defensive strategy
    if (unit.status.engaged) {
      const isRanged = unit.rangedWeapons?.length && !unit.meleeWeapons?.length;
      const shouldDisengage = isRanged || assessment.strategy === "defensive" ||
        (aliveModelCount(unit) <= 1 && unit.currentSupplyValue >= 2);
      if (shouldDisengage) {
        const action = tryBuildDisengageAction(state, playerId, unitId, assessment);
        if (action) return action;
      }
      // Melee units stay engaged — hold
      return { type: "HOLD_UNIT", payload: { playerId, unitId } };
    }

    // Move toward best strategic position
    const action = tryBuildMoveAction(state, playerId, unitId, assessment);
    if (action) return action;

    return { type: "HOLD_UNIT", payload: { playerId, unitId } };
  }

  return { type: "PASS_PHASE", payload: { playerId } };
}

function chooseAssaultAction(state, playerId, assessment) {
  // Try playing attack-buff cards first
  const cardAction = chooseBestCardPlay(state, playerId, assessment);
  if (cardAction) return cardAction;

  const actions = getLegalActionsForPlayer(state, playerId);

  // Ranged attacks — prioritize by target quality
  const rangedUnitIds = actions
    .filter(a => a.type === "DECLARE_RANGED_ATTACK" && a.enabled)
    .map(a => a.unitId);

  // Score each ranged unit by best available target
  const rangedWithScores = rangedUnitIds.map(unitId => {
    const attacker = state.units[unitId];
    const target = chooseBestRangedTarget(state, playerId, attacker, assessment);
    const score = target ? scoreRangedTarget(state, playerId, attacker, target, assessment) : -Infinity;
    return { unitId, target, score };
  }).filter(r => r.target).sort((a, b) => b.score - a.score);

  if (rangedWithScores.length) {
    const best = rangedWithScores[0];
    return {
      type: "DECLARE_RANGED_ATTACK",
      payload: { playerId, unitId: best.unitId, targetId: best.target.id }
    };
  }

  // Charge attacks — only if worthwhile
  const chargeUnitIds = actions
    .filter(a => a.type === "DECLARE_CHARGE" && a.enabled)
    .map(a => a.unitId);

  const chargeWithScores = chargeUnitIds.map(unitId => {
    const attacker = state.units[unitId];
    const target = chooseBestChargeTarget(state, playerId, attacker, assessment);
    const score = target ? scoreChargeTarget(state, playerId, attacker, target, assessment) : -Infinity;
    return { unitId, target, score };
  }).filter(r => r.target).sort((a, b) => b.score - a.score);

  if (chargeWithScores.length) {
    const best = chargeWithScores[0];
    return {
      type: "DECLARE_CHARGE",
      payload: { playerId, unitId: best.unitId, targetId: best.target.id }
    };
  }

  // Run remaining units toward objectives
  const unactivated = Object.values(state.units).filter(
    u => u.owner === playerId && isOnBattlefield(u) && !u.status.assaultActivated
  );
  const orderedRun = prioritizeUnits(state, playerId, unactivated.map(u => u.id), assessment);

  for (const unitId of orderedRun) {
    const unit = state.units[unitId];
    if (unit.status.engaged) {
      return { type: "HOLD_UNIT", payload: { playerId, unitId } };
    }
    // Run toward objectives if not in a fight
    const runAction = tryBuildRunAction(state, playerId, unitId, assessment);
    if (runAction) return runAction;
    return { type: "HOLD_UNIT", payload: { playerId, unitId } };
  }

  return { type: "PASS_PHASE", payload: { playerId } };
}

function chooseCombatAction(state, playerId, assessment) {
  // Resolve queued combat for our units
  const unitsWithCombat = Object.values(state.units).filter(u => {
    if (u.owner !== playerId || !isOnBattlefield(u) || u.status.combatActivated) return false;
    return state.combatQueue.some(e =>
      ["ranged_attack", "charge_attack", "overwatch_attack"].includes(e.type) && e.attackerId === u.id
    );
  });

  // Resolve highest-supply attackers first
  unitsWithCombat.sort((a, b) => b.currentSupplyValue - a.currentSupplyValue);

  if (unitsWithCombat.length) {
    return {
      type: "RESOLVE_COMBAT_UNIT",
      payload: { playerId, unitId: unitsWithCombat[0].id }
    };
  }

  // Hold remaining unactivated units
  const unactivated = Object.values(state.units).filter(
    u => u.owner === playerId && isOnBattlefield(u) && !u.status.combatActivated
  );
  if (unactivated.length) {
    return { type: "HOLD_UNIT", payload: { playerId, unitId: unactivated[0].id } };
  }

  return { type: "PASS_PHASE", payload: { playerId } };
}

/* ══════════════════════════════════════════════════════════════
   PUBLIC API
   ══════════════════════════════════════════════════════════════ */

export function chooseAction(state, playerId) {
  const assessment = assessGameState(state, playerId);

  if (state.phase === "movement") return chooseMovementAction(state, playerId, assessment);
  if (state.phase === "assault") return chooseAssaultAction(state, playerId, assessment);
  if (state.phase === "combat") return chooseCombatAction(state, playerId, assessment);

  return { type: "PASS_PHASE", payload: { playerId } };
}

export async function performBotTurn(store, playerId) {
  const action = chooseAction(store.getState(), playerId);
  return store.dispatch(action);
}
