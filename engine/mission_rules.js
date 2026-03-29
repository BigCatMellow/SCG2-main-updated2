import { getObjectiveControlSnapshot } from "./objectives.js";

function getControlledPlayer(result) {
  return result?.controller ?? null;
}

function isWindowActiveForRound(window, round) {
  if (!window.rounds || window.rounds === "all") return true;
  if (Array.isArray(window.rounds)) return window.rounds.includes(round);
  if (window.rounds.min != null && round < window.rounds.min) return false;
  if (window.rounds.max != null && round > window.rounds.max) return false;
  return true;
}

function scoreControlledMarkers(snapshot, vpPerMarker) {
  const gained = { playerA: 0, playerB: 0 };
  for (const result of Object.values(snapshot)) {
    const controller = getControlledPlayer(result);
    if (!controller) continue;
    gained[controller] += vpPerMarker;
  }
  return gained;
}

function scoreSpecificMarker(snapshot, markerId, vpValue) {
  const gained = { playerA: 0, playerB: 0 };
  const result = snapshot[markerId];
  const controller = getControlledPlayer(result);
  if (controller) gained[controller] += vpValue;
  return gained;
}

function mergeGained(total, gained) {
  total.playerA += gained.playerA;
  total.playerB += gained.playerB;
}

export function resolveMissionScoringAtCleanup(state) {
  const scoringWindows = state.mission.scoringWindows ?? [];
  const snapshot = getObjectiveControlSnapshot(state);
  const totalGained = { playerA: 0, playerB: 0 };
  const appliedWindows = [];

  for (const window of scoringWindows) {
    if (window.timing !== "cleanup") continue;
    if (!isWindowActiveForRound(window, state.round)) continue;

    let gained = { playerA: 0, playerB: 0 };
    if (window.type === "controlled_markers") {
      gained = scoreControlledMarkers(snapshot, window.vpPerMarker ?? 1);
    } else if (window.type === "specific_marker_control") {
      gained = scoreSpecificMarker(snapshot, window.markerId, window.vpValue ?? 1);
    }

    mergeGained(totalGained, gained);
    appliedWindows.push({ id: window.id, type: window.type, gained });
  }

  state.players.playerA.vp += totalGained.playerA;
  state.players.playerB.vp += totalGained.playerB;
  state.objectiveControl = snapshot;

  return { snapshot, gained: totalGained, appliedWindows };
}

export function checkMissionInstantWin(state, scoringResult) {
  const conditions = state.mission.instantWinConditions ?? [];

  for (const condition of conditions) {
    if (condition.type === "vp_threshold") {
      if (state.players.playerA.vp >= condition.threshold && state.players.playerA.vp > state.players.playerB.vp) {
        return { winner: "playerA", reason: `Blue reached VP threshold ${condition.threshold}.` };
      }
      if (state.players.playerB.vp >= condition.threshold && state.players.playerB.vp > state.players.playerA.vp) {
        return { winner: "playerB", reason: `Red reached VP threshold ${condition.threshold}.` };
      }
    }

    if (condition.type === "control_all_markers") {
      const controllers = Object.values(scoringResult.snapshot).map(result => result.controller);
      if (!controllers.length) continue;
      if (controllers.every(controller => controller === "playerA")) {
        return { winner: "playerA", reason: "Blue controls all mission markers." };
      }
      if (controllers.every(controller => controller === "playerB")) {
        return { winner: "playerB", reason: "Red controls all mission markers." };
      }
    }
  }

  return null;
}
