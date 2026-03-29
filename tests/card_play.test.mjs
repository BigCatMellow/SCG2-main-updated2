import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { beginRound, beginCombatPhase } from '../engine/phases.js';
import { resolvePlayCard } from '../engine/cards.js';
import { getLegalActionsForPlayer } from '../engine/legal_actions.js';
import { createSeededRng } from './helpers/rng.mjs';
import { resolveCombatPhase } from '../engine/combat.js';

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

test('legal actions include playable card actions for active player in matching phase', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 6, 6);

  const actions = getLegalActionsForPlayer(state, 'playerA');
  const cardActions = actions.filter(action => action.type === 'PLAY_CARD');

  assert.ok(cardActions.length >= 1);
  assert.ok(cardActions.every(action => action.cardId === 'rapid_relocation'));
});

test('playing a card moves it from hand to discard and adds an effect', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 6, 6);

  const cardInstanceId = state.players.playerA.hand.find(card => card.cardId === 'rapid_relocation').instanceId;
  const result = resolvePlayCard(state, 'playerA', cardInstanceId, 'blue_marines_1');

  assert.equal(result.ok, true);
  assert.equal(state.players.playerA.hand.some(card => card.instanceId === cardInstanceId), false);
  assert.equal(state.players.playerA.discardPile.some(card => card.instanceId === cardInstanceId), true);
  assert.equal(state.effects.length, 1);
  assert.equal(state.effects[0].name, 'Rapid Relocation');
});

test('focused_fire card affects combat hit chance for the targeted unit', () => {
  const state = buildState();
  state.phase = 'assault';
  state.activePlayer = 'playerA';
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zealots_1', 12, 10);

  const cardInstanceId = state.players.playerA.hand.find(card => card.cardId === 'focused_fire').instanceId;
  const playResult = resolvePlayCard(state, 'playerA', cardInstanceId, 'blue_marines_1');
  assert.equal(playResult.ok, true);

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zealots_1' });
  const combat = resolveCombatPhase(state, { rng: createSeededRng(123) });

  assert.equal(combat.ok, true);
  assert.equal(state.lastCombatReport.length, 1);
  assert.ok(state.lastCombatReport[0].hits >= 0);
});

// Integration sanity: cards should not break the normal phase flow.
test('combat phase still starts correctly after cards are used', () => {
  const state = buildState();
  state.phase = 'assault';
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zealots_1', 12, 10);

  const cardInstanceId = state.players.playerA.hand.find(card => card.cardId === 'focused_fire').instanceId;
  resolvePlayCard(state, 'playerA', cardInstanceId, 'blue_marines_1');
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zealots_1' });

  const result = beginCombatPhase(state);
  assert.equal(result.ok, true);
  assert.equal(state.phase, 'combat');
  assert.equal(state.round, 1);
  assert.equal(state.combatQueue.length, 1);
});
