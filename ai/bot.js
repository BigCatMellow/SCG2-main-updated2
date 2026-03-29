import {
  getLegalActionsForPlayer,
  getLegalDeployDestinations,
  getLegalMoveDestinations,
  getLegalDisengageDestinations,
  getLegalRunDestinations,
  getLegalBlinkDestinations,
  getLegalPsionicTransferDestinations
} from "../engine/legal_actions.js";
import { autoArrangeModels } from "../engine/coherency.js";
import { distance } from "../engine/geometry.js";
import { getObjectiveControlSnapshot, getObjectiveControlRange } from "../engine/objectives.js";
import { getTacticalCard } from "../data/tactical_cards.js";
import { validateUseMedpack, validateUseOpticalFlare } from "../engine/support.js";
import { validatePlaceCreep } from "../engine/creep.js";
import { validatePlaceForceField } from "../engine/force_fields.js";
import { validateOmegaTransfer } from "../engine/omega_worms.js";

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

function stableHash(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicNoise(seedParts) {
  const seed = seedParts.join("|");
  const hash = stableHash(seed);
  return (hash % 1000) / 1000;
}

function compareById(a, b) {
  const aId = a?.id ?? "";
  const bId = b?.id ?? "";
  return aId.localeCompare(bId);
}

function hasAbility(unit, ability) {
  return !!unit?.abilities?.includes?.(ability);
}

function unitRole(unit) {
  const hasRanged = !!unit.rangedWeapons?.length;
  const hasMelee = !!unit.meleeWeapons?.length;
  if (hasAbility(unit, "guardian_shield") || hasAbility(unit, "life_support") || hasAbility(unit, "stabilize_wounds") ||
      hasAbility(unit, "transfusion") || hasAbility(unit, "detection") || hasAbility(unit, "power_field_source")) {
    return "support";
  }
  if (hasRanged && !hasMelee) return "ranged";
  if (hasMelee && !hasRanged) return "melee";
  if (hasMelee && hasRanged) return "hybrid";
  return "general";
}

function getEnemyUnits(state, playerId) {
  return Object.values(state.units).filter(unit => unit.owner === opponent(playerId) && isOnBattlefield(unit));
}

function getFriendlyUnits(state, playerId) {
  return Object.values(state.units).filter(unit => unit.owner === playerId && isOnBattlefield(unit));
}

function woundsMissing(unit) {
  const maxWounds = unit.modelIds.length * (unit.woundsPerModel ?? 1);
  return Math.max(0, maxWounds - totalWoundsRemaining(unit));
}

function getMaxRangedReach(unit) {
  return Math.max(0, ...(unit.rangedWeapons ?? []).map(weapon => weapon.rangeInches ?? 0));
}

function getEnemyThreatScore(state, playerId, unit, assessment) {
  const point = leaderPoint(unit);
  if (!point) return 0;
  const rangedReach = getMaxRangedReach(unit);
  let score = unit.currentSupplyValue * 2;
  if (rangedReach > 0) score += rangedReach * 0.5 + aliveModelCount(unit) * 2;
  if (unit.meleeWeapons?.length) score += 3;
  for (const obj of assessment.objectiveDetails) {
    const dist = distance(point, obj);
    if (dist <= getObjectiveControlRange(state)) {
      if (obj.controller === opponent(playerId)) score += 8;
      else if (obj.contested) score += 5;
    }
  }
  return score;
}

function getForwardProgress(state, playerId, point) {
  if (!point) return 0;
  const side = state.deployment?.entryEdges?.[playerId]?.side;
  if (side === "west") return point.x;
  if (side === "east") return state.board.widthInches - point.x;
  if (side === "north") return point.y;
  if (side === "south") return state.board.heightInches - point.y;
  return 0;
}

function isNearHomeEdge(state, playerId, point, extra = 2) {
  if (!point) return false;
  const depth = (state.deployment?.zoneOfInfluenceDepth ?? 6) + extra;
  const side = state.deployment?.entryEdges?.[playerId]?.side;
  if (side === "west") return point.x <= depth;
  if (side === "east") return point.x >= state.board.widthInches - depth;
  if (side === "north") return point.y <= depth;
  if (side === "south") return point.y >= state.board.heightInches - depth;
  return false;
}

function countEnemiesNearPoint(state, playerId, point, radius) {
  return getEnemyUnits(state, playerId).filter(unit => {
    const unitPoint = leaderPoint(unit);
    return unitPoint && distance(point, unitPoint) <= radius;
  }).length;
}

function scoreHoldPosition(state, playerId, unit, assessment) {
  const point = leaderPoint(unit);
  if (!point) return -Infinity;
  let score = scoreDestination(state, playerId, unit, point, assessment);
  const role = unitRole(unit);
  const onOwnedObjective = assessment.objectiveDetails.some(
    obj => obj.controller === playerId && distance(point, obj) <= getObjectiveControlRange(state)
  );
  if (onOwnedObjective) {
    score += assessment.behavior.prefersDefense ? 10 : 4;
    if (role === "ranged" || role === "support") score += 6;
  }
  if (unit.status.stationary) score += 1.5;
  if (!assessment.behavior.prefersDefense && isNearHomeEdge(state, playerId, point) && countEnemiesNearPoint(state, playerId, point, 8) === 0) {
    score -= 14;
  }
  return score;
}

function chooseBestValidatedPoint(state, playerId, unitId, unit, assessment, validator, seedTag, band = 2.5, bonus = 0) {
  const candidates = [];
  for (let x = 0.5; x < state.board.widthInches; x += 1) {
    for (let y = 0.5; y < state.board.heightInches; y += 1) {
      const point = { x, y };
      const validation = validator(point);
      if (!validation.ok) continue;
      candidates.push({
        item: point,
        score: scoreDestination(state, playerId, unit, point, assessment) + bonus
      });
    }
  }
  const choice = chooseScoredOption(candidates, band, [state.round, state.phase, playerId, unitId, seedTag]);
  return choice?.item ?? null;
}

function chooseScoredOption(options, band, seedParts) {
  if (!options.length) return null;
  const sorted = [...options].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return compareById(a.item, b.item);
  });
  const bestScore = sorted[0].score;
  const candidates = sorted.filter(option => option.score >= bestScore - band);
  const pickIndex = Math.min(
    candidates.length - 1,
    Math.floor(deterministicNoise(seedParts) * candidates.length)
  );
  return candidates[pickIndex];
}

