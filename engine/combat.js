import { appendLog } from "./state.js";
import { distance, pointInBoard, circleOverlapsTerrain, circleOverlapsCircle, circleOverlapsRect } from "./geometry.js";
import { recomputeUnitCurrentSupply, refreshAllSupply } from "./supply.js";
import { getModifiedValue, onEvent } from "./effects.js";
import { refreshEngagement } from "./movement.js";
import { applyCloseRanks } from "./statuses.js";
import { isUnitWithinObjectiveRange } from "./objectives.js";
import { markUnitActivatedForExplicitPhase } from "./activation.js";
import {
  canTargetWithRangedWeapon,
  getAntiEvadeValue,
  getLongRangeValue,
  isUnitDetected,
  isUnitInGrass,
  isUnitOnElevatedCover,
  targetGetsEvadeOpportunity
} from "./visibility.js";
import { getEffectiveRangedRange, getGuardianShieldReduction, getStimpackPrecisionBonus, resolveLifeSupport, resolvePointDefenseLaser, resolveTransfusion } from "./support.js";

const MELEE_REACH_INCHES = 1.5;
const CHARGE_MAX_RANGE_INCHES = 8;
const PILE_IN_DISTANCE_INCHES = 3;
const CONSOLIDATE_DISTANCE_INCHES = 3;
const ENGAGEMENT_RANGE_INCHES = 1;
const BASE_TO_BASE_TOLERANCE = 0.05;

function getAliveModels(unit) {
  return unit.modelIds
    .map(modelId => unit.models[modelId])
    .filter(model => model.alive && model.x != null && model.y != null);
}

function getModelEdgeDistance(a, aRadius, b, bRadius) {
  return distance(a, b) - aRadius - bRadius;
}

function isWithinEnemyEngagement(attackerUnit, attackerModel, targetUnit) {
  return getAliveModels(targetUnit).some(targetModel =>
    getModelEdgeDistance(attackerModel, attackerUnit.base.radiusInches, targetModel, targetUnit.base.radiusInches) <= ENGAGEMENT_RANGE_INCHES + 1e-6
  );
}

function isInBaseContact(unit, model, friendlyModel) {
  const edgeDistance = getModelEdgeDistance(model, unit.base.radiusInches, friendlyModel, unit.base.radiusInches);
  return Math.abs(edgeDistance) <= BASE_TO_BASE_TOLERANCE;
}

function getMeleeRankProfile(attacker, target) {
  const aliveAttackers = getAliveModels(attacker);
  const fightingRankModels = aliveAttackers.filter(model => isWithinEnemyEngagement(attacker, model, target));
  const fightingRankIds = new Set(fightingRankModels.map(model => model.id));
  const supportingRankModels = aliveAttackers.filter(model => {
    if (fightingRankIds.has(model.id)) return false;
    return fightingRankModels.some(friendlyModel => isInBaseContact(attacker, model, friendlyModel));
  });

  return {
    fightingRankModels,
    supportingRankModels,
    eligibleModelCount: fightingRankModels.length + supportingRankModels.length
  };
}

function chooseNearestEnemyUnit(model, enemyUnits) {
  let best = null;
  let bestDistance = Infinity;
  for (const enemyUnit of enemyUnits) {
    for (const enemyModel of getAliveModels(enemyUnit)) {
      const d = getModelEdgeDistance(model, 0, enemyModel, 0);
      if (d < bestDistance) {
        bestDistance = d;
        best = enemyUnit;
      }
    }
  }
  return best;
}

function getEngagedEnemyUnitsForMelee(state, attacker) {
  return Object.values(state.units).filter(enemy => {
    if (enemy.owner === attacker.owner || enemy.status.location !== "battlefield") return false;
    return getAliveModels(attacker).some(model => isWithinEnemyEngagement(attacker, model, enemy));
  });
}

function getMeleeTargetProfiles(attacker, enemyUnits, primaryTargetId = null) {
  const profiles = new Map(enemyUnits.map(enemy => [enemy.id, {
    fightingRankModels: [],
    supportingRankModels: [],
    eligibleModelCount: 0
  }]));
  const fighterAssignments = new Map();
  const aliveAttackers = getAliveModels(attacker);

  for (const model of aliveAttackers) {
    const engagedEnemies = enemyUnits.filter(enemy => isWithinEnemyEngagement(attacker, model, enemy));
    if (!engagedEnemies.length) continue;

    const assignedEnemy = engagedEnemies.find(enemy => enemy.id === primaryTargetId)
      ?? chooseNearestEnemyUnit(model, engagedEnemies)
      ?? engagedEnemies[0];
    fighterAssignments.set(model.id, assignedEnemy.id);
    const profile = profiles.get(assignedEnemy.id);
    profile.fightingRankModels.push(model);
  }

  for (const model of aliveAttackers) {
    if (fighterAssignments.has(model.id)) continue;
    const supportingAssignments = aliveAttackers
      .filter(friendlyModel => fighterAssignments.has(friendlyModel.id) && isInBaseContact(attacker, model, friendlyModel))
      .map(friendlyModel => fighterAssignments.get(friendlyModel.id));
    if (!supportingAssignments.length) continue;
    const assignedEnemyId = supportingAssignments.find(enemyId => enemyId === primaryTargetId)
      ?? supportingAssignments[0];
    const profile = profiles.get(assignedEnemyId);
    profile.supportingRankModels.push(model);
  }

  for (const profile of profiles.values()) {
    profile.eligibleModelCount = profile.fightingRankModels.length + profile.supportingRankModels.length;
  }

  return profiles;
}

