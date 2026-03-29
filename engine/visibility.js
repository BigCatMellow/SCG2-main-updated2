import { distance, pointInsideRect, pointInsideTerrainKind, sampleSegment } from "./geometry.js";

const HIDDEN_REVEAL_RANGE = 4;
const DETECTION_RANGE = 6;
const SUPPORT_REACTION_RANGE = 4;

function isFlyingUnit(unit) {
  return unit?.tags?.includes("Flying") || unit?.abilities?.includes("flying");
}

function getTerrainModels(unit) {
  return Object.values(unit?.models ?? {}).filter(model => model.alive && model.x != null && model.y != null);
}

export function isUnitInsideTerrainKinds(state, unit, kinds = []) {
  const terrain = state?.board?.terrain ?? [];
  return getTerrainModels(unit).some(model => pointInsideTerrainKind(model, terrain, kinds));
}

export function isUnitInGrass(state, unit) {
  return isUnitInsideTerrainKinds(state, unit, ["grass"]);
}

export function isUnitOnElevatedCover(state, unit) {
  return isUnitInsideTerrainKinds(state, unit, ["elevated_cover"]);
}

export function weaponHasKeyword(weapon, keyword) {
  return weapon?.[keyword] === true || weapon?.keywords?.includes(keyword);
}

export function getLeaderPoint(unit) {
  const leader = unit?.models?.[unit?.leadingModelId];
  if (!leader || !leader.alive || leader.x == null || leader.y == null) return null;
  return { x: leader.x, y: leader.y };
}

export function hasIndirectFire(weapon) {
  return weapon?.indirectFire === true || weapon?.keywords?.includes("indirect_fire");
}

export function getLongRangeValue(weapon) {
  const longRange = weapon?.longRangeInches ?? weapon?.longRange ?? null;
  return longRange == null ? null : Math.max(Number(weapon?.rangeInches ?? 0), Number(longRange));
}

export function getAntiEvadeValue(weapon) {
  return Math.max(0, Math.floor(weapon?.antiEvade ?? 0));
}

export function hasBulkyWeapon(weapon) {
  return weaponHasKeyword(weapon, "bulky");
}

export function hasInstantWeapon(weapon) {
  return weaponHasKeyword(weapon, "instant");
}

export function hasPinpointWeapon(weapon) {
  return weaponHasKeyword(weapon, "pinpoint");
}

export function areUnitsWithinRevealRange(attacker, target, revealRange = HIDDEN_REVEAL_RANGE) {
  const attackerPoint = getLeaderPoint(attacker);
  const targetPoint = getLeaderPoint(target);
  if (!attackerPoint || !targetPoint) return false;
  return distance(attackerPoint, targetPoint) <= revealRange + 1e-6;
}

export function canUnitDetectTarget(detector, target, detectionRange = DETECTION_RANGE) {
  if (!detector?.abilities?.includes("detection")) return false;
  const detectorPoint = getLeaderPoint(detector);
  const targetPoint = getLeaderPoint(target);
  if (!detectorPoint || !targetPoint) return false;
  return distance(detectorPoint, targetPoint) <= detectionRange + 1e-6;
}

function getEffectZoneCenter(state, effect) {
  if (effect?.target?.scope === "unit") {
    return getLeaderPoint(state.units?.[effect.target.unitId]);
  }
  return effect?.zone?.center ?? null;
}

export function getDetectionZones(state, playerId = null) {
  return (state.effects ?? [])
    .filter(effect => effect?.zone?.kind === "detection_field")
    .map(effect => {
      const center = getEffectZoneCenter(state, effect);
      if (!center) return null;
      return {
        id: `detection_zone_${effect.id}`,
        owner: effect.source?.owner ?? null,
        source: effect.name ?? "Detection Field",
        center,
        radius: effect.zone?.radius ?? DETECTION_RANGE
      };
    })
    .filter(Boolean)
    .filter(zone => !playerId || zone.owner === playerId);
}

export function isUnitDetected(state, viewerPlayerId, target) {
  if (!target?.status?.hidden && !target?.status?.burrowed) return false;
  const unitDetection = Object.values(state.units).some(unit =>
    unit.owner === viewerPlayerId
    && unit.status?.location === "battlefield"
    && canUnitDetectTarget(unit, target)
  );
  if (unitDetection) return true;
  const targetPoint = getLeaderPoint(target);
  if (!targetPoint) return false;
  return getDetectionZones(state, viewerPlayerId).some(zone =>
    distance(zone.center, targetPoint) <= (zone.radius ?? DETECTION_RANGE) + 1e-6
  );
}