function deriveBehaviorProfile(state, playerId, assessment) {
  const pressureGap = assessment.theirObjectives - assessment.myObjectives;
  const lateGame = assessment.roundsLeft <= 1;
  const battlefieldGap = assessment.supplyAdvantage;

  let profile = "balanced_pressure";
  if (assessment.strategy === "defensive" && (lateGame || pressureGap <= 0)) {
    profile = "preserve_lead";
  } else if (assessment.strategy === "desperate_aggro" || pressureGap >= 1) {
    profile = "objective_pressure";
  } else if (battlefieldGap >= 3 || assessment.contested > 0) {
    profile = "pick_off_wounded";
  }

  return {
    profile,
    prefersDefense: profile === "preserve_lead",
    prefersPressure: profile === "objective_pressure",
    prefersKills: profile === "pick_off_wounded"
  };
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
    supplyAdvantage: mySupply - theirSupply,
    behavior: deriveBehaviorProfile(state, playerId, {
      vpDiff,
      roundsLeft,
      strategy,
      myObjectives,
      theirObjectives,
      contested,
      uncontrolled,
      objectiveDetails,
      snapshot,
      mySupply,
      theirSupply,
      supplyAdvantage: mySupply - theirSupply
    }),
    strategicObjectives: objectiveDetails
      .filter(obj => obj.controller !== playerId)
      .sort((a, b) => a.id.localeCompare(b.id))
  };
}

/* ══════════════════════════════════════════════════════════════
   OBJECTIVE SCORING - Where should a unit want to be?
   ══════════════════════════════════════════════════════════════ */