export function getMeleeTargetSelection(state, unitId) {
  const attacker = state.units[unitId];
  if (!attacker || attacker.status.location !== "battlefield") return null;

  const declarations = state.combatQueue.filter(entry =>
    entry.type === "charge_attack" && entry.attackerId === unitId
  );
  if (!declarations.length) return null;

  const engagedEnemies = getEngagedEnemyUnitsForMelee(state, attacker);
  if (engagedEnemies.length < 2) return null;

  const currentPrimaryTargetId = declarations[0].primaryTargetId ?? declarations[0].targetId;
  const options = engagedEnemies.map(enemy => {
    const profile = getMeleeTargetProfiles(attacker, engagedEnemies, enemy.id).get(enemy.id)
      ?? { fightingRankModels: [], supportingRankModels: [], eligibleModelCount: 0 };
    return {
      targetId: enemy.id,
      name: enemy.name,
      fightingRank: profile.fightingRankModels.length,
      supportingRank: profile.supportingRankModels.length,
      assignedModels: profile.eligibleModelCount,
      isCurrentPrimary: enemy.id === currentPrimaryTargetId
    };
  });

  return {
    unitId,
    attackerName: attacker.name,
    currentPrimaryTargetId,
    options
  };
}

function getAttackDeclarationLabel(declaration) {
  if (declaration.type === "overwatch_attack") return "Overwatch";
  if (declaration.type === "charge_attack") return "Charge Attack";
  return "Ranged Attack";
}

export function getCombatActivationPreview(state, unitId) {
  const attacker = state.units[unitId];
  if (!attacker || attacker.status.location !== "battlefield") return null;

  const declarations = expandMeleeDeclarations(state, state.combatQueue.filter(entry =>
    ["ranged_attack", "charge_attack", "overwatch_attack"].includes(entry.type) && entry.attackerId === unitId
  ));
  if (!declarations.length) return null;

  const steps = [];
  if (attacker.status.burrowed && declarations.some(entry => entry.type === "charge_attack")) {
    steps.push({
      kind: "close_ranks",
      label: "Close Ranks",
      detail: `${attacker.name} emerges from Burrowed formation before its melee sequence starts.`
    });
  }

  declarations.forEach((declaration, index) => {
    const target = state.units[declaration.targetId];
    const weapon = declaration.type === "charge_attack"
      ? attacker.meleeWeapons?.[0]
      : attacker.rangedWeapons?.[0];
    steps.push({
      kind: declaration.type,
      label: getAttackDeclarationLabel(declaration),
      detail: `${attacker.name} targets ${target?.name ?? declaration.targetId}${weapon?.name ? ` with ${weapon.name}` : ""}.`,
      targetId: declaration.targetId,
      targetName: target?.name ?? declaration.targetId,
      weaponName: weapon?.name ?? null,
      isPrimaryTarget: declaration.type === "charge_attack" && (declaration.primaryTargetId ?? declaration.targetId) === declaration.targetId,
      order: index + 1
    });
  });

  return {
    unitId,
    attackerName: attacker.name,
    steps
  };
}

export function setChargePrimaryTarget(state, playerId, unitId, targetId) {
  const attacker = state.units[unitId];
  if (!attacker) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
  if (attacker.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };

  const selection = getMeleeTargetSelection(state, unitId);
  if (!selection) {
    return { ok: false, code: "NO_SELECTION_NEEDED", message: "This unit does not need a melee target selection." };
  }

  const target = state.units[targetId];
  if (!target || !selection.options.some(option => option.targetId === targetId)) {
    return { ok: false, code: "INVALID_TARGET", message: "Choose one of the engaged enemy units." };
  }

  state.combatQueue = state.combatQueue.map(entry => (
    entry.type === "charge_attack" && entry.attackerId === unitId
      ? { ...entry, primaryTargetId: targetId }
      : entry
  ));
  appendLog(state, "combat", `${attacker.name} focuses its melee push toward ${target.name}.`);
  return { ok: true, state };
}

function getLeaderPoint(unit) {
  const leader = unit.models[unit.leadingModelId];
  if (!leader || !leader.alive || leader.x == null || leader.y == null) return null;
  return { x: leader.x, y: leader.y };
}

function isPointOccupiedByAnotherModel(state, unit, point) {
  for (const otherUnit of Object.values(state.units)) {
    for (const model of Object.values(otherUnit.models)) {
      if (!model.alive || model.x == null || model.y == null) continue;
      if (otherUnit.id === unit.id && model.id === unit.leadingModelId) continue;
      const radius = otherUnit.base?.radiusInches ?? unit.base.radiusInches;
      if (circleOverlapsCircle(point, unit.base.radiusInches, { x: model.x, y: model.y }, radius)) return true;
    }
  }
  return false;
}

function clampLeaderDestination(state, unit, destination) {
  if (!pointInBoard(destination, state.board, unit.base.radiusInches)) return null;
  if (circleOverlapsTerrain(destination, unit.base.radiusInches, state.board.terrain)) return null;
  if (isPointOccupiedByAnotherModel(state, unit, destination)) return null;
  return destination;
}

function pointToward(origin, target, maxDistance) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (!length || length <= maxDistance) return { x: target.x, y: target.y };
  return {
    x: origin.x + (dx / length) * maxDistance,
    y: origin.y + (dy / length) * maxDistance
  };
}

function pointTowardUntilRange(origin, target, maxDistance, keepRange) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (!length) return { x: origin.x, y: origin.y };
  const moveDistance = Math.max(0, Math.min(maxDistance, length - keepRange));
  return {
    x: origin.x + (dx / length) * moveDistance,
    y: origin.y + (dy / length) * moveDistance
  };
}

function moveLeaderToward(state, unit, towardPoint, maxDistance) {
  const leader = unit.models[unit.leadingModelId];
  if (!leader || leader.x == null || leader.y == null) return false;
  const desired = pointToward({ x: leader.x, y: leader.y }, towardPoint, maxDistance);
  const destination = clampLeaderDestination(state, unit, desired);
  if (!destination) return false;
  leader.x = destination.x;
  leader.y = destination.y;
  return true;
}

function moveLeaderTowardMeleeRange(state, unit, towardPoint, maxDistance, keepRange = MELEE_REACH_INCHES) {
  const leader = unit.models[unit.leadingModelId];
  if (!leader || leader.x == null || leader.y == null) return false;
  const desired = pointTowardUntilRange({ x: leader.x, y: leader.y }, towardPoint, maxDistance, keepRange);
  const destination = clampLeaderDestination(state, unit, desired);
  if (!destination) return false;
  leader.x = destination.x;
  leader.y = destination.y;
  return true;
}

