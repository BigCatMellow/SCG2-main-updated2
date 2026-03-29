import { appendLog } from "./state.js";
import { autoArrangeModels, applyModelPlacementsAndResolveCoherency } from "./coherency.js";
import { markUnitActivatedForMovement, endActivationAndPassTurn, isUnitEligibleForCurrentPhaseActivation } from "./activation.js";
import { pointInBoard, circleOverlapsTerrain, circleOverlapsCircle, distance } from "./geometry.js";
import { refreshEngagement } from "./movement.js";
import { refreshAllSupply } from "./supply.js";
import { removeStealthStatuses } from "./statuses.js";
import { moveUnitToReserves } from "./reserves.js";

const OMEGA_WORM_ACCESS_RANGE = 3;

function isOmegaWorm(unit) {
  return unit?.templateId === "omega_worm";
}

function isEligibleTunnelUnit(unit) {
  if (!unit || unit.status?.location !== "battlefield") return false;
  if (isOmegaWorm(unit)) return false;
  if (unit.tags?.includes("Structure")) return false;
  return /(zerg|roach|hydralisk|queen|kerrigan|raptor|zergling)/i.test(unit.templateId ?? "");
}

function getLeaderPoint(unit) {
  const leader = unit?.models?.[unit?.leadingModelId];
  if (!leader || !leader.alive || leader.x == null || leader.y == null) return null;
  return { x: leader.x, y: leader.y };
}

function getFriendlyOmegaWorms(state, playerId) {
  return Object.values(state.units).filter(unit =>
    unit.owner === playerId && unit.status?.location === "battlefield" && isOmegaWorm(unit)
  );
}

function getBaseContactWorms(state, playerId, unit) {
  const leader = getLeaderPoint(unit);
  if (!leader) return [];
  return getFriendlyOmegaWorms(state, playerId).filter(worm => {
    const wormPoint = getLeaderPoint(worm);
    if (!wormPoint) return false;
    const required = (unit.base?.radiusInches ?? 0) + (worm.base?.radiusInches ?? 0);
    return distance(leader, wormPoint) <= required + 1e-6;
  });
}

function getAccessWorms(state, playerId, point) {
  return getFriendlyOmegaWorms(state, playerId).filter(unit => {
    const leader = getLeaderPoint(unit);
    return leader && distance(leader, point) <= OMEGA_WORM_ACCESS_RANGE + 1e-6;
  });
}

function overlappingModelsAtPoint(state, unit, point, ignoreModelIds = new Set()) {
  for (const otherUnit of Object.values(state.units)) {
    if (otherUnit.status?.burrowed) continue;
    for (const otherModel of Object.values(otherUnit.models)) {
      if (!otherModel.alive || otherModel.x == null || otherModel.y == null || ignoreModelIds.has(otherModel.id)) continue;
      if (circleOverlapsCircle(point, unit.base.radiusInches, { x: otherModel.x, y: otherModel.y }, otherUnit.base.radiusInches)) return otherModel.id;
    }
  }
  return null;
}

function pointWithinEnemyEngagement(state, unit, point) {
  for (const otherUnit of Object.values(state.units)) {
    if (otherUnit.owner === unit.owner || !otherUnit.tags?.includes("Ground")) continue;
    for (const otherModel of Object.values(otherUnit.models)) {
      if (!otherModel.alive || otherModel.x == null || otherModel.y == null) continue;
      const edgeDistance = distance(point, otherModel) - unit.base.radiusInches - otherUnit.base.radiusInches;
      if (edgeDistance < 1 - 1e-6) return true;
    }
  }
  return false;
}

export function canUseOmegaWormNetwork(unit) {
  return isEligibleTunnelUnit(unit);
}

export function hasOmegaTransferOptions(state, playerId, unitId) {
  const unit = state.units[unitId];
  if (!unit || !canUseOmegaWormNetwork(unit) || unit.owner !== playerId || unit.status?.location !== "battlefield" || unit.status?.engaged) {
    return false;
  }
  const leader = getLeaderPoint(unit);
  if (!leader) return false;
  const originWorms = getAccessWorms(state, playerId, leader);
  if (!originWorms.length) return false;
  return getFriendlyOmegaWorms(state, playerId).some(worm => !originWorms.some(origin => origin.id === worm.id));
}

export function hasOmegaRecallOption(state, playerId, unitId) {
  const unit = state.units[unitId];
  if (!unit || unit.owner !== playerId || !canUseOmegaWormNetwork(unit)) return false;
  if (unit.status?.location !== "battlefield" || unit.status?.engaged) return false;
  return getBaseContactWorms(state, playerId, unit).length > 0;
}

