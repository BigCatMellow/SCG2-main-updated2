import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { beginCombatPhase } from '../engine/phases.js';
import { resolveCombatPhase, getCombatActivationPreview, getMeleeTargetSelection } from '../engine/combat.js';
import { dispatch as reduceState } from '../engine/reducer.js';
import { createSeededRng } from './helpers/rng.mjs';
import { canTargetWithRangedWeapon } from '../engine/visibility.js';

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

function placeModelAt(state, unitId, modelId, x, y) {
  const unit = state.units[unitId];
  unit.models[modelId].x = x;
  unit.models[modelId].y = y;
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

test('burrowed melee attacker closes ranks before resolving combat', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_roach_1', templateId: 'roach_t3' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_roach_1', 10, 10);
  placeUnitAt(state, 'red_marines_1', 11, 10);
  state.units.blue_roach_1.status.burrowed = true;
  state.units.blue_roach_1.status.hidden = true;

  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_roach_1', targetId: 'red_marines_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(21) });

  assert.equal(result.ok, true);
  assert.equal(state.units.blue_roach_1.status.burrowed, false);
  assert.equal(state.units.blue_roach_1.status.hidden, false);
  assert.equal(state.lastCombatReport[0].mode, 'melee');
  assert.ok(state.log.some(entry => entry.text.includes('closes ranks and emerges')));
});

test('combat phase offers close ranks as a real activation for engaged burrowed units', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_roach_1', templateId: 'roach_t3' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_roach_1', 10, 10);
  placeUnitAt(state, 'red_marines_1', 11, 10);
  state.phase = 'combat';
  state.activePlayer = 'playerA';
  state.units.blue_roach_1.status.burrowed = true;
  state.units.blue_roach_1.status.hidden = true;
  state.units.blue_roach_1.status.engaged = true;
  state.units.red_marines_1.status.engaged = true;

  const beforeActions = reduceState(state, { type: 'CLOSE_RANKS', payload: { playerId: 'playerA', unitId: 'blue_roach_1' } });

  assert.equal(beforeActions.ok, true);
  assert.equal(beforeActions.state.units.blue_roach_1.status.burrowed, false);
  assert.equal(beforeActions.state.units.blue_roach_1.status.hidden, false);
  assert.equal(beforeActions.state.units.blue_roach_1.status.combatActivated, true);
  assert.equal(beforeActions.state.activePlayer, 'playerB');
  assert.ok(beforeActions.state.log.some(entry => entry.text.includes('closes ranks and emerges')));
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

test('melee attacks only use fighting and supporting rank models', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_zealots_1', 10, 10);
  placeUnitAt(state, 'red_marines_1', 11.4, 10);

  const zealot = state.units.blue_zealots_1;
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[0], 10, 10);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[1], 8.8, 10);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[2], 6.8, 10);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[3], 6.8, 11.4);

  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_zealots_1', targetId: 'red_marines_1' });
  resolveCombatPhase(state, { rng: createSeededRng(8) });

  assert.equal(state.lastCombatReport[0].mode, 'melee');
  assert.equal(state.lastCombatReport[0].fightingRank, 1);
  assert.equal(state.lastCombatReport[0].supportingRank, 1);
  assert.equal(state.lastCombatReport[0].attempts, 4);
});

test('split engagement creates separate melee batches for multiple enemy units', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [
      { id: 'red_marines_1', templateId: 'marine_squad' },
      { id: 'red_marines_2', templateId: 'marine_squad' }
    ],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_zealots_1', 10, 10);
  placeUnitAt(state, 'red_marines_1', 11.4, 10);
  placeUnitAt(state, 'red_marines_2', 11.4, 12.4);

  const zealot = state.units.blue_zealots_1;
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[0], 10, 10);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[1], 8.8, 10);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[2], 10, 12.4);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[3], 8.8, 12.4);

  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_zealots_1', targetId: 'red_marines_1' });
  resolveCombatPhase(state, { rng: createSeededRng(9) });

  assert.equal(state.lastCombatReport.length, 2);
  const targetIds = new Set(state.lastCombatReport.map(entry => entry.targetId));
  assert.equal(targetIds.has('red_marines_1'), true);
  assert.equal(targetIds.has('red_marines_2'), true);
  for (const report of state.lastCombatReport) {
    assert.equal(report.mode, 'melee');
    assert.ok(report.fightingRank >= 1);
    assert.ok(report.supportingRank >= 1);
    assert.ok(report.attempts >= 4);
  }
});

