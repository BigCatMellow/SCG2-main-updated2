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
  },
  hatchery: {
    id: 'hatchery',
    name: 'Hatchery',
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
  spawning_pool: {
    id: 'spawning_pool',
    name: 'Spawning Pool',
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
  armory: {
    id: 'armory',
    name: 'Armory',
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
  forge: {
    id: 'forge',
    name: 'Forge',
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
  gateway: {
    id: 'gateway',
    name: 'Gateway',
    phase: 'combat',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['combat_resolve_attack'],
      modifiers: [
        { key: 'weapon.attacksPerModel', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'events', eventType: 'combat_attack_resolved', unitRole: 'attacker', remaining: 1 }
    }
  },
  observer: {
    id: 'observer',
    name: 'Observer',
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
  accelerating_creep: {
    id: 'accelerating_creep',
    name: 'Accelerating Creep',
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
  hydralisk_den: {
    id: 'hydralisk_den',
    name: 'Hydralisk Den',
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
  overlord: {
    id: 'overlord',
    name: 'Overlord',
    phase: 'movement',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['movement_deploy'],
      modifiers: [
        { key: 'unit.speed', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'phase_starts', phase: 'assault', remaining: 1 }
    }
  },
  overseer: {
    id: 'overseer',
    name: 'Overseer',
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
  spawning_pool_six: {
    id: 'spawning_pool_six',
    name: 'Spawning Pool (Six Pool)',
    phase: 'movement',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['movement_deploy'],
      modifiers: [
        { key: 'unit.speed', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'phase_starts', phase: 'assault', remaining: 1 }
    }
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
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
  barracks_tech_lab: {
    id: 'barracks_tech_lab',
    name: 'Barracks (Tech Lab)',
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
  dropship: {
    id: 'dropship',
    name: 'Dropship',
    phase: 'movement',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['movement_deploy', 'movement_move'],
      modifiers: [
        { key: 'unit.speed', operation: 'add', value: 2, priority: 0 }
      ],
      duration: { type: 'phase_starts', phase: 'assault', remaining: 1 }
    }
  },
  engineering_bay: {
    id: 'engineering_bay',
    name: 'Engineering Bay',
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
  factory: {
    id: 'factory',
    name: 'Factory',
    phase: 'assault',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['combat_resolve_attack'],
      modifiers: [
        { key: 'weapon.shotsPerModel', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'events', eventType: 'combat_attack_resolved', unitRole: 'attacker', remaining: 1 }
    }
  },
  supply_depot: {
    id: 'supply_depot',
    name: 'Supply Depot',
    phase: 'movement',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['movement_deploy'],
      modifiers: [
        { key: 'unit.speed', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'phase_starts', phase: 'assault', remaining: 1 }
    }
  },
  gate_chronoboosted: {
    id: 'gate_chronoboosted',
    name: 'Gate Chronoboosted',
    phase: 'combat',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['combat_resolve_attack'],
      modifiers: [
        { key: 'weapon.attacksPerModel', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'events', eventType: 'combat_attack_resolved', unitRole: 'attacker', remaining: 1 }
    }
  },
  nexus: {
    id: 'nexus',
    name: 'Nexus',
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
  overcharged_nexus: {
    id: 'overcharged_nexus',
    name: 'Overcharged Nexus',
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
  power_field: {
    id: 'power_field',
    name: 'Power Field',
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
  twilight_council: {
    id: 'twilight_council',
    name: 'Twilight Council',
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
  warp_gate: {
    id: 'warp_gate',
    name: 'Warp Gate',
    phase: 'combat',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['combat_resolve_attack'],
      modifiers: [
        { key: 'weapon.attacksPerModel', operation: 'add', value: 1, priority: 0 }
      ],
      duration: { type: 'events', eventType: 'combat_attack_resolved', unitRole: 'attacker', remaining: 1 }
    }
  },
  warp_prism: {
    id: 'warp_prism',
    name: 'Warp Prism',
    phase: 'movement',
    target: 'friendly_battlefield_unit',
    effect: {
      timings: ['movement_deploy', 'movement_move'],
      modifiers: [
        { key: 'unit.speed', operation: 'add', value: 2, priority: 0 }
      ],
      duration: { type: 'phase_starts', phase: 'assault', remaining: 1 }
    }
  }
};

export function getTacticalCard(cardId) {
  const card = TACTICAL_CARDS[cardId];
  if (!card) throw new Error(`Unknown tactical card: ${cardId}`);
  return card;
}
