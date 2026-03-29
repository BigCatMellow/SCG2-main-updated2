(() => {
  // data/units.js
  var UNIT_DATA = {
    marine_squad: {
      id: "marine_squad",
      name: "Marines",
      tags: ["Ground", "Infantry", "Ranged"],
      speed: 6,
      size: 1,
      base: { shape: "circle", diameterMm: 25, radiusInches: 0.5 },
      startingModelCount: 6,
      woundsPerModel: 1,
      supplyProfile: [
        { minModels: 5, supply: 2 },
        { minModels: 3, supply: 1 },
        { minModels: 1, supply: 0 },
        { minModels: 0, supply: 0 }
      ]
    },
    dragoon: {
      id: "dragoon",
      name: "Dragoon",
      tags: ["Ground", "Mechanical", "Armoured"],
      speed: 5,
      size: 2,
      base: { shape: "circle", diameterMm: 50, radiusInches: 1 },
      startingModelCount: 1,
      woundsPerModel: 4,
      supplyProfile: [
        { minModels: 1, supply: 2 },
        { minModels: 0, supply: 0 }
      ]
    },
    zealot_squad: {
      id: "zealot_squad",
      name: "Zealots",
      tags: ["Ground", "Infantry", "Melee", "Psionic"],
      speed: 7,
      size: 1,
      base: { shape: "circle", diameterMm: 32, radiusInches: 0.6 },
      startingModelCount: 4,
      woundsPerModel: 2,
      supplyProfile: [
        { minModels: 3, supply: 2 },
        { minModels: 2, supply: 1 },
        { minModels: 1, supply: 0 },
        { minModels: 0, supply: 0 }
      ]
    },
    zergling_squad: {
      id: "zergling_squad",
      name: "Zerglings",
      tags: ["Ground", "Biological", "Swarm", "Light"],
      speed: 8,
      size: 1,
      base: { shape: "circle", diameterMm: 25, radiusInches: 0.45 },
      startingModelCount: 8,
      woundsPerModel: 1,
      supplyProfile: [
        { minModels: 6, supply: 2 },
        { minModels: 4, supply: 1 },
        { minModels: 1, supply: 0 },
        { minModels: 0, supply: 0 }
      ]
    }
  };
  function getUnitTemplate(templateId) {
    const template = UNIT_DATA[templateId];
    if (!template) throw new Error(`Unknown unit template: ${templateId}`);
    return template;
  }
  function computeCurrentSupplyValue(template, aliveModelCount) {
    const sorted = [...template.supplyProfile].sort((a, b) => b.minModels - a.minModels);
    for (const bracket of sorted) {
      if (aliveModelCount >= bracket.minModels) return bracket.supply;
    }
    return 0;
  }
  function createUnitStateFromTemplate(templateId, owner, unitId) {
    const template = getUnitTemplate(templateId);
    const models = {};
    const modelIds = [];
    for (let i = 0; i < template.startingModelCount; i += 1) {
      const id = `${unitId}_m${i + 1}`;
      modelIds.push(id);
      models[id] = {
        id,
        alive: true,
        x: null,
        y: null,
        elevation: "ground",
        woundsRemaining: template.woundsPerModel
      };
    }
    return {
      id: unitId,
      owner,
      templateId,
      name: template.name,
      leadingModelId: modelIds[0] ?? null,
      modelIds,
      models,
      tags: [...template.tags],
      speed: template.speed,
      size: template.size,
      base: { ...template.base },
      supplyProfile: [...template.supplyProfile],
      currentSupplyValue: computeCurrentSupplyValue(template, template.startingModelCount),
      status: {
        location: "reserves",
        movementActivated: false,
        engaged: false,
        outOfCoherency: false,
        stationary: false,
        cannotRangedAttackNextAssault: false,
        cannotChargeNextAssault: false
      },
      activationMarkers: []
    };
  }

  // data/missions.js
  var MISSION_DATA = {
    take_and_hold: {
      id: "take_and_hold",
      name: "Take and Hold",
      roundLimit: 5,
      startingSupply: 4,
      supplyEscalation: 2
    }
  };
  function getMission(missionId) {
    const mission = MISSION_DATA[missionId];
    if (!mission) throw new Error(`Unknown mission: ${missionId}`);
    return mission;
  }

  // data/deployments.js
  var DEPLOYMENT_DATA = {
    crossfire: {
      id: "crossfire",
      name: "Crossfire",
      boardWidthInches: 36,
      boardHeightInches: 36,
      entryEdges: {
        playerA: { side: "west" },
        playerB: { side: "east" }
      },
      zoneOfInfluenceDepth: 6,
      missionMarkers: [
        { id: "obj1", x: 18, y: 18 },
        { id: "obj2", x: 18, y: 10 },
        { id: "obj3", x: 18, y: 26 }
      ]
    }
  };
  function getDeployment(deploymentId) {
    const deployment = DEPLOYMENT_DATA[deploymentId];
    if (!deployment) throw new Error(`Unknown deployment: ${deploymentId}`);
    return deployment;
  }

  // engine/state.js
  function createTerrain() {
    return [
      { id: "t1", kind: "blocker", impassable: true, rect: { minX: 11, minY: 14, maxX: 15, maxY: 18 } },
      { id: "t2", kind: "blocker", impassable: true, rect: { minX: 21, minY: 18, maxX: 25, maxY: 22 } },
      { id: "t3", kind: "cover", impassable: false, rect: { minX: 15, minY: 7, maxX: 20, maxY: 11 } },
      { id: "t4", kind: "cover", impassable: false, rect: { minX: 16, minY: 24, maxX: 22, maxY: 28 } }
    ];
  }
  function createInitialGameState({ missionId, deploymentId, armyA, armyB, firstPlayerMarkerHolder = "playerA" }) {
    const mission = getMission(missionId);
    const deployment = getDeployment(deploymentId);
    const units = {};
    const reserveA = [];
    const reserveB = [];
    for (const entry of armyA) {
      const unit = createUnitStateFromTemplate(entry.templateId, "playerA", entry.id);
      units[unit.id] = unit;
      reserveA.push(unit.id);
    }
    for (const entry of armyB) {
      const unit = createUnitStateFromTemplate(entry.templateId, "playerB", entry.id);
      units[unit.id] = unit;
      reserveB.push(unit.id);
    }
    return {
      round: 1,
      phase: "movement",
      mission,
      deployment,
      board: {
        widthInches: deployment.boardWidthInches,
        heightInches: deployment.boardHeightInches,
        terrain: createTerrain()
      },
      players: {
        playerA: {
          vp: 0,
          reserveUnitIds: reserveA,
          battlefieldUnitIds: [],
          supplyPool: mission.startingSupply,
          availableSupply: mission.startingSupply,
          hasPassedThisPhase: false
        },
        playerB: {
          vp: 0,
          reserveUnitIds: reserveB,
          battlefieldUnitIds: [],
          supplyPool: mission.startingSupply,
          availableSupply: mission.startingSupply,
          hasPassedThisPhase: false
        }
      },
      units,
      firstPlayerMarkerHolder,
      activePlayer: firstPlayerMarkerHolder,
      log: [
        {
          type: "phase",
          text: `Round 1 begins. Movement Phase active. ${firstPlayerMarkerHolder === "playerA" ? "Blue" : "Red"} player has first activation.`,
          round: 1,
          phase: "movement"
        }
      ]
    };
  }
  function cloneState(state) {
    return structuredClone(state);
  }
  function appendLog(state, type, text) {
    state.log.push({ type, text, round: state.round, phase: state.phase });
  }

  // engine/supply.js
  function getSupplyPoolForRound(mission, round) {
    if (round >= mission.roundLimit) return Infinity;
    return mission.startingSupply + (round - 1) * mission.supplyEscalation;
  }
  function getPlayerTotalCurrentSupplyOnBattlefield(state, playerId) {
    return state.players[playerId].battlefieldUnitIds.reduce((total, unitId) => total + state.units[unitId].currentSupplyValue, 0);
  }
  function getAvailableSupply(state, playerId) {
    const pool = state.players[playerId].supplyPool;
    if (pool === Infinity) return Infinity;
    return Math.max(0, pool - getPlayerTotalCurrentSupplyOnBattlefield(state, playerId));
  }
  function refreshPlayerSupply(state, playerId) {
    state.players[playerId].supplyPool = getSupplyPoolForRound(state.mission, state.round);
    state.players[playerId].availableSupply = getAvailableSupply(state, playerId);
  }
  function refreshAllSupply(state) {
    refreshPlayerSupply(state, "playerA");
    refreshPlayerSupply(state, "playerB");
  }
  function validateDeploySupply(state, playerId, unitId) {
    const unit = state.units[unitId];
    const available = state.players[playerId].availableSupply;
    const current = unit.currentSupplyValue;
    if (available === Infinity || current <= available) {
      return { ok: true, currentSupplyValue: current, availableSupply: available };
    }
    return {
      ok: false,
      reason: `Unit needs ${current} supply but only ${available} is available.`,
      currentSupplyValue: current,
      availableSupply: available
    };
  }

  // engine/phases.js
  function runStartOfRoundHooks() {
    return [];
  }
  function beginGame(state) {
    refreshAllSupply(state);
    appendLog(state, "info", "All units begin in reserves. Deploy as supply allows.");
    return { ok: true, state, events: [] };
  }
  function beginRound(state) {
    state.phase = "movement";
    state.activePlayer = state.firstPlayerMarkerHolder;
    state.players.playerA.hasPassedThisPhase = false;
    state.players.playerB.hasPassedThisPhase = false;
    for (const unit of Object.values(state.units)) unit.status.movementActivated = false;
    refreshAllSupply(state);
    appendLog(state, "phase", `Round ${state.round} begins. Movement Phase active.`);
    return { ok: true, state, events: runStartOfRoundHooks(state) };
  }
  function endMovementPhase(state) {
    appendLog(state, "phase", "Movement Phase complete. Assault, Combat, and Cleanup are placeholders in this build, so the game advances to the next round.");
    if (state.round >= state.mission.roundLimit) {
      appendLog(state, "phase", "Final round reached. Start a new game to continue testing.");
      return { ok: true, state, events: [{ type: "game_final_round_reached", payload: {} }] };
    }
    state.round += 1;
    return beginRound(state);
  }
  function advanceToNextPhase(state) {
    if (state.phase === "movement") return endMovementPhase(state);
    return { ok: true, state, events: [] };
  }

  // engine/activation.js
  function isUnitEligibleForMovementActivation(state, unitId) {
    const unit = state.units[unitId];
    if (!unit) return false;
    if (state.phase !== "movement") return false;
    if (unit.owner !== state.activePlayer) return false;
    if (unit.status.movementActivated) return false;
    if (state.players[unit.owner].hasPassedThisPhase) return false;
    return unit.status.location === "battlefield" || unit.status.location === "reserves";
  }
  function getEligibleMovementUnits(state, playerId) {
    return Object.values(state.units).filter((unit) => unit.owner === playerId && !unit.status.movementActivated && !state.players[playerId].hasPassedThisPhase);
  }
  function markUnitActivatedForMovement(state, unitId) {
    const unit = state.units[unitId];
    unit.status.movementActivated = true;
    unit.activationMarkers = unit.activationMarkers.filter((marker) => marker.phase !== "movement");
    unit.activationMarkers.push({ phase: "movement", state: "activated" });
  }
  function canPlayerPass(state, playerId) {
    return state.phase === "movement" && state.activePlayer === playerId && !state.players[playerId].hasPassedThisPhase;
  }
  function getOpponent(playerId) {
    return playerId === "playerA" ? "playerB" : "playerA";
  }
  function endActivationAndPassTurn(state) {
    const opponent = getOpponent(state.activePlayer);
    if (!state.players[opponent].hasPassedThisPhase) {
      state.activePlayer = opponent;
    }
  }
  function passPhase(state, playerId) {
    if (!canPlayerPass(state, playerId)) {
      return { ok: false, code: "INVALID_PASS", message: "That player cannot pass right now." };
    }
    const player = state.players[playerId];
    player.hasPassedThisPhase = true;
    if (state.firstPlayerMarkerHolder !== playerId && !state.players[getOpponent(playerId)].hasPassedThisPhase) {
      state.firstPlayerMarkerHolder = playerId;
      appendLog(state, "info", `${playerId === "playerA" ? "Blue" : "Red"} player passes first and claims the First Player Marker for the next phase.`);
    } else {
      appendLog(state, "info", `${playerId === "playerA" ? "Blue" : "Red"} player passes.`);
    }
    for (const unitId of player.battlefieldUnitIds) {
      if (!state.units[unitId].status.movementActivated) markUnitActivatedForMovement(state, unitId);
    }
    const opponentId = getOpponent(playerId);
    if (state.players[opponentId].hasPassedThisPhase) {
      return advanceToNextPhase(state);
    }
    state.activePlayer = opponentId;
    return { ok: true, state, events: [{ type: "player_passed", payload: { playerId } }] };
  }

  // engine/geometry.js
  function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  function pathLength(path = []) {
    if (!path || path.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < path.length; i += 1) total += distance(path[i - 1], path[i]);
    return total;
  }
  function pointInBoard(point, board, radius = 0) {
    return point.x - radius >= 0 && point.y - radius >= 0 && point.x + radius <= board.widthInches && point.y + radius <= board.heightInches;
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function nearestPointOnRect(point, rect) {
    return {
      x: clamp(point.x, rect.minX, rect.maxX),
      y: clamp(point.y, rect.minY, rect.maxY)
    };
  }
  function circleOverlapsCircle(aCenter, aRadius, bCenter, bRadius) {
    return distance(aCenter, bCenter) < aRadius + bRadius - 1e-6;
  }
  function circleOverlapsRect(center, radius, rect) {
    const nearest = nearestPointOnRect(center, rect);
    return distance(center, nearest) < radius - 1e-6;
  }
  function circleOverlapsTerrain(center, radius, terrainList = []) {
    return terrainList.some((terrain) => {
      if (!terrain.impassable) return false;
      return circleOverlapsRect(center, radius, terrain.rect);
    });
  }
  function sampleSegment(segmentStart, segmentEnd, step = 0.2) {
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
  function pathBlockedForCircle(path, radius, state, ignoreModelIds = /* @__PURE__ */ new Set(), options = {}) {
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
          for (const model of Object.values(unit.models)) {
            if (!model.alive || model.x == null || model.y == null || ignoreModelIds.has(model.id)) continue;
            if (circleOverlapsCircle(sample, radius, { x: model.x, y: model.y }, unit.base.radiusInches)) return true;
          }
        }
      }
    }
    return false;
  }
  function pointOnEntryEdge(deployment, playerId, point, tolerance = 0.15) {
    const side = deployment.entryEdges[playerId]?.side;
    if (!side) return false;
    if (side === "west") return Math.abs(point.x - 0) <= tolerance && point.y >= 0 && point.y <= deployment.boardHeightInches;
    if (side === "east") return Math.abs(point.x - deployment.boardWidthInches) <= tolerance && point.y >= 0 && point.y <= deployment.boardHeightInches;
    if (side === "north") return Math.abs(point.y - 0) <= tolerance && point.x >= 0 && point.x <= deployment.boardWidthInches;
    if (side === "south") return Math.abs(point.y - deployment.boardHeightInches) <= tolerance && point.x >= 0 && point.x <= deployment.boardWidthInches;
    return false;
  }
  function pointInsideEnemyZoneOfInfluence(state, playerId, point, radius = 0) {
    const enemyId = playerId === "playerA" ? "playerB" : "playerA";
    const enemyEdge = state.deployment.entryEdges[enemyId]?.side;
    const depth = state.deployment.zoneOfInfluenceDepth;
    if (enemyEdge === "west") return point.x - radius < depth;
    if (enemyEdge === "east") return point.x + radius > state.board.widthInches - depth;
    if (enemyEdge === "north") return point.y - radius < depth;
    if (enemyEdge === "south") return point.y + radius > state.board.heightInches - depth;
    return false;
  }
  function makeCirclePlacementRing(center, count, baseRadius, maxRadius = 2.8) {
    if (count <= 0) return [];
    const placements = [];
    const spacing = Math.max(baseRadius * 2.2, 0.9);
    const rings = [Math.min(1.25, maxRadius), Math.min(2, maxRadius), Math.min(2.8, maxRadius)];
    let generated = 0;
    for (const ringRadius of rings) {
      const circumference = Math.max(1, Math.floor(Math.PI * 2 * ringRadius / spacing));
      for (let i = 0; i < circumference && generated < count; i += 1) {
        const angle = Math.PI * 2 * i / circumference;
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

  // engine/coherency.js
  var COHERENCY_DISTANCE = 3;
  var ENGAGEMENT_RANGE = 1;
  function isModelWhollyWithinLeadingModelRadius(leadingModel, otherModel, maxDistance, baseRadius) {
    return distance(leadingModel, otherModel) + baseRadius <= maxDistance + 1e-6;
  }
  function canTraceCoherencyLink(unit, modelId) {
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
  function validateCoherency(unit) {
    const leader = unit.models[unit.leadingModelId];
    if (!leader || leader.x == null || leader.y == null) {
      return { inCoherency: false, outOfCoherencyModelIds: unit.modelIds.filter((id) => id !== unit.leadingModelId), removedModelIds: [] };
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
  function autoArrangeModels(state, unitId, leaderPoint) {
    const unit = state.units[unitId];
    const aliveFollowers = unit.modelIds.filter((id) => id !== unit.leadingModelId && unit.models[id].alive);
    const placements = makeCirclePlacementRing(leaderPoint, aliveFollowers.length, unit.base.radiusInches, 2.8);
    return aliveFollowers.map((modelId, index) => ({ modelId, x: placements[index]?.x ?? leaderPoint.x, y: placements[index]?.y ?? leaderPoint.y }));
  }
  function applyModelPlacementsAndResolveCoherency(state, unitId, placements) {
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
        x: leader.x + directionX / len * Math.min(2.7, COHERENCY_DISTANCE - unit.base.radiusInches),
        y: leader.y + directionY / len * Math.min(2.7, COHERENCY_DISTANCE - unit.base.radiusInches)
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

  // engine/movement.js
  var ENGAGEMENT_RANGE2 = 1;
  function getModel(unit, modelId) {
    if (!unit.models[modelId]) throw new Error(`Unknown model ${modelId} in unit ${unit.id}`);
    return unit.models[modelId];
  }
  function updateUnitEngagementStatus(state) {
    for (const unit of Object.values(state.units)) {
      unit.status.engaged = false;
    }
    const battlefieldUnits = Object.values(state.units).filter((unit) => unit.status.location === "battlefield" && unit.tags.includes("Ground"));
    for (let i = 0; i < battlefieldUnits.length; i += 1) {
      for (let j = i + 1; j < battlefieldUnits.length; j += 1) {
        const a = battlefieldUnits[i];
        const b = battlefieldUnits[j];
        if (a.owner === b.owner) continue;
        let engaged = false;
        for (const aModel of Object.values(a.models)) {
          if (!aModel.alive || aModel.x == null || aModel.y == null) continue;
          for (const bModel of Object.values(b.models)) {
            if (!bModel.alive || bModel.x == null || bModel.y == null) continue;
            const edgeDistance = distance(aModel, bModel) - a.base.radiusInches - b.base.radiusInches;
            if (edgeDistance <= ENGAGEMENT_RANGE2 + 1e-6) {
              engaged = true;
              break;
            }
          }
          if (engaged) break;
        }
        if (engaged) {
          a.status.engaged = true;
          b.status.engaged = true;
        }
      }
    }
  }
  function validateShared(state, playerId, unitId) {
    const unit = state.units[unitId];
    if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
    if (!isUnitEligibleForMovementActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
    if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
    return { ok: true, unit };
  }
  function overlappingModelsAtPoint(state, unit, point, ignoreModelIds = /* @__PURE__ */ new Set()) {
    for (const otherUnit of Object.values(state.units)) {
      for (const otherModel of Object.values(otherUnit.models)) {
        if (!otherModel.alive || otherModel.x == null || otherModel.y == null || ignoreModelIds.has(otherModel.id)) continue;
        if (circleOverlapsCircle(point, unit.base.radiusInches, { x: otherModel.x, y: otherModel.y }, otherUnit.base.radiusInches)) return otherModel.id;
      }
    }
    return null;
  }
  function pointWithinEnemyGroundEngagement(state, unit, point) {
    for (const otherUnit of Object.values(state.units)) {
      if (otherUnit.owner === unit.owner || !otherUnit.tags.includes("Ground")) continue;
      for (const otherModel of Object.values(otherUnit.models)) {
        if (!otherModel.alive || otherModel.x == null || otherModel.y == null) continue;
        const edgeDistance = distance(point, otherModel) - unit.base.radiusInches - otherUnit.base.radiusInches;
        if (edgeDistance < ENGAGEMENT_RANGE2 - 1e-6) return true;
      }
    }
    return false;
  }
  function getEngagedEnemyUnits(state, unit) {
    const enemies = /* @__PURE__ */ new Set();
    for (const otherUnit of Object.values(state.units)) {
      if (otherUnit.owner === unit.owner) continue;
      let engaged = false;
      for (const model of Object.values(unit.models)) {
        if (!model.alive || model.x == null || model.y == null) continue;
        for (const otherModel of Object.values(otherUnit.models)) {
          if (!otherModel.alive || otherModel.x == null || otherModel.y == null) continue;
          const edgeDistance = distance(model, otherModel) - unit.base.radiusInches - otherUnit.base.radiusInches;
          if (edgeDistance <= ENGAGEMENT_RANGE2 + 1e-6) {
            engaged = true;
            break;
          }
        }
        if (engaged) break;
      }
      if (engaged) enemies.add(otherUnit.id);
    }
    return [...enemies].map((id) => state.units[id]);
  }
  function finalPointFromPath(path) {
    return path[path.length - 1];
  }
  function validateHold(state, playerId, unitId) {
    const shared = validateShared(state, playerId, unitId);
    if (!shared.ok) return shared;
    if (shared.unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Only battlefield units can Hold." };
    return { ok: true };
  }
  function resolveHold(state, playerId, unitId) {
    const validation = validateHold(state, playerId, unitId);
    if (!validation.ok) return validation;
    const unit = state.units[unitId];
    unit.status.stationary = true;
    markUnitActivatedForMovement(state, unitId);
    appendLog(state, "action", `${unit.name} holds position.`);
    endActivationAndPassTurn(state);
    return { ok: true, state, events: [{ type: "unit_held", payload: { unitId } }] };
  }
  function validateMove(state, playerId, unitId, leadingModelId, path, modelPlacements = null) {
    const shared = validateShared(state, playerId, unitId);
    if (!shared.ok) return shared;
    const unit = shared.unit;
    if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Unit is not on the battlefield." };
    if (unit.status.engaged) return { ok: false, code: "UNIT_ENGAGED", message: "Engaged units cannot make a normal Move." };
    if (!path || path.length < 2) return { ok: false, code: "NO_PATH", message: "Move requires a path." };
    const leader = getModel(unit, leadingModelId);
    if (leader.x == null || leader.y == null) return { ok: false, code: "INVALID_LEADER", message: "Leading model must be on the battlefield." };
    const start = path[0];
    if (Math.abs(start.x - leader.x) > 0.01 || Math.abs(start.y - leader.y) > 0.01) return { ok: false, code: "BAD_PATH_START", message: "Path must begin at the leader's current position." };
    if (pathLength(path) - unit.speed > 1e-6) return { ok: false, code: "TOO_FAR", message: `${unit.name} can only move ${unit.speed}".` };
    const ignore = new Set(unit.modelIds);
    if (pathBlockedForCircle(path, unit.base.radiusInches, state, ignore)) return { ok: false, code: "PATH_BLOCKED", message: "Path crosses blocked ground, terrain, or bases." };
    const end = finalPointFromPath(path);
    if (!pointInBoard(end, state.board, unit.base.radiusInches)) return { ok: false, code: "OFF_BOARD", message: "Leading model must end fully on the battlefield." };
    if (circleOverlapsTerrain(end, unit.base.radiusInches, state.board.terrain)) return { ok: false, code: "TERRAIN_OVERLAP", message: "Leading model cannot end overlapping impassable terrain." };
    if (overlappingModelsAtPoint(state, unit, end, ignore)) return { ok: false, code: "BASE_OVERLAP", message: "Leading model would overlap another base." };
    if (pointWithinEnemyGroundEngagement(state, unit, end)) return { ok: false, code: "ENDS_ENGAGED", message: 'Normal Move cannot end within 1" of an enemy ground unit.' };
    const placements = modelPlacements ?? autoArrangeModels(state, unitId, end);
    return { ok: true, derived: { placements, end } };
  }
  function resolveMove(state, playerId, unitId, leadingModelId, path, modelPlacements = null) {
    const validation = validateMove(state, playerId, unitId, leadingModelId, path, modelPlacements);
    if (!validation.ok) return validation;
    const unit = state.units[unitId];
    unit.leadingModelId = leadingModelId;
    const leader = unit.models[leadingModelId];
    leader.x = validation.derived.end.x;
    leader.y = validation.derived.end.y;
    const coherency = applyModelPlacementsAndResolveCoherency(state, unitId, validation.derived.placements);
    unit.status.stationary = false;
    markUnitActivatedForMovement(state, unitId);
    updateUnitEngagementStatus(state);
    refreshAllSupply(state);
    const removedText = coherency.removedModelIds.length ? ` ${coherency.removedModelIds.length} model(s) could not be set and were removed.` : "";
    const coherencyText = coherency.outOfCoherency ? " Unit is out of coherency." : "";
    appendLog(state, "action", `${unit.name} moves ${pathLength(path).toFixed(1)}".${removedText}${coherencyText}`);
    endActivationAndPassTurn(state);
    return { ok: true, state, events: [{ type: "unit_moved", payload: { unitId } }] };
  }
  function validateDisengage(state, playerId, unitId, leadingModelId, path, modelPlacements = null) {
    const shared = validateShared(state, playerId, unitId);
    if (!shared.ok) return shared;
    const unit = shared.unit;
    if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Unit is not on the battlefield." };
    if (!unit.status.engaged) return { ok: false, code: "NOT_ENGAGED", message: "Only engaged units can Disengage." };
    if (!path || path.length < 2) return { ok: false, code: "NO_PATH", message: "Disengage requires a path." };
    const leader = getModel(unit, leadingModelId);
    if (leader.x == null || leader.y == null) return { ok: false, code: "INVALID_LEADER", message: "Leading model must be on the battlefield." };
    if (pathLength(path) - unit.speed > 1e-6) return { ok: false, code: "TOO_FAR", message: `${unit.name} can only move ${unit.speed}".` };
    const ignore = new Set(unit.modelIds);
    if (pathBlockedForCircle(path, unit.base.radiusInches, state, ignore)) return { ok: false, code: "PATH_BLOCKED", message: "Path crosses blocked ground, terrain, or bases." };
    const end = finalPointFromPath(path);
    if (!pointInBoard(end, state.board, unit.base.radiusInches)) return { ok: false, code: "OFF_BOARD", message: "Leading model must end fully on the battlefield." };
    const placements = modelPlacements ?? autoArrangeModels(state, unitId, end);
    const engagedEnemies = getEngagedEnemyUnits(state, unit);
    const enemySupplyTotal = engagedEnemies.reduce((total, enemy) => total + enemy.currentSupplyValue, 0);
    const tacticalMass = unit.currentSupplyValue > enemySupplyTotal;
    return { ok: true, derived: { end, placements, tacticalMass, engagedEnemies } };
  }
  function resolveDisengage(state, playerId, unitId, leadingModelId, path, modelPlacements = null) {
    const validation = validateDisengage(state, playerId, unitId, leadingModelId, path, modelPlacements);
    if (!validation.ok) return validation;
    const unit = state.units[unitId];
    unit.leadingModelId = leadingModelId;
    const leader = unit.models[leadingModelId];
    leader.x = validation.derived.end.x;
    leader.y = validation.derived.end.y;
    const coherency = applyModelPlacementsAndResolveCoherency(state, unitId, validation.derived.placements);
    updateUnitEngagementStatus(state);
    const stillEngaged = pointWithinEnemyGroundEngagement(state, unit, { x: leader.x, y: leader.y });
    if (stillEngaged) {
      leader.alive = false;
      leader.x = null;
      leader.y = null;
      appendLog(state, "action", `${unit.name} failed to break clear; the leading model was removed during Disengage.`);
    }
    for (const modelId of unit.modelIds) {
      if (modelId === leadingModelId) continue;
      const model = unit.models[modelId];
      if (!model.alive || model.x == null || model.y == null) continue;
      if (pointWithinEnemyGroundEngagement(state, unit, { x: model.x, y: model.y })) {
        model.alive = false;
        model.x = null;
        model.y = null;
        appendLog(state, "info", `${unit.name} loses a model that could not clear engagement during Disengage.`);
      }
    }
    if (!validation.derived.tacticalMass) {
      unit.status.cannotRangedAttackNextAssault = true;
      unit.status.cannotChargeNextAssault = true;
    } else {
      unit.status.cannotRangedAttackNextAssault = false;
      unit.status.cannotChargeNextAssault = false;
    }
    unit.status.stationary = false;
    markUnitActivatedForMovement(state, unitId);
    updateUnitEngagementStatus(state);
    refreshAllSupply(state);
    appendLog(state, "action", `${unit.name} disengages.${validation.derived.tacticalMass ? " Tactical Mass ignores the next-Assault penalty." : " It cannot Ranged Attack or Charge in the next Assault Phase."}${coherency.outOfCoherency ? " Unit is out of coherency." : ""}`);
    endActivationAndPassTurn(state);
    return { ok: true, state, events: [{ type: "unit_disengaged", payload: { unitId } }] };
  }
  function refreshEngagement(state) {
    updateUnitEngagementStatus(state);
  }

  // engine/reserves.js
  function moveUnitToBattlefield(state, unitId) {
    const unit = state.units[unitId];
    if (!unit || unit.status.location === "battlefield") return;
    const player = state.players[unit.owner];
    player.reserveUnitIds = player.reserveUnitIds.filter((id) => id !== unitId);
    if (!player.battlefieldUnitIds.includes(unitId)) player.battlefieldUnitIds.push(unitId);
    unit.status.location = "battlefield";
  }

  // engine/deployment.js
  function validateShared2(state, playerId, unitId) {
    const unit = state.units[unitId];
    if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
    if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
    if (!isUnitEligibleForMovementActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
    if (unit.status.location !== "reserves") return { ok: false, code: "NOT_IN_RESERVES", message: "Only reserve units can Deploy." };
    return { ok: true, unit };
  }
  function overlapsAnyModel(state, unit, point, ignoreIds = /* @__PURE__ */ new Set()) {
    for (const otherUnit of Object.values(state.units)) {
      for (const model of Object.values(otherUnit.models)) {
        if (!model.alive || model.x == null || model.y == null || ignoreIds.has(model.id)) continue;
        if (circleOverlapsCircle(point, unit.base.radiusInches, { x: model.x, y: model.y }, otherUnit.base.radiusInches)) return true;
      }
    }
    return false;
  }
  function validateDeploy(state, playerId, unitId, leadingModelId, entryPoint, path, modelPlacements = null) {
    const shared = validateShared2(state, playerId, unitId);
    if (!shared.ok) return shared;
    const unit = shared.unit;
    const supplyValidation = validateDeploySupply(state, playerId, unitId);
    if (!supplyValidation.ok) return { ok: false, code: "SUPPLY_BLOCKED", message: supplyValidation.reason };
    if (!pointOnEntryEdge(state.deployment, playerId, entryPoint)) return { ok: false, code: "BAD_ENTRY_EDGE", message: "Entry point must be on your entry edge." };
    if (!path || path.length < 2) return { ok: false, code: "NO_PATH", message: "Deploy requires a path." };
    const start = path[0];
    if (Math.abs(start.x - entryPoint.x) > 0.01 || Math.abs(start.y - entryPoint.y) > 0.01) return { ok: false, code: "PATH_ENTRY_MISMATCH", message: "Path must start at the chosen entry point." };
    if (pathLength(path) - unit.speed > 1e-6) return { ok: false, code: "TOO_FAR", message: `${unit.name} can only deploy ${unit.speed}" from the edge.` };
    const side = state.deployment.entryEdges[playerId].side;
    const adjustedStart = { ...entryPoint };
    if (side === "west") adjustedStart.x = unit.base.radiusInches;
    if (side === "east") adjustedStart.x = state.board.widthInches - unit.base.radiusInches;
    if (side === "north") adjustedStart.y = unit.base.radiusInches;
    if (side === "south") adjustedStart.y = state.board.heightInches - unit.base.radiusInches;
    const collisionPath = [adjustedStart, ...path.slice(1)];
    if (pathBlockedForCircle(collisionPath, unit.base.radiusInches, state, new Set(unit.modelIds))) return { ok: false, code: "PATH_BLOCKED", message: "Path crosses blocked ground, terrain, or bases." };
    const end = path[path.length - 1];
    if (!pointInBoard(end, state.board, unit.base.radiusInches)) return { ok: false, code: "OFF_BOARD", message: "Leading model must end fully on the battlefield." };
    if (circleOverlapsTerrain(end, unit.base.radiusInches, state.board.terrain)) return { ok: false, code: "TERRAIN_OVERLAP", message: "Leading model cannot end overlapping impassable terrain." };
    if (overlapsAnyModel(state, unit, end)) return { ok: false, code: "BASE_OVERLAP", message: "Leading model would overlap an existing base." };
    if (pointInsideEnemyZoneOfInfluence(state, playerId, end, unit.base.radiusInches)) return { ok: false, code: "ZONE_OF_INFLUENCE", message: "Deploy cannot end inside the opponent's zone of influence." };
    const placements = modelPlacements ?? autoArrangeModels(state, unitId, end);
    return { ok: true, derived: { end, placements } };
  }
  function resolveDeploy(state, playerId, unitId, leadingModelId, entryPoint, path, modelPlacements = null) {
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
    refreshEngagement(state);
    refreshAllSupply(state);
    appendLog(state, "action", `${unit.name} deploys from reserves.${coherency.outOfCoherency ? " Unit is out of coherency." : ""}`);
    endActivationAndPassTurn(state);
    return { ok: true, state, events: [{ type: "unit_deployed", payload: { unitId } }] };
  }

  // engine/reducer.js
  function dispatch(state, action) {
    const working = cloneState(state);
    switch (action.type) {
      case "PASS_PHASE":
        return passPhase(working, action.payload.playerId);
      case "HOLD_UNIT":
        return resolveHold(working, action.payload.playerId, action.payload.unitId);
      case "MOVE_UNIT":
        return resolveMove(working, action.payload.playerId, action.payload.unitId, action.payload.leadingModelId, action.payload.path, action.payload.modelPlacements);
      case "DISENGAGE_UNIT":
        return resolveDisengage(working, action.payload.playerId, action.payload.unitId, action.payload.leadingModelId, action.payload.path, action.payload.modelPlacements);
      case "DEPLOY_UNIT":
        return resolveDeploy(working, action.payload.playerId, action.payload.unitId, action.payload.leadingModelId, action.payload.entryPoint, action.payload.path, action.payload.modelPlacements);
      default:
        return { ok: false, code: "UNKNOWN_ACTION", message: `Unknown action type: ${action.type}` };
    }
  }

  // ui/input.js
  function bindInputHandlers(store2, controller2) {
    document.getElementById("newGameBtn").addEventListener("click", controller2.onNewGame);
    document.getElementById("passBtn").addEventListener("click", controller2.onPass);
  }
  function beginMoveInteraction(state, uiState2, unitId) {
    const unit = state.units[unitId];
    const leader = unit.models[unit.leadingModelId];
    uiState2.mode = "move";
    uiState2.previewPath = { path: [{ x: leader.x, y: leader.y }, { x: leader.x, y: leader.y }] };
    uiState2.previewUnit = { unitId, leader: { x: leader.x, y: leader.y }, placements: autoArrangeModels(state, unitId, leader) };
  }
  function beginDeployInteraction(state, uiState2, unitId) {
    uiState2.mode = "deploy";
    uiState2.previewPath = null;
    uiState2.previewUnit = null;
  }
  function beginDisengageInteraction(state, uiState2, unitId) {
    const unit = state.units[unitId];
    const leader = unit.models[unit.leadingModelId];
    uiState2.mode = "disengage";
    uiState2.previewPath = { path: [{ x: leader.x, y: leader.y }, { x: leader.x, y: leader.y }] };
    uiState2.previewUnit = { unitId, leader: { x: leader.x, y: leader.y }, placements: autoArrangeModels(state, unitId, leader) };
  }
  function cancelCurrentInteraction(uiState2) {
    uiState2.mode = null;
    uiState2.previewPath = null;
    uiState2.previewUnit = null;
  }

  // ui/panels.js
  function formatPlayerName(playerId) {
    return playerId === "playerA" ? "Blue" : "Red";
  }
  function formatSupply(pool) {
    return pool === Infinity ? "\u221E" : String(pool);
  }
  function buildUnitCard(unit, selectedUnitId, onClick) {
    const div = document.createElement("div");
    div.className = `unit-card ${selectedUnitId === unit.id ? "selected" : ""}`;
    div.addEventListener("click", () => onClick(unit.id));
    div.innerHTML = `
    <div class="unit-card-row">
      <span class="unit-name">${unit.name}</span>
      <span class="phase-chip">Supply ${unit.currentSupplyValue}</span>
    </div>
    <div class="badge-row">
      <span class="badge ${unit.owner}">${formatPlayerName(unit.owner)}</span>
      <span class="badge">Speed ${unit.speed}</span>
      <span class="badge">Models ${unit.modelIds.filter((id) => unit.models[id].alive).length}</span>
      ${unit.status.engaged ? '<span class="badge warn">Engaged</span>' : ""}
      ${unit.status.outOfCoherency ? '<span class="badge warn">Out of Coherency</span>' : ""}
      ${unit.status.movementActivated ? '<span class="badge good">Activated</span>' : ""}
    </div>
  `;
    return div;
  }
  function renderTopPanel(state) {
    const battleState = document.getElementById("battleState");
    const playerSupply = `${getPlayerSupply(state, "playerA")} / ${formatSupply(state.players.playerA.supplyPool)}`;
    const enemySupply = `${getPlayerSupply(state, "playerB")} / ${formatSupply(state.players.playerB.supplyPool)}`;
    battleState.innerHTML = `
    <div class="label">Round</div><div class="value">${state.round} / ${state.mission.roundLimit}</div>
    <div class="label">Phase</div><div class="value">${titleCase(state.phase)}</div>
    <div class="label">Active Player</div><div class="value">${formatPlayerName(state.activePlayer)}</div>
    <div class="label">First Player Marker</div><div class="value">${formatPlayerName(state.firstPlayerMarkerHolder)}</div>
    <div class="label">Mission</div><div class="value">${state.mission.name}</div>
    <div class="label">Deployment</div><div class="value">${state.deployment.name}</div>
  `;
    document.getElementById("playerSupplyText").textContent = playerSupply;
    document.getElementById("enemySupplyText").textContent = enemySupply;
    document.getElementById("playerSupplyFill").style.width = `${fillPercent(state, "playerA")}%`;
    document.getElementById("enemySupplyFill").style.width = `${fillPercent(state, "playerB")}%`;
    const turnBanner = document.getElementById("turnBanner");
    turnBanner.textContent = `${formatPlayerName(state.activePlayer)} Player Active`;
    turnBanner.className = `turn-banner ${state.activePlayer}`;
  }
  function getPlayerSupply(state, playerId) {
    return state.players[playerId].battlefieldUnitIds.reduce((total, unitId) => total + state.units[unitId].currentSupplyValue, 0);
  }
  function fillPercent(state, playerId) {
    const pool = state.players[playerId].supplyPool;
    if (pool === Infinity) return 100;
    if (pool <= 0) return 0;
    return Math.min(100, getPlayerSupply(state, playerId) / pool * 100);
  }
  function titleCase(value) {
    return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
  function renderUnitList(containerId, units, state, uiState2, onClick) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    if (!units.length) {
      container.innerHTML = '<div class="empty-state">None.</div>';
      return;
    }
    units.forEach((unit) => container.appendChild(buildUnitCard(unit, uiState2.selectedUnitId, onClick)));
  }
  function renderReserveTray(state, uiState2, onSelect) {
    renderUnitList("playerReserves", state.players.playerA.reserveUnitIds.map((id) => state.units[id]), state, uiState2, onSelect);
    renderUnitList("enemyReserves", state.players.playerB.reserveUnitIds.map((id) => state.units[id]), state, uiState2, onSelect);
    renderUnitList("playerBattlefield", state.players.playerA.battlefieldUnitIds.map((id) => state.units[id]), state, uiState2, onSelect);
    renderUnitList("enemyBattlefield", state.players.playerB.battlefieldUnitIds.map((id) => state.units[id]), state, uiState2, onSelect);
  }
  function renderSelectedUnit(state, uiState2) {
    const panel = document.getElementById("selectedUnitPanel");
    const unit = uiState2.selectedUnitId ? state.units[uiState2.selectedUnitId] : null;
    if (!unit) {
      panel.innerHTML = '<div class="empty-state">No unit selected.</div>';
      return;
    }
    const alive = unit.modelIds.filter((id) => unit.models[id].alive).length;
    panel.innerHTML = `
    <div class="selected-panel-title">${unit.name}</div>
    <div class="badge-row">
      <span class="badge ${unit.owner}">${formatPlayerName(unit.owner)}</span>
      <span class="badge">${unit.status.location}</span>
      ${unit.status.engaged ? '<span class="badge warn">Engaged</span>' : ""}
      ${unit.status.outOfCoherency ? '<span class="badge warn">Out of Coherency</span>' : ""}
    </div>
    <div class="selected-stats">
      <div class="selected-stat"><div class="k">Speed</div><div class="v">${unit.speed}</div></div>
      <div class="selected-stat"><div class="k">Supply</div><div class="v">${unit.currentSupplyValue}</div></div>
      <div class="selected-stat"><div class="k">Models Alive</div><div class="v">${alive}</div></div>
      <div class="selected-stat"><div class="k">Leading Model</div><div class="v">${unit.leadingModelId.replace(`${unit.id}_`, "")}</div></div>
    </div>
  `;
  }
  function renderActionButtons(buttons) {
    const container = document.getElementById("actionButtons");
    container.innerHTML = "";
    if (!buttons.length) {
      container.innerHTML = '<div class="empty-state">No actions available.</div>';
      return;
    }
    buttons.forEach((button) => container.appendChild(button));
  }
  function renderLog(state) {
    const panel = document.getElementById("logPanel");
    panel.innerHTML = "";
    state.log.forEach((entry) => {
      const div = document.createElement("div");
      div.className = "log-entry";
      div.innerHTML = `<div class="meta">Round ${entry.round} \u2022 ${titleCase(entry.phase)} \u2022 ${entry.type}</div><div>${entry.text}</div>`;
      panel.appendChild(div);
    });
  }

  // ui/board.js
  var SVG_NS = "http://www.w3.org/2000/svg";
  function createSvgElement(name, attrs = {}) {
    const el = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }
  function boardToSvgClass(playerId) {
    return playerId === "playerA" ? "playerA" : "playerB";
  }
  function addGrid(svg, width, height) {
    for (let x = 0; x <= width; x += 1) {
      svg.appendChild(createSvgElement("line", { x1: x, y1: 0, x2: x, y2: height, class: x === width / 2 ? "board-centerline" : "board-grid-line" }));
    }
    for (let y = 0; y <= height; y += 1) {
      svg.appendChild(createSvgElement("line", { x1: 0, y1: y, x2: width, y2: y, class: y === height / 2 ? "board-centerline" : "board-grid-line" }));
    }
  }
  function addZones(svg, state) {
    const depth = state.deployment.zoneOfInfluenceDepth;
    const left = createSvgElement("rect", { x: 0, y: 0, width: depth, height: state.board.heightInches, class: "edge-zone playerA" });
    const right = createSvgElement("rect", { x: state.board.widthInches - depth, y: 0, width: depth, height: state.board.heightInches, class: "edge-zone playerB" });
    svg.append(left, right);
  }
  function addTerrain(svg, terrain) {
    for (const piece of terrain) {
      svg.appendChild(createSvgElement("rect", {
        x: piece.rect.minX,
        y: piece.rect.minY,
        width: piece.rect.maxX - piece.rect.minX,
        height: piece.rect.maxY - piece.rect.minY,
        class: piece.impassable ? "terrain-block" : "terrain-cover"
      }));
    }
  }
  function addObjectives(svg, objectives) {
    for (const objective of objectives) {
      svg.appendChild(createSvgElement("circle", { cx: objective.x, cy: objective.y, r: 0.75, class: "objective-marker" }));
      svg.appendChild(createSvgElement("circle", { cx: objective.x, cy: objective.y, r: 2, class: "objective-ring" }));
    }
  }
  function addPathPreview(svg, preview) {
    if (!preview?.path || preview.path.length < 2) return;
    const d = preview.path.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    svg.appendChild(createSvgElement("path", { d, class: "path-preview" }));
  }
  function addSelection(svg, state, uiState2) {
    if (!uiState2.selectedUnitId) return;
    const unit = state.units[uiState2.selectedUnitId];
    if (!unit || unit.status.location !== "battlefield") return;
    const leader = unit.models[unit.leadingModelId];
    if (!leader || leader.x == null || leader.y == null) return;
    svg.appendChild(createSvgElement("circle", {
      cx: leader.x,
      cy: leader.y,
      r: unit.base.radiusInches + 0.35,
      class: "selection-ring"
    }));
  }
  function addPreviewUnit(svg, state, uiState2) {
    if (!uiState2.previewUnit) return;
    const unit = state.units[uiState2.previewUnit.unitId];
    if (!unit) return;
    const { leader, placements } = uiState2.previewUnit;
    const leaderCircle = createSvgElement("circle", {
      cx: leader.x,
      cy: leader.y,
      r: unit.base.radiusInches,
      class: "deploy-preview"
    });
    svg.appendChild(leaderCircle);
    for (const placement of placements) {
      svg.appendChild(createSvgElement("circle", {
        cx: placement.x,
        cy: placement.y,
        r: unit.base.radiusInches,
        class: "deploy-preview"
      }));
    }
  }
  function addUnits(svg, state, uiState2, onModelClick) {
    for (const unit of Object.values(state.units)) {
      if (unit.status.location !== "battlefield") continue;
      for (const modelId of unit.modelIds) {
        const model = unit.models[modelId];
        if (!model.alive || model.x == null || model.y == null) continue;
        if (unit.tags.includes("Ground")) {
          svg.appendChild(createSvgElement("circle", {
            cx: model.x,
            cy: model.y,
            r: unit.base.radiusInches + 1,
            class: "engagement-ring"
          }));
        }
        const circle = createSvgElement("circle", {
          cx: model.x,
          cy: model.y,
          r: unit.base.radiusInches,
          class: `model ${boardToSvgClass(unit.owner)} ${modelId === unit.leadingModelId ? "leader" : ""}`,
          "data-unit-id": unit.id,
          "data-model-id": modelId,
          "data-owner": unit.owner
        });
        circle.addEventListener("click", (event) => {
          event.stopPropagation();
          onModelClick(unit.id, modelId);
        });
        svg.appendChild(circle);
        const text = createSvgElement("text", { x: model.x, y: model.y, class: "model-text" });
        text.textContent = `${modelId === unit.leadingModelId ? "L" : ""}${unit.currentSupplyValue}`;
        svg.appendChild(text);
      }
    }
  }
  function screenToBoardPoint(svg, clientX, clientY) {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.max(0, Math.min(36, transformed.x)), y: Math.max(0, Math.min(36, transformed.y)) };
  }
  function renderBoard(state, uiState2, handlers) {
    const svg = document.getElementById("battlefield");
    svg.innerHTML = "";
    addZones(svg, state);
    addGrid(svg, state.board.widthInches, state.board.heightInches);
    addTerrain(svg, state.board.terrain);
    addObjectives(svg, state.deployment.missionMarkers);
    addPathPreview(svg, uiState2.previewPath);
    addSelection(svg, state, uiState2);
    addPreviewUnit(svg, state, uiState2);
    addUnits(svg, state, uiState2, handlers.onModelClick);
    svg.onclick = (event) => {
      const point = screenToBoardPoint(svg, event.clientX, event.clientY);
      handlers.onBoardClick(point);
    };
  }

  // ui/renderer.js
  function renderAll(state, uiState2, handlers) {
    renderTopPanel(state);
    renderReserveTray(state, uiState2, handlers.onUnitSelect);
    renderSelectedUnit(state, uiState2);
    renderActionButtons(handlers.buildActionButtons());
    renderLog(state);
    renderBoard(state, uiState2, handlers);
    document.getElementById("modeBanner").textContent = handlers.getModeText();
    document.getElementById("passBtn").disabled = !(state.activePlayer === "playerA" && state.phase === "movement" && !state.players.playerA.hasPassedThisPhase);
  }

  // engine/legal_actions.js
  function getLegalActionsForPlayer(state, playerId) {
    const units = getEligibleMovementUnits(state, playerId);
    const actions = [];
    if (state.activePlayer === playerId && !state.players[playerId].hasPassedThisPhase) {
      actions.push({ type: "PASS_PHASE", enabled: true });
    }
    for (const unit of units) {
      actions.push(...getLegalActionsForUnit(state, playerId, unit.id));
    }
    return actions;
  }
  function getLegalActionsForUnit(state, playerId, unitId) {
    const unit = state.units[unitId];
    if (!unit || unit.owner !== playerId) return [];
    const descriptors = [];
    if (unit.status.location === "reserves") {
      descriptors.push({ type: "DEPLOY_UNIT", unitId, enabled: true, uiHints: { requiresBoardClick: true } });
      return descriptors;
    }
    descriptors.push({ type: "HOLD_UNIT", unitId, enabled: validateHold(state, playerId, unitId).ok });
    descriptors.push({ type: "MOVE_UNIT", unitId, enabled: !unit.status.engaged, uiHints: { requiresBoardClick: true } });
    descriptors.push({ type: "DISENGAGE_UNIT", unitId, enabled: unit.status.engaged, uiHints: { requiresBoardClick: true } });
    return descriptors;
  }

  // ai/bot.js
  function getOpponent2(playerId) {
    return playerId === "playerA" ? "playerB" : "playerA";
  }
  function nearestEnemyPoint(state, playerId) {
    const enemyUnits = Object.values(state.units).filter((unit) => unit.owner === getOpponent2(playerId) && unit.status.location === "battlefield");
    if (!enemyUnits.length) return { x: state.board.widthInches / 2, y: state.board.heightInches / 2 };
    const points = enemyUnits.flatMap((unit) => Object.values(unit.models).filter((m) => m.alive && m.x != null && m.y != null).map((m) => ({ x: m.x, y: m.y })));
    if (!points.length) return { x: state.board.widthInches / 2, y: state.board.heightInches / 2 };
    return points.sort((a, b) => a.x - b.x)[Math.floor(points.length / 2)];
  }
  function stepToward(start, end, maxDistance) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    const travel = Math.min(maxDistance, len);
    return { x: start.x + dx / len * travel, y: start.y + dy / len * travel };
  }
  function pickDeployEntry(state, playerId, yTarget) {
    const side = state.deployment.entryEdges[playerId].side;
    if (side === "east") return { x: state.board.widthInches, y: Math.max(1, Math.min(state.board.heightInches - 1, yTarget)) };
    if (side === "west") return { x: 0, y: Math.max(1, Math.min(state.board.heightInches - 1, yTarget)) };
    if (side === "north") return { x: Math.max(1, Math.min(state.board.widthInches - 1, yTarget)), y: 0 };
    return { x: Math.max(1, Math.min(state.board.widthInches - 1, yTarget)), y: state.board.heightInches };
  }
  function chooseUnitPriority(state, unitIds) {
    return [...unitIds].sort((a, b) => state.units[b].currentSupplyValue - state.units[a].currentSupplyValue);
  }
  function chooseMovementPhaseAction(state, playerId) {
    const actions = getLegalActionsForPlayer(state, playerId);
    const deployActions = actions.filter((action) => action.type === "DEPLOY_UNIT");
    const enemyCenter = nearestEnemyPoint(state, playerId);
    if (deployActions.length) {
      const ordered = chooseUnitPriority(state, deployActions.map((action) => action.unitId));
      const unitId = ordered[0];
      const unit = state.units[unitId];
      const entryPoint = pickDeployEntry(state, playerId, enemyCenter.y);
      const end = stepToward(entryPoint, enemyCenter, Math.max(1, unit.speed - 0.5));
      return {
        type: "DEPLOY_UNIT",
        payload: {
          playerId,
          unitId,
          leadingModelId: unit.leadingModelId,
          entryPoint,
          path: [entryPoint, end],
          modelPlacements: autoArrangeModels(state, unitId, end)
        }
      };
    }
    const battlefieldUnits = Object.values(state.units).filter((unit) => unit.owner === playerId && unit.status.location === "battlefield" && !unit.status.movementActivated);
    const engaged = battlefieldUnits.filter((unit) => unit.status.engaged);
    if (engaged.length) {
      const unit = engaged[0];
      const leader = unit.models[unit.leadingModelId];
      const fallback = { x: leader.x + (playerId === "playerA" ? -unit.speed : unit.speed), y: leader.y };
      return {
        type: "DISENGAGE_UNIT",
        payload: {
          playerId,
          unitId: unit.id,
          leadingModelId: unit.leadingModelId,
          path: [{ x: leader.x, y: leader.y }, fallback],
          modelPlacements: autoArrangeModels(state, unit.id, fallback)
        }
      };
    }
    if (battlefieldUnits.length) {
      const movers = battlefieldUnits.filter((unit) => !unit.status.engaged);
      if (movers.length) {
        let chosen = movers[0];
        let closest = Infinity;
        for (const unit of movers) {
          const leader2 = unit.models[unit.leadingModelId];
          const d = distance(leader2, enemyCenter);
          if (d < closest) {
            closest = d;
            chosen = unit;
          }
        }
        const leader = chosen.models[chosen.leadingModelId];
        const end = stepToward(leader, enemyCenter, Math.max(1, chosen.speed - 0.25));
        return {
          type: "MOVE_UNIT",
          payload: {
            playerId,
            unitId: chosen.id,
            leadingModelId: chosen.leadingModelId,
            path: [{ x: leader.x, y: leader.y }, end],
            modelPlacements: autoArrangeModels(state, chosen.id, end)
          }
        };
      }
      return { type: "HOLD_UNIT", payload: { playerId, unitId: battlefieldUnits[0].id } };
    }
    return { type: "PASS_PHASE", payload: { playerId } };
  }
  async function performBotTurn(store2, playerId) {
    const action = chooseMovementPhaseAction(store2.getState(), playerId);
    return store2.dispatch(action);
  }

  // ui/main.js
  var DEFAULT_SETUP = {
    missionId: "take_and_hold",
    deploymentId: "crossfire",
    firstPlayerMarkerHolder: "playerA",
    armyA: [
      { id: "blue_marines_1", templateId: "marine_squad" },
      { id: "blue_marines_2", templateId: "marine_squad" },
      { id: "blue_dragoon_1", templateId: "dragoon" }
    ],
    armyB: [
      { id: "red_zealots_1", templateId: "zealot_squad" },
      { id: "red_zealots_2", templateId: "zealot_squad" },
      { id: "red_zerglings_1", templateId: "zergling_squad" }
    ]
  };
  function createStore(initialState) {
    let state = initialState;
    const listeners = [];
    return {
      getState() {
        return state;
      },
      dispatch(action) {
        const result = dispatch(state, action);
        if (result.ok) {
          state = result.state;
          listeners.forEach((listener) => listener(state, result.events ?? []));
        }
        return result;
      },
      replaceState(nextState) {
        state = nextState;
        listeners.forEach((listener) => listener(state, []));
      },
      subscribe(listener) {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      }
    };
  }
  var uiState = {
    selectedUnitId: null,
    mode: null,
    previewPath: null,
    previewUnit: null,
    locked: false,
    lastError: null
  };
  var store;
  function buildInitialState() {
    const state = createInitialGameState(DEFAULT_SETUP);
    beginGame(state);
    return state;
  }
  function selectUnit(unitId) {
    uiState.selectedUnitId = unitId;
    cancelCurrentInteraction(uiState);
    rerender();
  }
  function getSelectedUnit(state) {
    return uiState.selectedUnitId ? state.units[uiState.selectedUnitId] : null;
  }
  function getModeText() {
    if (uiState.lastError) return uiState.lastError;
    if (uiState.mode === "deploy") return "Deploy mode: click on the board to choose the leader's final position.";
    if (uiState.mode === "move") return "Move mode: click on the board to choose the leader's destination.";
    if (uiState.mode === "disengage") return "Disengage mode: click on the board to choose the fallback position.";
    return "Select a reserve or battlefield unit, then choose an action.";
  }
  function rerender() {
    const handlers = {
      onUnitSelect: selectUnit,
      onBoardClick: handleBoardClick,
      onModelClick: (unitId) => selectUnit(unitId),
      buildActionButtons,
      getModeText
    };
    renderAll(store.getState(), uiState, handlers);
  }
  function showError(message) {
    uiState.lastError = message;
    rerender();
    window.clearTimeout(showError.timer);
    showError.timer = window.setTimeout(() => {
      uiState.lastError = null;
      rerender();
    }, 2600);
  }
  function actionButton(label, className, onClick, disabled = false) {
    const button = document.createElement("button");
    button.className = `btn ${className}`;
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", onClick);
    return button;
  }
  function buildActionButtons() {
    const state = store.getState();
    const unit = getSelectedUnit(state);
    const buttons = [];
    if (!unit) return buttons;
    buttons.push(actionButton("Cancel", "secondary", () => {
      cancelCurrentInteraction(uiState);
      rerender();
    }, !uiState.mode));
    if (state.activePlayer !== "playerA") return buttons;
    if (unit.owner !== "playerA") return buttons;
    if (unit.status.movementActivated) return buttons;
    if (unit.status.location === "reserves") {
      buttons.unshift(actionButton("Deploy", "primary", () => {
        beginDeployInteraction(state, uiState, unit.id);
        rerender();
      }));
      return buttons;
    }
    buttons.unshift(actionButton("Hold", "secondary", () => {
      const result = store.dispatch({ type: "HOLD_UNIT", payload: { playerId: "playerA", unitId: unit.id } });
      if (!result.ok) showError(result.message);
    }));
    buttons.unshift(actionButton("Move", "primary", () => {
      beginMoveInteraction(state, uiState, unit.id);
      rerender();
    }, unit.status.engaged));
    buttons.unshift(actionButton("Disengage", "warn", () => {
      beginDisengageInteraction(state, uiState, unit.id);
      rerender();
    }, !unit.status.engaged));
    return buttons;
  }
  function computeDeployEntryPoint(state, point) {
    const side = state.deployment.entryEdges.playerA.side;
    if (side === "west") return { x: 0, y: point.y };
    if (side === "east") return { x: state.board.widthInches, y: point.y };
    if (side === "north") return { x: point.x, y: 0 };
    return { x: point.x, y: state.board.heightInches };
  }
  function handleBoardClick(point) {
    const state = store.getState();
    const unit = getSelectedUnit(state);
    if (!unit || state.activePlayer !== "playerA") return;
    if (uiState.mode === "deploy") {
      const entryPoint = computeDeployEntryPoint(state, point);
      const path = [entryPoint, point];
      const result = store.dispatch({
        type: "DEPLOY_UNIT",
        payload: {
          playerId: "playerA",
          unitId: unit.id,
          leadingModelId: unit.leadingModelId,
          entryPoint,
          path,
          modelPlacements: autoArrangeModels(state, unit.id, point)
        }
      });
      if (!result.ok) return showError(result.message);
      cancelCurrentInteraction(uiState);
      rerender();
      return;
    }
    if (uiState.mode === "move") {
      const leader = unit.models[unit.leadingModelId];
      const path = [{ x: leader.x, y: leader.y }, point];
      const result = store.dispatch({
        type: "MOVE_UNIT",
        payload: {
          playerId: "playerA",
          unitId: unit.id,
          leadingModelId: unit.leadingModelId,
          path,
          modelPlacements: autoArrangeModels(state, unit.id, point)
        }
      });
      if (!result.ok) return showError(result.message);
      cancelCurrentInteraction(uiState);
      rerender();
      return;
    }
    if (uiState.mode === "disengage") {
      const leader = unit.models[unit.leadingModelId];
      const path = [{ x: leader.x, y: leader.y }, point];
      const result = store.dispatch({
        type: "DISENGAGE_UNIT",
        payload: {
          playerId: "playerA",
          unitId: unit.id,
          leadingModelId: unit.leadingModelId,
          path,
          modelPlacements: autoArrangeModels(state, unit.id, point)
        }
      });
      if (!result.ok) return showError(result.message);
      cancelCurrentInteraction(uiState);
      rerender();
    }
  }
  async function maybeRunBot() {
    if (uiState.locked) return;
    const state = store.getState();
    if (state.activePlayer !== "playerB" || state.phase !== "movement") return;
    uiState.locked = true;
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 420));
    const result = await performBotTurn(store, "playerB");
    if (!result.ok) showError(result.message);
    uiState.locked = false;
    rerender();
    if (store.getState().activePlayer === "playerB" && store.getState().phase === "movement") {
      maybeRunBot();
    }
  }
  function resetGame() {
    uiState.selectedUnitId = null;
    cancelCurrentInteraction(uiState);
    const nextState = buildInitialState();
    store.replaceState(nextState);
  }
  function controller() {
    return {
      onNewGame: resetGame,
      onPass: () => {
        const result = store.dispatch({ type: "PASS_PHASE", payload: { playerId: "playerA" } });
        if (!result.ok) showError(result.message);
      }
    };
  }
  function updatePreviewFromPoint(point) {
    const state = store.getState();
    const unit = getSelectedUnit(state);
    if (!unit) return;
    if (uiState.mode === "deploy") {
      const entryPoint = computeDeployEntryPoint(state, point);
      uiState.previewPath = { path: [entryPoint, point] };
      uiState.previewUnit = { unitId: unit.id, leader: point, placements: autoArrangeModels(state, unit.id, point) };
    }
    if (uiState.mode === "move" || uiState.mode === "disengage") {
      const leader = unit.models[unit.leadingModelId];
      uiState.previewPath = { path: [{ x: leader.x, y: leader.y }, point] };
      uiState.previewUnit = { unitId: unit.id, leader: point, placements: autoArrangeModels(state, unit.id, point) };
    }
  }
  function wirePreviewEvents() {
    const svg = document.getElementById("battlefield");
    svg.addEventListener("mousemove", (event) => {
      if (!uiState.mode) return;
      const point = screenToBoardPoint(svg, event.clientX, event.clientY);
      updatePreviewFromPoint(point);
      rerender();
    });
    svg.addEventListener("mouseleave", () => {
      if (!uiState.mode) return;
      uiState.previewPath = null;
      uiState.previewUnit = null;
      rerender();
    });
  }
  function init() {
    store = createStore(buildInitialState());
    bindInputHandlers(store, controller());
    store.subscribe(() => {
      rerender();
      maybeRunBot();
    });
    rerender();
    wirePreviewEvents();
  }
  init();
})();