export function validateOmegaRecall(state, playerId, unitId) {
  const unit = state.units[unitId];
  if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
  if (state.phase !== "movement") return { ok: false, code: "WRONG_PHASE", message: "Omega Worm extraction only happens in the Movement Phase." };
  if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
  if (!isUnitEligibleForCurrentPhaseActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
  if (!canUseOmegaWormNetwork(unit)) return { ok: false, code: "NO_WORM_ACCESS", message: "This unit cannot use the Omega Worm network." };
  if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Only battlefield units can re-enter the Omega Worm network." };
  if (unit.status.engaged) return { ok: false, code: "UNIT_ENGAGED", message: "Engaged units cannot return to reserves through an Omega Worm." };
  const worms = getBaseContactWorms(state, playerId, unit);
  if (!worms.length) return { ok: false, code: "NO_CONTACT_WORM", message: "The unit must finish base-to-base with a friendly Omega Worm." };
  return { ok: true, derived: { wormId: worms[0].id } };
}

export function resolveOmegaRecall(state, playerId, unitId) {
  const validation = validateOmegaRecall(state, playerId, unitId);
  if (!validation.ok) return validation;
  const unit = state.units[unitId];
  const worm = state.units[validation.derived.wormId];
  moveUnitToReserves(state, unitId);
  markUnitActivatedForMovement(state, unitId);
  refreshEngagement(state);
  refreshAllSupply(state);
  appendLog(
    state,
    "action",
    `${unit.name} slips back into ${worm?.name ?? "a friendly Omega Worm"} and returns to reserves.`
  );
  endActivationAndPassTurn(state);
  return {
    ok: true,
    state,
    events: [{ type: "omega_recall_used", payload: { unitId, wormId: validation.derived.wormId } }]
  };
}

export function validateOmegaTransfer(state, playerId, unitId, point, modelPlacements = null) {
  const unit = state.units[unitId];
  if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
  if (state.phase !== "movement") return { ok: false, code: "WRONG_PHASE", message: "Omega Worm transfers only happen in the Movement Phase." };
  if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
  if (!isUnitEligibleForCurrentPhaseActivation(state, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate." };
  if (!canUseOmegaWormNetwork(unit)) return { ok: false, code: "NO_WORM_ACCESS", message: "This unit cannot use the Omega Worm network." };
  if (unit.status.location !== "battlefield") return { ok: false, code: "NOT_ON_BATTLEFIELD", message: "Only battlefield units can tunnel through Omega Worms." };
  if (unit.status.engaged) return { ok: false, code: "UNIT_ENGAGED", message: "Engaged units cannot use the Omega Worm network." };
  const leader = getLeaderPoint(unit);
  if (!leader) return { ok: false, code: "NO_LEADER", message: "Unit leader is not on the battlefield." };

  const originWorms = getAccessWorms(state, playerId, leader);
  if (!originWorms.length) return { ok: false, code: "NO_ORIGIN_WORM", message: "The unit must start within 3\" of a friendly Omega Worm." };

  const destinationWorms = getAccessWorms(state, playerId, point).filter(worm =>
    !originWorms.some(origin => origin.id === worm.id)
  );
  if (!destinationWorms.length) return { ok: false, code: "NO_DESTINATION_WORM", message: "Destination must be within 3\" of a different friendly Omega Worm." };
  if (!pointInBoard(point, state.board, unit.base.radiusInches)) return { ok: false, code: "OFF_BOARD", message: "Unit must emerge fully on the battlefield." };
  if (circleOverlapsTerrain(point, unit.base.radiusInches, state.board.terrain)) return { ok: false, code: "TERRAIN_OVERLAP", message: "Unit cannot emerge overlapping impassable terrain." };
  const ignore = new Set(unit.modelIds);
  if (overlappingModelsAtPoint(state, unit, point, ignore)) return { ok: false, code: "BASE_OVERLAP", message: "Unit would emerge overlapping another base." };
  if (pointWithinEnemyEngagement(state, unit, point)) return { ok: false, code: "ENDS_ENGAGED", message: "Unit cannot emerge within 1\" of an enemy ground unit." };

  const placements = modelPlacements ?? autoArrangeModels(state, unitId, point);
  return { ok: true, derived: { end: point, placements, destinationWormId: destinationWorms[0].id } };
}

export function resolveOmegaTransfer(state, playerId, unitId, point, modelPlacements = null) {
  const validation = validateOmegaTransfer(state, playerId, unitId, point, modelPlacements);
  if (!validation.ok) return validation;
  const unit = state.units[unitId];
  const leader = unit.models[unit.leadingModelId];
  leader.x = validation.derived.end.x;
  leader.y = validation.derived.end.y;
  const coherency = applyModelPlacementsAndResolveCoherency(state, unitId, validation.derived.placements);
  const brokeStealth = removeStealthStatuses(unit);
  unit.status.stationary = false;
  markUnitActivatedForMovement(state, unitId);
  refreshEngagement(state);
  refreshAllSupply(state);
  const destinationWorm = state.units[validation.derived.destinationWormId];
  appendLog(
    state,
    "action",
    `${unit.name} tunnels through the Omega Worm network and emerges near ${destinationWorm?.name ?? "an Omega Worm"}.${brokeStealth ? " Hidden/Burrowed removed." : ""}${coherency.outOfCoherency ? " Out of coherency." : ""}`
  );
  endActivationAndPassTurn(state);
  return {
    ok: true,
    state,
    events: [{ type: "omega_transfer_used", payload: { unitId, destinationWormId: validation.derived.destinationWormId } }]
  };
}
