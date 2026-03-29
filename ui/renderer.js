import { renderTopPanel, renderReserveTray, renderSelectedUnit, renderActionButtons, renderTacticalCards, renderCombatQueue, renderLog, renderPhaseChecklist } from "./panels.js";
import { renderBoard } from "./board.js";

export function renderAll(state, uiState, handlers) {
  const actionButtons = typeof handlers.buildActionButtons === "function" ? handlers.buildActionButtons() : [];
  const cardButtons = typeof handlers.buildCardButtons === "function" ? handlers.buildCardButtons() : [];
  renderTopPanel(state);
  renderReserveTray(state, uiState, handlers.onUnitSelect);
  renderSelectedUnit(state, uiState);
  renderActionButtons(actionButtons);
  renderTacticalCards(state, cardButtons);
  renderCombatQueue(state, uiState, handlers);
  renderLog(state, uiState, handlers);
  renderBoard(state, uiState, handlers);
  renderPhaseChecklist(state, typeof handlers.getPhaseChecklist === "function" ? handlers.getPhaseChecklist() : null);

  // Mode banner
  const modeBanner = document.getElementById("modeBanner");
  modeBanner.textContent = handlers.getModeText();
  modeBanner.className = "mode-banner";
  if (uiState.pendingPass) modeBanner.classList.add("mode-warning");
  else if (uiState.mode) modeBanner.classList.add("mode-active");
  else if (uiState.locked) modeBanner.classList.add("mode-locked");

  // Pass button (now in the floating action bar)
  const passBtn = document.getElementById("passBtn");
  const canPass = state.activePlayer === "playerA" && ["movement", "assault", "combat"].includes(state.phase) && !state.players.playerA.hasPassedThisPhase;
  passBtn.disabled = !canPass;
  passBtn.textContent = uiState.pendingPass ? "Confirm Pass" : "Pass";
  passBtn.className = uiState.pendingPass ? "btn warn pass-confirm-flash" : "btn primary";

  const actionBar = document.getElementById("actionBar");
  const actionBarToggleBtn = document.getElementById("actionBarToggleBtn");
  if (actionBar) {
    actionBar.classList.toggle("compact", Boolean(uiState.compactActionBar));
  }
  if (actionBarToggleBtn) {
    actionBarToggleBtn.textContent = uiState.compactActionBar ? "Expand" : "Compact";
    actionBarToggleBtn.onclick = () => handlers.onToggleActionBarCompact?.();
  }

  // Unit brief in action bar
  const brief = document.getElementById("selectedUnitBrief");
  const unit = uiState.selectedUnitId ? state.units[uiState.selectedUnitId] : null;
  if (unit) {
    const alive = unit.modelIds.filter(id => unit.models[id].alive).length;
    const wpn = unit.rangedWeapons?.[0] ?? unit.meleeWeapons?.[0];
    const wpnTxt = wpn ? ` · ${wpn.name}` : "";
    brief.innerHTML = `<strong>${unit.name}</strong> ${unit.currentSupplyValue}SP · ${alive} models · Spd ${unit.speed}${wpnTxt}`;
  } else {
    brief.innerHTML = "No unit selected";
  }
}
