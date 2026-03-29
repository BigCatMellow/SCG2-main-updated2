export function moveUnitToReserves(state, unitId) {
  const unit = state.units[unitId];
  if (!unit || unit.status.location === "reserves") return;
  const player = state.players[unit.owner];
  player.battlefieldUnitIds = player.battlefieldUnitIds.filter(id => id !== unitId);
  if (!player.reserveUnitIds.includes(unitId)) player.reserveUnitIds.push(unitId);
  unit.status.location = "reserves";
  for (const model of Object.values(unit.models)) {
    model.x = null;
    model.y = null;
  }
}

export function moveUnitToBattlefield(state, unitId) {
  const unit = state.units[unitId];
  if (!unit || unit.status.location === "battlefield") return;
  const player = state.players[unit.owner];
  player.reserveUnitIds = player.reserveUnitIds.filter(id => id !== unitId);
  if (!player.battlefieldUnitIds.includes(unitId)) player.battlefieldUnitIds.push(unitId);
  unit.status.location = "battlefield";
}

export function isUnitInReserves(unit) {
  return unit.status.location === "reserves";
}

export function isUnitOnBattlefield(unit) {
  return unit.status.location === "battlefield";
}
