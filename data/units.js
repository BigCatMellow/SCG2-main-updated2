export const UNIT_DATA = {
  marine_squad: {
    id: "marine_squad",
    name: "Marines",
    tags: ["Ground", "Infantry", "Ranged"],
    abilities: ["combat_squad"],
    speed: 6,
    size: 1,
    base: { shape: "circle", diameterMm: 25, radiusInches: 0.5 },
    startingModelCount: 6,
    woundsPerModel: 1,
    defense: {
      toughness: 3,
      armorSave: 4,
      invulnerableSave: null,
      evadeTarget: 6
    },
    rangedWeapons: [
      {
        id: "gauss_rifle",
        name: "Gauss Rifle",
        rangeInches: 15,
        shotsPerModel: 1,
        hitTarget: 4,
        strength: 4,
        armorPenetration: 1,
        damage: 1,
        surge: { tags: ["Light"], dice: "D3" },
        keywords: ["rapid_fire"]
      }
    ],
    meleeWeapons: [
      {
        id: "combat_knife",
        name: "Combat Knife",
        attacksPerModel: 1,
        hitTarget: 5,
        strength: 3,
        armorPenetration: 0,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 5, supply: 2 },
      { minModels: 3, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  dragoon: {
    id: "dragoon",
    name: "Dragoon",
    tags: ["Ground", "Mechanical", "Armoured"],
    abilities: ["stabilized_platform"],
    speed: 5,
    size: 2,
    base: { shape: "circle", diameterMm: 50, radiusInches: 1 },
    startingModelCount: 1,
    woundsPerModel: 4,
    defense: {
      toughness: 6,
      armorSave: 3,
      invulnerableSave: 5,
      evadeTarget: 5
    },
    rangedWeapons: [
      {
        id: "phase_disruptor",
        name: "Phase Disruptor",
        rangeInches: 18,
        shotsPerModel: 4,
        hitTarget: 4,
        strength: 7,
        armorPenetration: 2,
        damage: 2,
        keywords: ["piercing"]
      }
    ],
    meleeWeapons: [
      {
        id: "stomp",
        name: "Stomp",
        attacksPerModel: 2,
        hitTarget: 4,
        strength: 6,
        armorPenetration: 1,
        damage: 1,
        keywords: ["brutal"]
      }
    ],
    supplyProfile: [
      { minModels: 1, supply: 3 },
      { minModels: 0, supply: 0 }
    ]
  },
  zealot_squad: {
    id: "zealot_squad",
    name: "Zealots",
    tags: ["Ground", "Infantry", "Melee", "Psionic"],
    abilities: ["charge"],
    speed: 7,
    size: 1,
    base: { shape: "circle", diameterMm: 32, radiusInches: 0.6 },
    startingModelCount: 4,
    woundsPerModel: 2,
    defense: {
      toughness: 4,
      armorSave: 4,
      invulnerableSave: 5,
      evadeTarget: 6
    },
    rangedWeapons: [],
    meleeWeapons: [
      {
        id: "psi_blades",
        name: "Psi Blades",
        attacksPerModel: 2,
        hitTarget: 4,
        strength: 5,
        armorPenetration: 2,
        damage: 1,
        keywords: ["precise"]
      }
    ],
    supplyProfile: [
      { minModels: 3, supply: 2 },
      { minModels: 2, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  zergling_squad: {
    id: "zergling_squad",
    name: "Zerglings",
    tags: ["Ground", "Biological", "Swarm", "Light", "Infantry"],
    abilities: ["swarm_tactics"],
    impact: { dicePerModel: 1, hitTarget: 5, damage: 1 },
    speed: 8,
    size: 1,
    base: { shape: "circle", diameterMm: 25, radiusInches: 0.45 },
    startingModelCount: 8,
    woundsPerModel: 1,
    defense: {
      toughness: 3,
      armorSave: 6,
      invulnerableSave: null,
      evadeTarget: 5
    },
    rangedWeapons: [],
    meleeWeapons: [
      {
        id: "claws",
        name: "Claws",
        attacksPerModel: 2,
        hitTarget: 4,
        strength: 3,
        armorPenetration: 0,
        damage: 1,
        keywords: ["anti_infantry"]
      }
    ],
    supplyProfile: [
      { minModels: 6, supply: 2 },
      { minModels: 4, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  hydralisk: {
    id: "hydralisk",
    name: "Hydralisk",
    tags: ["Ground", "Biological", "Light", "Elite", "Ranged"],
    abilities: ["squadron"],
    speed: 6,
    size: 2,
    base: { shape: "circle", diameterMm: 32, radiusInches: 0.6 },
    startingModelCount: 2,
    woundsPerModel: 4,
    defense: {
      toughness: 4,
      armorSave: 5,
      invulnerableSave: null,
      evadeTarget: 5
    },
    rangedWeapons: [
      {
        id: "needle_spines",
        name: "Needle Spines",
        rangeInches: 12,
        shotsPerModel: 3,
        hitTarget: 3,
        strength: 5,
        armorPenetration: 1,
        damage: 2,
        surge: { tags: ["Light", "Armoured"], dice: "D3+1" },
        keywords: []
      }
    ],
    meleeWeapons: [
      {
        id: "hydralisk_scythe",
        name: "Scythe",
        attacksPerModel: 2,
        hitTarget: 4,
        strength: 4,
        armorPenetration: 0,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 2, supply: 2 },
      { minModels: 1, supply: 1 },
      { minModels: 0, supply: 0 }
    ]
  },
  queen: {
    id: "queen",
    name: "Queen",
    tags: ["Ground", "Biological", "Support"],
    abilities: ["transfusion"],
    speed: 6,
    size: 2,
    base: { shape: "circle", diameterMm: 40, radiusInches: 0.8 },
    startingModelCount: 1,
    woundsPerModel: 6,
    defense: {
      toughness: 5,
      armorSave: 4,
      invulnerableSave: null,
      evadeTarget: 5
    },
    rangedWeapons: [
      {
        id: "acid_spines",
        name: "Acid Spines",
        rangeInches: 10,
        shotsPerModel: 4,
        hitTarget: 4,
        strength: 4,
        armorPenetration: 1,
        damage: 1,
        surge: { tags: ["Light"], dice: "D3" },
        keywords: []
      }
    ],
    meleeWeapons: [
      {
        id: "queen_claws",
        name: "Claws",
        attacksPerModel: 3,
        hitTarget: 4,
        strength: 4,
        armorPenetration: 0,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 1, supply: 2 },
      { minModels: 0, supply: 0 }
    ]
  },
  omega_worm: {
    id: "omega_worm",
    name: "Omega Worm",
    tags: ["Ground", "Biological", "Armoured", "Other", "Structure"],
    abilities: ["detection", "source_of_creep"],
    speed: 0,
    size: 3,
    base: { shape: "circle", diameterMm: 80, radiusInches: 1.6 },
    startingModelCount: 1,
    woundsPerModel: 10,
    defense: {
      toughness: 7,
      armorSave: 5,
      invulnerableSave: null,
      evadeTarget: 7
    },
    rangedWeapons: [],
    meleeWeapons: [],
    supplyProfile: [
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  roachling: {
    id: "roachling",
    name: "Roachling",
    tags: ["Ground", "Biological", "Light", "Other", "Melee"],
    abilities: ["swarm_tactics"],
    speed: 7,
    size: 1,
    base: { shape: "circle", diameterMm: 25, radiusInches: 0.45 },
    startingModelCount: 3,
    woundsPerModel: 1,
    defense: {
      toughness: 3,
      armorSave: 6,
      invulnerableSave: null,
      evadeTarget: 5
    },
    rangedWeapons: [],
    meleeWeapons: [
      {
        id: "roachling_claws",
        name: "Claws",
        attacksPerModel: 2,
        hitTarget: 4,
        strength: 3,
        armorPenetration: 0,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 3, supply: 0 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  jim_raynor: {
    id: "jim_raynor",
    name: "Jim Raynor",
    tags: ["Ground", "Infantry", "Hero", "Ranged"],
    abilities: ["heroic_presence"],
    speed: 6,
    size: 1,
    base: { shape: "circle", diameterMm: 32, radiusInches: 0.6 },
    startingModelCount: 1,
    woundsPerModel: 6,
    defense: {
      toughness: 5,
      armorSave: 3,
      invulnerableSave: 5,
      evadeTarget: 5
    },
    rangedWeapons: [
      {
        id: "penetrator_rounds",
        name: "Penetrator Rounds",
        rangeInches: 18,
        shotsPerModel: 3,
        hitTarget: 3,
        strength: 6,
        armorPenetration: 2,
        damage: 2,
        keywords: ["heroic"]
      }
    ],
    meleeWeapons: [
      {
        id: "cqc_rifle_butt",
        name: "Rifle Butt",
        attacksPerModel: 3,
        hitTarget: 4,
        strength: 4,
        armorPenetration: 1,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 1, supply: 3 },
      { minModels: 0, supply: 0 }
    ]
  },
  marine_t2: {
    id: "marine_t2",
    name: "Marine T2",
    tags: ["Ground", "Infantry", "Ranged", "Core"],
    abilities: ["stimpack_drill"],
    speed: 6,
    size: 1,
    base: { shape: "circle", diameterMm: 25, radiusInches: 0.5 },
    startingModelCount: 6,
    woundsPerModel: 1,
    defense: {
      toughness: 3,
      armorSave: 4,
      invulnerableSave: null,
      evadeTarget: 6
    },
    rangedWeapons: [
      {
        id: "gauss_rifle_t2",
        name: "Gauss Rifle",
        rangeInches: 16,
        shotsPerModel: 1,
        hitTarget: 4,
        strength: 4,
        armorPenetration: 1,
        damage: 1,
        surge: { tags: ["Light"], dice: "D3" },
        keywords: ["rapid_fire"]
      }
    ],
    meleeWeapons: [
      {
        id: "combat_knife",
        name: "Combat Knife",
        attacksPerModel: 1,
        hitTarget: 5,
        strength: 3,
        armorPenetration: 0,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 5, supply: 2 },
      { minModels: 3, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  marauder_t1: {
    id: "marauder_t1",
    name: "Marauder T1",
    tags: ["Ground", "Infantry", "Core", "Armoured"],
    abilities: ["concussive_shells"],
    speed: 5,
    size: 1,
    base: { shape: "circle", diameterMm: 32, radiusInches: 0.6 },
    startingModelCount: 3,
    woundsPerModel: 2,
    defense: {
      toughness: 5,
      armorSave: 4,
      invulnerableSave: null,
      evadeTarget: 6
    },
    rangedWeapons: [
      {
        id: "punisher_grenades",
        name: "Punisher Grenades",
        rangeInches: 14,
        shotsPerModel: 2,
        hitTarget: 4,
        strength: 5,
        armorPenetration: 1,
        damage: 2,
        surge: { tags: ["Armoured"], dice: "D3" },
        pierce: { tag: "Armoured", damage: 2 },
        keywords: ["blast"]
      }
    ],
    meleeWeapons: [
      {
        id: "powered_fist",
        name: "Powered Fist",
        attacksPerModel: 2,
        hitTarget: 4,
        strength: 5,
        armorPenetration: 1,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 3, supply: 2 },
      { minModels: 2, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  medic_t1: {
    id: "medic_t1",
    name: "Medic T1",
    tags: ["Ground", "Infantry", "Support"],
    abilities: ["stabilize_wounds"],
    speed: 6,
    size: 1,
    base: { shape: "circle", diameterMm: 25, radiusInches: 0.5 },
    startingModelCount: 2,
    woundsPerModel: 2,
    defense: {
      toughness: 4,
      armorSave: 5,
      invulnerableSave: null,
      evadeTarget: 6
    },
    rangedWeapons: [
      {
        id: "sidearm",
        name: "Sidearm",
        rangeInches: 10,
        shotsPerModel: 1,
        hitTarget: 4,
        strength: 4,
        armorPenetration: 1,
        damage: 1,
        keywords: []
      }
    ],
    meleeWeapons: [
      {
        id: "defibrillator_strike",
        name: "Defibrillator Strike",
        attacksPerModel: 1,
        hitTarget: 5,
        strength: 3,
        armorPenetration: 0,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 2, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  goliath: {
    id: "goliath",
    name: "Goliath",
    tags: ["Ground", "Mechanical", "Armoured", "Elite", "Ranged"],
    abilities: ["stabilized_platform"],
    impact: { dicePerModel: 4, hitTarget: 3, damage: 1 },
    speed: 7,
    size: 3,
    base: { shape: "circle", diameterMm: 60, radiusInches: 1.2 },
    startingModelCount: 1,
    woundsPerModel: 10,
    defense: {
      toughness: 7,
      armorSave: 4,
      invulnerableSave: null,
      evadeTarget: 7
    },
    rangedWeapons: [
      {
        id: "autocannon",
        name: "Autocannon",
        rangeInches: 12,
        shotsPerModel: 9,
        hitTarget: 4,
        strength: 5,
        armorPenetration: 1,
        damage: 1,
        keywords: ["long_range"]
      },
      {
        id: "hellfire_missiles",
        name: "Hellfire Missiles",
        rangeInches: 16,
        shotsPerModel: 6,
        hitTarget: 3,
        strength: 5,
        armorPenetration: 1,
        damage: 1,
        surge: { tags: ["Light"], dice: "D3" },
        antiEvade: 1,
        keywords: ["sidearm"]
      }
    ],
    meleeWeapons: [
      {
        id: "goliath_stomp",
        name: "Stomp",
        attacksPerModel: 4,
        hitTarget: 5,
        strength: 6,
        armorPenetration: 1,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 1, supply: 2 },
      { minModels: 0, supply: 0 }
    ]
  },
  point_defense_drone: {
    id: "point_defense_drone",
    name: "Point Defense Drone",
    tags: ["Flying", "Mechanical", "Armoured", "Other", "Structure"],
    abilities: ["point_defense_laser", "gliding"],
    speed: 8,
    size: 1,
    base: { shape: "circle", diameterMm: 32, radiusInches: 0.6 },
    startingModelCount: 1,
    woundsPerModel: 3,
    defense: {
      toughness: 3,
      armorSave: 6,
      invulnerableSave: null,
      evadeTarget: 6
    },
    rangedWeapons: [],
    meleeWeapons: [],
    supplyProfile: [
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  kerrigan: {
    id: "kerrigan",
    name: "Kerrigan",
    tags: ["Ground", "Hero", "Psionic", "Melee"],
    abilities: ["queen_of_blades", "deep_strike"],
    speed: 8,
    size: 1,
    base: { shape: "circle", diameterMm: 40, radiusInches: 0.8 },
    startingModelCount: 1,
    woundsPerModel: 6,
    defense: {
      toughness: 6,
      armorSave: 3,
      invulnerableSave: 4,
      evadeTarget: 4,
      dodge: 1
    },
    rangedWeapons: [
      {
        id: "psi_blast",
        name: "Psi Blast",
        rangeInches: 12,
        shotsPerModel: 2,
        hitTarget: 3,
        strength: 6,
        armorPenetration: 2,
        damage: 2,
        surge: { tags: ["Light", "Armoured"], dice: "D3" },
        indirectFire: true,
        keywords: ["psionic"]
      }
    ],
    meleeWeapons: [
      {
        id: "psi_blades_hero",
        name: "Psi Blades",
        attacksPerModel: 5,
        hitTarget: 3,
        strength: 7,
        armorPenetration: 3,
        damage: 2,
        criticalHit: 2,
        keywords: ["lethal"]
      }
    ],
    supplyProfile: [
      { minModels: 1, supply: 3 },
      { minModels: 0, supply: 0 }
    ]
  },
  raptor_t2: {
    id: "raptor_t2",
    name: "Raptor (Zergling) T2",
    tags: ["Ground", "Biological", "Swarm", "Elite", "Melee"],
    abilities: ["leap_strike"],
    impact: { dicePerModel: 2, hitTarget: 5, damage: 1 },
    speed: 9,
    size: 1,
    base: { shape: "circle", diameterMm: 25, radiusInches: 0.45 },
    startingModelCount: 6,
    woundsPerModel: 1,
    defense: {
      toughness: 4,
      armorSave: 5,
      invulnerableSave: null,
      evadeTarget: 5
    },
    rangedWeapons: [],
    meleeWeapons: [
      {
        id: "raptor_claws",
        name: "Raptor Claws",
        attacksPerModel: 3,
        hitTarget: 4,
        strength: 4,
        armorPenetration: 1,
        damage: 1,
        surge: { tags: ["Light", "Armoured"], dice: "D6" },
        keywords: ["anti_infantry"]
      }
    ],
    supplyProfile: [
      { minModels: 5, supply: 2 },
      { minModels: 3, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  roach_t3: {
    id: "roach_t3",
    name: "Roach T3",
    tags: ["Ground", "Biological", "Elite", "Armoured"],
    abilities: ["burrow", "burrowed_regen"],
    impact: { dicePerModel: 2, hitTarget: 4, damage: 1 },
    speed: 5,
    size: 1,
    base: { shape: "circle", diameterMm: 32, radiusInches: 0.6 },
    startingModelCount: 3,
    woundsPerModel: 3,
    defense: {
      toughness: 6,
      armorSave: 4,
      invulnerableSave: null,
      evadeTarget: 5
    },
    rangedWeapons: [
      {
        id: "acid_spit",
        name: "Acid Spit",
        rangeInches: 12,
        shotsPerModel: 2,
        hitTarget: 4,
        strength: 6,
        armorPenetration: 2,
        damage: 2,
        surge: { tags: ["Light"], dice: "D3+1" },
        keywords: ["corrosive"]
      }
    ],
    meleeWeapons: [
      {
        id: "chitin_bash",
        name: "Chitin Bash",
        attacksPerModel: 2,
        hitTarget: 4,
        strength: 5,
        armorPenetration: 1,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 3, supply: 2 },
      { minModels: 2, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  zergling_t3: {
    id: "zergling_t3",
    name: "Zergling T3",
    tags: ["Ground", "Biological", "Swarm", "Core", "Melee"],
    abilities: ["adrenal_glands", "burrow"],
    impact: { dicePerModel: 1, hitTarget: 5, damage: 1 },
    speed: 9,
    size: 1,
    base: { shape: "circle", diameterMm: 25, radiusInches: 0.45 },
    startingModelCount: 8,
    woundsPerModel: 1,
    defense: {
      toughness: 3,
      armorSave: 6,
      invulnerableSave: null,
      evadeTarget: 5
    },
    rangedWeapons: [],
    meleeWeapons: [
      {
        id: "adrenal_claws",
        name: "Adrenal Claws",
        attacksPerModel: 3,
        hitTarget: 4,
        strength: 3,
        armorPenetration: 0,
        damage: 1,
        surge: { tags: ["Light"], dice: "D3" },
        keywords: ["anti_infantry"]
      }
    ],
    supplyProfile: [
      { minModels: 6, supply: 2 },
      { minModels: 4, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  zergling_t2: {
    id: "zergling_t2",
    name: "Zergling T2",
    tags: ["Ground", "Biological", "Swarm", "Core", "Melee"],
    abilities: ["metabolic_boost"],
    impact: { dicePerModel: 1, hitTarget: 5, damage: 1 },
    speed: 8,
    size: 1,
    base: { shape: "circle", diameterMm: 25, radiusInches: 0.45 },
    startingModelCount: 6,
    woundsPerModel: 1,
    defense: {
      toughness: 3,
      armorSave: 6,
      invulnerableSave: null,
      evadeTarget: 5
    },
    rangedWeapons: [],
    meleeWeapons: [
      {
        id: "zergling_claws_t2",
        name: "Claws",
        attacksPerModel: 2,
        hitTarget: 4,
        strength: 3,
        armorPenetration: 0,
        damage: 1,
        surge: { tags: ["Light"], dice: "D3" },
        keywords: ["anti_infantry"]
      }
    ],
    supplyProfile: [
      { minModels: 5, supply: 1 },
      { minModels: 3, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  stalker: {
    id: "stalker",
    name: "Stalker",
    tags: ["Ground", "Mechanical", "Armoured", "Elite", "Ranged", "Psionic"],
    abilities: ["blink"],
    speed: 8,
    size: 3,
    base: { shape: "circle", diameterMm: 50, radiusInches: 1 },
    startingModelCount: 1,
    woundsPerModel: 6,
    defense: {
      toughness: 6,
      armorSave: 4,
      invulnerableSave: 5,
      evadeTarget: 6
    },
    rangedWeapons: [
      {
        id: "particle_disruptors",
        name: "Particle Disruptors",
        rangeInches: 12,
        shotsPerModel: 4,
        hitTarget: 3,
        strength: 6,
        armorPenetration: 2,
        damage: 2,
        surge: { tags: ["Armoured"], dice: "D3" },
        keywords: []
      }
    ],
    meleeWeapons: [
      {
        id: "stalker_stomp",
        name: "Stomp",
        attacksPerModel: 2,
        hitTarget: 5,
        strength: 5,
        armorPenetration: 1,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 1, supply: 1 },
      { minModels: 0, supply: 0 }
    ]
  },
  artanis: {
    id: "artanis",
    name: "Artanis",
    tags: ["Ground", "Biological", "Psionic", "Hero", "Melee"],
    abilities: ["commander", "charge"],
    impact: { dicePerModel: 6, hitTarget: 4, damage: 1 },
    speed: 8,
    size: 2,
    base: { shape: "circle", diameterMm: 40, radiusInches: 0.8 },
    startingModelCount: 1,
    woundsPerModel: 9,
    defense: {
      toughness: 6,
      armorSave: 4,
      invulnerableSave: 4,
      evadeTarget: 5
    },
    rangedWeapons: [],
    meleeWeapons: [
      {
        id: "artanis_blades",
        name: "Blades of Aiur",
        attacksPerModel: 6,
        hitTarget: 3,
        strength: 6,
        armorPenetration: 2,
        damage: 2,
        surge: { tags: ["Light", "Armoured"], dice: "D3" },
        keywords: ["precise"]
      }
    ],
    supplyProfile: [
      { minModels: 1, supply: 3 },
      { minModels: 0, supply: 0 }
    ]
  },
  adept: {
    id: "adept",
    name: "Adept",
    tags: ["Ground", "Biological", "Light", "Core", "Psionic", "Ranged"],
    abilities: ["psionic_transfer"],
    speed: 8,
    size: 2,
    base: { shape: "circle", diameterMm: 32, radiusInches: 0.6 },
    startingModelCount: 3,
    woundsPerModel: 3,
    defense: {
      toughness: 4,
      armorSave: 5,
      invulnerableSave: 5,
      evadeTarget: 5
    },
    rangedWeapons: [
      {
        id: "glaive_cannon",
        name: "Glaive Cannon",
        rangeInches: 8,
        shotsPerModel: 2,
        hitTarget: 3,
        strength: 4,
        armorPenetration: 1,
        damage: 1,
        surge: { tags: ["Light"], dice: "D3+1" },
        antiEvade: 1,
        keywords: []
      }
    ],
    meleeWeapons: [
      {
        id: "adept_strike",
        name: "Strike",
        attacksPerModel: 1,
        hitTarget: 4,
        strength: 4,
        armorPenetration: 0,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 3, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  sentry: {
    id: "sentry",
    name: "Sentry",
    tags: ["Ground", "Mechanical", "Light", "Support", "Psionic", "Ranged"],
    abilities: ["guardian_shield"],
    speed: 7,
    size: 1,
    base: { shape: "circle", diameterMm: 32, radiusInches: 0.6 },
    startingModelCount: 2,
    woundsPerModel: 4,
    defense: {
      toughness: 4,
      armorSave: 5,
      invulnerableSave: 5,
      evadeTarget: 6
    },
    rangedWeapons: [
      {
        id: "disruption_beam",
        name: "Disruption Beam",
        rangeInches: 8,
        shotsPerModel: 2,
        hitTarget: 2,
        strength: 4,
        armorPenetration: 1,
        damage: 1,
        keywords: ["instant"]
      }
    ],
    meleeWeapons: [
      {
        id: "sentry_beam",
        name: "Beam",
        attacksPerModel: 2,
        hitTarget: 3,
        strength: 4,
        armorPenetration: 0,
        damage: 1,
        keywords: []
      }
    ],
    supplyProfile: [
      { minModels: 2, supply: 1 },
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  },
  pylon: {
    id: "pylon",
    name: "Pylon",
    tags: ["Ground", "Armoured", "Other", "Structure"],
    abilities: ["khalai_ingenuity", "warp_conduit"],
    speed: 0,
    size: 3,
    base: { shape: "circle", diameterMm: 80, radiusInches: 1.6 },
    startingModelCount: 1,
    woundsPerModel: 8,
    defense: {
      toughness: 6,
      armorSave: 5,
      invulnerableSave: 5,
      evadeTarget: 7
    },
    rangedWeapons: [],
    meleeWeapons: [],
    supplyProfile: [
      { minModels: 1, supply: 0 },
      { minModels: 0, supply: 0 }
    ]
  }
};

export function getUnitTemplate(templateId) {
  const template = UNIT_DATA[templateId];
  if (!template) throw new Error(`Unknown unit template: ${templateId}`);
  return template;
}

function normalizeUpgradeName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function findWeapon(unit, collectionKey, matcher) {
  const weapons = unit[collectionKey] ?? [];
  return weapons.find(weapon => matcher(weapon));
}

function replaceWeapon(unit, collectionKey, matcher, replacement) {
  unit[collectionKey] = (unit[collectionKey] ?? []).map(weapon => (matcher(weapon) ? replacement(weapon) : weapon));
}

function addKeyword(weapon, keyword) {
  if (!weapon.keywords) weapon.keywords = [];
  if (!weapon.keywords.includes(keyword)) weapon.keywords.push(keyword);
}

function addAbility(unit, ability) {
  unit.abilities = [...new Set([...(unit.abilities ?? []), ability])];
}

export function applyImportedUpgradesToUnit(unit, selectedUpgrades = []) {
  const applied = [];
  const partial = [];
  const ignored = [];

  for (const rawName of selectedUpgrades) {
    const upgrade = normalizeUpgradeName(rawName);
    let handled = true;
    let partiallyHandled = false;

    switch (upgrade) {
      case "grooved_spines": {
        const weapon = findWeapon(unit, "rangedWeapons", current => current.name === "Needle Spines");
        if (!weapon) {
          handled = false;
          break;
        }
        weapon.longRange = 16;
        break;
      }
      case "shredding_claws": {
        replaceWeapon(unit, "meleeWeapons", current => /claws/i.test(current.name), current => ({
          ...current,
          name: "Shredding Claws",
          surge: { tags: ["Light", "Armoured"], dice: "D3" }
        }));
        break;
      }
      case "adrenal_glands":
      case "we_stand_as_one": {
        for (const weapon of unit.meleeWeapons ?? []) {
          weapon.precision = Math.max(weapon.precision ?? 0, 2);
        }
        break;
      }
      case "combat_shield": {
        addAbility(unit, "combat_shield");
        break;
      }
      case "bayonet": {
        replaceWeapon(unit, "meleeWeapons", current => /strike|combat knife/i.test(current.name), current => ({
          ...current,
          name: "Bayonet",
          attacksPerModel: 2,
          hitTarget: 5,
          surge: current.name === "Bayonet" ? current.surge : null
        }));
        break;
      }
      case "slugthrower": {
        for (const weapon of unit.rangedWeapons ?? []) {
          if (/c-14|gauss rifle/i.test(weapon.name)) weapon.antiEvade = Math.max(weapon.antiEvade ?? 0, 1);
        }
        break;
      }
      case "grenades_frag": {
        for (const weapon of unit.rangedWeapons ?? []) {
          if (/c-14|gauss rifle/i.test(weapon.name)) weapon.surge = { tags: ["Light"], dice: "D6" };
        }
        break;
      }
      case "agg_12": {
        replaceWeapon(unit, "rangedWeapons", current => /c-14|gauss rifle/i.test(current.name), current => ({
          ...current,
          name: "AGG-12",
          surge: { tags: ["Armoured"], dice: "D3" },
          longRange: 18
        }));
        break;
      }
      case "ares_class_targeting_system": {
        for (const weapon of unit.rangedWeapons ?? []) {
          weapon.precision = Math.max(weapon.precision ?? 0, 1);
        }
        break;
      }
      case "scatter_missiles": {
        replaceWeapon(unit, "rangedWeapons", current => /hellfire missiles/i.test(current.name), current => ({
          ...current,
          name: "Scatter Missiles",
          rangeInches: 18,
          hitTarget: 5,
          surge: { tags: ["Light"], dice: "D3" },
          indirectFire: true,
          lockedIn: 6,
          longRange: 24
        }));
        break;
      }
      case "haywire_missiles": {
        replaceWeapon(unit, "rangedWeapons", current => /hellfire missiles/i.test(current.name), current => ({
          ...current,
          name: "Haywire Missiles",
          rangeInches: 12,
          shotsPerModel: 3,
          hitTarget: 3,
          surge: { tags: ["Armoured"], dice: "D3" },
          pierce: { tag: "Armoured", damage: 3 }
        }));
        break;
      }
      case "resonating_glaives": {
        for (const weapon of unit.rangedWeapons ?? []) {
          if (/glaive cannon/i.test(weapon.name)) weapon.shotsPerModel += 1;
        }
        break;
      }
      case "guidance": {
        for (const weapon of unit.rangedWeapons ?? []) {
          if (/glaive cannon/i.test(weapon.name)) weapon.antiEvade = Math.max(weapon.antiEvade ?? 0, 2);
        }
        break;
      }
      case "glaive_strike": {
        replaceWeapon(unit, "meleeWeapons", current => /strike/i.test(current.name), current => ({
          ...current,
          name: "Glaive Strike",
          surge: { tags: ["Light"], dice: "D3" },
          pierce: { tag: "Light", damage: 2 }
        }));
        break;
      }
      case "my_life_for_aiur": {
        if (!unit.impact) {
          handled = false;
          break;
        }
        unit.impact.dicePerModel += 1;
        break;
      }
      case "kinetic_foam": {
        unit.woundsPerModel += 1;
        Object.values(unit.models ?? {}).forEach(model => {
          model.woundsRemaining += 1;
        });
        break;
      }
      case "advanced_medic_facilities": {
        unit.supplyProfile = (unit.supplyProfile ?? []).map(bracket => ({ ...bracket, supply: 0 }));
        unit.currentSupplyValue = 0;
        break;
      }
      case "laser_targeting_systems": {
        for (const weapon of unit.rangedWeapons ?? []) {
          weapon.longRange = Math.max(weapon.longRange ?? weapon.rangeInches ?? 0, 16);
        }
        break;
      }
      case "path_of_shadows": {
        addAbility(unit, "path_of_shadows");
        break;
      }
      case "fury_of_the_nerazim": {
        for (const weapon of unit.rangedWeapons ?? []) {
          addKeyword(weapon, "instant");
        }
        break;
      }
      case "burrow_ambush": {
        addAbility(unit, "burrow_ambush");
        break;
      }
      case "leg_enhancements":
      case "veteran_of_tarsonis":
      case "hallucination":
      case "ancillary_carapace":
      case "lurking":
      case "a_13_flash_grenade_launcher":
      case "stabilizer_medpacks": {
        addAbility(unit, upgrade);
        break;
      }
      case "solid_field_projectors": {
        addAbility(unit, upgrade);
        break;
      }
      case "zealous_round": {
        addAbility(unit, upgrade);
        break;
      }
      default:
        handled = false;
    }

    if (handled && partiallyHandled) partial.push(rawName);
    else if (handled) applied.push(rawName);
    else ignored.push(rawName);
  }

  unit.importedUpgrades = {
    selected: [...selectedUpgrades],
    applied,
    partial,
    ignored
  };
}

export function computeCurrentSupplyValue(template, aliveModelCount) {
  const sorted = [...template.supplyProfile].sort((a, b) => b.minModels - a.minModels);
  for (const bracket of sorted) {
    if (aliveModelCount >= bracket.minModels) return bracket.supply;
  }
  return 0;
}

export function createUnitStateFromTemplate(templateId, owner, unitId, options = {}) {
  const template = getUnitTemplate(templateId);
  const models = {};
  const modelIds = [];
  for (let i = 0; i < template.startingModelCount; i += 1) {
    const id = `${unitId}_m${i + 1}`;
    modelIds.push(id);
    models[id] = {
      id,
      alive: true,
      x: null,
      y: null,
      elevation: "ground",
      woundsRemaining: template.woundsPerModel
    };
  }

  const rangedWeapons = template.rangedWeapons?.map(weapon => ({
    ...weapon,
    surge: weapon.surge ? { ...weapon.surge, tags: [...(weapon.surge.tags ?? [])] } : null,
    pierce: Array.isArray(weapon.pierce)
      ? weapon.pierce.map(entry => ({ ...entry }))
      : weapon.pierce
        ? { ...weapon.pierce }
        : null
  })) ?? [];
  const meleeWeapons = template.meleeWeapons?.map(weapon => ({
    ...weapon,
    surge: weapon.surge ? { ...weapon.surge, tags: [...(weapon.surge.tags ?? [])] } : null,
    pierce: Array.isArray(weapon.pierce)
      ? weapon.pierce.map(entry => ({ ...entry }))
      : weapon.pierce
        ? { ...weapon.pierce }
        : null
  })) ?? [];

  const unit = {
    id: unitId,
    owner,
    templateId,
    name: template.name,
    leadingModelId: modelIds[0] ?? null,
    modelIds,
    models,
    tags: [...template.tags],
    abilities: [...(template.abilities ?? [])],
    impact: template.impact ? { ...template.impact } : null,
    speed: template.speed,
    size: template.size,
    woundsPerModel: template.woundsPerModel,
    base: { ...template.base },
    defense: { ...template.defense },
      rangedWeapons,
      meleeWeapons,
    ranged: rangedWeapons.length
      ? {
          rangeInches: rangedWeapons[0].rangeInches,
          shotsPerModel: rangedWeapons[0].shotsPerModel,
          hitTarget: rangedWeapons[0].hitTarget
        }
      : null,
    supplyProfile: [...template.supplyProfile],
    currentSupplyValue: computeCurrentSupplyValue(template, template.startingModelCount),
    status: {
      location: "reserves",
      movementActivated: false,
      assaultActivated: false,
      combatActivated: false,
      engaged: false,
      hidden: false,
      burrowed: false,
      outOfCoherency: false,
      stationary: false,
      cannotRangedAttackNextAssault: false,
      cannotRangedAttackThisAssault: false,
      cannotChargeNextAssault: false,
      cannotChargeThisAssault: false,
      overwatchUsedThisRound: false,
      zealousRoundUsedThisRound: false,
      lurkingUsedThisRound: false,
      ancillaryCarapaceUsedThisPhase: false,
      opticalFlareRound: null,
      opticalFlareRangePenalty: 0
    },
    activationMarkers: []
  };

  applyImportedUpgradesToUnit(unit, options.selectedUpgrades ?? []);
  return unit;
}

export function summarizeImportedUpgrades(templateId, selectedUpgrades = []) {
  const preview = createUnitStateFromTemplate(templateId, "preview", "preview_unit", { selectedUpgrades });
  return preview.importedUpgrades ?? {
    selected: [...selectedUpgrades],
    applied: [],
    partial: [],
    ignored: [...selectedUpgrades]
  };
}
