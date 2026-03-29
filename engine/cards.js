import { addEffect } from './effects.js';
import { getTacticalCard } from '../data/tactical_cards.js';
import { appendLog } from './state.js';

function findCardInHand(player, cardInstanceId) {
  return player.hand?.find(card => card.instanceId === cardInstanceId) ?? null;
}

function buildSpecialCardEffect(card, playerId, target) {
  if (card.id === 'observer' || card.id === 'overseer') {
    return {
      name: card.name,
      source: { kind: 'tactical_card', id: card.id, owner: playerId },
      target: target ? { scope: 'unit', unitId: target.id } : { scope: 'player', playerId },
      timings: [],
      modifiers: card.effect?.modifiers ?? [],
      duration: { type: 'rounds', remaining: 1 },
      zone: {
        kind: 'detection_field',
        radius: 6
      }
    };
  }
  if (card.id === 'warp_prism') {
    return {
      name: card.name,
      source: { kind: 'tactical_card', id: card.id, owner: playerId },
      target: target ? { scope: 'unit', unitId: target.id } : { scope: 'player', playerId },
      timings: card.effect.timings,
      modifiers: card.effect.modifiers,
      duration: { type: 'rounds', remaining: 1 },
      zone: {
        kind: 'warp_field',
        radius: 6
      }
    };
  }
  if (card.id === 'malignant_creep' || card.id === 'accelerating_creep') {
    return {
      name: card.name,
      source: { kind: 'tactical_card', id: card.id, owner: playerId },
      target: target ? { scope: 'unit', unitId: target.id } : { scope: 'player', playerId },
      timings: card.effect.timings,
      modifiers: card.effect.modifiers,
      duration: { type: 'rounds', remaining: 1 },
      zone: {
        kind: 'creep_field',
        radius: 6
      }
    };
  }
  if (card.id === 'hatchery') {
    return {
      name: card.name,
      source: { kind: 'tactical_card', id: card.id, owner: playerId },
      target: target ? { scope: 'unit', unitId: target.id } : { scope: 'player', playerId },
      timings: card.effect.timings,
      modifiers: card.effect.modifiers,
      duration: { type: 'rounds', remaining: 1 },
      zone: {
        kind: 'hatchery_field',
        radius: 6
      }
    };
  }
  if (card.id === 'barracks' || card.id === 'barracks_proxy') {
    return {
      name: card.name,
      source: { kind: 'tactical_card', id: card.id, owner: playerId },
      target: target ? { scope: 'unit', unitId: target.id } : { scope: 'player', playerId },
      timings: card.effect.timings,
      modifiers: card.effect.modifiers,
      duration: { type: 'rounds', remaining: 1 },
      zone: {
        kind: 'proxy_field',
        radius: 6
      }
    };
  }
  if (card.id === 'nexus' || card.id === 'overcharged_nexus') {
    return {
      name: card.name,
      source: { kind: 'tactical_card', id: card.id, owner: playerId },
      target: target ? { scope: 'unit', unitId: target.id } : { scope: 'player', playerId },
      timings: card.effect.timings,
      modifiers: card.effect.modifiers,
      duration: { type: 'rounds', remaining: 1 },
      zone: {
        kind: 'warp_field',
        radius: 6
      }
    };
  }
  return null;
}

export function validatePlayCard(state, playerId, cardInstanceId, targetUnitId = null) {
  const player = state.players[playerId];
  if (!player) return { ok: false, code: 'BAD_PLAYER', message: 'Unknown player.' };
  if (state.activePlayer !== playerId) return { ok: false, code: 'NOT_ACTIVE_PLAYER', message: 'Only the active player may play cards.' };

  const cardInHand = findCardInHand(player, cardInstanceId);
  if (!cardInHand) return { ok: false, code: 'CARD_NOT_IN_HAND', message: 'Card is not in hand.' };

  const card = getTacticalCard(cardInHand.cardId);
  if (card.phase !== state.phase) return { ok: false, code: 'WRONG_PHASE', message: `${card.name} can only be played in ${card.phase} phase.` };

  if (card.target === 'friendly_battlefield_unit') {
    if (!targetUnitId) return { ok: false, code: 'MISSING_TARGET', message: 'This card requires a friendly target unit.' };
    const target = state.units[targetUnitId];
    if (!target || target.owner !== playerId || target.status.location !== 'battlefield') {
      return { ok: false, code: 'BAD_TARGET', message: 'Select a friendly battlefield unit as target.' };
    }
    return { ok: true, card, cardInHand, target };
  }

  return { ok: true, card, cardInHand, target: null };
}

export function resolvePlayCard(state, playerId, cardInstanceId, targetUnitId = null) {
  const validation = validatePlayCard(state, playerId, cardInstanceId, targetUnitId);
  if (!validation.ok) return validation;

  const player = state.players[playerId];
  const { card, cardInHand, target } = validation;

  const specialEffect = buildSpecialCardEffect(card, playerId, target);
  const effectId = addEffect(state, specialEffect ?? {
    name: card.name,
    source: { kind: 'tactical_card', id: card.id, owner: playerId },
    target: target ? { scope: 'unit', unitId: target.id } : { scope: 'player', playerId },
    timings: card.effect.timings,
    modifiers: card.effect.modifiers,
    duration: structuredClone(card.effect.duration)
  });

  player.hand = player.hand.filter(entry => entry.instanceId !== cardInstanceId);
  player.discardPile = [...(player.discardPile ?? []), cardInHand];

  appendLog(state, 'card', `${playerId === 'playerA' ? 'Blue' : 'Red'} plays ${card.name}${target ? ` on ${target.name}` : ''}.`);

  return {
    ok: true,
    state,
    events: [{ type: 'card_played', payload: { playerId, cardId: card.id, cardInstanceId, targetUnitId: target?.id ?? null, effectId } }]
  };
}

export function getPlayableCardActions(state, playerId) {
  const player = state.players[playerId];
  if (!player || state.activePlayer !== playerId) return [];
  const actions = [];

  for (const card of player.hand ?? []) {
    const cardDef = getTacticalCard(card.cardId);
    if (cardDef.phase !== state.phase) continue;

    if (cardDef.target === 'friendly_battlefield_unit') {
      for (const unitId of state.players[playerId].battlefieldUnitIds) {
        const target = state.units[unitId];
        if (!target) continue;
        actions.push({ type: 'PLAY_CARD', cardInstanceId: card.instanceId, cardId: card.cardId, targetUnitId: unitId, enabled: true });
      }
      continue;
    }

    actions.push({ type: 'PLAY_CARD', cardInstanceId: card.instanceId, cardId: card.cardId, targetUnitId: null, enabled: true });
  }

  return actions;
}
