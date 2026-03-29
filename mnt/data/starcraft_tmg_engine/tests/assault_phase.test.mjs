import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { beginRound } from '../engine/phases.js';
import { advanceToNextPhase } from '../engine/phases.js';
import { resolveRun, resolveDeclareRangedAttack, resolveDeclareCharge } from '../engine/assault.js';
import { passPhase } from '../engine/activation.js';

function buildState() {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_zealots_1', templateId: 'zealot_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  return state;
}

function placeLeaderAt(state, unitId, x, y) {
  const unit = state.units[unitId];
  unit.status.location = 'battlefield';
  const owner = unit.owner;
  state.players[owner].reserveUnitIds = state.players[owner].reserveUnitIds.filter(id => id !== unitId);
  if (!state.players[owner].battlefieldUnitIds.includes(unitId)) state.players[owner].battlefieldUnitIds.push(unitId);
  unit.models[unit.leadingModelId].x = x;
  unit.models[unit.leadingModelId].y = y;
  for (const modelId of unit.modelIds) {
    if (modelId === unit.leadingModelId) continue;
    unit.models[modelId].x = x;
    unit.models[modelId].y = y;
  }
}

test('movement phase advances into assault phase', () => {
  const state = buildState();

  const result = advanceToNextPhase(state);

  assert.equal(result.ok, true);
  assert.equal(state.phase, 'assault');
  assert.equal(state.activePlayer, state.firstPlayerMarkerHolder);
});

test('assault run moves unit and marks assault activation', () => {
  const state = buildState();
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  placeLeaderAt(state, 'red_zealots_1', 30, 30);
  advanceToNextPhase(state);

  const run = resolveRun(
    state,
    'playerA',
    'blue_marines_1',
    state.units.blue_marines_1.leadingModelId,
    [{ x: 5, y: 5 }, { x: 10, y: 5 }]
  );

  assert.equal(run.ok, true);
  assert.equal(state.units.blue_marines_1.status.assaultActivated, true);
  assert.equal(state.units.blue_marines_1.models[state.units.blue_marines_1.leadingModelId].x, 10);
});


test('declare ranged attack queues a combat declaration and activates unit', () => {
  const state = buildState();
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  placeLeaderAt(state, 'red_zealots_1', 10, 5);
  advanceToNextPhase(state);

  const declareResult = resolveDeclareRangedAttack(state, 'playerA', 'blue_marines_1');

  assert.equal(declareResult.ok, true);
  assert.equal(state.units.blue_marines_1.status.assaultActivated, true);
  assert.equal(state.combatQueue.length, 1);
  assert.equal(state.combatQueue[0].targetId, 'red_zealots_1');
});

test('declare charge queues melee declaration and activates unit', () => {
  const state = buildState();
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  placeLeaderAt(state, 'red_zealots_1', 10, 5);
  advanceToNextPhase(state);

  const declareResult = resolveDeclareCharge(state, 'playerA', 'blue_marines_1');

  assert.equal(declareResult.ok, true);
  assert.equal(state.units.blue_marines_1.status.assaultActivated, true);
  assert.equal(state.combatQueue.length, 1);
  assert.equal(state.combatQueue[0].type, 'charge_attack');
  assert.equal(state.combatQueue[0].targetId, 'red_zealots_1');
});

test('declare charge also queues overwatch when defender has ranged weapon and has not used it', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_zealots_1', 5, 5);
  placeLeaderAt(state, 'red_marines_1', 10, 5);
  advanceToNextPhase(state);

  const declareResult = resolveDeclareCharge(state, 'playerA', 'blue_zealots_1');

  assert.equal(declareResult.ok, true);
  assert.equal(state.combatQueue.length, 2);
  assert.equal(state.combatQueue[0].type, 'overwatch_attack');
  assert.equal(state.combatQueue[1].type, 'charge_attack');
  assert.equal(state.units.red_marines_1.status.overwatchUsedThisRound, true);
});

test('both players passing in assault advances into interactive combat phase', () => {
  const state = buildState();
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  placeLeaderAt(state, 'red_zealots_1', 30, 30);
  advanceToNextPhase(state);

  passPhase(state, 'playerA');
  const result = passPhase(state, 'playerB');

  assert.equal(result.ok, true);
  assert.equal(state.phase, 'combat');
  assert.equal(state.round, 1);
});

test('assault auto-passes players with no eligible units and advances to combat phase', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  advanceToNextPhase(state); // assault

  const action = resolveRun(
    state,
    'playerA',
    'blue_marines_1',
    state.units.blue_marines_1.leadingModelId,
    [{ x: 5, y: 5 }, { x: 8, y: 5 }]
  );

  assert.equal(action.ok, true);
  assert.equal(state.phase, 'combat');
  assert.equal(state.round, 1);
});