test('primary target focus wins ambiguous melee allocation', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [
      { id: 'red_marines_1', templateId: 'marine_squad' },
      { id: 'red_marines_2', templateId: 'marine_squad' }
    ],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_zealots_1', 10, 11);
  placeUnitAt(state, 'red_marines_1', 11.4, 10);
  placeUnitAt(state, 'red_marines_2', 11.4, 12);

  const zealot = state.units.blue_zealots_1;
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[0], 10, 11);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[1], 8.8, 11);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[2], 6.5, 11);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[3], 6.5, 12.4);

  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_zealots_1', targetId: 'red_marines_2' });
  resolveCombatPhase(state, { rng: createSeededRng(10) });

  assert.equal(state.lastCombatReport.length, 2);
  const primaryReport = state.lastCombatReport.find(entry => entry.targetId === 'red_marines_2');
  const secondaryReport = state.lastCombatReport.find(entry => entry.targetId === 'red_marines_1');
  assert.equal(primaryReport?.primaryTargetFocus, true);
  assert.equal(primaryReport?.assignedModels, 1);
  assert.equal(secondaryReport?.primaryTargetFocus, false);
  assert.equal(secondaryReport?.assignedModels, 1);
});

test('melee target selection previews focus options for split engagements', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [
      { id: 'red_marines_1', templateId: 'marine_squad' },
      { id: 'red_marines_2', templateId: 'marine_squad' }
    ],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_zealots_1', 10, 11);
  placeUnitAt(state, 'red_marines_1', 11.4, 10);
  placeUnitAt(state, 'red_marines_2', 11.4, 12);

  const zealot = state.units.blue_zealots_1;
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[0], 10, 11);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[1], 8.8, 11);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[2], 6.5, 11);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[3], 6.5, 12.4);

  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_zealots_1', targetId: 'red_marines_1' });
  const selection = getMeleeTargetSelection(state, 'blue_zealots_1');

  assert.ok(selection);
  assert.equal(selection?.options.length, 2);
  assert.equal(selection?.currentPrimaryTargetId, 'red_marines_1');
  assert.deepEqual(
    selection?.options.map(option => option.targetId).sort(),
    ['red_marines_1', 'red_marines_2']
  );
});

test('combat activation preview lists numbered attack steps before resolution', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [
      { id: 'red_zealots_1', templateId: 'zealot_squad' },
      { id: 'red_dragoon_1', templateId: 'dragoon' }
    ],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zealots_1', 12, 10);
  placeUnitAt(state, 'red_dragoon_1', 14, 10);

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zealots_1' });
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_dragoon_1' });

  const preview = getCombatActivationPreview(state, 'blue_marines_1');

  assert.ok(preview);
  assert.equal(preview?.steps.length, 2);
  assert.equal(preview?.steps[0].label, 'Ranged Attack');
  assert.equal(preview?.steps[0].targetId, 'red_zealots_1');
  assert.equal(preview?.steps[1].targetId, 'red_dragoon_1');
});

