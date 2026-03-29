import { autoArrangeModels } from "../engine/coherency.js";

export function bindInputHandlers(store, controller) {
  document.getElementById("gridModeBtn").addEventListener("click", controller.onToggleGridMode);
  document.getElementById("undoBtn")?.addEventListener("click", controller.onUndo);
  document.getElementById("undoToolbarBtn")?.addEventListener("click", controller.onUndo);
  document.getElementById("armyBuilderBtn")?.addEventListener("click", controller.onOpenArmyBuilder);
  document.getElementById("exportLogBtn")?.addEventListener("click", controller.onExportLog);
  document.getElementById("exportBtn")?.addEventListener("click", controller.onExportSave);
  document.getElementById("importBtn")?.addEventListener("click", controller.onImportSave);
  document.getElementById("importFileInput")?.addEventListener("change", controller.onImportFileSelected);
  document.getElementById("armyImportFileInput")?.addEventListener("change", controller.onArmyImportFileSelected);
  document.getElementById("newGameBtn").addEventListener("click", controller.onNewGame);
  document.getElementById("passBtn").addEventListener("click", controller.onPass);
}

export function beginMoveInteraction(state, uiState, unitId) {
  const unit = state.units[unitId];
  const leader = unit.models[unit.leadingModelId];
  uiState.mode = "move";
  uiState.previewPath = { path: [{ x: leader.x, y: leader.y }, { x: leader.x, y: leader.y }] };
  uiState.previewUnit = { unitId, leader: { x: leader.x, y: leader.y }, placements: autoArrangeModels(state, unitId, leader) };
}

export function beginDeployInteraction(state, uiState, unitId) {
  uiState.mode = "deploy";
  uiState.previewPath = null;
  uiState.previewUnit = null;
}


export function beginRunInteraction(state, uiState, unitId) {
  const unit = state.units[unitId];
  const leader = unit.models[unit.leadingModelId];
  uiState.mode = "run";
  uiState.previewPath = { path: [{ x: leader.x, y: leader.y }, { x: leader.x, y: leader.y }] };
  uiState.previewUnit = { unitId, leader: { x: leader.x, y: leader.y }, placements: autoArrangeModels(state, unitId, leader) };
}

export function beginForceFieldInteraction(uiState) {
  uiState.mode = "force_field";
  uiState.previewPath = null;
  uiState.previewUnit = null;
}

export function beginCreepInteraction(uiState) {
  uiState.mode = "place_creep";
  uiState.previewPath = null;
  uiState.previewUnit = null;
}

export function beginOmegaTransferInteraction(uiState) {
  uiState.mode = "omega_transfer";
  uiState.previewPath = null;
  uiState.previewUnit = null;
}

export function beginMedpackInteraction(uiState) {
  uiState.mode = "use_medpack";
  uiState.previewPath = null;
  uiState.previewUnit = null;
}

export function beginOpticalFlareInteraction(uiState) {
  uiState.mode = "use_optical_flare";
  uiState.previewPath = null;
  uiState.previewUnit = null;
}

export function beginDisengageInteraction(state, uiState, unitId) {
  const unit = state.units[unitId];
  const leader = unit.models[unit.leadingModelId];
  uiState.mode = "disengage";
  uiState.previewPath = { path: [{ x: leader.x, y: leader.y }, { x: leader.x, y: leader.y }] };
  uiState.previewUnit = { unitId, leader: { x: leader.x, y: leader.y }, placements: autoArrangeModels(state, unitId, leader) };
}

export function beginBlinkInteraction(uiState) {
  uiState.mode = "blink";
  uiState.previewPath = null;
  uiState.previewUnit = null;
}

export function beginPsionicTransferInteraction(uiState) {
  uiState.mode = "psionic_transfer";
  uiState.previewPath = null;
  uiState.previewUnit = null;
}


export function beginDeclareRangedInteraction(uiState) {
  uiState.mode = "declare_ranged";
  uiState.previewPath = null;
  uiState.previewUnit = null;
}

export function beginDeclareChargeInteraction(uiState) {
  uiState.mode = "declare_charge";
  uiState.previewPath = null;
  uiState.previewUnit = null;
}

export function confirmCurrentInteraction() {}
export function cancelCurrentInteraction(uiState) {
  uiState.mode = null;
  uiState.previewPath = null;
  uiState.previewUnit = null;
}