function getNearestEnemyLeaderPoint(state, unit) {
  let best = null;
  let bestDistance = Infinity;
  const source = getLeaderPoint(unit);
  if (!source) return null;

  for (const other of Object.values(state.units)) {
    if (other.owner === unit.owner || other.status.location !== "battlefield") continue;
    const leader = getLeaderPoint(other);
    if (!leader) continue;
    const d = distance(source, leader);
    if (d < bestDistance) {
      bestDistance = d;
      best = leader;
    }
  }

  return best;
}

function rollSuccesses(attempts, target, rng) {
  if (attempts <= 0) return 0;
  const clampedTarget = Math.max(2, Math.min(6, Math.round(target)));
  let successes = 0;
  for (let i = 0; i < attempts; i += 1) {
    const roll = Math.floor(rng() * 6) + 1;
    if (roll >= clampedTarget) successes += 1;
  }
  return successes;
}

function rollDiceExpression(expression, rng) {
  if (expression == null) return 0;
  if (typeof expression === "number") return Math.max(0, Math.floor(expression));
  const normalized = String(expression).trim().toUpperCase();
  if (!normalized) return 0;

  const diceMatch = normalized.match(/^D(3|6)([+-]\d+)?$/);
  if (diceMatch) {
    const [, facesRaw, modifierRaw] = diceMatch;
    const faces = Number(facesRaw);
    const modifier = modifierRaw ? Number(modifierRaw) : 0;
    return Math.max(0, Math.floor(rng() * faces) + 1 + modifier);
  }

  const flatValue = Number.parseInt(normalized, 10);
  return Number.isNaN(flatValue) ? 0 : Math.max(0, flatValue);
}

function getPrecisionValue(weapon) {
  return Math.max(0, Math.floor(weapon.precision ?? 0));
}

function getCriticalHitValue(weapon) {
  return Math.max(0, Math.floor(weapon.criticalHit ?? 0));
}

function getAutomaticHitsRule(weapon) {
  if (!weapon?.hits) return null;
  if (typeof weapon.hits === "number") {
    return {
      count: Math.max(0, Math.floor(weapon.hits)),
      damage: Math.max(1, Math.floor(weapon.damage ?? 1))
    };
  }
  return {
    count: Math.max(0, Math.floor(weapon.hits.count ?? weapon.hits.value ?? weapon.hits.hits ?? 0)),
    damage: Math.max(1, Math.floor(weapon.hits.damage ?? weapon.damage ?? 1))
  };
}

function getBurstFireRule(weapon) {
  if (!weapon?.burstFire) return null;
  if (typeof weapon.burstFire === "number") {
    return { rangeInches: weapon.rangeInches ?? 0, bonusAttacks: Math.max(0, Math.floor(weapon.burstFire)) };
  }
  return {
    rangeInches: Math.max(0, Number(weapon.burstFire.rangeInches ?? weapon.burstFire.range ?? 0)),
    bonusAttacks: Math.max(0, Math.floor(weapon.burstFire.bonusAttacks ?? weapon.burstFire.attacks ?? weapon.burstFire.value ?? 0))
  };
}

function getLockedInValue(weapon) {
  return Math.max(0, Math.floor(weapon?.lockedIn ?? 0));
}

function getConcentratedFireValue(weapon) {
  return Math.max(0, Math.floor(weapon?.concentratedFire ?? 0));
}

function getPierceDamage(weapon, target) {
  const entries = Array.isArray(weapon.pierce)
    ? weapon.pierce
    : weapon.pierce
      ? [weapon.pierce]
      : [];

  let best = null;
  for (const entry of entries) {
    if (!entry?.tag || !target.tags.includes(entry.tag)) continue;
    if (best == null || Number(entry.damage) > best) best = Number(entry.damage);
  }
  return best;
}

function woundTargetForProfile(strength, toughness) {
  if (strength >= toughness * 2) return 2;
  if (strength > toughness) return 3;
  if (strength === toughness) return 4;
  if (strength * 2 <= toughness) return 6;
  return 5;
}

function applyWeaponKeywordsToWoundTarget(weapon, targetUnit, woundTarget) {
  let next = woundTarget;
  if (weapon.keywords?.includes("anti_infantry") && targetUnit.tags.includes("Infantry")) {
    next = Math.max(2, next - 1);
  }
  if (weapon.keywords?.includes("precise") && targetUnit.tags.includes("Light")) {
    next = Math.max(2, next - 1);
  }
  return next;
}

function getBestSaveTarget(unit, armorPenetration) {
  const armorSave = Math.min(6, Math.max(2, unit.defense.armorSave + armorPenetration));
  if (unit.defense.invulnerableSave == null) return armorSave;
  return Math.min(armorSave, unit.defense.invulnerableSave);
}

function getObjectiveDefenseBonus(state, unit) {
  return unit?.abilities?.includes("veteran_of_tarsonis") && isUnitWithinObjectiveRange(state, unit, 3) ? 1 : 0;
}

function hasAncillaryCarapaceAvailable(target) {
  return target?.abilities?.includes("ancillary_carapace") && !target?.status?.ancillaryCarapaceUsedThisPhase;
}

function createArmourPoolEntries(count, damage, options = {}) {
  const entryCount = Math.max(0, Math.floor(count));
  const entryDamage = Math.max(1, Math.floor(damage ?? 1));
  return Array.from({ length: entryCount }, () => ({
    damage: entryDamage,
    surgeEligible: options.surgeEligible !== false,
    source: options.source ?? "standard"
  }));
}

function popHighestDamageEntries(entries, count, predicate = null) {
  if (count <= 0 || !entries.length) return [];
  const indexed = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => (predicate ? predicate(entry) : true))
    .sort((a, b) => {
      if (b.entry.damage !== a.entry.damage) return b.entry.damage - a.entry.damage;
      return a.index - b.index;
    })
    .slice(0, count)
    .sort((a, b) => b.index - a.index);

  const removed = [];
  for (const { index } of indexed) {
    removed.push(entries.splice(index, 1)[0]);
  }
  return removed;
}