function scoreDestination(state, playerId, unit, point, assessment) {
  const controlRange = getObjectiveControlRange(state);
  let score = 0;
  const role = unitRole(unit);
  const favoredObjective = assessment.strategicObjectives.length
    ? assessment.strategicObjectives[
      stableHash(`${unit.id}|${state.round}|${state.phase}`) % assessment.strategicObjectives.length
    ]
    : null;

  // Objective proximity — the core driver
  for (const obj of assessment.objectiveDetails) {
    const dist = distance(point, obj);
    if (dist <= controlRange) {
      // On the objective
      if (obj.controller === playerId) {
        // Already ours — moderate value (defend)
        score += assessment.strategy === "defensive" ? 18 : 8;
        if (assessment.behavior.prefersDefense) score += 8;
      } else if (obj.controller === opponent(playerId)) {
        // Flip it — high value
        score += assessment.strategy === "desperate_aggro" ? 30 : 20;
        if (assessment.behavior.prefersPressure) score += 8;
      } else if (obj.contested) {
        // Break the tie
        score += 22;
        if (assessment.behavior.prefersPressure) score += 4;
      } else {
        // Unclaimed — grab it
        score += 25;
        if (assessment.behavior.prefersPressure) score += 5;
      }
    } else if (dist <= controlRange + 4) {
      // Near an objective — partial credit
      const nearScore = Math.max(0, (controlRange + 4 - dist) * 3);
      score += nearScore;
    }

    if (favoredObjective?.id === obj.id && dist <= controlRange + 6) {
      score += Math.max(0, 6 - Math.max(0, dist - controlRange));
    }
  }

  // Enemy proximity scoring
  const enemies = Object.values(state.units).filter(u => u.owner === opponent(playerId) && isOnBattlefield(u));
  for (const enemy of enemies) {
    const ep = leaderPoint(enemy);
    if (!ep) continue;
    const dist = distance(point, ep);

    // Ranged units want to stay at weapon range, not in melee
    if (role === "ranged") {
      const maxRange = Math.max(...unit.rangedWeapons.map(w => w.rangeInches ?? 0));
      if (maxRange > 0) {
        // Sweet spot: 60-90% of max range
        const idealDist = maxRange * 0.75;
        const rangePenalty = Math.abs(dist - idealDist) * 0.5;
        score -= rangePenalty;
        if (dist <= 1.5) score -= 10; // danger close penalty for ranged units
      }
    } else if (role === "melee" || role === "hybrid") {
      // Melee units want to close distance (but this is handled by charge/move toward)
      if (assessment.strategy !== "defensive") {
        score += Math.max(0, 6 - dist) * 0.5;
      }
    }
  }

  const friendlies = Object.values(state.units).filter(
    other => other.owner === playerId && other.id !== unit.id && isOnBattlefield(other)
  );
  for (const friendly of friendlies) {
    const fp = leaderPoint(friendly);
    if (!fp) continue;
    const dist = distance(point, fp);
    if (role === "support") {
      score += Math.max(0, 5 - Math.abs(dist - 3.5)) * 1.2;
    } else if (role === "ranged") {
      score += Math.max(0, 4 - Math.abs(dist - 4.5)) * 0.4;
    } else if (role === "melee") {
      score += Math.max(0, 4 - Math.abs(dist - 2.5)) * 0.6;
    }
  }

  const currentPoint = leaderPoint(unit);
  if (currentPoint) {
    const movementDelta = distance(currentPoint, point);
    const forwardDelta = getForwardProgress(state, playerId, point) - getForwardProgress(state, playerId, currentPoint);
    if (assessment.behavior.prefersDefense && movementDelta <= 2) score += 2.5;
    if (assessment.behavior.prefersPressure && movementDelta >= 3) score += 2;
    if (!assessment.behavior.prefersDefense) {
      score += Math.max(0, forwardDelta) * (assessment.behavior.prefersPressure ? 1.6 : 0.9);
    }
  }

  if (!assessment.behavior.prefersDefense) {
    score += getForwardProgress(state, playerId, point) * 0.2;
    if (isNearHomeEdge(state, playerId, point) && state.round <= 2) score -= 8;
  }

  // Slight penalty for being at the edges (less tactical value)
  const edgeDist = Math.min(point.x, point.y, state.board.widthInches - point.x, state.board.heightInches - point.y);
  if (edgeDist < 2) score -= 3;

  score += deterministicNoise([state.round, state.phase, playerId, unit.id, point.x, point.y]) * 1.5;

  return score;
}

