import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { resolveCombatPhase } from '../engine/combat.js';
import { determineWinner, getObjectiveControlSnapshot, resolveObjectiveController, scoreObjectivesForRound } from '../engine/objectives.js';
import { beginCleanupPhase } from '../engine/phases.js';

function buildState() {
  return createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_zealots_1', templateId: 'zealot_squad' }],
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

test('resolveObjectiveController uses supply totals (not model count)', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 18, 18);
  placeUnitAt(state, 'red_zealots_1', 18, 18);

  const result = resolveObjectiveController(state, 'obj1');

  assert.equal(result.controller, null);
  assert.equal(result.contested, true);
  assert.equal(result.playerASupply, 2);
  assert.equal(result.playerBSupply, 2);
});

test('scoreObjectivesForRound awards VP only for controlled markers', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 18, 10);
  placeUnitAt(state, 'red_zealots_1', 30, 30);

  const snapshot = getObjectiveControlSnapshot(state);
  assert.equal(snapshot.obj2.controller, 'playerA');
  assert.equal(snapshot.obj1.controller, null);

  const scoring = scoreObjectivesForRound(state);

  assert.equal(scoring.gained.playerA, 1);
  assert.equal(scoring.gained.playerB, 0);
  assert.equal(state.players.playerA.vp, 1);
  assert.equal(state.players.playerB.vp, 0);
});

test('burrowed units do not contest objectives', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_roach_1', templateId: 'roach_t3' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_roach_1', 18, 10);
  placeUnitAt(state, 'red_marines_1', 30, 30);
  state.units.blue_roach_1.status.burrowed = true;
  state.units.blue_roach_1.status.hidden = true;

  const snapshot = getObjectiveControlSnapshot(state);

  assert.equal(snapshot.obj2.playerASupply, 0);
  assert.equal(snapshot.obj2.controller, null);
});

test('flying units do not contest objectives', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 18, 10);
  state.units.blue_marines_1.tags = state.units.blue_marines_1.tags.filter(tag => tag !== 'Ground');
  state.units.blue_marines_1.tags.push('Flying');
  state.units.blue_marines_1.abilities.push('flying');

  const snapshot = getObjectiveControlSnapshot(state);

  assert.equal(snapshot.obj2.playerASupply, 0);
  assert.equal(snapshot.obj2.controller, null);
});

test('beginCleanupPhase on final round resolves winner from VP totals', () => {
  const state = buildState();
  state.round = state.mission.roundLimit;
  state.players.playerA.vp = 3;
  state.players.playerB.vp = 1;
  placeUnitAt(state, 'blue_marines_1', 30, 30);
  placeUnitAt(state, 'red_zealots_1', 30, 30);

  state.phase = "combat";
  const result = beginCleanupPhase(state);

  assert.equal(result.ok, true);
  assert.equal(result.events[0].type, 'game_completed');
  assert.equal(state.winner, 'playerA');
  assert.equal(determineWinner(state), 'playerA');
});

test('veteran of tarsonis improves armour while within 3 inches of an objective', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marauder_1', templateId: 'marauder_t1', selectedUpgrades: ['Veteran of Tarsonis'] }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marauder_1', 18, 10);
  placeUnitAt(state, 'red_marines_1', 24, 10);

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'red_marines_1', targetId: 'blue_marauder_1' });
  resolveCombatPhase(state, { rng: () => 0.45 });

  assert.equal(state.lastCombatReport[0].objectiveDefenseBonus, 1);
});
