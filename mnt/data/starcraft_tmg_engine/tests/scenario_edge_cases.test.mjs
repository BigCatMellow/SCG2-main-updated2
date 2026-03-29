import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { resolveCombatPhase } from '../engine/combat.js';
import { resolveMissionScoringAtCleanup, checkMissionInstantWin } from '../engine/mission_rules.js';
import { validateMove } from '../engine/movement.js';
import { validateDeploy } from '../engine/deployment.js';

function buildState({
  missionId = 'take_and_hold',
  armyA = [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
  armyB = [{ id: 'red_zealots_1', templateId: 'zealot_squad' }]
} = {}) {
  return createInitialGameState({
    missionId,
    deploymentId: 'crossfire',
    armyA,
    armyB,
    firstPlayerMarkerHolder: 'playerA'
  });
}

function placeUnitAt(state, unitId, x, y) {
  const unit = state.units[unitId];
  unit.status.location = 'battlefield';
  const owner = unit.owner;
  state.players[owner].reserveUnitIds = state.players[owner].reserveUnitIds.filter(id => id !== unitId);
  if (!state.players[owner].battlefieldUnitIds.includes(unitId)) state.players[owner].battlefieldUnitIds.push(unitId);

  for (const modelId of unit.modelIds) {
    unit.models[modelId].x = x;
    unit.models[modelId].y = y;
  }
}

test('combat resolver skips invalid declarations but still resolves valid ones', () => {
  const state = buildState({
    armyA: [
      { id: 'blue_marines_1', templateId: 'marine_squad' },
      { id: 'blue_dragoon_1', templateId: 'dragoon' }
    ],
    armyB: [{ id: 'red_zealots_1', templateId: 'zealot_squad' }]
  });

  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'blue_dragoon_1', 40, 40);
  placeUnitAt(state, 'red_zealots_1', 12, 10);

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_dragoon_1', targetId: 'red_zealots_1' }); // out of range
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zealots_1' }); // valid

  const result = resolveCombatPhase(state);

  assert.equal(result.ok, true);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.attackerId, 'blue_marines_1');
  assert.equal(state.combatQueue.length, 0);
});

test('control_all_markers instant win does not trigger when mission has zero markers', () => {
  const state = buildState();
  state.deployment.missionMarkers = [];

  const scoring = resolveMissionScoringAtCleanup(state);
  const instant = checkMissionInstantWin(state, scoring);

  assert.equal(Object.keys(scoring.snapshot).length, 0);
  assert.equal(instant, null);
});

test('movement path through difficult cover terrain spends extra movement', () => {
  const state = buildState({
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_zealots_1', templateId: 'zealot_squad' }]
  });
  placeUnitAt(state, 'blue_marines_1', 14, 8);
  placeUnitAt(state, 'red_zealots_1', 28, 28);

  state.phase = 'movement';
  state.activePlayer = 'playerA';

  const unit = state.units.blue_marines_1;
  const result = validateMove(
    state,
    'playerA',
    'blue_marines_1',
    unit.leadingModelId,
    [{ x: 14, y: 8 }, { x: 21, y: 8 }]
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'TOO_FAR');
});

test('deep strike units can deploy from reserves away from board edges', () => {
  const state = buildState({
    armyA: [{ id: 'swarm_kerrigan', templateId: 'kerrigan' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }]
  });
  placeUnitAt(state, 'red_marines_1', 30, 30);
  state.phase = 'movement';
  state.activePlayer = 'playerA';

  const result = validateDeploy(
    state,
    'playerA',
    'swarm_kerrigan',
    state.units.swarm_kerrigan.leadingModelId,
    { x: 18, y: 18 },
    [{ x: 18, y: 18 }, { x: 18, y: 18 }]
  );

  assert.equal(result.ok, true);
});

test('deep strike denies deployment within 6 inches of enemy models', () => {
  const state = buildState({
    armyA: [{ id: 'swarm_kerrigan', templateId: 'kerrigan' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }]
  });
  placeUnitAt(state, 'red_marines_1', 18, 18);
  state.phase = 'movement';
  state.activePlayer = 'playerA';

  const result = validateDeploy(
    state,
    'playerA',
    'swarm_kerrigan',
    state.units.swarm_kerrigan.leadingModelId,
    { x: 20, y: 18 },
    [{ x: 20, y: 18 }, { x: 20, y: 18 }]
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'DEEP_STRIKE_DENIED');
});

test('grid mode measures movement in squares using grid distance', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_zealots_1', templateId: 'zealot_squad' }],
    rules: { gridMode: true },
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 5, 5);
  placeUnitAt(state, 'red_zealots_1', 30, 30);
  state.phase = 'movement';
  state.activePlayer = 'playerA';

  const valid = validateMove(
    state,
    'playerA',
    'blue_marines_1',
    state.units.blue_marines_1.leadingModelId,
    [{ x: 5, y: 5 }, { x: 11, y: 11 }] // grid distance 6
  );
  assert.equal(valid.ok, true);

  const tooFar = validateMove(
    state,
    'playerA',
    'blue_marines_1',
    state.units.blue_marines_1.leadingModelId,
    [{ x: 5, y: 5 }, { x: 12, y: 12 }] // grid distance 7
  );
  assert.equal(tooFar.ok, false);
  assert.equal(tooFar.code, 'TOO_FAR');
});
