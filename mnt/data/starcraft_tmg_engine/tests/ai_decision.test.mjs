import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { chooseAction } from '../ai/bot.js';

function placeUnit(state, unitId, x, y) {
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

test('assault AI prioritizes ranged declaration and chooses high-value target', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [
      { id: 'red_zealots_1', templateId: 'zealot_squad' },
      { id: 'red_zerglings_1', templateId: 'zergling_squad' }
    ],
    firstPlayerMarkerHolder: 'playerA'
  });

  state.phase = 'assault';
  state.activePlayer = 'playerA';
  state.players.playerA.hand = [];
  placeUnit(state, 'blue_marines_1', 16, 18);
  placeUnit(state, 'red_zealots_1', 18, 18); // on objective, higher supply
  placeUnit(state, 'red_zerglings_1', 18, 14);

  const action = chooseAction(state, 'playerA');

  assert.equal(action.type, 'DECLARE_RANGED_ATTACK');
  assert.equal(action.payload.unitId, 'blue_marines_1');
  assert.equal(action.payload.targetId, 'red_zealots_1');
});

test('assault AI declares charge for melee-focused units in range', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });

  state.phase = 'assault';
  state.activePlayer = 'playerA';
  placeUnit(state, 'blue_zealots_1', 16, 18);
  placeUnit(state, 'red_marines_1', 18, 18);

  const action = chooseAction(state, 'playerA');

  assert.equal(action.type, 'DECLARE_CHARGE');
  assert.equal(action.payload.unitId, 'blue_zealots_1');
  assert.equal(action.payload.targetId, 'red_marines_1');
});

test('movement AI plays rapid_relocation before moving when a valid target exists', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });

  state.phase = 'movement';
  state.activePlayer = 'playerA';
  placeUnit(state, 'blue_marines_1', 8, 18);
  placeUnit(state, 'red_marines_1', 28, 18);

  const action = chooseAction(state, 'playerA');

  assert.equal(action.type, 'PLAY_CARD');
  assert.equal(action.payload.playerId, 'playerA');
  assert.equal(action.payload.targetUnitId, 'blue_marines_1');
  assert.match(action.payload.cardInstanceId, /rapid_relocation/);
});

test('assault AI plays focused_fire before declaring attacks when a valid shooter exists', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_zealots_1', templateId: 'zealot_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });

  state.phase = 'assault';
  state.activePlayer = 'playerA';
  placeUnit(state, 'blue_marines_1', 16, 18);
  placeUnit(state, 'red_zealots_1', 18, 18);

  const action = chooseAction(state, 'playerA');

  assert.equal(action.type, 'PLAY_CARD');
  assert.equal(action.payload.playerId, 'playerA');
  assert.equal(action.payload.targetUnitId, 'blue_marines_1');
  assert.match(action.payload.cardInstanceId, /focused_fire/);
});

test('combat AI resolves queued combat declarations when available', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_zealots_1', templateId: 'zealot_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });

  state.phase = 'combat';
  state.activePlayer = 'playerA';
  placeUnit(state, 'blue_marines_1', 16, 18);
  placeUnit(state, 'red_zealots_1', 18, 18);
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zealots_1' });

  const action = chooseAction(state, 'playerA');

  assert.equal(action.type, 'RESOLVE_COMBAT_UNIT');
  assert.equal(action.payload.playerId, 'playerA');
  assert.equal(action.payload.unitId, 'blue_marines_1');
});
