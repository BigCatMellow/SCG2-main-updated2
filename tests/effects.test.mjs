import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialGameState } from '../engine/state.js';
import { addEffect, getModifiedValue, onPhaseStart, onRoundStart } from '../engine/effects.js';
import { beginRound } from '../engine/phases.js';
import { advanceToNextPhase } from '../engine/phases.js';
import { validateDeclareRangedAttack } from '../engine/assault.js';

function buildState() {
  return createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
    armyB: [{ id: 'red_zealots_1', templateId: 'zealot_squad' }],
    firstPlayerMarkerHolder: 'playerA'
  });
}

test('effect modifiers apply in priority order for a timing/key', () => {
  const state = buildState();
  addEffect(state, {
    target: { scope: 'unit', unitId: 'blue_marines_1' },
    timings: ['combat_resolve_attack'],
    modifiers: [{ key: 'weapon.shotsPerModel', operation: 'add', value: 1, priority: 1 }]
  });
  addEffect(state, {
    target: { scope: 'unit', unitId: 'blue_marines_1' },
    timings: ['combat_resolve_attack'],
    modifiers: [{ key: 'weapon.shotsPerModel', operation: 'mul', value: 2, priority: 2 }]
  });

  const modified = getModifiedValue(state, {
    timing: 'combat_resolve_attack',
    unitId: 'blue_marines_1',
    key: 'weapon.shotsPerModel',
    baseValue: 1
  });

  assert.equal(modified.value, 4);
  assert.equal(modified.modifiersApplied.length, 2);
});

test('round and phase duration effects expire through hooks', () => {
  const state = buildState();
  addEffect(state, {
    name: 'One round buff',
    duration: { type: 'rounds', remaining: 1 },
    modifiers: [{ key: 'weapon.hitTarget', operation: 'add', value: -1 }]
  });
  addEffect(state, {
    name: 'Assault-only countdown',
    duration: { type: 'phase_starts', phase: 'assault', remaining: 1 },
    modifiers: [{ key: 'assault.canDeclareRanged', operation: 'set', value: false }]
  });

  assert.equal(state.effects.length, 2);
  onRoundStart(state);
  assert.equal(state.effects.length, 1);
  onPhaseStart(state, 'assault');
  assert.equal(state.effects.length, 0);
});

test('assault ranged declaration can be blocked by an effect modifier', () => {
  const state = buildState();
  beginRound(state);

  const marine = state.units.blue_marines_1;
  const zealot = state.units.red_zealots_1;
  marine.status.location = 'battlefield';
  zealot.status.location = 'battlefield';
  state.players.playerA.reserveUnitIds = [];
  state.players.playerB.reserveUnitIds = [];
  state.players.playerA.battlefieldUnitIds = ['blue_marines_1'];
  state.players.playerB.battlefieldUnitIds = ['red_zealots_1'];
  for (const id of marine.modelIds) {
    marine.models[id].x = 10;
    marine.models[id].y = 10;
  }
  for (const id of zealot.modelIds) {
    zealot.models[id].x = 12;
    zealot.models[id].y = 10;
  }

  advanceToNextPhase(state); // to assault

  addEffect(state, {
    target: { scope: 'unit', unitId: 'blue_marines_1' },
    timings: ['assault_declare_ranged'],
    modifiers: [{ key: 'assault.canDeclareRanged', operation: 'set', value: false, priority: 100 }]
  });

  const validation = validateDeclareRangedAttack(state, 'playerA', 'blue_marines_1');
  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'RANGED_BLOCKED');
});
