import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { beginRound } from '../engine/phases.js';
import { advanceToNextPhase } from '../engine/phases.js';
import { resolveRun, resolveDeclareRangedAttack, resolveDeclareCharge } from '../engine/assault.js';
import { passPhase } from '../engine/activation.js';
import { dispatch } from '../engine/reducer.js';
import { getLegalActionsForUnit } from '../engine/legal_actions.js';
import { autoArrangeModels } from '../engine/coherency.js';

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


test('declare ranged attack resolves immediately during the assault activation', () => {
  const state = buildState();
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  placeLeaderAt(state, 'red_zealots_1', 10, 5);
  advanceToNextPhase(state);

  const declareResult = resolveDeclareRangedAttack(state, 'playerA', 'blue_marines_1');

  assert.equal(declareResult.ok, true);
  assert.equal(state.units.blue_marines_1.status.assaultActivated, true);
  assert.equal(state.combatQueue.length, 0);
  assert.ok(declareResult.events.some(event => event.type === 'combat_attack_resolved'), JSON.stringify({ events: declareResult.events, report: state.lastCombatReport }));
  assert.equal(state.lastCombatReport.length, 1);
  assert.equal(state.lastCombatReport[0].targetId, 'red_zealots_1');
});

test('declare charge resolves immediately during the assault activation', () => {
  const state = buildState();
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  placeLeaderAt(state, 'red_zealots_1', 7, 5);
  advanceToNextPhase(state);

  const declareResult = resolveDeclareCharge(state, 'playerA', 'blue_marines_1', null, { rng: () => 0.99 });

  assert.equal(declareResult.ok, true);
  assert.equal(state.units.blue_marines_1.status.assaultActivated, true);
  assert.equal(state.combatQueue.length, 0);
  assert.equal(declareResult.events.some(event => event.type === 'combat_attack_resolved'), true);
  assert.equal(state.lastCombatReport[0].mode, 'melee');
  assert.equal(state.lastCombatReport[0].targetId, 'red_zealots_1');
});

test('declare charge resolves overwatch and the charge attack immediately when defender can react', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_zealots_1', 5, 5);
  placeLeaderAt(state, 'red_marines_1', 7, 5);
  advanceToNextPhase(state);

  const declareResult = resolveDeclareCharge(state, 'playerA', 'blue_zealots_1', null, { rng: () => 0.99 });

  assert.equal(declareResult.ok, true);
  assert.equal(state.combatQueue.length, 0);
  assert.equal(declareResult.events.some(event => event.type === 'combat_attack_resolved' && event.payload.mode === 'overwatch'), true);
  assert.equal(declareResult.events.some(event => event.type === 'combat_attack_resolved' && event.payload.mode === 'melee'), true);
  assert.equal(state.units.red_marines_1.status.overwatchUsedThisRound, true);
});

test('instant charge shuts down overwatch reactions', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_zealots_1', 5, 5);
  placeLeaderAt(state, 'red_marines_1', 7, 5);
  advanceToNextPhase(state);
  state.units.blue_zealots_1.meleeWeapons[0].instant = true;

  const declareResult = resolveDeclareCharge(state, 'playerA', 'blue_zealots_1');

  assert.equal(declareResult.ok, true);
  assert.equal(state.combatQueue.length, 0);
  assert.equal(declareResult.events.some(event => event.type === 'combat_attack_resolved' && event.payload.mode === 'overwatch'), false);
  assert.equal(declareResult.events.some(event => event.type === 'combat_attack_resolved' && event.payload.mode === 'melee'), true);
  assert.equal(state.units.red_marines_1.status.overwatchUsedThisRound, false);
  assert.ok(state.log.some(entry => entry.text.includes('has Instant')));
});

test('charge can fail and reports no queued melee attack when roll is short', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_dragoon_1', templateId: 'dragoon' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_dragoon_1', 10, 10);
  placeLeaderAt(state, 'red_zerglings_1', 17.6, 10);
  advanceToNextPhase(state);

  const declareResult = resolveDeclareCharge(state, 'playerA', 'blue_dragoon_1', 'red_zerglings_1', { rng: () => 0 });

  assert.equal(declareResult.ok, true);
  assert.equal(state.units.blue_dragoon_1.status.assaultActivated, true);
  assert.equal(state.combatQueue.some(entry => entry.type === 'charge_attack' && entry.attackerId === 'blue_dragoon_1'), false);
  assert.equal(declareResult.events[0].type, 'charge_roll_resolved');
  assert.equal(declareResult.events[0].payload.success, false);
  assert.equal(declareResult.events.some(event => event.type === 'combat_attack_resolved'), false);
});

