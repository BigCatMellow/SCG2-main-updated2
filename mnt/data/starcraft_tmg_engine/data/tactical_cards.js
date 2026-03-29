export const TACTICAL_CARDS = {
  focused_fire: {
    id: 'focused_fire',
    name: 'Focused Fire',
    phase: 'assault',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['combat_resolve_attack'],
      modifiers: [
        { key: 'weapon.hitTarget', operation: 'add', value: -1, priority: 0 }
      ],
      duration: { type: 'events', eventType: 'combat_attack_resolved', unitRole: 'attacker', remaining: 1 }
    }
  },
  rapid_relocation: {
    id: 'rapid_relocation',
    name: 'Rapid Relocation',
    phase: 'movement',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['movement_move', 'movement_disengage'],
      modifiers: [
        { key: 'unit.speed', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'phase_starts', phase: 'assault', remaining: 1 }
    }
  },
  lair: {
    id: 'lair',
    name: 'Lair',
    phase: 'assault',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['combat_resolve_attack'],
      modifiers: [
        { key: 'weapon.attacksPerModel', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'events', eventType: 'combat_attack_resolved', unitRole: 'attacker', remaining: 1 }
    }
  },
  evolution_chamber: {
    id: 'evolution_chamber',
    name: 'Evolution Chamber',
    phase: 'assault',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['combat_resolve_attack'],
      modifiers: [
        { key: 'weapon.hitTarget', operation: 'add', value: -1, priority: 0 }
      ],
      duration: { type: 'events', eventType: 'combat_attack_resolved', unitRole: 'attacker', remaining: 1 }
    }
  },
  roach_warren: {
    id: 'roach_warren',
    name: 'Roach Warren',
    phase: 'movement',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['movement_move', 'movement_disengage'],
      modifiers: [
        { key: 'unit.speed', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'phase_starts', phase: 'assault', remaining: 1 }
    }
  },
  malignant_creep: {
    id: 'malignant_creep',
    name: 'Malignant Creep',
    phase: 'movement',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['movement_move', 'movement_disengage'],
      modifiers: [
        { key: 'unit.speed', operation: 'add', value: 2, priority: 0 }
      ],
      duration: { type: 'events', eventType: 'unit_moved', remaining: 1 }
    }
  },
  barracks_proxy: {
    id: 'barracks_proxy',
    name: 'Barracks (Proxy)',
    phase: 'movement',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['movement_move', 'movement_disengage'],
      modifiers: [
        { key: 'unit.speed', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'phase_starts', phase: 'assault', remaining: 1 }
    }
  },
  academy: {
    id: 'academy',
    name: 'Academy',
    phase: 'assault',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['combat_resolve_attack'],
      modifiers: [
        { key: 'weapon.hitTarget', operation: 'add', value: -1, priority: 0 }
      ],
      duration: { type: 'events', eventType: 'combat_attack_resolved', unitRole: 'attacker', remaining: 1 }
    }
  },
  orbital_command: {
    id: 'orbital_command',
    name: 'Orbital Command',
    phase: 'assault',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['combat_resolve_attack'],
      modifiers: [
        { key: 'weapon.shotsPerModel', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'events', eventType: 'combat_attack_resolved', unitRole: 'attacker', remaining: 1 }
    }
  }
};

export function getTacticalCard(cardId) {
  const card = TACTICAL_CARDS[cardId];
  if (!card) throw new Error(`Unknown tactical card: ${cardId}`);
  return card;
}
