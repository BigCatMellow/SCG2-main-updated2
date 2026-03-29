import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { resolveMissionScoringAtCleanup, checkMissionInstantWin } from '../engine/mission_rules.js';

function buildState(missionId = 'domination_protocol') {
  return createInitialGameState({
    missionId,
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

test('domination_protocol applies different scoring windows by round', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 18, 18); // center marker obj1

  state.round = 2;
  const early = resolveMissionScoringAtCleanup(state);
  assert.equal(early.gained.playerA, 1);

  state.round = 3;
  const late = resolveMissionScoringAtCleanup(state);
  assert.equal(late.gained.playerA, 2);
});

test('mission instant win detects vp threshold', () => {
  const state = buildState('take_and_hold');
  state.players.playerA.vp = 10;
  state.players.playerB.vp = 6;
  const scoringResult = { snapshot: {} };

  const instant = checkMissionInstantWin(state, scoringResult);

  assert.equal(instant.winner, 'playerA');
});