test('hidden target beyond 4 inches cannot be declared as a ranged attack target', () => {
  const state = buildState();
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  placeLeaderAt(state, 'red_zealots_1', 11, 5);
  state.units.red_zealots_1.status.hidden = true;
  advanceToNextPhase(state);

  const declareResult = resolveDeclareRangedAttack(state, 'playerA', 'blue_marines_1', 'red_zealots_1');

  assert.equal(declareResult.ok, false);
  assert.match(declareResult.message, /hidden/i);
});

test('bulky ranged weapons cannot be declared while engaged', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_zealots_1', templateId: 'zealot_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  placeLeaderAt(state, 'red_zealots_1', 6, 5);
  advanceToNextPhase(state);
  state.units.blue_marines_1.rangedWeapons[0].bulky = true;
  state.units.blue_marines_1.status.engaged = true;

  const declareResult = resolveDeclareRangedAttack(state, 'playerA', 'blue_marines_1', 'red_zealots_1');

  assert.equal(declareResult.ok, false);
  assert.match(declareResult.message, /bulky/i);
});

test('engaged enemy units cannot be targeted by normal ranged attacks', () => {
  const state = buildState();
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  placeLeaderAt(state, 'red_zealots_1', 10, 5);
  advanceToNextPhase(state);
  state.units.red_zealots_1.status.engaged = true;

  const declareResult = resolveDeclareRangedAttack(state, 'playerA', 'blue_marines_1', 'red_zealots_1');

  assert.equal(declareResult.ok, false);
  assert.match(declareResult.message, /engaged/i);
});

test('pinpoint ranged weapons can target engaged enemy units', () => {
  const state = buildState();
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  placeLeaderAt(state, 'red_zealots_1', 10, 5);
  advanceToNextPhase(state);
  state.units.red_zealots_1.status.engaged = true;
  state.units.blue_marines_1.rangedWeapons[0].pinpoint = true;

  const declareResult = resolveDeclareRangedAttack(state, 'playerA', 'blue_marines_1', 'red_zealots_1');

  assert.equal(declareResult.ok, true);
  assert.equal(state.combatQueue.length, 0);
  assert.equal(state.lastCombatReport[0].targetId, 'red_zealots_1');
});

test('indirect fire can be declared without line of sight', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_kerrigan_1', templateId: 'kerrigan' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_kerrigan_1', 10, 16);
  placeLeaderAt(state, 'red_marines_1', 20, 16);
  advanceToNextPhase(state);

  const declareResult = resolveDeclareRangedAttack(state, 'playerA', 'blue_kerrigan_1', 'red_marines_1');

  assert.equal(declareResult.ok, true);
  assert.equal(state.combatQueue.length, 0);
  assert.equal(state.lastCombatReport[0].mode, 'ranged');
  assert.equal(state.lastCombatReport[0].targetId, 'red_marines_1');
});

test('flying units ignore blocker paths and enemy ground engagement while moving', () => {
  const state = buildState();
  placeLeaderAt(state, 'blue_marines_1', 4, 10);
  placeLeaderAt(state, 'red_zealots_1', 18, 10);

  const unit = state.units.blue_marines_1;
  unit.tags = unit.tags.filter(tag => tag !== 'Ground');
  unit.tags.push('Flying');
  unit.abilities.push('flying');
  unit.speed = 20;

  state.board.terrain.push({
    kind: 'blocker',
    impassable: true,
    rect: { minX: 8, maxX: 12, minY: 8, maxY: 12 }
  });

  const result = dispatch(state, {
    type: 'MOVE_UNIT',
    payload: {
      playerId: 'playerA',
      unitId: 'blue_marines_1',
      leadingModelId: unit.leadingModelId,
      path: [{ x: 4, y: 10 }, { x: 16.4, y: 10 }]
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.units.blue_marines_1.status.engaged, false);
});

test('burrow-capable units can burrow as an activation in movement', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_roach_1', templateId: 'roach_t3' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_roach_1', 8, 8);
  placeLeaderAt(state, 'red_marines_1', 20, 20);

  const actions = getLegalActionsForUnit(state, 'playerA', 'blue_roach_1');
  assert.equal(actions.some(action => action.type === 'TOGGLE_BURROW' && action.enabled), true);

  const result = dispatch(state, { type: 'TOGGLE_BURROW', payload: { playerId: 'playerA', unitId: 'blue_roach_1' } });

  assert.equal(result.ok, true);
  assert.equal(result.state.units.blue_roach_1.status.burrowed, true);
  assert.equal(result.state.units.blue_roach_1.status.hidden, true);
});

test('upgraded zerglings can burrow as a battlefield action', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zerglings_1', templateId: 'zergling_t3' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_zerglings_1', 8, 8);
  placeLeaderAt(state, 'red_marines_1', 20, 20);

  const actions = getLegalActionsForUnit(state, 'playerA', 'blue_zerglings_1');

  assert.equal(actions.some(action => action.type === 'TOGGLE_BURROW' && action.enabled), true);
});