test('setting charge primary target updates queued melee focus before resolution', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad' }],
    armyB: [
      { id: 'red_marines_1', templateId: 'marine_squad' },
      { id: 'red_marines_2', templateId: 'marine_squad' }
    ],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_zealots_1', 10, 11);
  placeUnitAt(state, 'red_marines_1', 11.4, 10);
  placeUnitAt(state, 'red_marines_2', 11.4, 12);

  const zealot = state.units.blue_zealots_1;
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[0], 10, 11);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[1], 8.8, 11);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[2], 6.5, 11);
  placeModelAt(state, 'blue_zealots_1', zealot.modelIds[3], 6.5, 12.4);

  state.phase = 'combat';
  state.activePlayer = 'playerA';
  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_zealots_1', targetId: 'red_marines_1' });

  const retargetResult = reduceState(state, {
    type: 'SET_CHARGE_PRIMARY_TARGET',
    payload: { playerId: 'playerA', unitId: 'blue_zealots_1', targetId: 'red_marines_2' }
  });

  assert.equal(retargetResult.ok, true);
  const updatedQueueEntry = retargetResult.state.combatQueue.find(entry => entry.attackerId === 'blue_zealots_1');
  assert.equal(updatedQueueEntry?.primaryTargetId, 'red_marines_2');

  const combatResult = resolveCombatPhase(retargetResult.state, { rng: createSeededRng(10) });
  assert.equal(combatResult.ok, true);
  const primaryReport = retargetResult.state.lastCombatReport.find(entry => entry.targetId === 'red_marines_2');
  assert.equal(primaryReport?.primaryTargetFocus, true);
});

test('raptor charge resolves impact hits before melee damage', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_raptors_1', templateId: 'raptor_t2' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_t2' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_raptors_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 11, 10);

  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_raptors_1', targetId: 'red_zerglings_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(5) });

  assert.equal(result.ok, true);
  assert.equal(state.lastCombatReport[0].mode, 'melee');
  assert.ok(state.lastCombatReport[0].impact, 'impact result should be recorded');
  assert.ok(state.lastCombatReport[0].impact.attempts > 0);
});

test('surge bypasses armour when the target matches the weapon surge tags', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_t2' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 12, 10);

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zerglings_1' });
  const rolls = [
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.66,
    0.0, 0.0, 0.0, 0.0
  ];
  let index = 0;
  const result = resolveCombatPhase(state, {
    rng: () => rolls[index++] ?? 0
  });

  assert.equal(result.ok, true);
  assert.equal(state.lastCombatReport.length, 1);
  assert.equal(state.lastCombatReport[0].surge?.dice, 'D3');
  assert.equal(state.lastCombatReport[0].surge?.applied, 2);
  assert.equal(state.lastCombatReport[0].saved, 0);
  assert.equal(state.lastCombatReport[0].casualties, 8);
});

test('life support reduces damage from nearby medics with stabilizer medpacks', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [
      { id: 'red_roach_1', templateId: 'roach_t3' },
      { id: 'red_medic_1', templateId: 'medic_t1', selectedUpgrades: ['Stabilizer Medpacks'] }
    ],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_roach_1', 12, 10);
  placeUnitAt(state, 'red_medic_1', 12, 12);
  state.units.blue_marines_1.rangedWeapons[0].shotsPerModel = 4;
  state.units.blue_marines_1.rangedWeapons[0].hitTarget = 2;
  state.units.blue_marines_1.rangedWeapons[0].strength = 7;

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_roach_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(42) });

  assert.equal(result.ok, true);
  assert.ok(state.lastCombatReport[0].lifeSupport);
  assert.ok(state.lastCombatReport[0].lifeSupport.reducedBy >= 1);
});

test('transfusion reduces incoming damage for nearby friendly biological units', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [
      { id: 'red_roach_1', templateId: 'roach_t3' },
      { id: 'red_queen_1', templateId: 'queen' }
    ],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_roach_1', 12, 10);
  placeUnitAt(state, 'red_queen_1', 13, 10);
  state.units.blue_marines_1.rangedWeapons[0].shotsPerModel = 4;
  state.units.blue_marines_1.rangedWeapons[0].hitTarget = 2;
  state.units.blue_marines_1.rangedWeapons[0].strength = 7;

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_roach_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(42) });

  assert.equal(result.ok, true);
  assert.equal(state.lastCombatReport[0].transfusion?.sourceUnitId, 'red_queen_1');
  assert.equal(state.lastCombatReport[0].transfusion?.reducedBy, 2);
  assert.ok(state.log.some(entry => entry.text.includes('uses Transfusion')));
});

