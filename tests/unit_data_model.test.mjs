import test from 'node:test';
import assert from 'node:assert/strict';

import { UNIT_DATA, createUnitStateFromTemplate } from '../data/units.js';

test('all unit templates include defense and melee weapon data', () => {
  for (const template of Object.values(UNIT_DATA)) {
    assert.ok(template.defense, `${template.id} missing defense block`);
    assert.equal(typeof template.defense.toughness, 'number');
    assert.equal(typeof template.defense.armorSave, 'number');
    assert.ok(Array.isArray(template.meleeWeapons), `${template.id} missing meleeWeapons`);
    assert.ok(Array.isArray(template.rangedWeapons), `${template.id} missing rangedWeapons`);
  }
});

test('unit runtime state carries rich combat model fields', () => {
  const unit = createUnitStateFromTemplate('marine_squad', 'playerA', 'marine_test');
  assert.ok(unit.defense);
  assert.ok(Array.isArray(unit.rangedWeapons));
  assert.ok(Array.isArray(unit.meleeWeapons));
  assert.ok(Array.isArray(unit.abilities));
  assert.equal(unit.rangedWeapons[0].strength, 4);
  assert.equal(unit.meleeWeapons[0].attacksPerModel, 1);
});

test('zergling and roach templates carry faction keyword data', () => {
  const zergling = createUnitStateFromTemplate('zergling_t3', 'playerA', 'zergling_test');
  const roach = createUnitStateFromTemplate('roach_t3', 'playerA', 'roach_test');

  assert.equal(zergling.abilities.includes('burrow'), true);
  assert.equal(zergling.impact?.dicePerModel, 1);
  assert.equal(roach.abilities.includes('burrowed_regen'), true);
  assert.equal(roach.rangedWeapons[0].surge?.dice, 'D3+1');
  assert.deepEqual(roach.rangedWeapons[0].surge?.tags, ['Light']);
});
