import { distance, pointInsideRect, sampleSegment } from "./geometry.js";

const HIDDEN_REVEAL_RANGE = 4;
const SUPPORT_REACTION_RANGE = 4;

function isFlyingUnit(unit) {
  return unit?.tags?.includes("Flying") || unit?.abilities?.includes("flying");
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

export function isTargetHiddenFromUnit(state, attacker, target) {
  if (!target?.status?.hidden) return false;
  return !areUnitsWithinRevealRange(attacker, target);
}

export function canTargetWithRangedWeapon(state, attacker, target, weapon) {
  if (attacker?.status?.engaged && hasBulkyWeapon(weapon)) {
    return { ok: false, reason: "Bulky weapons cannot be used while the attacker is engaged." };
  }

  if (target?.status?.engaged && !hasPinpointWeapon(weapon)) {
    return { ok: false, reason: "Engaged enemy units can only be targeted by ranged attacks with Pinpoint." };
  }

  if (isTargetHiddenFromUnit(state, attacker, target)) {
    return { ok: false, reason: "Target is hidden beyond 4 inches." };
  }

  const visible = hasLineOfSight(state, attacker, target);
  if (!visible && !hasIndirectFire(weapon)) {
    return { ok: false, reason: "Target is not visible." };
  }

  return { ok: true, visible };
}

export function targetGetsEvadeOpportunity(state, attacker, target, weapon, isMelee, visible) {
  if (target?.defense?.evadeTarget == null) return false;
  if (target?.status?.hidden || target?.status?.burrowed) return true;
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