test('ancillary carapace applies on the first armour roll of the phase', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_roach_1', templateId: 'roach_t3', selectedUpgrades: ['Ancillary Carapace'] }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_roach_1', 12, 10);
  state.units.blue_marines_1.rangedWeapons[0].shotsPerModel = 4;
  state.units.blue_marines_1.rangedWeapons[0].hitTarget = 2;
  state.units.blue_marines_1.rangedWeapons[0].strength = 7;

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_roach_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(42) });

  assert.equal(result.ok, true);
  assert.ok(state.lastCombatReport[0].ancillaryCarapace);
  assert.equal(state.units.red_roach_1.status.ancillaryCarapaceUsedThisPhase, true);
});

test('lurking grants the first ranged evade while stationary', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_roach_1', templateId: 'roach_t3', selectedUpgrades: ['Lurking'] }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_roach_1', 12, 10);
  state.units.red_roach_1.status.stationary = true;
  state.units.blue_marines_1.rangedWeapons[0].shotsPerModel = 4;
  state.units.blue_marines_1.rangedWeapons[0].hitTarget = 2;
  state.units.blue_marines_1.rangedWeapons[0].strength = 7;

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_roach_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(42) });

  assert.equal(result.ok, true);
  assert.ok(state.lastCombatReport[0].evade);
  assert.equal(state.lastCombatReport[0].evade.lurkingBonus, 1);
  assert.equal(state.units.red_roach_1.status.lurkingUsedThisRound, true);
});

test('precision converts failed hit dice into extra hits', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_t2' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 12, 10);
  state.units.blue_marines_1.rangedWeapons[0].precision = 2;

  const rolls = [
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.9, 0.9,
    0.0, 0.0
  ];
  let index = 0;
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zerglings_1' });
  resolveCombatPhase(state, { rng: () => rolls[index++] ?? 0 });

  assert.equal(state.lastCombatReport[0].precision, 2);
  assert.equal(state.lastCombatReport[0].hits, 2);
  assert.ok(state.lastCombatReport[0].casualties >= 2);
});

test('hits keyword adds automatic armour-pool hits without generating surge', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_t2' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 12, 10);
  Object.assign(state.units.blue_marines_1.rangedWeapons[0], {
    shotsPerModel: 1,
    hitTarget: 6,
    damage: 1,
    surge: { tags: ['Light'], dice: 'D6' },
    hits: { count: 2, damage: 2 }
  });

  const rolls = [
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0
  ];
  let index = 0;
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zerglings_1' });
  resolveCombatPhase(state, { rng: () => rolls[index++] ?? 0 });

  assert.deepEqual(state.lastCombatReport[0].automaticHits, { count: 2, damage: 2 });
  assert.equal(state.lastCombatReport[0].surge, null);
  assert.equal(state.lastCombatReport[0].hits, 2);
  assert.equal(state.lastCombatReport[0].totalDamage, 4);
});

test('long range allows attacks beyond base range with a hit penalty', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_t2' }],
    armyB: [{ id: 'red_dragoon_1', templateId: 'dragoon' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_dragoon_1', 26, 10);
  state.units.blue_marines_1.rangedWeapons[0].rangeInches = 12;
  state.units.blue_marines_1.rangedWeapons[0].longRange = 18;

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_dragoon_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(42) });

  assert.equal(result.ok, true);
  assert.equal(state.lastCombatReport[0].longRangePenalty, true);
});

