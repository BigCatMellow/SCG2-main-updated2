import { passPhase } from "./activation.js";
import { isUnitEligibleForCurrentPhaseActivation, markUnitActivatedForCurrentPhase, endActivationAndPassTurn } from "./activation.js";
import { resolveHold, resolveMove, resolveDisengage } from "./movement.js";
import { resolveDeploy } from "./deployment.js";
import { resolveRun, resolveDeclareRangedAttack, resolveDeclareCharge } from "./assault.js";
import { resolvePlayCard } from "./cards.js";
import { resolveCombatForUnit, hasQueuedCombatForUnit } from "./combat.js";
import { cloneState } from "./state.js";

export function dispatch(state, action) {
  const working = cloneState(state);
  switch (action.type) {
    case "PASS_PHASE":
      return passPhase(working, action.payload.playerId);
    case "HOLD_UNIT":
      return resolveHold(working, action.payload.playerId, action.payload.unitId);
    case "MOVE_UNIT":
      return resolveMove(working, action.payload.playerId, action.payload.unitId, action.payload.leadingModelId, action.payload.path, action.payload.modelPlacements);
    case "DISENGAGE_UNIT":
      return resolveDisengage(working, action.payload.playerId, action.payload.unitId, action.payload.leadingModelId, action.payload.path, action.payload.modelPlacements);
    case "DEPLOY_UNIT":
      return resolveDeploy(working, action.payload.playerId, action.payload.unitId, action.payload.leadingModelId, action.payload.entryPoint, action.payload.path, action.payload.modelPlacements);
    case "RUN_UNIT":
      return resolveRun(working, action.payload.playerId, action.payload.unitId, action.payload.leadingModelId, action.payload.path, action.payload.modelPlacements);
    case "DECLARE_RANGED_ATTACK":
      return resolveDeclareRangedAttack(working, action.payload.playerId, action.payload.unitId, action.payload.targetId ?? null);
    case "DECLARE_CHARGE":
      return resolveDeclareCharge(working, action.payload.playerId, action.payload.unitId, action.payload.targetId ?? null);
    case "PLAY_CARD":
      return resolvePlayCard(working, action.payload.playerId, action.payload.cardInstanceId, action.payload.targetUnitId ?? null);
    case "RESOLVE_COMBAT_UNIT": {
      const { playerId, unitId } = action.payload;
      const unit = working.units[unitId];
      if (!unit) return { ok: false, code: "UNKNOWN_UNIT", message: "Unit not found." };
      if (working.phase !== "combat") return { ok: false, code: "WRONG_PHASE", message: "Combat resolutions are only available in Combat Phase." };
      if (working.activePlayer !== playerId) return { ok: false, code: "NOT_ACTIVE_PLAYER", message: "Only the active player can resolve combat actions." };
      if (unit.owner !== playerId) return { ok: false, code: "WRONG_OWNER", message: "You do not control that unit." };
      if (!isUnitEligibleForCurrentPhaseActivation(working, unitId)) return { ok: false, code: "UNIT_NOT_ELIGIBLE", message: "Unit is not eligible to activate in Combat." };
      if (!hasQueuedCombatForUnit(working, unitId)) return { ok: false, code: "NO_DECLARATIONS", message: "Unit has no queued combat declarations." };
      const combatResult = resolveCombatForUnit(working, unitId);
      if (!combatResult.ok) return combatResult;
      markUnitActivatedForCurrentPhase(working, unitId);
      return endActivationAndPassTurn(working);
    }
    default:
      return { ok: false, code: "UNKNOWN_ACTION", message: `Unknown action type: ${action.type}` };
  }
}
