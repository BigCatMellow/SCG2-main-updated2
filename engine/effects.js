let effectCounter = 1;

function nextEffectId() {
  const id = `eff_${effectCounter}`;
  effectCounter += 1;
  return id;
}

function matchesTarget(effect, unitId, playerId) {
  if (!effect.target || effect.target.scope === "global") return true;
  if (effect.target.scope === "unit") return effect.target.unitId === unitId;
  if (effect.target.scope === "player") return effect.target.playerId === playerId;
  return false;
}

function isDurationActive(effect) {
  if (!effect.duration || effect.duration.type === "permanent") return true;
  return effect.duration.remaining > 0;
}

function eventMatchesDuration(effect, event) {
  if (!effect.duration || effect.duration.type !== "events") return false;
  if (effect.duration.eventType && effect.duration.eventType !== event.type) return false;
  if (effect.duration.unitRole === "attacker") {
    return effect.target?.scope === "unit" && effect.target.unitId === event.payload?.attackerId;
  }
  if (effect.duration.unitRole === "target") {
    return effect.target?.scope === "unit" && effect.target.unitId === event.payload?.targetId;
  }
  return true;
}

function matchesTiming(effect, timing) {
  if (!effect.timings || !effect.timings.length) return true;
  return effect.timings.includes(timing);
}

function sortModifiers(modifiers) {
  return [...modifiers].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

function applyModifier(currentValue, modifier) {
  if (modifier.operation === "add") return currentValue + modifier.value;
  if (modifier.operation === "mul") return currentValue * modifier.value;
  if (modifier.operation === "set") return modifier.value;
  return currentValue;
}

export function addEffect(state, effect) {
  const withDefaults = {
    ...effect,
    id: effect.id ?? nextEffectId(),
    name: effect.name ?? "Unnamed Effect",
    source: effect.source ?? { kind: "system", id: "unknown" },
    target: effect.target ?? { scope: "global" },
    timings: effect.timings ?? [],
    modifiers: effect.modifiers ?? [],
    duration: effect.duration ?? { type: "permanent" }
  };
  state.effects.push(withDefaults);
  return withDefaults.id;
}

export function removeEffect(state, effectId) {
  state.effects = state.effects.filter(effect => effect.id !== effectId);
}

export function pruneExpiredEffects(state) {
  state.effects = state.effects.filter(isDurationActive);
}

export function getModifiersForContext(state, { timing, unitId = null, playerId = null, key = null }) {
  const modifiers = [];
  for (const effect of state.effects) {
    if (!isDurationActive(effect)) continue;
    if (!matchesTarget(effect, unitId, playerId)) continue;
    if (!matchesTiming(effect, timing)) continue;
    for (const modifier of effect.modifiers) {
      if (key && modifier.key !== key) continue;
      modifiers.push(modifier);
    }
  }
  return sortModifiers(modifiers);
}

export function getModifiedValue(state, { timing, unitId = null, playerId = null, key, baseValue }) {
  const modifiers = getModifiersForContext(state, { timing, unitId, playerId, key });
  let value = baseValue;
  for (const modifier of modifiers) {
    value = applyModifier(value, modifier);
  }
  return { value, modifiersApplied: modifiers };
}

export function onPhaseStart(state, phase) {
  for (const effect of state.effects) {
    if (!effect.duration || effect.duration.type !== "phase_starts") continue;
    if (effect.duration.phase && effect.duration.phase !== phase) continue;
    effect.duration.remaining -= 1;
  }
  pruneExpiredEffects(state);
}

export function onRoundStart(state) {
  for (const effect of state.effects) {
    if (!effect.duration || effect.duration.type !== "rounds") continue;
    effect.duration.remaining -= 1;
  }
  pruneExpiredEffects(state);
}

export function onEvent(state, event) {
  for (const effect of state.effects) {
    if (!isDurationActive(effect)) continue;
    if (!eventMatchesDuration(effect, event)) continue;
    effect.duration.remaining -= 1;
  }
  pruneExpiredEffects(state);
}