test('critical hit bypasses armour before saves are rolled', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_kerrigan_1', templateId: 'kerrigan' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_kerrigan_1', 10, 10);
  placeUnitAt(state, 'red_marines_1', 11, 10);

  const rolls = [
    0.9, 0.9, 0.9, 0.9, 0.9,
    0.9, 0.9, 0.9, 0.9, 0.9,
    0.0, 0.0, 0.0
  ];
  let index = 0;
  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_kerrigan_1', targetId: 'red_marines_1' });
  resolveCombatPhase(state, { rng: () => rolls[index++] ?? 0 });

  assert.equal(state.lastCombatReport[0].criticalHit?.applied, 2);
  assert.ok(state.lastCombatReport[0].casualties >= 2);
});

test('pierce changes damage against matching target tags', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_t2' }],
    armyB: [{ id: 'red_dragoon_1', templateId: 'dragoon' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_dragoon_1', 12, 10);
  state.units.blue_marines_1.rangedWeapons[0].pierce = { tag: 'Armoured', damage: 3 };

  const rolls = [
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.0,
    0.0, 0.0, 0.0, 0.0, 0.0
  ];
  let index = 0;
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_dragoon_1' });
  resolveCombatPhase(state, { rng: () => rolls[index++] ?? 0 });

  assert.equal(state.lastCombatReport[0].damagePerHit, 3);
  assert.ok(state.lastCombatReport[0].totalDamage >= 3);
});

test('hidden target can use evade to cancel unsaved ranged hits', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_t2' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 12, 10);
  state.units.red_zerglings_1.status.hidden = true;

  const rolls = [
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.0,
    0.0, 0.0, 0.0, 0.0, 0.0,
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9
  ];
  let index = 0;
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zerglings_1' });
  resolveCombatPhase(state, { rng: () => rolls[index++] ?? 0 });

  assert.equal(state.lastCombatReport[0].evade?.saved, 5);
  assert.equal(state.lastCombatReport[0].casualties, 1);
});

test('detection removes hidden evade protection for nearby targets', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [
      { id: 'blue_marines_1', templateId: 'marine_t2' },
      { id: 'blue_omega_worm_1', templateId: 'omega_worm' }
    ],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'blue_omega_worm_1', 15, 10);
  placeUnitAt(state, 'red_zerglings_1', 16, 12);
  state.units.red_zerglings_1.status.hidden = true;

  const rolls = [
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0
  ];
  let index = 0;
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zerglings_1' });
  resolveCombatPhase(state, { rng: () => rolls[index++] ?? 0 });

  assert.equal(state.lastCombatReport[0].evade?.saved ?? 0, 0);
  assert.equal(state.lastCombatReport[0].casualties > 0, true);
});

test('anti-evade worsens the target evade roll', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_t2' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 12, 10);
  state.units.red_zerglings_1.status.hidden = true;
  state.units.blue_marines_1.rangedWeapons[0].antiEvade = 2;
  state.units.blue_marines_1.rangedWeapons[0].surge = null;

  const rolls = [
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.7, 0.7, 0.7, 0.7, 0.7, 0.7
  ];
  let index = 0;
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zerglings_1' });
  resolveCombatPhase(state, { rng: () => rolls[index++] ?? 0 });

  assert.equal(state.lastCombatReport[0].antiEvade, 2);
  assert.equal(state.lastCombatReport[0].evade?.target, 6);
  assert.ok(state.lastCombatReport[0].casualties > 0);
});

test('dodge converts bypassed hits back into saveable wounds', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_kerrigan_1', templateId: 'kerrigan' }],
    armyB: [{ id: 'red_dragoon_1', templateId: 'dragoon' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_kerrigan_1', 10, 10);
  placeUnitAt(state, 'red_dragoon_1', 11, 10);
  state.units.red_dragoon_1.defense.dodge = 2;

  const rolls = [
    0.9, 0.9, 0.9, 0.9, 0.9,
    0.9, 0.9, 0.9, 0.9, 0.9,
    0.0, 0.0, 0.0, 0.9, 0.9
  ];
  let index = 0;
  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_kerrigan_1', targetId: 'red_dragoon_1' });
  resolveCombatPhase(state, { rng: () => rolls[index++] ?? 0 });

  assert.equal(state.lastCombatReport[0].criticalHit?.applied, 2);
  assert.equal(state.lastCombatReport[0].dodge?.prevented, 2);
  assert.equal(state.lastCombatReport[0].totalDamage, 4);
});

test('hidden target ignores impact hits during a charge', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_raptors_1', templateId: 'raptor_t2' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_t2' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_raptors_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 11, 10);
  state.units.red_zerglings_1.status.hidden = true;

  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_raptors_1', targetId: 'red_zerglings_1' });
  resolveCombatPhase(state, { rng: createSeededRng(5) });

  assert.equal(state.lastCombatReport[0].impact?.preventedByHidden, true);
});

