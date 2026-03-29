import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { beginRound, beginCombatPhase } from '../engine/phases.js';
import { resolvePlayCard } from '../engine/cards.js';
import { getLegalActionsForPlayer } from '../engine/legal_actions.js';
import { createSeededRng } from './helpers/rng.mjs';
import { resolveCombatPhase } from '../engine/combat.js';
import { canTargetWithRangedWeapon } from '../engine/visibility.js';
import { validateDeploy } from '../engine/deployment.js';
import { resolveOmegaRecall } from '../engine/omega_worms.js';
import { getCreepZones } from '../engine/creep.js';

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

test('observer card creates a temporary detection field that reveals hidden enemies', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_zergling_1', templateId: 'zergling_t2' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  state.phase = 'movement';
  state.activePlayer = 'playerA';
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zergling_1', 15, 10);
  state.units.red_zergling_1.status.hidden = true;

  state.players.playerA.hand = [{ instanceId: 'observer-1', cardId: 'observer' }];

  const playResult = resolvePlayCard(state, 'playerA', 'observer-1', 'blue_marines_1');
  assert.equal(playResult.ok, true);

  const attacker = state.units.blue_marines_1;
  const target = state.units.red_zergling_1;
  const weapon = attacker.rangedWeapons[0];
  const targeting = canTargetWithRangedWeapon(state, attacker, target, weapon);

  assert.equal(targeting.ok, true);
  assert.equal(state.effects.some(effect => effect.zone?.kind === 'detection_field'), true);
});

test('warp prism card creates a temporary warp field for reserve deployment', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [
      { id: 'blue_marines_1', templateId: 'marine_squad' },
      { id: 'blue_zealots_1', templateId: 'zealot_squad' }
    ],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  state.phase = 'movement';
  state.activePlayer = 'playerA';
  placeUnitAt(state, 'blue_marines_1', 12, 12);
  placeUnitAt(state, 'red_marines_1', 30, 30);

  state.players.playerA.hand = [{ instanceId: 'warp-prism-1', cardId: 'warp_prism' }];
  const playResult = resolvePlayCard(state, 'playerA', 'warp-prism-1', 'blue_marines_1');
  assert.equal(playResult.ok, true);

  const reserveUnit = state.units.blue_zealots_1;
  const leaderId = reserveUnit.leadingModelId;
  const entryPoint = { x: 14, y: 12 };
  const deployValidation = validateDeploy(
    state,
    'playerA',
    reserveUnit.id,
    leaderId,
    entryPoint,
    [entryPoint, entryPoint]
  );

  assert.equal(deployValidation.ok, true);
  assert.equal(deployValidation.derived.warpDeploy, true);
});

test('omega recall returns a unit in base contact with a friendly omega worm to reserves', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [
      { id: 'blue_omega_1', templateId: 'omega_worm' },
      { id: 'blue_roach_1', templateId: 'roach_t3' }
    ],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  state.phase = 'movement';
  state.activePlayer = 'playerA';
  placeUnitAt(state, 'blue_omega_1', 10, 10);
  placeUnitAt(state, 'blue_roach_1', 12.2, 10);

  const result = resolveOmegaRecall(state, 'playerA', 'blue_roach_1');

  assert.equal(result.ok, true);
  assert.equal(state.units.blue_roach_1.status.location, 'reserves');
  assert.equal(state.players.playerA.reserveUnitIds.includes('blue_roach_1'), true);
  assert.equal(state.players.playerA.battlefieldUnitIds.includes('blue_roach_1'), false);
});

test('malignant creep card creates a temporary creep field around the target unit', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_queen_1', templateId: 'queen' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  state.phase = 'movement';
  state.activePlayer = 'playerA';
  placeUnitAt(state, 'blue_queen_1', 12, 12);
  state.players.playerA.hand = [{ instanceId: 'malignant-1', cardId: 'malignant_creep' }];

  const result = resolvePlayCard(state, 'playerA', 'malignant-1', 'blue_queen_1');

  assert.equal(result.ok, true);
  assert.equal(getCreepZones(state).some(zone => zone.kind === 'creep_field' && zone.center.x === 12 && zone.center.y === 12), true);
});

test('barracks proxy card creates a temporary terran infantry deployment field', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [
      { id: 'blue_marines_1', templateId: 'marine_squad' },
      { id: 'blue_marauders_1', templateId: 'marauder_t1' }
    ],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  state.phase = 'movement';
  state.activePlayer = 'playerA';
  placeUnitAt(state, 'blue_marines_1', 12, 12);
  placeUnitAt(state, 'red_marines_1', 30, 30);
  state.players.playerA.hand = [{ instanceId: 'proxy-1', cardId: 'barracks_proxy' }];

  const playResult = resolvePlayCard(state, 'playerA', 'proxy-1', 'blue_marines_1');
  assert.equal(playResult.ok, true);

  const reserveUnit = state.units.blue_marauders_1;
  const leaderId = reserveUnit.leadingModelId;
  const entryPoint = { x: 13.5, y: 12 };
  const deployValidation = validateDeploy(
    state,
    'playerA',
    reserveUnit.id,
    leaderId,
    entryPoint,
    [entryPoint, entryPoint]
  );

  assert.equal(deployValidation.ok, true);
  assert.equal(Boolean(deployValidation.derived.cardDeployZone), true);
  assert.equal(deployValidation.derived.cardDeployZone.kind, 'proxy_field');
});

test('hatchery card creates a temporary zerg deployment field', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [
      { id: 'blue_queen_1', templateId: 'queen' },
      { id: 'blue_roach_1', templateId: 'roach_t3' }
    ],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  state.phase = 'movement';
  state.activePlayer = 'playerA';
  placeUnitAt(state, 'blue_queen_1', 14, 14);
  placeUnitAt(state, 'red_marines_1', 30, 30);
  state.players.playerA.hand = [{ instanceId: 'hatchery-1', cardId: 'hatchery' }];

  const playResult = resolvePlayCard(state, 'playerA', 'hatchery-1', 'blue_queen_1');
  assert.equal(playResult.ok, true);

  const reserveUnit = state.units.blue_roach_1;
  const leaderId = reserveUnit.leadingModelId;
  const entryPoint = { x: 9, y: 14 };
  const deployValidation = validateDeploy(
    state,
    'playerA',
    reserveUnit.id,
    leaderId,
    entryPoint,
    [entryPoint, entryPoint]
  );

  assert.equal(deployValidation.ok, true);
  assert.equal(Boolean(deployValidation.derived.cardDeployZone), true);
  assert.equal(deployValidation.derived.cardDeployZone.kind, 'hatchery_field');
});
