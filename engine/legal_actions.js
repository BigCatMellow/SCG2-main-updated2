import { getEligibleUnitsForCurrentPhase } from "./activation.js";
import { validateHold, validateMove, validateDisengage } from "./movement.js";
import { validateDeploy } from "./deployment.js";
import { validateRun, validateDeclareRangedAttack, validateDeclareCharge } from "./assault.js";
import { getPlayableCardActions } from "./cards.js";
import { hasQueuedCombatForUnit } from "./combat.js";
import { canBurrow, canHide, validateCloseRanks, validateToggleBurrow, validateToggleHidden } from "./statuses.js";
import { validatePlaceForceField } from "./force_fields.js";
import { validateUseMedpack, validateUseOpticalFlare } from "./support.js";

export function getLegalActionsForPlayer(state, playerId) {
  const units = getEligibleUnitsForCurrentPhase(state, playerId);
  const actions = [];
  actions.push(...getPlayableCardActions(state, playerId));
  if (state.activePlayer === playerId && !state.players[playerId].hasPassedThisPhase) {
    actions.push({ type: "PASS_PHASE", enabled: true });
  }
  for (const unit of units) {
    actions.push(...getLegalActionsForUnit(state, playerId, unit.id));
  }
  return actions;
}

export function getLegalActionsForUnit(state, playerId, unitId) {
  const unit = state.units[unitId];
  if (!unit || unit.owner !== playerId) return [];
  const descriptors = [];

  if (state.phase === "movement") {
    if (unit.status.location === "reserves") {
      descriptors.push({ type: "DEPLOY_UNIT", unitId, enabled: true, uiHints: { requiresBoardClick: true } });
      return descriptors;
    }
    descriptors.push({ type: "HOLD_UNIT", unitId, enabled: validateHold(state, playerId, unitId).ok });
    descriptors.push({ type: "MOVE_UNIT", unitId, enabled: !unit.status.engaged, uiHints: { requiresBoardClick: true } });
    descriptors.push({ type: "DISENGAGE_UNIT", unitId, enabled: unit.status.engaged, uiHints: { requiresBoardClick: true } });
    if (unit.abilities?.includes("solid_field_projectors")) descriptors.push({ type: "PLACE_FORCE_FIELD", unitId, enabled: validatePlaceForceField(state, playerId, unitId, { x: unit.models[unit.leadingModelId].x, y: unit.models[unit.leadingModelId].y }).ok, uiHints: { requiresBoardClick: true } });
    if (unit.abilities?.includes("stabilize_wounds")) descriptors.push({ type: "USE_MEDPACK", unitId, enabled: true, uiHints: { requiresBoardClick: true } });
    if (unit.abilities?.includes("stabilize_wounds")) descriptors.push({ type: "USE_OPTICAL_FLARE", unitId, enabled: true, uiHints: { requiresBoardClick: true } });
    if (canBurrow(unit)) descriptors.push({ type: "TOGGLE_BURROW", unitId, enabled: validateToggleBurrow(state, playerId, unitId).ok });
    if (canHide(unit)) descriptors.push({ type: "TOGGLE_HIDDEN", unitId, enabled: validateToggleHidden(state, playerId, unitId).ok });
    return descriptors;
  }

  if (state.phase === "assault") {
    if (unit.status.location !== "battlefield") return descriptors;
    descriptors.push({ type: "HOLD_UNIT", unitId, enabled: validateHold(state, playerId, unitId).ok });
    descriptors.push({ type: "RUN_UNIT", unitId, enabled: !unit.status.engaged, uiHints: { requiresBoardClick: true } });
    if (canBurrow(unit)) descriptors.push({ type: "TOGGLE_BURROW", unitId, enabled: validateToggleBurrow(state, playerId, unitId).ok });
    if (canHide(unit)) descriptors.push({ type: "TOGGLE_HIDDEN", unitId, enabled: validateToggleHidden(state, playerId, unitId).ok });
    descriptors.push({ type: "DECLARE_RANGED_ATTACK", unitId, enabled: validateDeclareRangedAttack(state, playerId, unitId).ok });
    descriptors.push({ type: "DECLARE_CHARGE", unitId, enabled: validateDeclareCharge(state, playerId, unitId).ok });
    return descriptors;
  }

  if (state.phase === "combat") {
    if (unit.status.location !== "battlefield") return descriptors;
    descriptors.push({ type: "HOLD_UNIT", unitId, enabled: validateHold(state, playerId, unitId).ok });
    descriptors.push({ type: "CLOSE_RANKS", unitId, enabled: validateCloseRanks(state, playerId, unitId).ok });
    descriptors.push({ type: "RESOLVE_COMBAT_UNIT", unitId, enabled: hasQueuedCombatForUnit(state, unitId) });
    return descriptors;
  }

  return descriptors;
}

export function getLegalMoveDestinations(state, playerId, unitId, leadingModelId) {
  const unit = state.units[unitId];
  const leader = unit.models[leadingModelId];
  const points = [];
  for (let x = 0.5; x < state.board.widthInches; x += 1) {
    for (let y = 0.5; y < state.board.heightInches; y += 1) {
      const path = [{ x: leader.x, y: leader.y }, { x, y }];
      const validation = validateMove(state, playerId, unitId, leadingModelId, path);
      if (validation.ok) points.push({ x, y });
    }
  }
  return points;
}

export function getLegalDeployDestinations(state, playerId, unitId, leadingModelId) {
  const points = [];
  const entrySide = state.deployment.entryEdges[playerId].side;
  const entryX = entrySide === "west" ? 0 : state.board.widthInches;
  for (let x = 0.5; x < state.board.widthInches; x += 1) {
    for (let y = 0.5; y < state.board.heightInches; y += 1) {
      const entryPoint = entrySide === "west" || entrySide === "east" ? { x: entryX, y } : { x, y: entrySide === "north" ? 0 : state.board.heightInches };
      const path = [entryPoint, { x, y }];
      const validation = validateDeploy(state, playerId, unitId, leadingModelId, entryPoint, path);
      if (validation.ok) points.push({ x, y, entryPoint });
    }
  }
  return points;
}

export function getLegalDisengageDestinations(state, playerId, unitId, leadingModelId) {
  const unit = state.units[unitId];
  const leader = unit.models[leadingModelId];
  const points = [];
  for (let x = 0.5; x < state.board.widthInches; x += 1) {
    for (let y = 0.5; y < state.board.heightInches; y += 1) {
      const path = [{ x: leader.x, y: leader.y }, { x, y }];
      const validation = validateDisengage(state, playerId, unitId, leadingModelId, path);
      if (validation.ok) points.push({ x, y });
    }
  }
  return points;
}

export function getLegalRunDestinations(state, playerId, unitId, leadingModelId) {
  const unit = state.units[unitId];
  const leader = unit.models[leadingModelId];
  const points = [];
  for (let x = 0.5; x < state.board.widthInches; x += 1) {
    for (let y = 0.5; y < state.board.heightInches; y += 1) {
      const path = [{ x: leader.x, y: leader.y }, { x, y }];
      const validation = validateRun(state, playerId, unitId, leadingModelId, path);
      if (validation.ok) points.push({ x, y });
    }
  }
  return points;
}