test('burrowed units cannot declare ranged attacks or charges', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_roach_1', templateId: 'roach_t3' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_roach_1', 8, 8);
  placeLeaderAt(state, 'red_marines_1', 12, 8);
  state.units.blue_roach_1.status.burrowed = true;
  state.units.blue_roach_1.status.hidden = true;
  advanceToNextPhase(state);

  const ranged = resolveDeclareRangedAttack(state, 'playerA', 'blue_roach_1', 'red_marines_1');
  const charge = resolveDeclareCharge(state, 'playerA', 'blue_roach_1', 'red_marines_1');

  assert.equal(ranged.ok, false);
  assert.match(ranged.message, /burrowed/i);
  assert.equal(charge.ok, false);
  assert.match(charge.message, /burrowed/i);
});

test('running removes burrowed and hidden status', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_roach_1', templateId: 'roach_t3' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_roach_1', 8, 8);
  placeLeaderAt(state, 'red_marines_1', 20, 20);
  state.units.blue_roach_1.status.burrowed = true;
  state.units.blue_roach_1.status.hidden = true;
  advanceToNextPhase(state);

  const run = resolveRun(
    state,
    'playerA',
    'blue_roach_1',
    state.units.blue_roach_1.leadingModelId,
    [{ x: 8, y: 8 }, { x: 12, y: 8 }]
  );

  assert.equal(run.ok, true);
  assert.equal(state.units.blue_roach_1.status.burrowed, false);
  assert.equal(state.units.blue_roach_1.status.hidden, false);
});

test('burrowed regen heals damaged living models when the unit activates', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_roach_1', templateId: 'roach_t3' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_roach_1', 8, 8);
  placeLeaderAt(state, 'red_marines_1', 20, 20);

  const roach = state.units.blue_roach_1;
  roach.status.burrowed = true;
  roach.status.hidden = true;
  roach.models[roach.modelIds[0]].woundsRemaining = 1;

  const result = dispatch(state, { type: 'HOLD_UNIT', payload: { playerId: 'playerA', unitId: 'blue_roach_1' } });

  assert.equal(result.ok, true);
  assert.equal(result.state.units.blue_roach_1.models[roach.modelIds[0]].woundsRemaining, 3);
});

test('burrowed regen does not restore destroyed models', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_roach_1', templateId: 'roach_t3' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_roach_1', 8, 8);
  placeLeaderAt(state, 'red_marines_1', 20, 20);

  const roach = state.units.blue_roach_1;
  roach.status.burrowed = true;
  roach.status.hidden = true;
  roach.models[roach.modelIds[0]].alive = false;
  roach.models[roach.modelIds[0]].x = null;
  roach.models[roach.modelIds[0]].y = null;
  roach.models[roach.modelIds[0]].woundsRemaining = 0;
  roach.models[roach.modelIds[1]].woundsRemaining = 2;

  const result = dispatch(state, { type: 'HOLD_UNIT', payload: { playerId: 'playerA', unitId: 'blue_roach_1' } });

  assert.equal(result.ok, true);
  assert.equal(result.state.units.blue_roach_1.models[roach.modelIds[0]].alive, false);
  assert.equal(result.state.units.blue_roach_1.models[roach.modelIds[1]].woundsRemaining, 3);
});

test('both players passing in assault now enters the combat phase', () => {
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

test('both players passing in combat advances to cleanup and the next round', () => {
  const state = buildState();
  placeLeaderAt(state, 'blue_marines_1', 5, 5);
  placeLeaderAt(state, 'red_zealots_1', 30, 30);
  advanceToNextPhase(state);

  passPhase(state, 'playerA');
  passPhase(state, 'playerB');

  assert.equal(state.phase, 'combat');

  passPhase(state, 'playerA');
  const result = passPhase(state, 'playerB');

  assert.equal(result.ok, true);
  assert.equal(state.phase, 'movement');
  assert.equal(state.round, 2);
});

test('leg enhancements increase movement range for imported units', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealot_1', templateId: 'zealot_squad', selectedUpgrades: ['Leg Enhancements'] }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_zealot_1', 10, 10);
  placeLeaderAt(state, 'red_marines_1', 30, 30);

  const zealot = state.units.blue_zealot_1;
  const destination = { x: 18, y: 12 };
  const placements = autoArrangeModels(state, 'blue_zealot_1', destination);

  const result = dispatch(state, {
    type: 'MOVE_UNIT',
    payload: {
      playerId: 'playerA',
      unitId: 'blue_zealot_1',
      leadingModelId: zealot.leadingModelId,
      path: [{ x: 10, y: 10 }, destination],
      modelPlacements: placements
    }
  });

  assert.equal(result.ok, true);
});

