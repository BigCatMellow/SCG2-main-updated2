import { renderTopPanel, renderReserveTray, renderSelectedUnit, renderActionButtons, renderTacticalCards, renderCombatQueue, renderLog } from "./panels.js";
import { renderBoard } from "./board.js";

export function renderAll(state, uiState, handlers) {
  const actionButtons = typeof handlers.buildActionButtons === "function" ? handlers.buildActionButtons() : [];
  const cardButtons = typeof handlers.buildCardButtons === "function" ? handlers.buildCardButtons() : [];
  renderTopPanel(state);
  renderReserveTray(state, uiState, handlers.onUnitSelect);
  renderSelectedUnit(state, uiState);
  renderActionButtons(actionButtons);
  renderTacticalCards(state, cardButtons);
  renderCombatQueue(state);
  renderLog(state);
  renderBoard(state, uiState, handlers);
  document.getElementById("modeBanner").textContent = handlers.getModeText();
  document.getElementById("passBtn").disabled = !(state.activePlayer === "playerA" && ["movement", "assault", "combat"].includes(state.phase) && !state.players.playerA.hasPassedThisPhase);
}
