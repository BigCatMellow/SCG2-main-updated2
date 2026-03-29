import { appendLog } from "./state.js";
import { advanceToNextPhase } from "./phases.js";

function getPhaseActivationFlag(phase) {
  if (phase === "movement") return "movementActivated";
  if (phase === "assault") return "assaultActivated";
  if (phase === "combat") return "combatActivated";
  return null;
}

function isActivatingPhase(phase) {
  return phase === "movement" || phase === "assault" || phase === "combat";
}

function isUnitActivatedForPhase(unit, phase) {
  const flag = getPhaseActivationFlag(phase);
  if (!flag) return true;
  return Boolean(unit.status[flag]);
}

function markUnitActivatedForPhase(state, unitId, phase) {
  const unit = state.units[unitId];
  const flag = getPhaseActivationFlag(phase);
  if (!flag) return;
  unit.status[flag] = true;
  unit.activationMarkers = unit.activationMarkers.filter(marker => marker.phase !== phase);
  unit.activationMarkers.push({ phase, state: "activated" });
}

export function isUnitEligibleForMovementActivation(state, unitId) {
  const unit = state.units[unitId];
  if (!unit) return false;
  if (state.phase !== "movement") return false;
  if (unit.owner !== state.activePlayer) return false;
  if (unit.status.movementActivated) return false;
  if (state.players[unit.owner].hasPassedThisPhase) return false;
  return unit.status.location === "battlefield" || unit.status.location === "reserves";
}

export function isUnitEligibleForCurrentPhaseActivation(state, unitId) {
  const unit = state.units[unitId];
  if (!unit) return false;
  if (!isActivatingPhase(state.phase)) return false;
  if (unit.owner !== state.activePlayer) return false;
  if (isUnitActivatedForPhase(unit, state.phase)) return false;
  if (state.players[unit.owner].hasPassedThisPhase) return false;
  if (state.phase === "movement") return unit.status.location === "battlefield" || unit.status.location === "reserves";
  return unit.status.location === "battlefield";
}

export function getEligibleUnitsForCurrentPhase(state, playerId) {
  return Object.values(state.units).filter(unit => {
    if (unit.owner !== playerId) return false;
    if (state.players[playerId].hasPassedThisPhase) return false;
    if (state.phase === "movement") return !unit.status.movementActivated;
    if (state.phase === "assault") return unit.status.location === "battlefield" && !unit.status.assaultActivated;
    if (state.phase === "combat") return unit.status.location === "battlefield" && !unit.status.combatActivated;
    return false;
  });
}

export function markUnitActivatedForMovement(state, unitId) {
  markUnitActivatedForPhase(state, unitId, "movement");
}

export function markUnitActivatedForCurrentPhase(state, unitId) {
  markUnitActivatedForPhase(state, unitId, state.phase);
}

export function clearPhaseActivationFlagsForNewRound(state) {
  for (const unit of Object.values(state.units)) {
    unit.status.movementActivated = false;
    unit.status.assaultActivated = false;
    unit.status.combatActivated = false;
    unit.activationMarkers = [];
  }
}

export function clearCurrentPhaseActivationFlags(state) {
  const phase = state.phase;
  const flag = getPhaseActivationFlag(phase);
  if (!flag) return;
  for (const unit of Object.values(state.units)) {
    unit.status[flag] = false;
    unit.activationMarkers = unit.activationMarkers.filter(marker => marker.phase !== phase);
  }
}

export function canPlayerPass(state, playerId) {
  return isActivatingPhase(state.phase) && state.activePlayer === playerId && !state.players[playerId].hasPassedThisPhase;
}

function getOpponent(playerId) {
  return playerId === "playerA" ? "playerB" : "playerA";
}

export function endActivationAndPassTurn(state) {
  const opponent = getOpponent(state.activePlayer);
  if (!state.players[opponent].hasPassedThisPhase) {
    state.activePlayer = opponent;
  }

  const events = [];
  for (let i = 0; i < 2; i += 1) {
    const playerId = state.activePlayer;
    if (state.players[playerId].hasPassedThisPhase) {
      state.activePlayer = getOpponent(playerId);
      continue;
    }
    const eligible = getEligibleUnitsForCurrentPhase(state, playerId).length;
    if (eligible > 0) break;

    state.players[playerId].hasPassedThisPhase = true;
    appendLog(state, "info", `${playerId === "playerA" ? "Blue" : "Red"} has no eligible units and is auto-passed.`);
    events.push({ type: "player_auto_passed", payload: { playerId, phase: state.phase } });
    state.activePlayer = getOpponent(playerId);
  }

  if (state.players.playerA.hasPassedThisPhase && state.players.playerB.hasPassedThisPhase) {
    return advanceToNextPhase(state);
  }

  return { ok: true, state, events };
}

export function passPhase(state, playerId) {
  if (!canPlayerPass(state, playerId)) {
    return { ok: false, code: "INVALID_PASS", message: "That player cannot pass right now." };
  }

  const player = state.players[playerId];
  player.hasPassedThisPhase = true;

  if (state.firstPlayerMarkerHolder !== playerId && !state.players[getOpponent(playerId)].hasPassedThisPhase) {
    state.firstPlayerMarkerHolder = playerId;
    appendLog(state, "info", `${playerId === "playerA" ? "Blue" : "Red"} player passes first and claims the First Player Marker for the next phase.`);
  } else {
    appendLog(state, "info", `${playerId === "playerA" ? "Blue" : "Red"} player passes.`);
  }

  if (state.phase === "movement") {
    for (const unitId of player.battlefieldUnitIds) {
      if (!state.units[unitId].status.movementActivated) markUnitActivatedForMovement(state, unitId);
    }
  }

  const opponentId = getOpponent(playerId);
  if (state.players[opponentId].hasPassedThisPhase) {
    return advanceToNextPhase(state);
  }

  state.activePlayer = opponentId;
  return { ok: true, state, events: [{ type: "player_passed", payload: { playerId, phase: state.phase } }] };
}