function chooseBestDestination(points, state, playerId, unit, assessment) {
  if (!points.length) return null;
  const choice = chooseScoredOption(
    points.map(point => ({
      item: point,
      score: scoreDestination(state, playerId, unit, point, assessment)
    })),
    2.5,
    [state.round, state.phase, playerId, unit.id, "destination"]
  );
  return choice?.item ?? null;
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
  if (assessment.behavior.prefersKills) {
    score += (total - alive) * 3;
    if (alive <= 2) score += 5;
  }

  // High-supply targets are valuable
  score += target.currentSupplyValue * 3;

  // Objective pressure — target units on objectives
  const controlRange = getObjectiveControlRange(state);
  for (const obj of assessment.objectiveDetails) {
    if (distance(tLeader, obj) <= controlRange) {
      if (obj.controller === opponent(playerId)) score += assessment.behavior.prefersPressure ? 16 : 10; // kill their obj holder
      else if (obj.contested) score += assessment.behavior.prefersPressure ? 10 : 6;
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
  if (assessment.behavior.prefersKills) {
    score += (total - alive) * 2;
    if (alive <= 2) score += 4;
  }

  // Supply value
  score += target.currentSupplyValue * 2;

  // Objective presence
  const controlRange = getObjectiveControlRange(state);
  for (const obj of assessment.objectiveDetails) {
    if (distance(tLeader, obj) <= controlRange) {
      if (obj.controller === opponent(playerId)) score += assessment.behavior.prefersPressure ? 18 : 12;
      else if (obj.contested) score += assessment.behavior.prefersPressure ? 11 : 7;
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
  const choice = chooseScoredOption(
    enemies.map(target => ({
      item: target,
      score: scoreRangedTarget(state, playerId, attacker, target, assessment)
    })).filter(option => Number.isFinite(option.score)),
    3,
    [state.round, state.phase, playerId, attacker.id, "ranged-target"]
  );
  return choice?.item ?? null;
}

function chooseBestChargeTarget(state, playerId, attacker, assessment) {
  const enemies = Object.values(state.units).filter(u => u.owner === opponent(playerId) && isOnBattlefield(u));
  const choice = chooseScoredOption(
    enemies.map(target => ({
      item: target,
      score: scoreChargeTarget(state, playerId, attacker, target, assessment)
    })).filter(option => Number.isFinite(option.score)),
    2.5,
    [state.round, state.phase, playerId, attacker.id, "charge-target"]
  );
  return choice && choice.score > 0 ? choice.item : null; // Only charge if score is positive
}

/* ══════════════════════════════════════════════════════════════
   CARD PLAY — Use tactical cards on the best targets
   ══════════════════════════════════════════════════════════════ */

function chooseBestCardPlay(state, playerId, assessment) {
  const actions = getLegalActionsForPlayer(state, playerId);
  const cardActions = actions.filter(a => a.type === "PLAY_CARD" && a.enabled);
  if (!cardActions.length) return null;

  const scoredCards = [];

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

    score += deterministicNoise([state.round, state.phase, playerId, action.cardId, action.targetUnitId ?? ""]) * 1.2;
    scoredCards.push({ item: action, score });
  }

  const bestCard = chooseScoredOption(scoredCards, 2, [state.round, state.phase, playerId, "card-play"])?.item;
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

function tryBuildBlinkAction(state, playerId, unitId, assessment) {
  const unit = state.units[unitId];
  const legalPoints = getLegalBlinkDestinations(state, playerId, unitId);
  const chosen = chooseBestDestination(legalPoints, state, playerId, unit, assessment);
  if (!chosen) return null;
  return {
    action: {
      type: "BLINK_UNIT",
      payload: {
        playerId,
        unitId,
        point: chosen,
        modelPlacements: autoArrangeModels(state, unitId, chosen)
      }
    },
    score: scoreDestination(state, playerId, unit, chosen, assessment) + 5
  };
}

function tryBuildPsionicTransferAction(state, playerId, unitId, assessment) {
  const unit = state.units[unitId];
  const legalPoints = getLegalPsionicTransferDestinations(state, playerId, unitId);
  const chosen = chooseBestDestination(legalPoints, state, playerId, unit, assessment);
  if (!chosen) return null;
  return {
    action: {
      type: "PSIONIC_TRANSFER_UNIT",
      payload: {
        playerId,
        unitId,
        point: chosen,
        modelPlacements: autoArrangeModels(state, unitId, chosen)
      }
    },
    score: scoreDestination(state, playerId, unit, chosen, assessment) + 4
  };
}

function tryBuildPlaceCreepAction(state, playerId, unitId, assessment) {
  const unit = state.units[unitId];
  const chosen = chooseBestValidatedPoint(
    state,
    playerId,
    unitId,
    unit,
    assessment,
    point => validatePlaceCreep(state, playerId, unitId, point),
    "place-creep",
    2,
    4
  );
  if (!chosen) return null;
  const strategicCoverage = assessment.objectiveDetails.some(
    obj => obj.controller !== playerId && distance(chosen, obj) <= getObjectiveControlRange(state) + 4
  ) ? 4 : 0;
  return {
    action: {
      type: "PLACE_CREEP",
      payload: { playerId, unitId, point: chosen }
    },
    score: scoreDestination(state, playerId, unit, chosen, assessment) + 8 + strategicCoverage
  };
}

function tryBuildForceFieldAction(state, playerId, unitId, assessment) {
  const unit = state.units[unitId];
  const chosen = chooseBestValidatedPoint(
    state,
    playerId,
    unitId,
    unit,
    assessment,
    point => validatePlaceForceField(state, playerId, unitId, point),
    "force-field",
    2,
    3
  );
  if (!chosen) return null;
  const enemyPressure = getEnemyUnits(state, playerId).filter(enemy => {
    const point = leaderPoint(enemy);
    return point && distance(point, chosen) <= 5;
  }).length;
  return {
    action: {
      type: "PLACE_FORCE_FIELD",
      payload: { playerId, unitId, point: chosen }
    },
    score: scoreDestination(state, playerId, unit, chosen, assessment) + enemyPressure * 4 + 6
  };
}

function tryBuildOmegaTransferAction(state, playerId, unitId, assessment) {
  const unit = state.units[unitId];
  const chosen = chooseBestValidatedPoint(
    state,
    playerId,
    unitId,
    unit,
    assessment,
    point => validateOmegaTransfer(state, playerId, unitId, point),
    "omega-transfer",
    2.5,
    5
  );
  if (!chosen) return null;
  return {
    action: {
      type: "OMEGA_TRANSFER",
      payload: {
        playerId,
        unitId,
        point: chosen,
        modelPlacements: autoArrangeModels(state, unitId, chosen)
      }
    },
    score: scoreDestination(state, playerId, unit, chosen, assessment) + 9
  };
}

function chooseBestMedpackAction(state, playerId, unitId, assessment) {
  const medic = state.units[unitId];
  const friendlies = getFriendlyUnits(state, playerId).filter(unit => unit.id !== unitId);
  const options = friendlies.map(target => {
    const validation = validateUseMedpack(state, playerId, unitId, target.id);
    if (!validation.ok) return null;
    let score = woundsMissing(target) * 7 + target.currentSupplyValue * 2;
    if (target.status.engaged) score += 4;
    if (assessment.behavior.prefersDefense) {
      const targetPoint = leaderPoint(target);
      if (targetPoint && assessment.objectiveDetails.some(
        obj => obj.controller === playerId && distance(targetPoint, obj) <= getObjectiveControlRange(state)
      )) {
        score += 5;
      }
    }
    return {
      item: target,
      score
    };
  }).filter(Boolean);
  const choice = chooseScoredOption(options, 2, [state.round, state.phase, playerId, unitId, "medpack"]);
  if (!choice || choice.score <= 0) return null;
  return {
    action: {
      type: "USE_MEDPACK",
      payload: { playerId, unitId, targetId: choice.item.id }
    },
    score: choice.score
  };
}

function chooseBestOpticalFlareAction(state, playerId, unitId, assessment) {
  const enemies = getEnemyUnits(state, playerId);
  const options = enemies.map(target => {
    const validation = validateUseOpticalFlare(state, playerId, unitId, target.id);
    if (!validation.ok) return null;
    let score = getEnemyThreatScore(state, playerId, target, assessment);
    if (getMaxRangedReach(target) > 0) score += 8;
    if (assessment.behavior.prefersDefense) score += 3;
    return { item: target, score };
  }).filter(Boolean);
  const choice = chooseScoredOption(options, 3, [state.round, state.phase, playerId, unitId, "optical-flare"]);
  if (!choice || choice.score <= 0) return null;
  return {
    action: {
      type: "USE_OPTICAL_FLARE",
      payload: { playerId, unitId, targetId: choice.item.id }
    },
    score: choice.score
  };
}

function chooseGuardianShieldAction(state, playerId, unitId, assessment) {
  const unit = state.units[unitId];
  const point = leaderPoint(unit);
  if (!point) return null;
  const nearbyFriendlies = getFriendlyUnits(state, playerId).filter(other => {
    const otherPoint = leaderPoint(other);
    return other.id !== unitId && otherPoint && distance(point, otherPoint) <= 4 + 1e-6;
  });
  let threatened = 0;
  for (const friendly of nearbyFriendlies) {
    const friendlyPoint = leaderPoint(friendly);
    if (!friendlyPoint) continue;
    if (getEnemyUnits(state, playerId).some(enemy => {
      const enemyPoint = leaderPoint(enemy);
      return enemyPoint && distance(enemyPoint, friendlyPoint) <= getMaxRangedReach(enemy) + 2;
    })) {
      threatened += 1;
    }
  }
  const score = nearbyFriendlies.length * 10 + threatened * 18 + (threatened > 0 ? 10 : 0) + (assessment.behavior.prefersDefense ? 6 : 0);
  if (score <= 0) return null;
  return {
    action: {
      type: "ACTIVATE_GUARDIAN_SHIELD",
      payload: { playerId, unitId }
    },
    score
  };
}

function chooseStimpackAction(state, playerId, unitId, assessment) {
  const unit = state.units[unitId];
  const point = leaderPoint(unit);
  if (!point) return null;
  const missing = woundsMissing(unit);
  const currentWounds = totalWoundsRemaining(unit);
  if (missing >= currentWounds - 1) return null;
  const nearbyEnemy = getEnemyUnits(state, playerId).some(enemy => {
    const enemyPoint = leaderPoint(enemy);
    return enemyPoint && distance(enemyPoint, point) <= 8;
  });
  const nearEnemyObjective = assessment.objectiveDetails.some(
    obj => obj.controller !== playerId && distance(point, obj) <= getObjectiveControlRange(state) + 4
  );
  const score = (nearbyEnemy ? 7 : 0) + (nearEnemyObjective ? 8 : 0) + unit.currentSupplyValue * 1.5;
  if (score <= 8) return null;
  return {
    action: {
      type: "ACTIVATE_STIMPACK",
      payload: { playerId, unitId }
    },
    score
  };
}

function chooseBurrowOrHideAction(state, playerId, unitId, assessment, actionsByType) {
  const unit = state.units[unitId];
  const point = leaderPoint(unit);
  if (!point) return null;
  if (actionsByType.has("TOGGLE_BURROW") && !unit.status.burrowed) {
    const score = (assessment.behavior.prefersDefense ? 6 : 2) + (woundsMissing(unit) > 0 ? 5 : 0);
    if (score > 6) {
      return {
        action: { type: "TOGGLE_BURROW", payload: { playerId, unitId } },
        score
      };
    }
  }
  if (actionsByType.has("TOGGLE_HIDDEN") && !unit.status.hidden) {
    const onOwnedObjective = assessment.objectiveDetails.some(
      obj => obj.controller === playerId && distance(point, obj) <= getObjectiveControlRange(state)
    );
    const score = (assessment.behavior.prefersDefense ? 4 : 0) + (onOwnedObjective ? 6 : 0);
    if (score > 5) {
      return {
        action: { type: "TOGGLE_HIDDEN", payload: { playerId, unitId } },
        score
      };
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════
   UNIT PRIORITY ORDERING
   ══════════════════════════════════════════════════════════════ */

function prioritizeUnits(state, playerId, unitIds, assessment) {
  const scored = [...unitIds].map(unitId => {
    const unit = state.units[unitId];
    const pt = leaderPoint(unit);
    let score = 0;

    if (unit.status.location === "reserves") score += 25;
    score += unit.currentSupplyValue * 6;

    if (pt) {
      const enemyObjectives = assessment.objectiveDetails.filter(o => o.controller !== playerId);
      const minObjDist = Math.min(...enemyObjectives.map(o => distance(pt, o)).concat([999]));
      score += Math.max(0, 12 - minObjDist);

      const nearestEnemyDist = Math.min(
        ...Object.values(state.units)
          .filter(other => other.owner === opponent(playerId) && isOnBattlefield(other))
          .map(other => {
            const otherPt = leaderPoint(other);
            return otherPt ? distance(pt, otherPt) : 999;
          })
          .concat([999])
      );

      const role = unitRole(unit);
      if (role === "melee") score += Math.max(0, 8 - nearestEnemyDist) * 0.8;
      if (role === "ranged") score += Math.max(0, nearestEnemyDist - 2) * 0.25;
      if (role === "support") score += Math.max(0, 6 - minObjDist) * 0.5;
    }

    score += deterministicNoise([state.round, state.phase, playerId, unitId, "activation-order"]) * 2.2;
    return { unitId, score };
  });

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.unitId.localeCompare(b.unitId);
    })
    .map(entry => entry.unitId);
}

/* ══════════════════════════════════════════════════════════════
   PHASE DECISION FUNCTIONS
   ══════════════════════════════════════════════════════════════ */

function chooseMovementAction(state, playerId, assessment) {
  // Try playing a card first (speed boosts are movement phase)
  const cardAction = chooseBestCardPlay(state, playerId, assessment);
  if (cardAction) return cardAction;

  const actions = getLegalActionsForPlayer(state, playerId);
  const candidates = [];
  const actionsByUnit = new Map();
  for (const action of actions.filter(entry => entry.enabled && entry.unitId)) {
    if (!actionsByUnit.has(action.unitId)) actionsByUnit.set(action.unitId, new Set());
    actionsByUnit.get(action.unitId).add(action.type);
  }

  const deployUnitIds = actions
    .filter(a => a.type === "DEPLOY_UNIT" && a.enabled)
    .map(a => a.unitId);
  const orderedDeploys = prioritizeUnits(state, playerId, deployUnitIds, assessment);
  for (const unitId of orderedDeploys) {
    const built = tryBuildDeployAction(state, playerId, unitId, assessment);
    if (!built) continue;
    const end = built.payload.path.at(-1);
    candidates.push({
      item: built,
      score: scoreDestination(state, playerId, state.units[unitId], end, assessment) + state.units[unitId].currentSupplyValue * 2 + 6
    });
  }

  const battleUnits = Object.values(state.units).filter(
    u => u.owner === playerId && isOnBattlefield(u) && !u.status.movementActivated
  );
  const orderedUnits = prioritizeUnits(state, playerId, battleUnits.map(u => u.id), assessment);

  for (const unitId of orderedUnits) {
    const unit = state.units[unitId];
    const role = unitRole(unit);
    const point = leaderPoint(unit);
    const legalTypes = actionsByUnit.get(unitId) ?? new Set();

    if (legalTypes.has("USE_MEDPACK")) {
      const medpack = chooseBestMedpackAction(state, playerId, unitId, assessment);
      if (medpack) candidates.push({ item: medpack.action, score: medpack.score });
    }
    if (legalTypes.has("USE_OPTICAL_FLARE")) {
      const flare = chooseBestOpticalFlareAction(state, playerId, unitId, assessment);
      if (flare) candidates.push({ item: flare.action, score: flare.score });
    }
    if (legalTypes.has("ACTIVATE_GUARDIAN_SHIELD")) {
      const shield = chooseGuardianShieldAction(state, playerId, unitId, assessment);
      if (shield) candidates.push({ item: shield.action, score: shield.score });
    }
    if (legalTypes.has("ACTIVATE_STIMPACK")) {
      const stim = chooseStimpackAction(state, playerId, unitId, assessment);
      if (stim) candidates.push({ item: stim.action, score: stim.score });
    }
    if (legalTypes.has("BLINK_UNIT")) {
      const blink = tryBuildBlinkAction(state, playerId, unitId, assessment);
      if (blink) candidates.push({ item: blink.action, score: blink.score });
    }
    if (legalTypes.has("PSIONIC_TRANSFER_UNIT")) {
      const transfer = tryBuildPsionicTransferAction(state, playerId, unitId, assessment);
      if (transfer) candidates.push({ item: transfer.action, score: transfer.score });
    }
    if (legalTypes.has("OMEGA_TRANSFER")) {
      const omegaTransfer = tryBuildOmegaTransferAction(state, playerId, unitId, assessment);
      if (omegaTransfer) candidates.push({ item: omegaTransfer.action, score: omegaTransfer.score });
    }
    if (legalTypes.has("OMEGA_RECALL")) {
      const recallScore = woundsMissing(unit) * 5 + (assessment.behavior.prefersDefense ? 5 : 0) + unit.currentSupplyValue;
      if (recallScore > 5) {
        candidates.push({
          item: { type: "OMEGA_RECALL", payload: { playerId, unitId } },
          score: recallScore
        });
      }
    }
    if (legalTypes.has("PLACE_CREEP")) {
      const creep = tryBuildPlaceCreepAction(state, playerId, unitId, assessment);
      if (creep) candidates.push({ item: creep.action, score: creep.score });
    }
    if (legalTypes.has("PLACE_FORCE_FIELD")) {
      const field = tryBuildForceFieldAction(state, playerId, unitId, assessment);
      if (field) candidates.push({ item: field.action, score: field.score });
    }
    const stealthAction = chooseBurrowOrHideAction(state, playerId, unitId, assessment, legalTypes);
    if (stealthAction) candidates.push({ item: stealthAction.action, score: stealthAction.score });

    if (unit.status.engaged) {
      const isRanged = role === "ranged" || role === "support";
      const shouldDisengage = isRanged || assessment.strategy === "defensive" ||
        (aliveModelCount(unit) <= 1 && unit.currentSupplyValue >= 2);
      if (shouldDisengage && legalTypes.has("DISENGAGE_UNIT")) {
        const disengage = tryBuildDisengageAction(state, playerId, unitId, assessment);
        if (disengage) {
          const end = disengage.payload.path.at(-1);
          candidates.push({
            item: disengage,
            score: scoreDestination(state, playerId, unit, end, assessment) + 7
          });
        }
      }
      candidates.push({
        item: { type: "HOLD_UNIT", payload: { playerId, unitId } },
        score: scoreHoldPosition(state, playerId, unit, assessment) + (role === "melee" ? 4 : 0)
      });
      continue;
    }

    if (legalTypes.has("MOVE_UNIT")) {
      const move = tryBuildMoveAction(state, playerId, unitId, assessment);
      if (move) {
        const end = move.payload.path.at(-1);
        candidates.push({
          item: move,
          score: scoreDestination(state, playerId, unit, end, assessment) + 2
        });
      }
    }

    if (point) {
      const onOwnedObjective = assessment.objectiveDetails.some(
        obj => obj.controller === playerId && distance(point, obj) <= getObjectiveControlRange(state)
      );
      const localEnemyPressure = countEnemiesNearPoint(state, playerId, point, 8);
      if ((onOwnedObjective && (assessment.behavior.prefersDefense || localEnemyPressure > 0)) ||
          (assessment.behavior.prefersDefense && localEnemyPressure > 0)) {
        candidates.push({
          item: { type: "HOLD_UNIT", payload: { playerId, unitId } },
          score: scoreHoldPosition(state, playerId, unit, assessment)
        });
      }
    }
  }

  const chosen = chooseScoredOption(candidates, 4, [state.round, state.phase, playerId, "movement-candidate-pick"]);
  if (chosen?.item) return chosen.item;

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
  }).filter(r => r.target);

  if (rangedWithScores.length) {
    const best = chooseScoredOption(
      rangedWithScores.map(entry => ({
        item: entry,
        score: entry.score + deterministicNoise([state.round, playerId, entry.unitId, entry.target.id, "ranged-action"])
      })),
      3,
      [state.round, state.phase, playerId, "ranged-action-pick"]
    )?.item;
    if (!best) return null;
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
  }).filter(r => r.target);

  if (chargeWithScores.length) {
    const best = chooseScoredOption(
      chargeWithScores.map(entry => ({
        item: entry,
        score: entry.score + deterministicNoise([state.round, playerId, entry.unitId, entry.target.id, "charge-action"])
      })),
      2.5,
      [state.round, state.phase, playerId, "charge-action-pick"]
    )?.item;
    if (!best) return null;
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
    const role = unitRole(unit);
    const point = leaderPoint(unit);
    if (unit.status.engaged) {
      return { type: "HOLD_UNIT", payload: { playerId, unitId } };
    }
    if (assessment.behavior.prefersDefense && point && (role === "ranged" || role === "support")) {
      const controlRange = getObjectiveControlRange(state);
      const coveringOwnedObjective = assessment.objectiveDetails.some(
        obj => obj.controller === playerId && distance(point, obj) <= controlRange + 1
      );
      if (coveringOwnedObjective) {
        return { type: "HOLD_UNIT", payload: { playerId, unitId } };
      }
    }
    // Run toward objectives if not in a fight
    const runAction = tryBuildRunAction(state, playerId, unitId, assessment);
    if (runAction) return runAction;
    return { type: "HOLD_UNIT", payload: { playerId, unitId } };
  }

  return { type: "PASS_PHASE", payload: { playerId } };
}

function chooseCombatAction(state, playerId, assessment) {
  const closeRanksUnits = Object.values(state.units).filter(unit =>
    unit.owner === playerId && isOnBattlefield(unit) && !unit.status.combatActivated && unit.status.burrowed && unit.status.engaged
  );
  if (closeRanksUnits.length) {
    const ordered = prioritizeUnits(state, playerId, closeRanksUnits.map(unit => unit.id), assessment);
    return {
      type: "CLOSE_RANKS",
      payload: { playerId, unitId: ordered[0] }
    };
  }

  // Resolve queued combat for our units
  const unitsWithCombat = Object.values(state.units).filter(u => {
    if (u.owner !== playerId || !isOnBattlefield(u) || u.status.combatActivated) return false;
    return state.combatQueue.some(e =>
      ["ranged_attack", "charge_attack", "overwatch_attack"].includes(e.type) && e.attackerId === u.id
    );
  });

  // Resolve highest-supply attackers first
  unitsWithCombat.sort((a, b) => {
    const aQueued = state.combatQueue.filter(e => e.attackerId === a.id).length;
    const bQueued = state.combatQueue.filter(e => e.attackerId === b.id).length;
    const aEnemy = state.combatQueue.find(e => e.attackerId === a.id)?.targetId
      ? state.units[state.combatQueue.find(e => e.attackerId === a.id).targetId]
      : null;
    const bEnemy = state.combatQueue.find(e => e.attackerId === b.id)?.targetId
      ? state.units[state.combatQueue.find(e => e.attackerId === b.id).targetId]
      : null;
    const aKillBias = assessment.behavior.prefersKills ? ((aEnemy?.currentSupplyValue ?? 0) * 2) : 0;
    const bKillBias = assessment.behavior.prefersKills ? ((bEnemy?.currentSupplyValue ?? 0) * 2) : 0;
    const aScore = a.currentSupplyValue * 4 + aQueued * 3 + aKillBias +
      deterministicNoise([state.round, state.phase, playerId, a.id, "combat-order"]) * 2;
    const bScore = b.currentSupplyValue * 4 + bQueued * 3 + bKillBias +
      deterministicNoise([state.round, state.phase, playerId, b.id, "combat-order"]) * 2;
    if (bScore !== aScore) return bScore - aScore;
    return a.id.localeCompare(b.id);
  });

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
    const ordered = prioritizeUnits(state, playerId, unactivated.map(u => u.id), assessment);
    return { type: "HOLD_UNIT", payload: { playerId, unitId: ordered[0] } };
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