function getPhaseActivationStatus(unit, phase) {
  if (phase === "movement") return Boolean(unit?.status?.movementActivated);
  if (phase === "assault") return Boolean(unit?.status?.assaultActivated);
  if (phase === "combat") return Boolean(unit?.status?.combatActivated);
  return false;
}

function resolveZealousRound(state, target, totalDamage) {
  if (totalDamage <= 0) return null;
  if (!target?.abilities?.includes("zealous_round")) return null;
  if (target.status?.zealousRoundUsedThisRound) return null;
  if (getPhaseActivationStatus(target, state.phase)) return null;

  const reducedBy = Math.min(2, totalDamage);
  if (reducedBy <= 0) return null;

  target.status.zealousRoundUsedThisRound = true;
  markUnitActivatedForExplicitPhase(state, target.id, state.phase);
  appendLog(
    state,
    "combat",
    `${target.name} uses Zealous Round, counts as activated in ${state.phase}, and reduces incoming damage by ${reducedBy}.`
  );
  return { reducedBy, phase: state.phase };
}

function resolveAncillaryCarapace(target, saveableWounds) {
  if (saveableWounds <= 0) return null;
  if (!hasAncillaryCarapaceAvailable(target)) return null;
  target.status.ancillaryCarapaceUsedThisPhase = true;
  return { bonus: 1 };
}

function isUnitReceivingCover(state, unit) {
  const coverTerrain = state.board.terrain.filter(terrain => !terrain.impassable && ["cover", "elevated_cover"].includes(terrain.kind));
  if (!coverTerrain.length) return false;
  return unit.modelIds.some(modelId => {
    const model = unit.models[modelId];
    if (!model.alive || model.x == null || model.y == null) return false;
    return coverTerrain.some(terrain => circleOverlapsRect({ x: model.x, y: model.y }, unit.base.radiusInches, terrain.rect));
  });
}

function targetHasHighGroundCover(state, attacker, target, isMelee) {
  if (isMelee) return false;
  if (!isUnitOnElevatedCover(state, target)) return false;
  if (isUnitOnElevatedCover(state, attacker)) return false;
  return !(attacker?.tags?.includes("Flying") || attacker?.abilities?.includes("flying"));
}

function applyDamageToUnit(unit, totalDamage, options = {}) {
  const casualtyCap = options.casualtyCap == null ? null : Math.max(0, Math.floor(options.casualtyCap));
  let remaining = totalDamage;
  const ordered = unit.modelIds.map(modelId => unit.models[modelId]).filter(model => model.alive);
  let casualties = 0;
  let appliedDamage = 0;

  for (const model of ordered) {
    if (remaining <= 0) break;
    if (casualtyCap != null && casualties >= casualtyCap) break;
    model.woundsRemaining -= remaining;
    if (model.woundsRemaining <= 0) {
      const spill = Math.abs(model.woundsRemaining);
      appliedDamage += remaining - spill;
      remaining = spill;
      model.alive = false;
      model.x = null;
      model.y = null;
      model.woundsRemaining = 0;
      casualties += 1;
      if (casualtyCap != null && casualties >= casualtyCap) {
        remaining = 0;
      }
    } else {
      appliedDamage += remaining;
      remaining = 0;
    }
  }

  if (unit.leadingModelId && !unit.models[unit.leadingModelId].alive) {
    const nextLeader = unit.modelIds.find(modelId => unit.models[modelId].alive);
    unit.leadingModelId = nextLeader ?? unit.leadingModelId;
  }

  recomputeUnitCurrentSupply(unit);
  return {
    casualties,
    appliedDamage,
    discardedDamage: Math.max(0, totalDamage - appliedDamage)
  };
}

function resolveImpactHits(state, attacker, target, rng, options = {}) {
  const impact = attacker.impact;
  if (!impact) return null;
  if (target?.status?.hidden && !isUnitDetected(state, attacker?.owner, target)) {
    appendLog(state, "combat", `${attacker.name} triggers Impact against ${target.name}, but the target stays hidden and avoids the collision.`);
    return {
      attempts: 0,
      hits: 0,
      saved: 0,
      unsaved: 0,
      totalDamage: 0,
      casualties: 0,
      hitTarget: impact.hitTarget,
      damage: impact.damage ?? 1,
      preventedByHidden: true
    };
  }

  const aliveAttackerModels = options.eligibleModelCount ?? getAliveModels(attacker).length;
  if (!aliveAttackerModels) return null;

  const attempts = aliveAttackerModels * (impact.dicePerModel ?? 0);
  if (attempts <= 0) return null;

  const hits = rollSuccesses(attempts, impact.hitTarget, rng);
  const saveTarget = getBestSaveTarget(target, 0);
  const saved = rollSuccesses(hits, saveTarget, rng);
  const unsaved = Math.max(0, hits - saved);
  const totalDamage = unsaved * (impact.damage ?? 1);
  const damageResult = applyDamageToUnit(target, totalDamage);
  const casualties = damageResult.casualties;

  appendLog(
    state,
    "combat",
    `${attacker.name} triggers Impact against ${target.name}: ${attempts} impact dice, ${hits} impact hits, ${saved} saves, ${casualties} casualties.`
  );

  return {
    attempts,
    hits,
    saved,
    unsaved,
    totalDamage,
    casualties,
    hitTarget: impact.hitTarget,
    damage: impact.damage ?? 1
  };
}

function resolveSurge(weapon, target, surgeEligibleEntries, rng) {
  if (!weapon.surge || surgeEligibleEntries.length <= 0) return null;
  const surgeTags = weapon.surge.tags ?? [];
  const matchedTags = surgeTags.filter(tag => target.tags.includes(tag));
  if (!matchedTags.length) return null;

  const roll = rollDiceExpression(weapon.surge.dice, rng);
  const appliedEntries = popHighestDamageEntries(surgeEligibleEntries, roll);
  const applied = appliedEntries.length;
  return {
    tags: surgeTags,
    matchedTags,
    dice: weapon.surge.dice,
    roll,
    applied,
    entries: appliedEntries
  };
}

function resolveCriticalHit(weapon, armourPoolEntries) {
  const appliedEntries = popHighestDamageEntries(armourPoolEntries, getCriticalHitValue(weapon));
  const applied = appliedEntries.length;
  if (applied <= 0) return null;
  return {
    applied,
    value: getCriticalHitValue(weapon),
    entries: appliedEntries
  };
}

