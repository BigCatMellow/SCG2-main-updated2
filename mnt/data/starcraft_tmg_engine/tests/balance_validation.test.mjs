import test from 'node:test';
import assert from 'node:assert/strict';

import { UNIT_DATA } from '../data/units.js';
import { MISSION_DATA } from '../data/missions.js';
import { createInitialGameState } from '../engine/state.js';
import { resolveCombatPhase } from '../engine/combat.js';
import { resolveMissionScoringAtCleanup } from '../engine/mission_rules.js';
import { createSeededRng } from './helpers/rng.mjs';

function buildDuel(attackerTemplateId, targetTemplateId) {
  const state = createInitialGameState({
    missionId: 'take_and_hold',
    deploymentId: 'crossfire',
    armyA: [{ id: 'blue_1', templateId: attackerTemplateId }],
    armyB: [{ id: 'red_1', templateId: targetTemplateId }],
    firstPlayerMarkerHolder: 'playerA'
  });

  const attacker = state.units.blue_1;
  const target = state.units.red_1;

  attacker.status.location = 'battlefield';
  target.status.location = 'battlefield';
  state.players.playerA.battlefieldUnitIds.push(attacker.id);
  state.players.playerB.battlefieldUnitIds.push(target.id);
  state.players.playerA.reserveUnitIds = [];
  state.players.playerB.reserveUnitIds = [];

  for (const modelId of attacker.modelIds) {
    attacker.models[modelId].x = 10;
    attacker.models[modelId].y = 10;
  }
  for (const modelId of target.modelIds) {
    target.models[modelId].x = 12;
    target.models[modelId].y = 10;
  }

  return state;
}

function aliveModels(unit) {
  return unit.modelIds.filter(id => unit.models[id].alive).length;
}

test('balance harness: every ranged unit can damage at least one archetype in a single volley', () => {
  const rangedTemplates = Object.values(UNIT_DATA).filter(unit => (unit.rangedWeapons?.length ?? 0) > 0);
  const targetTemplates = Object.values(UNIT_DATA);

  for (const attacker of rangedTemplates) {
    let foundDamagingMatchup = false;

    for (const target of targetTemplates) {
      const state = buildDuel(attacker.id, target.id);
      state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_1', targetId: 'red_1' });
      resolveCombatPhase(state, { rng: createSeededRng(1000 + target.startingModelCount) });

      if (aliveModels(state.units.red_1) < target.startingModelCount) {
        foundDamagingMatchup = true;
        break;
      }
    }

    assert.equal(foundDamagingMatchup, true, `${attacker.id} should threaten at least one target profile`);
  }
});

test('balance harness: dragoon ranged output remains bounded against infantry', () => {
  const state = buildDuel('dragoon', 'marine_squad');
  state.combatQueue.push({ type: 'ranged_attack', attackerId: 'blue_1', targetId: 'red_1' });

  const before = aliveModels(state.units.red_1);
  resolveCombatPhase(state, { rng: createSeededRng(7) });
  const after = aliveModels(state.units.red_1);
  const casualties = before - after;

  assert.ok(casualties >= 1, 'dragoon should usually remove at least one marine at close range');
  assert.ok(casualties <= 4, 'dragoon volley should not wipe most of a marine squad in one attack');
});

test('mission scoring cadence: total cleanup VP per round stays within mission window bounds', () => {
  for (const mission of Object.values(MISSION_DATA)) {
    const state = createInitialGameState({
      missionId: mission.id,
      deploymentId: 'crossfire',
      armyA: [{ id: 'blue_marines_1', templateId: 'marine_squad' }],
      armyB: [{ id: 'red_zealots_1', templateId: 'zealot_squad' }],
      firstPlayerMarkerHolder: 'playerA'
    });

    // Put Blue near center marker to guarantee at least one controlled marker.
    const blue = state.units.blue_marines_1;
    blue.status.location = 'battlefield';
    state.players.playerA.battlefieldUnitIds.push(blue.id);
    state.players.playerA.reserveUnitIds = [];
    for (const modelId of blue.modelIds) {
      blue.models[modelId].x = 18;
      blue.models[modelId].y = 18;
    }

    for (let round = 1; round <= mission.roundLimit; round += 1) {
      state.round = round;
      const scoring = resolveMissionScoringAtCleanup(state);
      const totalRoundGain = scoring.gained.playerA + scoring.gained.playerB;

      const maxFromWindows = (mission.scoringWindows ?? [])
        .filter(window => {
          if (window.timing !== 'cleanup') return false;
          if (!window.rounds || window.rounds === 'all') return true;
          if (Array.isArray(window.rounds)) return window.rounds.includes(round);
          if (window.rounds.min != null && round < window.rounds.min) return false;
          if (window.rounds.max != null && round > window.rounds.max) return false;
          return true;
        })
        .reduce((sum, window) => {
          if (window.type === 'controlled_markers') return sum + ((window.vpPerMarker ?? 1) * state.deployment.missionMarkers.length);
          if (window.type === 'specific_marker_control') return sum + (window.vpValue ?? 1);
          return sum;
        }, 0);

      assert.ok(totalRoundGain >= 0, `${mission.id} round ${round} should never yield negative VP`);
      assert.ok(totalRoundGain <= maxFromWindows, `${mission.id} round ${round} exceeded declared scoring window budget`);
    }
  }
});
