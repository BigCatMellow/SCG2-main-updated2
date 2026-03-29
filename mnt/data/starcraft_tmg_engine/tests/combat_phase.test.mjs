import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { beginCombatPhase } from '../engine/phases.js';
import { resolveCombatPhase } from '../engine/combat.js';
import { passPhase } from '../engine/activation.js';
import { getLegalActionsForPlayer } from '../engine/legal_actions.js';
import { createSeededRng } from './helpers/rng.mjs';

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

test('resolveCombatPhase applies seeded ranged casualties and supply updates', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zealots_1', 12, 10);

  state.combatQueue.push({ type: "ranged_attack", attackerId: "blue_marines_1", targetId: "red_zealots_1" });
  const result = resolveCombatPhase(state, { rng: createSeededRng(42) });

  assert.equal(result.ok, true);
  assert.equal(state.lastCombatReport.length, 1);
  assert.equal(state.lastCombatReport[0].mode, 'ranged');
  assert.ok(state.lastCombatReport[0].casualties >= 0);
  assert.equal(state.units.red_zealots_1.currentSupplyValue <= 2, true);
});

test('resolveCombatPhase resolves charge declarations as melee attacks', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_zealots_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 11, 10);

  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_zealots_1', targetId: 'red_zerglings_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(1337) });

  assert.equal(result.ok, true);
  assert.equal(state.lastCombatReport[0].mode, 'melee');
  assert.ok(state.lastCombatReport[0].casualties >= 0);
});

test('charge attack performs pile-in movement before resolving melee', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_zealots_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 13, 10); // outside melee reach, inside pile-in distance

  const before = state.units.blue_zealots_1.models[state.units.blue_zealots_1.leadingModelId].x;
  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_zealots_1', targetId: 'red_zerglings_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(77) });
  const after = state.units.blue_zealots_1.models[state.units.blue_zealots_1.leadingModelId].x;

  assert.equal(result.ok, true);
  assert.ok(after > before, 'charge should move attacker toward target during pile-in');
  assert.equal(state.lastCombatReport[0].mode, 'melee');
});

test('melee kill consolidates toward nearest enemy', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [
      { id: 'red_zerglings_1', templateId: 'zergling_squad' },
      { id: 'red_marines_1', templateId: 'marine_squad' }
    ],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_zealots_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 11, 10);
  placeUnitAt(state, 'red_marines_1', 20, 10);

  // Make the first target easy to remove so consolidation can trigger.
  const zerg = state.units.red_zerglings_1;
  zerg.modelIds.slice(1).forEach(modelId => {
    zerg.models[modelId].alive = false;
    zerg.models[modelId].x = null;
    zerg.models[modelId].y = null;
  });

  const before = state.units.blue_zealots_1.models[state.units.blue_zealots_1.leadingModelId].x;
  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_zealots_1', targetId: 'red_zerglings_1' });
  resolveCombatPhase(state, { rng: createSeededRng(3) });
  const after = state.units.blue_zealots_1.models[state.units.blue_zealots_1.leadingModelId].x;

  assert.ok(after > before, 'attacker should consolidate toward next nearest enemy after a melee kill');
});

test('overwatch attacks resolve as reduced-volume ranged attacks', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_dragoon_1', templateId: 'dragoon' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_dragoon_1', 11, 10);

  state.combatQueue.push({ type: 'overwatch_attack', attackerId: 'red_dragoon_1', targetId: 'blue_marines_1' });
  resolveCombatPhase(state, { rng: createSeededRng(19) });

  assert.equal(state.lastCombatReport.length, 1);
  assert.equal(state.lastCombatReport[0].mode, 'overwatch');
  assert.equal(state.lastCombatReport[0].attempts, 2); // dragoon 4 shots, overwatch halves volume
});

test('ranged targets in cover receive defensive save benefit', () => {
  const build = () => createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_dragoon_1', templateId: 'dragoon' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });

  const noCover = build();
  placeUnitAt(noCover, 'blue_dragoon_1', 10, 9);
  placeUnitAt(noCover, 'red_marines_1', 13, 9); // not in cover
  noCover.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_dragoon_1', targetId: 'red_marines_1' });
  resolveCombatPhase(noCover, { rng: createSeededRng(55) });
  const casualtiesNoCover = noCover.lastCombatReport[0].casualties;

  const withCover = build();
  placeUnitAt(withCover, 'blue_dragoon_1', 10, 9);
  placeUnitAt(withCover, 'red_marines_1', 16, 9); // inside cover rectangle
  withCover.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_dragoon_1', targetId: 'red_marines_1' });
  resolveCombatPhase(withCover, { rng: createSeededRng(55) });
  const casualtiesWithCover = withCover.lastCombatReport[0].casualties;

  assert.ok(casualtiesWithCover <= casualtiesNoCover);
});

test('beginCombatPhase is interactive and resolves queued attacks on phase pass-out', () => {
  const state = buildState();
  state.phase = 'assault';
  state.round = 1;
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zealots_1', 12, 10);

  state.combatQueue.push({ type: "ranged_attack", attackerId: "blue_marines_1", targetId: "red_zealots_1" });
  const begin = beginCombatPhase(state);

  assert.equal(begin.ok, true);
  assert.equal(state.phase, 'combat');
  assert.equal(state.combatQueue.length, 1);

  const passA = passPhase(state, 'playerA');
  assert.equal(passA.ok, true);
  const passB = passPhase(state, 'playerB');
  assert.equal(passB.ok, true);

  assert.equal(state.phase, 'movement');
  assert.equal(state.round, 2);
  assert.equal(state.combatQueue.length, 0);
  assert.equal(state.players.playerA.vp >= 0, true);
});

test('combat legal actions include RESOLVE_COMBAT_UNIT for queued attacker', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zealots_1', 12, 10);
  state.phase = 'combat';
  state.activePlayer = 'playerA';
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zealots_1' });

  const actions = getLegalActionsForPlayer(state, 'playerA');
  const resolveAction = actions.find(action => action.type === 'RESOLVE_COMBAT_UNIT' && action.unitId === 'blue_marines_1');

  assert.ok(resolveAction);
  assert.equal(resolveAction.enabled, true);
});