function resolveDodge(target, bypassedEntries) {
  const dodge = Math.max(0, Math.floor(target?.defense?.dodge ?? 0));
  if (dodge <= 0 || bypassedEntries.length <= 0) return null;
  const preventedEntries = bypassedEntries
    .slice()
    .sort((a, b) => b.damage - a.damage)
    .slice(0, dodge);
  const prevented = preventedEntries.length;
  return {
    value: dodge,
    prevented,
    entries: preventedEntries
  };
}

function resolveEvade(state, attacker, target, weapon, isMelee, visible, unsaved, rng) {
  if (unsaved <= 0) return null;
  if (!targetGetsEvadeOpportunity(state, attacker, target, weapon, isMelee, visible)) return null;

  const baseTarget = Math.max(2, Math.min(6, Math.round(target.defense.evadeTarget)));
  const lurkingBonus = !isMelee && target?.abilities?.includes("lurking") && target?.status?.stationary && !target?.status?.lurkingUsedThisRound ? 1 : 0;
  const antiEvade = getAntiEvadeValue(weapon);
  const evadeTarget = Math.max(2, Math.min(6, baseTarget + antiEvade - lurkingBonus));
  const saved = rollSuccesses(unsaved, evadeTarget, rng);
  if (lurkingBonus > 0) target.status.lurkingUsedThisRound = true;

  return {
    baseTarget,
    antiEvade,
    lurkingBonus,
    target: evadeTarget,
    saved
  };
}

function validateDeclaration(state, declaration) {
  const attacker = state.units[declaration.attackerId];
  const target = state.units[declaration.targetId];
  if (!attacker || !target) return { ok: false, reason: "Missing attacker or target." };
  if (attacker.status.location !== "battlefield" || target.status.location !== "battlefield") return { ok: false, reason: "Attacker or target not on battlefield." };

  const isMelee = declaration.type === "charge_attack";
  const isOverwatch = declaration.type === "overwatch_attack";
  const weaponPool = isMelee ? attacker.meleeWeapons : attacker.rangedWeapons;
  const weapon = weaponPool?.find(profile => profile.id === declaration.weaponId) ?? weaponPool?.[0] ?? null;
  if (!weapon) return { ok: false, reason: `Attacker has no ${isMelee ? "melee" : "ranged"} profile.` };

  const attackerPoint = getLeaderPoint(attacker);
  const targetPoint = getLeaderPoint(target);
  if (!attackerPoint || !targetPoint) return { ok: false, reason: "Attacker or target has no valid leader position." };

  const range = distance(attackerPoint, targetPoint);
  let visible = true;

  if (isMelee) {
    if (range > CHARGE_MAX_RANGE_INCHES + 1e-6) return { ok: false, reason: "Charge target moved out of declared charge range." };
  } else {
    const maxRange = getEffectiveRangedRange(state, attacker, weapon) ?? getLongRangeValue(weapon) ?? weapon.rangeInches;
    const modifiedRange = getModifiedValue(state, {
      timing: "combat_resolve_attack",
      unitId: attacker.id,
      key: "weapon.rangeInches",
      baseValue: maxRange
    }).value;
    if (range > modifiedRange + 1e-6) return { ok: false, reason: "Target out of range." };
    const targeting = canTargetWithRangedWeapon(state, attacker, target, weapon);
    if (!targeting.ok) return { ok: false, reason: targeting.reason };
    visible = targeting.visible !== false;
  }
  if (attacker.owner === target.owner) return { ok: false, reason: "Cannot target friendly units." };
  return { ok: true, attacker, target, weapon, isMelee, isOverwatch, visible };
}

function buildFailedAttackEvent({ attacker, target, weapon, mode, visible = true, impact = null, reason }) {
  return {
    type: "combat_attack_resolved",
    payload: {
      mode,
      attackerId: attacker?.id ?? null,
      targetId: target?.id ?? null,
      weaponId: weapon?.id ?? null,
      attempts: 0,
      hits: 0,
      wounds: 0,
      saved: 0,
      unsaved: 0,
      totalDamage: 0,
      casualties: 0,
      impact,
      visible,
      failedReason: reason ?? null
    }
  };
}

