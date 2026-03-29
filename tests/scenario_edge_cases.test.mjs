import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { resolveCombatPhase } from '../engine/combat.js';
import { resolveMissionScoringAtCleanup, checkMissionInstantWin } from '../engine/mission_rules.js';

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