test('solid-field projectors place a force field token during movement', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_sentry_1', templateId: 'sentry', selectedUpgrades: ['Solid-Field Projectors'] }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_sentry_1', 6, 4);
  placeLeaderAt(state, 'red_marines_1', 15, 4);

  const result = dispatch(state, {
    type: 'PLACE_FORCE_FIELD',
    payload: { playerId: 'playerA', unitId: 'blue_sentry_1', point: { x: 13, y: 4 } }
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.board.terrain.some(entry => entry.kind === 'force_field'), true);
  assert.equal(result.state.units.blue_sentry_1.status.movementActivated, true);
});

test('force field blocks size 2 or lower units from crossing it', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_sentry_1', templateId: 'sentry', selectedUpgrades: ['Solid-Field Projectors'] }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_sentry_1', 6, 4);
  placeLeaderAt(state, 'red_marines_1', 15, 4);

  const placed = dispatch(state, {
    type: 'PLACE_FORCE_FIELD',
    payload: { playerId: 'playerA', unitId: 'blue_sentry_1', point: { x: 13, y: 4 } }
  });

  const result = dispatch(placed.state, {
    type: 'MOVE_UNIT',
    payload: {
      playerId: 'playerB',
      unitId: 'red_marines_1',
      leadingModelId: placed.state.units.red_marines_1.leadingModelId,
      path: [{ x: 15, y: 4 }, { x: 11, y: 4 }],
      modelPlacements: autoArrangeModels(placed.state, 'red_marines_1', { x: 11, y: 4 })
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /force field/i);
});

test('size 3 units break force fields when moving through them', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_sentry_1', templateId: 'sentry', selectedUpgrades: ['Solid-Field Projectors'] }],
    armyB: [{ id: 'red_goliath_1', templateId: 'goliath' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_sentry_1', 6, 4);
  placeLeaderAt(state, 'red_goliath_1', 16, 4);

  const placed = dispatch(state, {
    type: 'PLACE_FORCE_FIELD',
    payload: { playerId: 'playerA', unitId: 'blue_sentry_1', point: { x: 13, y: 4 } }
  });

  const result = dispatch(placed.state, {
    type: 'MOVE_UNIT',
    payload: {
      playerId: 'playerB',
      unitId: 'red_goliath_1',
      leadingModelId: placed.state.units.red_goliath_1.leadingModelId,
      path: [{ x: 16, y: 4 }, { x: 10, y: 4 }],
      modelPlacements: autoArrangeModels(placed.state, 'red_goliath_1', { x: 10, y: 4 })
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.board.terrain.some(entry => entry.kind === 'force_field'), false);
});

test('medpack heals another friendly biological unit during movement', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [
      { id: 'blue_medic_1', templateId: 'medic_t1', selectedUpgrades: ['Stabilizer Medpacks'] },
      { id: 'blue_roach_1', templateId: 'roach_t3' }
    ],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_medic_1', 8, 8);
  placeLeaderAt(state, 'blue_roach_1', 10, 8);
  placeLeaderAt(state, 'red_marines_1', 20, 20);
  state.units.blue_roach_1.models[state.units.blue_roach_1.modelIds[0]].woundsRemaining = 1;

  const result = dispatch(state, {
    type: 'USE_MEDPACK',
    payload: { playerId: 'playerA', unitId: 'blue_medic_1', targetId: 'blue_roach_1' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.units.blue_roach_1.models[state.units.blue_roach_1.modelIds[0]].woundsRemaining, state.units.blue_roach_1.woundsPerModel);
  assert.ok(result.state.log.some(entry => entry.text.includes('uses Medpack')));
});

test('optical flare with A-13 flash grenade launcher suppresses long range declarations', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [
      { id: 'blue_medic_1', templateId: 'medic_t1', selectedUpgrades: ['A-13 Flash Grenade Launcher'] },
      { id: 'blue_marines_1', templateId: 'marine_squad' }
    ],
    armyB: [
      { id: 'red_hydra_1', templateId: 'hydralisk', selectedUpgrades: ['Grooved Spines'] }
    ],
    firstPlayerMarkerHolder: 'playerA'
  });
  beginRound(state);
  placeLeaderAt(state, 'blue_medic_1', 10, 10);
  placeLeaderAt(state, 'blue_marines_1', 31, 10);
  placeLeaderAt(state, 'red_hydra_1', 18, 10);

  const flareResult = dispatch(state, {
    type: 'USE_OPTICAL_FLARE',
    payload: { playerId: 'playerA', unitId: 'blue_medic_1', targetId: 'red_hydra_1' }
  });
  assert.equal(flareResult.ok, true);

  advanceToNextPhase(flareResult.state);
  flareResult.state.activePlayer = 'playerB';
  const rangedResult = resolveDeclareRangedAttack(flareResult.state, 'playerB', 'red_hydra_1', 'blue_marines_1');

  assert.equal(rangedResult.ok, false);
  assert.match(rangedResult.message, /out of range/i);
});
