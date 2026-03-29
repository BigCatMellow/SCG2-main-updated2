import { appendLog } from "./state.js";
import { refreshAllSupply } from "./supply.js";
import { determineWinner } from "./objectives.js";
import { checkMissionInstantWin, resolveMissionScoringAtCleanup } from "./mission_rules.js";
import { clearCurrentPhaseActivationFlags, clearPhaseActivationFlagsForNewRound } from "./activation.js";
import { resolveCombatPhase } from "./combat.js";
import { onPhaseStart, onRoundStart } from "./effects.js";

export function runStartOfRoundHooks() {
  return [];
}

function formatPlayer(playerId) {
  if (!playerId) return "No one";
  return playerId === "playerA" ? "Blue" : "Red";
}

function resetPassFlags(state) {
  state.players.playerA.hasPassedThisPhase = false;
  state.players.playerB.hasPassedThisPhase = false;
}

function beginActivationPhase(state, phase, message) {
  onPhaseStart(state, phase);
  state.phase = phase;
  state.activePlayer = state.firstPlayerMarkerHolder;
  resetPassFlags(state);
  clearCurrentPhaseActivationFlags(state);
  appendLog(state, "phase", message);
  return { ok: true, state, events: [] };
}

function logObjectiveScoring(state, scoring) {
  const objectiveSummaries = Object.values(scoring.snapshot).map(result => {
    if (!result.controller) {
      if (result.contested) return `${result.objectiveId}: contested (${result.playerASupply}-${result.playerBSupply})`;
      return `${result.objectiveId}: uncontrolled`;
    }
    return `${result.objectiveId}: ${formatPlayer(result.controller)} controls (${result.playerASupply}-${result.playerBSupply})`;
  });

  appendLog(
    state,
    "score",
    `Round ${state.round} objective control resolved. ${objectiveSummaries.join(" | ")}`
  );

  const windowSummary = scoring.appliedWindows?.length
    ? ` Windows: ${scoring.appliedWindows.map(window => `${window.id} (B:+${window.gained.playerA}, R:+${window.gained.playerB})`).join("; ")}.`
    : " No scoring windows applied.";

  appendLog(
    state,
    "score",
    `VP scored this round — Blue: +${scoring.gained.playerA}, Red: +${scoring.gained.playerB}. Total VP — Blue: ${state.players.playerA.vp}, Red: ${state.players.playerB.vp}.${windowSummary}`
  );
}

export function beginGame(state) {
  refreshAllSupply(state);
  appendLog(state, "info", "All units begin in reserves. Deploy as supply allows.");
  return { ok: true, state, events: [] };
}

export function beginRound(state) {
  clearPhaseActivationFlagsForNewRound(state);
  for (const unit of Object.values(state.units)) {
    unit.status.overwatchUsedThisRound = false;
  }
  onRoundStart(state);
  state.combatQueue = [];
  refreshAllSupply(state);
  return beginActivationPhase(state, "movement", `Round ${state.round} begins. Movement Phase active.`);
}

export function beginMovementPhase(state) {
  return beginActivationPhase(state, "movement", `Movement Phase active.`);
}

export function beginAssaultPhase(state) {
  for (const unit of Object.values(state.units)) {
    unit.status.cannotRangedAttackThisAssault = unit.status.cannotRangedAttackNextAssault;
    unit.status.cannotRangedAttackNextAssault = false;
    unit.status.cannotChargeThisAssault = unit.status.cannotChargeNextAssault;
    unit.status.cannotChargeNextAssault = false;
  }
  return beginActivationPhase(state, "assault", "Assault Phase active. Units can Run, Hold, Declare Ranged Attack, or Declare Charge.");
}

export function beginCombatPhase(state) {
  return beginActivationPhase(state, "combat", "Combat Phase active. Resolve queued attacks by unit or hold/pass to end combat.");
}

export function beginCleanupPhase(state) {
  state.phase = "cleanup";
  appendLog(state, "phase", "Cleanup Phase complete.");
  const scoring = resolveMissionScoringAtCleanup(state);
  logObjectiveScoring(state, scoring);

  state.lastRoundSummary = {
    round: state.round,
    scoring,
    combatEvents: state.lastCombatReport ?? []
  };

  const instantWin = checkMissionInstantWin(state, scoring);
  if (instantWin) {
    state.winner = instantWin.winner;
    appendLog(state, "phase", `Instant mission win: ${instantWin.reason}`);
    return { ok: true, state, events: [{ type: "game_completed", payload: { winner: state.winner, reason: instantWin.reason } }] };
  }

  const roundLimit = state.mission.pacing?.roundLimit ?? state.mission.roundLimit;
  if (state.round >= roundLimit) {
    state.winner = determineWinner(state);
    if (state.winner) {
      appendLog(state, "phase", `Final round reached. ${formatPlayer(state.winner)} wins on VP.`);
    } else {
      appendLog(state, "phase", "Final round reached. The game ends in a VP draw.");
    }
    return { ok: true, state, events: [{ type: "game_completed", payload: { winner: state.winner } }] };
  }

  state.round += 1;
  return beginRound(state);
}

export function advanceToNextPhase(state) {
  if (state.phase === "movement") return beginAssaultPhase(state);
  if (state.phase === "assault") return beginCombatPhase(state);
  if (state.phase === "combat") {
    const combatResult = resolveCombatPhase(state);
    if (!combatResult.ok) return combatResult;
    appendLog(state, "phase", "Combat resolution complete.");
    return beginCleanupPhase(state);
  }
  return { ok: true, state, events: [] };
}
