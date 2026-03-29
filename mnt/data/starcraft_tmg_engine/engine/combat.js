import { appendLog } from "./state.js";
import { distance, pointInBoard, circleOverlapsTerrain, circleOverlapsCircle, circleOverlapsRect } from "./geometry.js";
import { recomputeUnitCurrentSupply, refreshAllSupply } from "./supply.js";
import { getModifiedValue, onEvent } from "./effects.js";
import { refreshEngagement } from "./movement.js";

const MELEE_REACH_INCHES = 1.5;
const CHARGE_MAX_RANGE_INCHES = 8;
const PILE_IN_DISTANCE_INCHES = 3;
const CONSOLIDATE_DISTANCE_INCHES = 3;

function getAliveModels(unit) {
  return unit.modelIds
    .map(modelId => unit.models[modelId])
    .filter(model => model.alive && model.x != null && model.y != null);
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

function isUnitReceivingCover(state, unit) {
  const coverTerrain = state.board.terrain.filter(terrain => !terrain.impassable && terrain.kind === "cover");
  if (!coverTerrain.length) return false;
  return unit.modelIds.some(modelId => {
    const model = unit.models[modelId];
    if (!model.alive || model.x == null || model.y == null) return false;
    return coverTerrain.some(terrain => circleOverlapsRect({ x: model.x, y: model.y }, unit.base.radiusInches, terrain.rect));
  });
}

function applyDamageToUnit(unit, totalDamage) {
  let remaining = totalDamage;
  const ordered = unit.modelIds.map(modelId => unit.models[modelId]).filter(model => model.alive);

  for (const model of ordered) {
    if (remaining <= 0) break;
    model.woundsRemaining -= remaining;
    if (model.woundsRemaining <= 0) {
      remaining = Math.abs(model.woundsRemaining);
      model.alive = false;
      model.x = null;
      model.y = null;
      model.woundsRemaining = 0;
    } else {
      remaining = 0;
    }
  }

  if (unit.leadingModelId && !unit.models[unit.leadingModelId].alive) {
    const nextLeader = unit.modelIds.find(modelId => unit.models[modelId].alive);
    unit.leadingModelId = nextLeader ?? unit.leadingModelId;
  }

  const removed = ordered.filter(model => !model.alive).length;
  recomputeUnitCurrentSupply(unit);
  return removed;
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
  if (isMelee) {
    if (range > CHARGE_MAX_RANGE_INCHES + 1e-6) return { ok: false, reason: "Charge target moved out of declared charge range." };
  } else {
    const modifiedRange = getModifiedValue(state, {
      timing: "combat_resolve_attack",
      unitId: attacker.id,
      key: "weapon.rangeInches",
      baseValue: weapon.rangeInches
    }).value;
    if (range > modifiedRange + 1e-6) return { ok: false, reason: "Target out of range." };
  }
  if (attacker.owner === target.owner) return { ok: false, reason: "Cannot target friendly units." };
  return { ok: true, attacker, target, weapon, isMelee, isOverwatch };
}

function resolveSingleAttack(state, declaration, rng) {
  const validation = validateDeclaration(state, declaration);
  if (!validation.ok) {
    appendLog(state, "combat", `Skipped declared attack (${declaration.attackerId} -> ${declaration.targetId}): ${validation.reason}`);
    return null;
  }

  const { attacker, target, weapon, isMelee, isOverwatch } = validation;

  if (isMelee) {
    const targetPoint = getLeaderPoint(target);
    if (!targetPoint) return null;
    const attackerPoint = getLeaderPoint(attacker);
    if (!attackerPoint) return null;

    const currentRange = distance(attackerPoint, targetPoint);
    if (currentRange > MELEE_REACH_INCHES + 1e-6) {
      const moved = moveLeaderTowardMeleeRange(state, attacker, targetPoint, PILE_IN_DISTANCE_INCHES, MELEE_REACH_INCHES);
      if (!moved) {
        appendLog(state, "combat", `${attacker.name} could not complete pile-in movement and loses its charge attack.`);
        return null;
      }
    }

    const inReachAfterPileIn = distance(getLeaderPoint(attacker), targetPoint) <= MELEE_REACH_INCHES + 1e-6;
    if (!inReachAfterPileIn) {
      appendLog(state, "combat", `${attacker.name} failed to reach ${target.name} after pile-in movement.`);
      return null;
    }
  }

  const aliveAttackerModels = getAliveModels(attacker).length;
  if (!aliveAttackerModels) return null;

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
  const hitTarget = isOverwatch ? Math.max(hitTargetBase, 6) : hitTargetBase;

  const woundTargetBase = woundTargetForProfile(weapon.strength, target.defense.toughness);
  const woundTarget = applyWeaponKeywordsToWoundTarget(weapon, target, woundTargetBase);
  let saveTarget = getBestSaveTarget(target, weapon.armorPenetration);
  const coverApplies = !isMelee && isUnitReceivingCover(state, target);
  if (coverApplies) saveTarget = Math.max(2, saveTarget - 1);

  const rawAttempts = aliveAttackerModels * attemptsPerModel;
  const attempts = Math.max(0, Math.floor(isOverwatch ? rawAttempts / 2 : rawAttempts));
  const hits = rollSuccesses(attempts, hitTarget, rng);
  const wounds = rollSuccesses(hits, woundTarget, rng);
  const saved = rollSuccesses(wounds, saveTarget, rng);
  const unsaved = Math.max(0, wounds - saved);
  const totalDamage = unsaved * weapon.damage;
  const casualties = applyDamageToUnit(target, totalDamage);

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
    `${attacker.name} ${isMelee ? "charges" : isOverwatch ? "fires overwatch at" : "attacks"} ${target.name} with ${weapon.name}: ${attempts} attacks, ${hits} hits, ${wounds} wounds, ${saved} saves${coverApplies ? " (cover)" : ""}, ${casualties} casualties.`
  );

  return {
    type: "combat_attack_resolved",
    payload: {
      mode: isMelee ? "melee" : isOverwatch ? "overwatch" : "ranged",
      attackerId: attacker.id,
      targetId: target.id,
      weaponId: weapon.id,
      attempts,
      hits,
      wounds,
      saved,
      unsaved,
      totalDamage,
      casualties
    }
  };
}

export function hasQueuedCombatForUnit(state, unitId) {
  return state.combatQueue.some(entry =>
    ["ranged_attack", "charge_attack", "overwatch_attack"].includes(entry.type) && entry.attackerId === unitId
  );
}

export function resolveCombatForUnit(state, unitId, { rng = Math.random } = {}) {
  const events = [];
  const declarations = state.combatQueue.filter(entry =>
    ["ranged_attack", "charge_attack", "overwatch_attack"].includes(entry.type) && entry.attackerId === unitId
  );

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
  const declarations = state.combatQueue.filter(entry => ["ranged_attack", "charge_attack", "overwatch_attack"].includes(entry.type));

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