function resolveSingleAttack(state, declaration, rng) {
  const validation = validateDeclaration(state, declaration);
  if (!validation.ok) {
    appendLog(state, "combat", `Skipped declared attack (${declaration.attackerId} -> ${declaration.targetId}): ${validation.reason}`);
    const attacker = state.units[declaration.attackerId] ?? null;
    const target = state.units[declaration.targetId] ?? null;
    const weaponPool = declaration.type === "charge_attack" ? attacker?.meleeWeapons : attacker?.rangedWeapons;
    const weapon = weaponPool?.find(profile => profile.id === declaration.weaponId) ?? weaponPool?.[0] ?? null;
    return buildFailedAttackEvent({
      attacker,
      target,
      weapon,
      mode: declaration.type === "charge_attack" ? "melee" : declaration.type === "overwatch_attack" ? "overwatch" : "ranged",
      reason: validation.reason
    });
  }

  const { attacker, target, weapon, isMelee, isOverwatch, visible } = validation;

  if (isMelee) {
    applyCloseRanks(state, attacker, { targetName: target.name });
    const targetPoint = getLeaderPoint(target);
    if (!targetPoint) return null;
    const attackerPoint = getLeaderPoint(attacker);
    if (!attackerPoint) return null;

    const currentRange = distance(attackerPoint, targetPoint);
    if (currentRange > MELEE_REACH_INCHES + 1e-6) {
      const moved = moveLeaderTowardMeleeRange(state, attacker, targetPoint, PILE_IN_DISTANCE_INCHES, MELEE_REACH_INCHES);
      if (!moved) {
        appendLog(state, "combat", `${attacker.name} could not complete pile-in movement and loses its charge attack.`);
        return buildFailedAttackEvent({
          attacker,
          target,
          weapon,
          mode: "melee",
          visible,
          reason: "Charge attack was lost because pile-in movement could not be completed."
        });
      }
    }

    const inReachAfterPileIn = distance(getLeaderPoint(attacker), targetPoint) <= MELEE_REACH_INCHES + 1e-6;
    if (!inReachAfterPileIn) {
      appendLog(state, "combat", `${attacker.name} failed to reach ${target.name} after pile-in movement.`);
      return buildFailedAttackEvent({
        attacker,
        target,
        weapon,
        mode: "melee",
        visible,
        reason: "Charge attack did not reach melee range after pile-in movement."
      });
    }
  }

  const meleeEnemyUnits = isMelee ? getEngagedEnemyUnitsForMelee(state, attacker) : null;
  const meleeTargetProfiles = isMelee ? getMeleeTargetProfiles(attacker, meleeEnemyUnits, declaration.targetId) : null;
  const meleeRankProfile = isMelee
    ? (meleeTargetProfiles.get(target.id) ?? { fightingRankModels: [], supportingRankModels: [], eligibleModelCount: 0 })
    : null;
  const primaryTargetFocus = isMelee && (declaration.primaryTargetId ?? declaration.targetId) === target.id;

  const impactResult = isMelee
    ? resolveImpactHits(state, attacker, target, rng, { eligibleModelCount: meleeRankProfile.eligibleModelCount })
    : null;
  if (isMelee && getAliveModels(target).length <= 0) {
    appendLog(state, "combat", `${target.name} is destroyed by Impact before ${attacker.name} can make melee attacks.`);
    return {
      type: "combat_attack_resolved",
      payload: {
        mode: "melee",
        attackerId: attacker.id,
        targetId: target.id,
        weaponId: weapon.id,
        attempts: 0,
        hits: 0,
        wounds: 0,
        saved: 0,
        unsaved: 0,
        totalDamage: 0,
        casualties: 0,
        impact: impactResult
      }
    };
  }

  const aliveAttackerModels = isMelee ? meleeRankProfile.eligibleModelCount : getAliveModels(attacker).length;
  if (!aliveAttackerModels) {
    if (isMelee) {
      appendLog(state, "combat", `${attacker.name} has no models assigned to ${target.name} after target allocation and cannot make melee attacks.`);
      return buildFailedAttackEvent({
        attacker,
        target,
        weapon,
        mode: "melee",
        visible,
        impact: impactResult,
        reason: "No models were in fighting or supporting rank against this target."
      });
    }
    return buildFailedAttackEvent({
      attacker,
      target,
      weapon,
      mode: isOverwatch ? "overwatch" : "ranged",
      visible,
      reason: "Attacker had no living models able to resolve this attack."
    });
  }

  const attemptsPerModel = getModifiedValue(state, {
    timing: "combat_resolve_attack",
    unitId: attacker.id,
    key: isMelee ? "weapon.attacksPerModel" : "weapon.shotsPerModel",
    baseValue: isMelee ? weapon.attacksPerModel : weapon.shotsPerModel
  }).value;

  const hitTargetBase = getModifiedValue(state, {
    timing: "combat_resolve_attack",
    unitId: attacker.id,
    key: "weapon.hitTarget",
    baseValue: weapon.hitTarget
  }).value;
  const effectiveForcedRange = getEffectiveRangedRange(state, attacker, weapon);
  const longRangePenalty = !isMelee && effectiveForcedRange == null && weapon.rangeInches != null && getLongRangeValue(weapon) != null
    && distance(getLeaderPoint(attacker), getLeaderPoint(target)) > weapon.rangeInches + 1e-6
      ? 1
      : 0;
  const hitTarget = isOverwatch ? Math.max(hitTargetBase + longRangePenalty, 6) : hitTargetBase + longRangePenalty;

  const woundTargetBase = woundTargetForProfile(weapon.strength, target.defense.toughness);
  const woundTarget = applyWeaponKeywordsToWoundTarget(weapon, target, woundTargetBase);
  let saveTarget = getBestSaveTarget(target, weapon.armorPenetration);
  const objectiveDefenseBonus = getObjectiveDefenseBonus(state, target);
  if (objectiveDefenseBonus > 0) saveTarget = Math.max(2, saveTarget - objectiveDefenseBonus);
  const coverApplies = !isMelee && isUnitReceivingCover(state, target);
  if (coverApplies) saveTarget = Math.max(2, saveTarget - 1);
  const highGroundCover = targetHasHighGroundCover(state, attacker, target, isMelee);
  if (highGroundCover) saveTarget = Math.max(2, saveTarget - 1);

  const burstFireRule = !isMelee ? getBurstFireRule(weapon) : null;
  const burstFireApplied = Boolean(
    burstFireRule
    && distance(getLeaderPoint(attacker), getLeaderPoint(target)) <= burstFireRule.rangeInches + 1e-6
    && burstFireRule.bonusAttacks > 0
  );
  const lockedInBonus = !isMelee && target.status.stationary ? getLockedInValue(weapon) : 0;
  const modifiedAttemptsPerModel = attemptsPerModel + (burstFireApplied ? burstFireRule.bonusAttacks : 0) + lockedInBonus;
  const rawAttempts = aliveAttackerModels * modifiedAttemptsPerModel;
  const attackPoolBeforeDefense = Math.max(0, Math.floor(isOverwatch ? rawAttempts / 2 : rawAttempts));
  const guardianShieldReduction = getGuardianShieldReduction(state, target, isMelee);
  const pointDefenseLaserResult = resolvePointDefenseLaser(
    state,
    attacker,
    target,
    weapon,
    isMelee,
    Math.max(0, attackPoolBeforeDefense - (guardianShieldReduction?.reducedBy ?? 0))
  );
  const attempts = Math.max(0, attackPoolBeforeDefense - (guardianShieldReduction?.reducedBy ?? 0) - (pointDefenseLaserResult?.reducedBy ?? 0));
  const rolledHits = rollSuccesses(attempts, hitTarget, rng);
  const stimpackPrecisionBonus = getStimpackPrecisionBonus(state, attacker);
  const precisionApplied = Math.min(Math.max(0, attempts - rolledHits), getPrecisionValue(weapon) + stimpackPrecisionBonus);
  const wounds = rollSuccesses(rolledHits, woundTarget, rng);
  const damagePerHit = getPierceDamage(weapon, target) ?? weapon.damage;
  const automaticHitsRule = getAutomaticHitsRule(weapon);
  const automaticHitEntries = createArmourPoolEntries(automaticHitsRule?.count ?? 0, automaticHitsRule?.damage ?? damagePerHit, {
    surgeEligible: false,
    source: "hits"
  });
  const armourPoolEntries = [
    ...createArmourPoolEntries(wounds, damagePerHit, { source: "wound" }),
    ...createArmourPoolEntries(precisionApplied, damagePerHit, { source: "precision" }),
    ...automaticHitEntries
  ];
  const surgeEligibleEntries = armourPoolEntries.filter(entry => entry.surgeEligible);
  const criticalHitResult = resolveCriticalHit(weapon, armourPoolEntries);
  const surgeResult = resolveSurge(weapon, target, surgeEligibleEntries, rng);
  const bypassedEntries = [...(criticalHitResult?.entries ?? []), ...(surgeResult?.entries ?? [])];
  const dodgeResult = resolveDodge(target, bypassedEntries);
  const preventedByDodge = new Set((dodgeResult?.entries ?? []).map(entry => entry));
  const finalBypassedEntries = bypassedEntries.filter(entry => !preventedByDodge.has(entry));
  for (const preventedEntry of dodgeResult?.entries ?? []) {
    armourPoolEntries.push(preventedEntry);
  }
  const saveableWounds = armourPoolEntries.length;
  const ancillaryCarapaceResult = resolveAncillaryCarapace(target, saveableWounds);
  if (ancillaryCarapaceResult) saveTarget = Math.max(2, saveTarget - ancillaryCarapaceResult.bonus);
  const saved = rollSuccesses(saveableWounds, saveTarget, rng);
  popHighestDamageEntries(armourPoolEntries, saved);
  const unsavedBeforeEvade = armourPoolEntries.length + finalBypassedEntries.length;
  const evadeResult = resolveEvade(state, attacker, target, weapon, isMelee, visible, unsavedBeforeEvade, rng);
  const allDamageEntries = [...finalBypassedEntries, ...armourPoolEntries];
  popHighestDamageEntries(allDamageEntries, Math.max(0, evadeResult?.saved ?? 0));
  const unsaved = allDamageEntries.length;
  const rawTotalDamage = allDamageEntries.reduce((sum, entry) => sum + entry.damage, 0);
  const lifeSupportResult = resolveLifeSupport(state, target, rawTotalDamage);
  const transfusionResult = resolveTransfusion(state, target, Math.max(0, rawTotalDamage - (lifeSupportResult?.reducedBy ?? 0)));
  const zealousRoundResult = resolveZealousRound(
    state,
    target,
    Math.max(0, rawTotalDamage - (lifeSupportResult?.reducedBy ?? 0) - (transfusionResult?.reducedBy ?? 0))
  );
  const totalDamage = Math.max(
    0,
    rawTotalDamage - (lifeSupportResult?.reducedBy ?? 0) - (transfusionResult?.reducedBy ?? 0) - (zealousRoundResult?.reducedBy ?? 0)
  );
  const concentratedFireCap = getConcentratedFireValue(weapon);
  const damageResult = applyDamageToUnit(target, totalDamage, {
    casualtyCap: concentratedFireCap > 0 ? concentratedFireCap : null
  });
  const casualties = damageResult.casualties;

  const targetStillAlive = getAliveModels(target).length > 0;
  if (isMelee && !targetStillAlive) {
    const nearestEnemyPoint = getNearestEnemyLeaderPoint(state, attacker);
    if (nearestEnemyPoint) {
      moveLeaderToward(state, attacker, nearestEnemyPoint, CONSOLIDATE_DISTANCE_INCHES);
    }
  }

  appendLog(
    state,
    "combat",
    `${attacker.name} ${isMelee ? "charges" : isOverwatch ? "fires overwatch at" : "attacks"} ${target.name} with ${weapon.name}: ${attempts} attacks${guardianShieldReduction ? ` (Guardian Shield -${guardianShieldReduction.reducedBy})` : ""}${pointDefenseLaserResult ? ` (Point Defense Laser -${pointDefenseLaserResult.reducedBy})` : ""}, ${rolledHits + precisionApplied + automaticHitEntries.length} hits${precisionApplied ? ` (including ${precisionApplied} Precision${stimpackPrecisionBonus ? `, Stimpack +${stimpackPrecisionBonus}` : ""})` : stimpackPrecisionBonus ? ` (Stimpack +${stimpackPrecisionBonus} Precision)` : ""}${automaticHitEntries.length ? ` (including ${automaticHitEntries.length} automatic Hits)` : ""}, ${wounds} wounds${criticalHitResult ? `, Critical Hit ${criticalHitResult.applied} bypassed armour` : ""}${surgeResult ? `, Surge ${surgeResult.dice} rolled ${surgeResult.roll} vs ${surgeResult.matchedTags.join("/")} -> ${surgeResult.applied} bypassed armour` : ""}${dodgeResult ? `, Dodge prevented ${dodgeResult.prevented} bypassed hits` : ""}, ${saved} saves${ancillaryCarapaceResult ? " (Ancillary Carapace)" : ""}${objectiveDefenseBonus ? ` (objective armor +${objectiveDefenseBonus})` : ""}${coverApplies ? " (cover)" : ""}${highGroundCover ? " (high ground)" : ""}${evadeResult ? `, ${evadeResult.saved} evade saves on ${evadeResult.target}+${evadeResult.lurkingBonus ? " with Lurking" : ""}` : ""}${!visible && !isMelee ? ", indirect fire without line of sight" : ""}${!isMelee && isUnitInGrass(state, target) && !isUnitDetected(state, attacker.owner, target) ? ", grass concealment active" : ""}${longRangePenalty ? ", long range penalty applied" : ""}${burstFireApplied ? `, Burst Fire +${burstFireRule.bonusAttacks}` : ""}${lockedInBonus ? `, Locked In +${lockedInBonus}` : ""}${getAntiEvadeValue(weapon) ? `, Anti-Evade ${getAntiEvadeValue(weapon)}` : ""}${damagePerHit !== weapon.damage ? `, Pierce damage ${damagePerHit}` : ""}${automaticHitEntries.length ? `, Hits ${automaticHitEntries.length} (${automaticHitsRule.damage} damage each)` : ""}${lifeSupportResult ? `, Life Support reduced damage by ${lifeSupportResult.reducedBy}` : ""}${transfusionResult ? `, Transfusion reduced damage by ${transfusionResult.reducedBy}` : ""}${zealousRoundResult ? `, Zealous Round reduced damage by ${zealousRoundResult.reducedBy}` : ""}${concentratedFireCap > 0 ? `, Concentrated Fire cap ${concentratedFireCap}${damageResult.discardedDamage > 0 ? ` (discarded ${damageResult.discardedDamage} damage)` : ""}` : ""}${isMelee ? `, Fighting Rank ${meleeRankProfile.fightingRankModels.length}, Supporting Rank ${meleeRankProfile.supportingRankModels.length}, Assigned Models ${aliveAttackerModels}${primaryTargetFocus ? ", Primary Target Focus" : ""}` : ""}, ${casualties} casualties.`
  );

  return {
    type: "combat_attack_resolved",
    payload: {
      mode: isMelee ? "melee" : isOverwatch ? "overwatch" : "ranged",
      attackerId: attacker.id,
      targetId: target.id,
      weaponId: weapon.id,
      attempts,
      hits: rolledHits + precisionApplied + automaticHitEntries.length,
      wounds,
      saved,
      unsaved,
      casualties,
      impact: impactResult,
      surge: surgeResult,
      precision: precisionApplied,
      stimpack: stimpackPrecisionBonus ? { precisionBonus: stimpackPrecisionBonus } : null,
      automaticHits: automaticHitEntries.length
        ? { count: automaticHitEntries.length, damage: automaticHitsRule.damage }
        : null,
      criticalHit: criticalHitResult,
      evade: evadeResult,
      ancillaryCarapace: ancillaryCarapaceResult,
      dodge: dodgeResult,
      antiEvade: getAntiEvadeValue(weapon),
      objectiveDefenseBonus,
      highGround: highGroundCover,
      guardianShield: guardianShieldReduction,
      pointDefenseLaser: pointDefenseLaserResult,
      burstFire: burstFireApplied ? burstFireRule : null,
      lockedIn: lockedInBonus,
      concentratedFire: concentratedFireCap > 0 ? { cap: concentratedFireCap, discardedDamage: damageResult.discardedDamage } : null,
      lifeSupport: lifeSupportResult,
      transfusion: transfusionResult,
      zealousRound: zealousRoundResult,
      fightingRank: isMelee ? meleeRankProfile.fightingRankModels.length : null,
      supportingRank: isMelee ? meleeRankProfile.supportingRankModels.length : null,
      assignedModels: isMelee ? aliveAttackerModels : null,
      primaryTargetFocus: isMelee ? primaryTargetFocus : null,
      visible,
      longRangePenalty: Boolean(longRangePenalty),
      damagePerHit,
      totalDamage: damageResult.appliedDamage
    }
  };
}