test('zergling charge uses its built-in impact profile', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zerglings_1', templateId: 'zergling_t2' }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_zerglings_1', 10, 10);
  placeUnitAt(state, 'red_marines_1', 11, 10);

  state.combatQueue.push({ type: 'charge_attack', attackerId: 'blue_zerglings_1', targetId: 'red_marines_1' });
  resolveCombatPhase(state, { rng: createSeededRng(11) });

  assert.equal(state.lastCombatReport[0].impact?.hitTarget, 5);
  assert.equal(state.lastCombatReport[0].impact?.attempts > 0, true);
});

test('roach acid spit now carries surge against light targets', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_roach_1', templateId: 'roach_t3' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_roach_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 12, 10);

  const rolls = [
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.9, 0.9, 0.9, 0.9, 0.9, 0.9,
    0.5,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0
  ];
  let index = 0;
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_roach_1', targetId: 'red_zerglings_1' });
  resolveCombatPhase(state, { rng: () => rolls[index++] ?? 0 });

  assert.equal(state.lastCombatReport[0].surge?.dice, 'D3+1');
  assert.equal(state.lastCombatReport[0].surge?.applied >= 1, true);
});

test('burst fire increases ranged attack volume at close range', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_t2' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 16, 12);
  state.units.blue_marines_1.rangedWeapons[0].burstFire = { rangeInches: 8, bonusAttacks: 3 };

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zerglings_1' });
  resolveCombatPhase(state, { rng: createSeededRng(12) });

  assert.equal(state.lastCombatReport[0].attempts, 24);
  assert.equal(state.lastCombatReport[0].burstFire?.bonusAttacks, 3);
});

test('locked in adds attacks against stationary targets', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_t2' }],
    armyB: [{ id: 'red_dragoon_1', templateId: 'dragoon' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_dragoon_1', 18, 12);
  state.units.red_dragoon_1.status.stationary = true;
  state.units.blue_marines_1.rangedWeapons[0].lockedIn = 2;

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_dragoon_1' });
  resolveCombatPhase(state, { rng: createSeededRng(14) });

  assert.equal(state.lastCombatReport[0].attempts, 18);
  assert.equal(state.lastCombatReport[0].lockedIn, 2);
});

test('concentrated fire caps casualties and discards excess damage', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_t2' }],
    armyB: [{ id: 'red_zerglings_1', templateId: 'zergling_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zerglings_1', 12, 10);
  Object.assign(state.units.blue_marines_1.rangedWeapons[0], {
    shotsPerModel: 2,
    hitTarget: 2,
    strength: 10,
    damage: 2,
    surge: null,
    concentratedFire: 1
  });

  const rolls = new Array(24).fill(0.9).concat(new Array(12).fill(0.0));
  let index = 0;
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zerglings_1' });
  resolveCombatPhase(state, { rng: () => rolls[index++] ?? 0 });

  assert.equal(state.lastCombatReport[0].casualties, 1);
  assert.equal(state.lastCombatReport[0].concentratedFire?.cap, 1);
  assert.ok(state.lastCombatReport[0].concentratedFire?.discardedDamage > 0);
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

test('unit combat activation dispatch preserves combat resolution events', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zealots_1', 12, 10);
  state.phase = 'combat';
  state.activePlayer = 'playerA';
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zealots_1' });

  const result = reduceState(state, {
    type: 'RESOLVE_COMBAT_UNIT',
    payload: { playerId: 'playerA', unitId: 'blue_marines_1' }
  });

  assert.equal(result.ok, true);
  assert.ok(result.events?.some(event => event.type === 'combat_attack_resolved'));
});

test('beginCombatPhase starts an interactive combat activation phase', () => {
  const state = buildState();
  state.round = 1;
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zealots_1', 12, 10);

  state.combatQueue.push({ type: "ranged_attack", attackerId: "blue_marines_1", targetId: "red_zealots_1" });
  const result = beginCombatPhase(state);

  assert.equal(result.ok, true);
  assert.equal(state.phase, 'combat');
  assert.equal(state.round, 1);
  assert.equal(state.lastCombatReport?.length ?? 0, 0);
  assert.equal(state.units.blue_marines_1.status.combatActivated, false);
});

test('flying units ignore blocker line of sight rules', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zealots_1', 18, 10);
  state.units.red_zealots_1.tags = state.units.red_zealots_1.tags.filter(tag => tag !== 'Ground');
  state.units.red_zealots_1.tags.push('Flying');
  state.units.red_zealots_1.abilities.push('flying');
  state.board.terrain.push({
    kind: 'blocker',
    impassable: true,
    rect: { minX: 13, maxX: 15, minY: 8, maxY: 12 }
  });

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zealots_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(4) });

  assert.equal(result.ok, true);
  assert.equal(state.lastCombatReport[0].visible, true);
});