export function hasLineOfSight(state, attacker, target) {
  const attackerPoint = getLeaderPoint(attacker);
  const targetPoint = getLeaderPoint(target);
  if (!attackerPoint || !targetPoint) return false;
  if (isFlyingUnit(attacker) || isFlyingUnit(target)) return true;

  const blockers = state.board.terrain.filter(terrain => terrain.kind === "blocker" || terrain.impassable);
  const samples = sampleSegment(attackerPoint, targetPoint, 0.2);
  for (let i = 1; i < samples.length - 1; i += 1) {
    if (blockers.some(terrain => pointInsideRect(samples[i], terrain.rect))) return false;
  }
  return true;
}

function isTargetConcealedByGrass(state, attacker, target) {
  if (!isUnitInGrass(state, target)) return false;
  if (isUnitDetected(state, attacker?.owner, target)) return false;
  if (isUnitInGrass(state, attacker)) return false;
  return !areUnitsWithinRevealRange(attacker, target);
}

export function isTargetHiddenFromUnit(state, attacker, target) {
  if (!target?.status?.hidden) return false;
  if (isUnitDetected(state, attacker?.owner, target)) return false;
  return !areUnitsWithinRevealRange(attacker, target);
}

export function canTargetWithRangedWeapon(state, attacker, target, weapon) {
  const attackerPoint = getLeaderPoint(attacker);
  const targetPoint = getLeaderPoint(target);
  const targetDistance = attackerPoint && targetPoint ? distance(attackerPoint, targetPoint) : null;
  if (attacker?.status?.engaged && hasBulkyWeapon(weapon)) {
    return {
      ok: false,
      reason: "Bulky weapons cannot be used while the attacker is engaged.",
      detail: attackerPoint && targetPoint
        ? `Attacker is engaged, and ${weapon?.name ?? "this weapon"} has Bulky. Range to target was ${targetDistance.toFixed(1)}".`
        : `${weapon?.name ?? "This weapon"} has Bulky and cannot fire while the attacker is engaged.`
    };
  }

  if (target?.status?.engaged && !hasPinpointWeapon(weapon)) {
    return {
      ok: false,
      reason: "Engaged enemy units can only be targeted by ranged attacks with Pinpoint.",
      detail: `${target?.name ?? "The target"} is engaged in melee, and ${weapon?.name ?? "this weapon"} does not have Pinpoint.`
    };
  }

  if (isTargetHiddenFromUnit(state, attacker, target)) {
    return {
      ok: false,
      reason: "Target is hidden beyond 4 inches.",
      detail: `${target?.name ?? "The target"} is Hidden, not detected, and ${targetDistance != null ? `is ${targetDistance.toFixed(1)}" away` : "is outside reveal distance"}. Hidden targets can only be revealed for normal targeting within ${HIDDEN_REVEAL_RANGE}".`
    };
  }

  if (isTargetConcealedByGrass(state, attacker, target)) {
    return {
      ok: false,
      reason: "Target is concealed in grass beyond 4 inches.",
      detail: `${target?.name ?? "The target"} is in grass, ${attacker?.name ?? "the attacker"} is not, no Detection is active, and the units are ${targetDistance != null ? `${targetDistance.toFixed(1)}"` : "more than 4\""} apart. Grass concealment blocks this shot beyond ${HIDDEN_REVEAL_RANGE}".`
    };
  }

  const visible = hasLineOfSight(state, attacker, target);
  if (!visible && !hasIndirectFire(weapon)) {
    return {
      ok: false,
      reason: "Target is not visible.",
      detail: `${target?.name ?? "The target"} is outside line of sight from ${attacker?.name ?? "the attacker"}, and ${weapon?.name ?? "this weapon"} does not have Indirect Fire.`
    };
  }

  return { ok: true, visible, detail: visible ? "Target is visible." : "Target is not visible, but Indirect Fire allows the attack." };
}

export function targetGetsEvadeOpportunity(state, attacker, target, weapon, isMelee, visible) {
  if (target?.defense?.evadeTarget == null) return false;
  if ((target?.status?.hidden || target?.status?.burrowed) && !isUnitDetected(state, attacker?.owner, target)) return true;
  if (!isMelee && isUnitInGrass(state, target) && !isUnitDetected(state, attacker?.owner, target)) return true;
  if (!isMelee && target?.abilities?.includes("lurking") && target?.status?.stationary && !target?.status?.lurkingUsedThisRound) return true;
  if (isMelee && target?.abilities?.includes("combat_shield")) return true;
  if (!isMelee && Object.values(state.units).some(unit => {
    if (unit.owner !== target.owner || unit.id === target.id || !unit.abilities?.includes("hallucination")) return false;
    const source = getLeaderPoint(unit);
    const defended = getLeaderPoint(target);
    if (!source || !defended) return false;
    return distance(source, defended) <= SUPPORT_REACTION_RANGE + 1e-6;
  })) return true;
  if (!isMelee && target?.status?.engaged) return true;
  if (!isMelee && hasIndirectFire(weapon) && visible === false) return true;
  return false;
}
