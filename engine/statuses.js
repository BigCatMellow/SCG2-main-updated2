import { appendLog } from "./state.js";
import { markUnitActivatedForCurrentPhase, isUnitEligibleForCurrentPhaseActivation, endActivationAndPassTurn } from "./activation.js";

function hasAbility(unit, ability) {
  return unit?.abilities?.includes(ability);
}

export function canBurrow(unit) {
  return Boolean(unit?.tags?.includes("Ground") && (hasAbility(unit, "burrow") || hasAbility(unit, "burrowed_regen")));
}

export function canHide(unit) {
  return Boolean(hasAbility(unit, "hide"));
}

export function setHiddenStatus(unit, hidden) {
  unit.status.hidden = Boolean(hidden);
}

export function setBurrowedStatus(unit, burrowed) {
  unit.status.burrowed = Boolean(burrowed);
  if (burrowed) {
    unit.status.hidden = true;
  }
}

export function removeStealthStatuses(unit) {
  const changed = unit.status.hidden || unit.status.burrowed;
  unit.status.hidden = false;
  unit.status.burrowed = false;
  return changed;
}

export function applyCloseRanks(state, unit, options = {}) {
  if (!unit?.status?.burrowed) return { changed: false };

  unit.status.burrowed = false;
  unit.status.hidden = false;
  unit.status.stationary = false;

  const targetName = options.targetName ? ` against ${options.targetName}` : "";
  appendLog(
    state,
    "action",
    `${unit.name} closes ranks and emerges from Burrowed formation${targetName}.`
  );
  return { changed: true };
}

export function validateCloseRanks(state, playerId, unitId) {
  const unit = state.units[unitId];
  if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
  if (state.phase !== "combat") return { ok: false, code: "WRONG_PHASE", message: "Close Ranks is only available in Combat Phase." };
  if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
  if (!isUnitEligibleForCurrentPhaseActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
  if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Only battlefield units can close ranks." };
  if (!unit.status.burrowed) return { ok: false, code: "NOT_BURROWED", message: "Only Burrowed units can close ranks." };
  if (!unit.status.engaged) return { ok: false, code: "NOT_ENGAGED", message: "Unit must be engaged to close ranks." };
  return { ok: true, unit };
}

export function resolveCloseRanks(state, playerId, unitId) {
  const validation = validateCloseRanks(state, playerId, unitId);
  if (!validation.ok) return validation;

  const unit = validation.unit;
  applyBurrowedActivationEffects(state, unit);
  applyCloseRanks(state, unit);
  markUnitActivatedForCurrentPhase(state, unitId);
  endActivationAndPassTurn(state);
  return { ok: true, state, events: [{ type: "unit_closed_ranks", payload: { unitId } }] };
}

export function healUnitDamage(unit, amount) {
  const healAmount = Math.max(0, Math.floor(amount));
  if (!healAmount) return 0;

  const maxWounds = Math.max(1, Math.floor(unit.woundsPerModel ?? 1));
  let remaining = healAmount;
  let restored = 0;
  const damagedModels = unit.modelIds
    .map(modelId => unit.models[modelId])
    .filter(model => model.alive && model.woundsRemaining < maxWounds)
    .sort((a, b) => a.woundsRemaining - b.woundsRemaining);

  for (const model of damagedModels) {
    if (remaining <= 0) break;
    const missing = maxWounds - model.woundsRemaining;
    const recovered = Math.min(missing, remaining);
    model.woundsRemaining += recovered;
    restored += recovered;
    remaining -= recovered;
  }

  return restored;
}

export function applyBurrowedActivationEffects(state, unit) {
  if (!unit?.status?.burrowed) return { healed: 0 };
  if (!hasAbility(unit, "burrowed_regen")) return { healed: 0 };

  const healed = healUnitDamage(unit, 2);
  if (healed > 0) {
    appendLog(state, "info", `${unit.name} regenerates ${healed} wound${healed === 1 ? "" : "s"} while burrowed.`);
  }
  return { healed };
}

function validateShared(state, playerId, unitId) {
  const unit = state.units[unitId];
  if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
  if (!isUnitEligibleForCurrentPhaseActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
  if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
  if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Only battlefield units can change status." };
  if (unit.status.engaged) return { ok: false, code: "UNIT_ENGAGED", message: "Unit must be unengaged to change stealth status." };
  return { ok: true, unit };
}

export function validateToggleBurrow(state, playerId, unitId) {
  const shared = validateShared(state, playerId, unitId);
  if (!shared.ok) return shared;
  if (!canBurrow(shared.unit)) return { ok: false, code: "CANNOT_BURROW", message: "This unit cannot burrow." };
  return { ok: true, unit: shared.unit };
}

export function resolveToggleBurrow(state, playerId, unitId) {
  const validation = validateToggleBurrow(state, playerId, unitId);
  if (!validation.ok) return validation;

  const unit = validation.unit;
  applyBurrowedActivationEffects(state, unit);
  const nextBurrowed = !unit.status.burrowed;
  setBurrowedStatus(unit, nextBurrowed);
  if (!nextBurrowed) {
    unit.status.hidden = false;
  }
  unit.status.stationary = true;

  markUnitActivatedForCurrentPhase(state, unitId);
  appendLog(state, "action", `${unit.name} ${nextBurrowed ? "burrows and becomes Hidden." : "emerges and loses Burrowed."}`);
  endActivationAndPassTurn(state);
  return { ok: true, state, events: [{ type: "unit_burrow_toggled", payload: { unitId, burrowed: nextBurrowed } }] };
}

export function validateToggleHidden(state, playerId, unitId) {
  const shared = validateShared(state, playerId, unitId);
  if (!shared.ok) return shared;
  if (!canHide(shared.unit)) return { ok: false, code: "CANNOT_HIDE", message: "This unit cannot gain Hidden." };
  if (shared.unit.status.burrowed) return { ok: false, code: "ALREADY_BURROWED", message: "Burrowed units are already Hidden." };
  return { ok: true, unit: shared.unit };
}

export function resolveToggleHidden(state, playerId, unitId) {
  const validation = validateToggleHidden(state, playerId, unitId);
  if (!validation.ok) return validation;

  const unit = validation.unit;
  applyBurrowedActivationEffects(state, unit);
  const nextHidden = !unit.status.hidden;
  setHiddenStatus(unit, nextHidden);
  unit.status.stationary = true;

  markUnitActivatedForCurrentPhase(state, unitId);
  appendLog(state, "action", `${unit.name} ${nextHidden ? "becomes Hidden." : "reveals itself and loses Hidden."}`);
  endActivationAndPassTurn(state);
  return { ok: true, state, events: [{ type: "unit_hidden_toggled", payload: { unitId, hidden: nextHidden } }] };
}