test('hallucination support grants evade against nearby ranged attacks', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [
      { id: 'blue_sentry_1', templateId: 'sentry', selectedUpgrades: ['Hallucination'] },
      { id: 'blue_adept_1', templateId: 'adept' }
    ],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_sentry_1', 10, 10);
  placeUnitAt(state, 'blue_adept_1', 12, 10);
  placeUnitAt(state, 'red_marines_1', 20, 10);

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'red_marines_1', targetId: 'blue_adept_1' });
  resolveCombatPhase(state, { rng: createSeededRng(44) });

  assert.ok(state.lastCombatReport[0].evade);
  assert.ok(state.lastCombatReport[0].evade.saved >= 0);
});

test('guardian shield removes a die from nearby ranged attacks', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [
      { id: 'blue_marines_1', templateId: 'marine_squad' },
      { id: 'blue_sentry_1', templateId: 'sentry' }
    ],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerB'
  });
  placeUnitAt(state, 'blue_marines_1', 12, 10);
  placeUnitAt(state, 'blue_sentry_1', 10, 10);
  placeUnitAt(state, 'red_marines_1', 18, 10);
  state.effects.push({
    id: 'guardian_shield_test',
    name: 'Guardian Shield',
    source: { kind: 'unit', id: 'blue_sentry_1', owner: 'playerA' },
    target: { scope: 'unit', unitId: 'blue_sentry_1' },
    zone: { kind: 'guardian_shield_field', radius: 6 },
    duration: { type: 'rounds', remaining: 1 },
    timings: [],
    modifiers: []
  });

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'red_marines_1', targetId: 'blue_marines_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(7) });

  assert.equal(result.ok, true);
  assert.equal(state.lastCombatReport[0].guardianShield?.reducedBy, 1);
  assert.ok(state.log.some(entry => entry.text.includes('Guardian Shield -1')));
});

test('point defense laser sacrifices the drone to strip dice from a nearby ranged attack', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [
      { id: 'blue_marines_1', templateId: 'marine_squad' },
      { id: 'blue_pdd_1', templateId: 'point_defense_drone' }
    ],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_squad' }],
    firstPlayerMarkerHolder: 'playerB'
  });
  placeUnitAt(state, 'blue_marines_1', 12, 10);
  placeUnitAt(state, 'blue_pdd_1', 10, 10);
  placeUnitAt(state, 'red_marines_1', 18, 10);

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'red_marines_1', targetId: 'blue_marines_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(7) });

  assert.equal(result.ok, true);
  assert.equal(state.lastCombatReport[0].pointDefenseLaser?.reducedBy, 2);
  assert.equal(state.units.blue_pdd_1.status.location, 'destroyed');
  assert.equal(state.players.playerA.battlefieldUnitIds.includes('blue_pdd_1'), false);
  assert.ok(state.log.some(entry => entry.text.includes('Point Defense Laser')));
});