function expandMeleeDeclarations(state, declarations) {
  const expanded = [...declarations];
  const existingKeys = new Set(declarations.map(entry => `${entry.attackerId}:${entry.targetId}:${entry.type}`));

  for (const declaration of declarations) {
    if (declaration.type !== "charge_attack") continue;
    const attacker = state.units[declaration.attackerId];
    if (!attacker || attacker.status.location !== "battlefield") continue;
    const engagedEnemies = getEngagedEnemyUnitsForMelee(state, attacker);
    for (const enemy of engagedEnemies) {
      const key = `${attacker.id}:${enemy.id}:${declaration.type}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      expanded.push({
        ...declaration,
        targetId: enemy.id,
        primaryTargetId: declaration.primaryTargetId ?? declaration.targetId
      });
    }
  }

  return expanded.map(entry => entry.type === "charge_attack"
    ? { ...entry, primaryTargetId: entry.primaryTargetId ?? entry.targetId }
    : entry);
}

export function hasQueuedCombatForUnit(state, unitId) {
  return state.combatQueue.some(entry =>
    ["ranged_attack", "charge_attack", "overwatch_attack"].includes(entry.type) && entry.attackerId === unitId
  );
}

export function resolveCombatForUnit(state, unitId, { rng = Math.random } = {}) {
  const events = [];
  const declarations = expandMeleeDeclarations(state, state.combatQueue.filter(entry =>
    ["ranged_attack", "charge_attack", "overwatch_attack"].includes(entry.type) && entry.attackerId === unitId
  ));

  if (!declarations.length) {
    return { ok: true, state, events };
  }

  for (const declaration of declarations) {
    const event = resolveSingleAttack(state, declaration, rng);
    if (event) {
      events.push(event);
      onEvent(state, event);
    }
  }

  state.combatQueue = state.combatQueue.filter(entry =>
    !(["ranged_attack", "charge_attack", "overwatch_attack"].includes(entry.type) && entry.attackerId === unitId)
  );

  refreshEngagement(state);
  refreshAllSupply(state);
  return { ok: true, state, events };
}

export function resolveCombatPhase(state, { rng = Math.random } = {}) {
  const events = [];
  state.lastCombatReport = [];
  const declarations = expandMeleeDeclarations(
    state,
    state.combatQueue.filter(entry => ["ranged_attack", "charge_attack", "overwatch_attack"].includes(entry.type))
  );

  if (!declarations.length) {
    appendLog(state, "combat", "No attacks were declared in Assault. Combat ends without attacks.");
    return { ok: true, state, events };
  }

  for (const declaration of declarations) {
    const event = resolveSingleAttack(state, declaration, rng);
    if (event) {
      events.push(event);
      onEvent(state, event);
    }
  }

  state.lastCombatReport = events.map(event => event.payload);
  state.combatQueue = [];
  refreshEngagement(state);
  refreshAllSupply(state);
  return { ok: true, state, events };
}
