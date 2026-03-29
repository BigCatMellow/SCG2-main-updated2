export function getSupplyPoolForRound(mission, round) {
  const roundLimit = mission.pacing?.roundLimit ?? mission.roundLimit;
  const unlimitedFinalRound = mission.pacing?.finalRoundUnlimitedSupply ?? true;
  if (unlimitedFinalRound && round >= roundLimit) return Infinity;
  return mission.startingSupply + ((round - 1) * mission.supplyEscalation);
}

export function getPlayerTotalCurrentSupplyOnBattlefield(state, playerId) {
  return state.players[playerId].battlefieldUnitIds.reduce((total, unitId) => total + state.units[unitId].currentSupplyValue, 0);
}

export function getAvailableSupply(state, playerId) {
  const pool = state.players[playerId].supplyPool;
  if (pool === Infinity) return Infinity;
  return Math.max(0, pool - getPlayerTotalCurrentSupplyOnBattlefield(state, playerId));
}

export function refreshPlayerSupply(state, playerId) {
  state.players[playerId].supplyPool = getSupplyPoolForRound(state.mission, state.round);
  state.players[playerId].availableSupply = getAvailableSupply(state, playerId);
}

export function refreshAllSupply(state) {
  refreshPlayerSupply(state, "playerA");
  refreshPlayerSupply(state, "playerB");
}

export function recomputeUnitCurrentSupply(unit) {
  const aliveModelCount = Object.values(unit.models).filter(model => model.alive).length;
  const sorted = [...unit.supplyProfile].sort((a, b) => b.minModels - a.minModels);
  for (const bracket of sorted) {
    if (aliveModelCount >= bracket.minModels) {
      unit.currentSupplyValue = bracket.supply;
      return unit.currentSupplyValue;
    }
  }
  unit.currentSupplyValue = 0;
  return 0;
}

export function getCurrentSupplyValue(unit) {
  return unit.currentSupplyValue;
}

export function validateDeploySupply(state, playerId, unitId) {
  const unit = state.units[unitId];
  const available = state.players[playerId].availableSupply;
  const current = unit.currentSupplyValue;
  if (available === Infinity || current <= available) {
    return { ok: true, currentSupplyValue: current, availableSupply: available };
  }
  return {
    ok: false,
    reason: `Unit needs ${current} supply but only ${available} is available.`,
    currentSupplyValue: current,
    availableSupply: available
  };
}