test('stimpack effect can coexist with combat resolution without breaking the attack flow', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_t2' }],
    armyB: [{ id: 'red_zealots_1', templateId: 'zealot_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
  placeUnitAt(state, 'blue_marines_1', 12, 10);
  placeUnitAt(state, 'red_zealots_1', 18, 10);
  if (!state.units.blue_marines_1.abilities.includes('stimpack_drill')) {
    state.units.blue_marines_1.abilities.push('stimpack_drill');
  }
  state.effects.push({
    id: 'stimpack_test',
    name: 'Stimpack',
    source: { kind: 'unit', id: 'blue_marines_1', owner: 'playerA' },
    target: { scope: 'unit', unitId: 'blue_marines_1' },
    duration: { type: 'rounds', remaining: 1 },
    timings: [],
    modifiers: [{ key: 'unit.speed', operation: 'add', value: 3 }]
  });

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zealots_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(11) });

  assert.equal(result.ok, true);
  assert.equal(state.lastCombatReport[0].attackerId, 'blue_marines_1');
  assert.equal(state.effects.some(effect => effect.name === 'Stimpack' && effect.target?.unitId === 'blue_marines_1'), true);
});

test('zealous round reduces incoming damage and marks the target activated for the phase', () => {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_zealots_1', templateId: 'zealot_squad', selectedUpgrades: ['Zealous Round'] }],
    armyB: [{ id: 'red_marines_1', templateId: 'marine_t2' }],
    firstPlayerMarkerHolder: 'playerB'
  });
  placeUnitAt(state, 'blue_zealots_1', 12, 10);
  placeUnitAt(state, 'red_marines_1', 10, 10);

  state.phase = 'combat';
  state.activePlayer = 'playerB';
  const weapon = state.units.red_marines_1.rangedWeapons[0];
  weapon.shotsPerModel = 1;
  weapon.hitTarget = 2;
  weapon.strength = 8;
  weapon.armorPenetration = 3;
  weapon.damage = 1;
  weapon.surge = null;

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'red_marines_1', targetId: 'blue_zealots_1' });
  const rolls = [
    0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
    0.99, 0.99, 0.99, 0.99, 0.99, 0.99,
    0.0, 0.0
  ];
  let index = 0;
  resolveCombatPhase(state, { rng: () => rolls[index++] ?? 0 });

  assert.equal(state.lastCombatReport[0].zealousRound?.reducedBy, 2);
  assert.equal(state.units.blue_zealots_1.status.combatActivated, true);
  assert.equal(state.units.blue_zealots_1.status.zealousRoundUsedThisRound, true);
});

test('grass conceals ranged targets beyond 4 inches', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 10, 10);
  placeUnitAt(state, 'red_zealots_1', 17, 9);

  const attacker = state.units.blue_marines_1;
  const target = state.units.red_zealots_1;
  const weapon = attacker.rangedWeapons[0];
  const targeting = canTargetWithRangedWeapon(state, attacker, target, weapon);

  assert.equal(targeting.ok, false);
  assert.match(targeting.reason, /grass/i);
});

test('high ground grants an extra save bonus against lower ranged attackers', () => {
  const state = buildState();
  placeUnitAt(state, 'blue_marines_1', 17, 17);
  placeUnitAt(state, 'red_zealots_1', 17, 25);

  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_marines_1', targetId: 'red_zealots_1' });
  const result = resolveCombatPhase(state, { rng: createSeededRng(42) });

  assert.equal(result.ok, true);
  assert.equal(state.lastCombatReport[0].highGround, true);
});
