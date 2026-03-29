import test from "node:test";
import assert from "node:assert/strict";

import { buildSetupFromImportedRosters, importArmyBuilderRoster, isArmyBuilderPayload } from "../engine/army_builder_import.js";
import { createInitialGameState } from "../engine/state.js";

test("recognizes army builder export payloads", () => {
  assert.equal(isArmyBuilderPayload({ units: [], tacticalCards: [] }), true);
  assert.equal(isArmyBuilderPayload({ units: [] }), false);
  assert.equal(isArmyBuilderPayload(null), false);
});

test("imports supported zerg army builder units and tactical cards", () => {
  const roster = importArmyBuilderRoster({
    faction: "Kerrigan's Swarm",
    scale: "Standard",
    factionCard: { id: "kerrigans-swarm", name: "Kerrigan's Swarm" },
    tacticalCards: [
      { id: "lair", name: "Lair" },
      { id: "roach-warren", name: "Roach Warren" }
    ],
    units: [
      { unitId: "kerrigan", name: "Kerrigan", tier: { level: "T2" }, selectedUpgrades: [] },
      { unitId: "raptor", name: "Raptor (Zergling)", tier: { level: "T2" }, selectedUpgrades: [{ name: "Adrenal Glands" }] },
      { unitId: "hydralisk", name: "Hydralisk", tier: { level: "T2" }, selectedUpgrades: [] }
    ]
  }, "playerA");

  assert.equal(roster.factionKey, "zerg");
  assert.deepEqual(roster.army.map(unit => unit.templateId), ["kerrigan", "raptor_t2", "hydralisk"]);
  assert.deepEqual(roster.tacticalCards, ["lair", "roach_warren"]);
  assert.equal(roster.summary.importedUnits, 3);
  assert.equal(roster.summary.skippedUnits, 0);
  assert.equal(roster.warnings.some(warning => warning.includes("Hydralisk")), false);
});

test("builds a playable setup from imported rosters", () => {
  const terranRoster = importArmyBuilderRoster({
    faction: "Raynor's Raiders",
    factionCard: { id: "raynors-raiders", name: "Raynor's Raiders" },
    tacticalCards: [{ id: "academy", name: "Academy" }],
    units: [
      { unitId: "jim-raynor", name: "Jim Raynor", tier: { level: "T2" } },
      { unitId: "marine", name: "Marine", tier: { level: "T2" } }
    ]
  }, "playerB");

  const setup = buildSetupFromImportedRosters({
    baseSetup: {
      missionId: "take_and_hold",
      deploymentId: "crossfire",
      firstPlayerMarkerHolder: "playerA",
      armyA: [{ id: "fallback_a", templateId: "zergling_t2" }],
      armyB: [{ id: "fallback_b", templateId: "marine_t2" }],
      tacticalCardsA: ["lair"],
      tacticalCardsB: ["academy"],
      rules: { gridMode: true }
    },
    missionId: "domination_protocol",
    deploymentId: "crossfire",
    firstPlayerMarkerHolder: "playerB",
    rosterB: terranRoster
  });

  assert.equal(setup.missionId, "domination_protocol");
  assert.equal(setup.firstPlayerMarkerHolder, "playerB");
  assert.deepEqual(setup.armyB.map(unit => unit.templateId), ["jim_raynor", "marine_t2"]);
  assert.deepEqual(setup.tacticalCardsB, ["academy"]);

  const state = createInitialGameState(setup);
  assert.ok(state.units.playerB_jim_raynor_1);
  assert.ok(state.units.playerB_marine_t2_2);
});

test("imports broader protoss and zerg builder coverage without skipping supported cards", () => {
  const protossRoster = importArmyBuilderRoster({
    faction: "Khalai",
    factionCard: { id: "khalai", name: "Khalai" },
    tacticalCards: [
      { id: "forge", name: "Forge" },
      { id: "gateway", name: "Gateway" },
      { id: "observer", name: "Observer" }
    ],
    units: [
      { unitId: "stalker", name: "Stalker", tier: { level: "T2" } },
      { unitId: "adept", name: "Adept", tier: { level: "T2" } },
      { unitId: "sentry", name: "Sentry", tier: { level: "T2" } }
    ]
  }, "playerA");

  const zergRoster = importArmyBuilderRoster({
    faction: "Zerg Swarm",
    factionCard: { id: "zerg-swarm", name: "Zerg Swarm" },
    tacticalCards: [
      { id: "hatchery", name: "Hatchery" },
      { id: "spawning-pool", name: "Spawning Pool" }
    ],
    units: [
      { unitId: "hydralisk", name: "Hydralisk", tier: { level: "T2" } },
      { unitId: "queen", name: "Queen", tier: { level: "T2" } }
    ]
  }, "playerB");

  assert.deepEqual(protossRoster.army.map(unit => unit.templateId), ["stalker", "adept", "sentry"]);
  assert.deepEqual(protossRoster.tacticalCards, ["forge", "gateway", "observer"]);
  assert.equal(protossRoster.summary.skippedUnits, 0);
  assert.equal(protossRoster.summary.skippedCards, 0);

  assert.deepEqual(zergRoster.army.map(unit => unit.templateId), ["hydralisk", "queen"]);
  assert.deepEqual(zergRoster.tacticalCards, ["hatchery", "spawning_pool"]);
  assert.equal(zergRoster.summary.skippedUnits, 0);
  assert.equal(zergRoster.summary.skippedCards, 0);
});

test("imports most builder-only support units and long-tail tactical cards cleanly", () => {
  const zergRoster = importArmyBuilderRoster({
    faction: "Kerrigan's Swarm",
    factionCard: { id: "kerrigans-swarm", name: "Kerrigan's Swarm" },
    tacticalCards: [
      { id: "accelerating-creep", name: "Accelerating Creep" },
      { id: "hydralisk-den", name: "Hydralisk Den" },
      { id: "overlord", name: "Overlord" },
      { id: "overseer", name: "Overseer" },
      { id: "spawning-pool-six", name: "Spawning Pool (Six Pool)" }
    ],
    units: [
      { unitId: "omega-worm", name: "Omega Worm", tier: { level: "T2" } },
      { unitId: "roachling", name: "Roachling", tier: { level: "T2" } }
    ]
  }, "playerA");

  const terranRoster = importArmyBuilderRoster({
    faction: "Terran Armed Forces",
    factionCard: { id: "terran-armed-forces", name: "Terran Armed Forces" },
    tacticalCards: [
      { id: "barracks", name: "Barracks" },
      { id: "barracks-tech-lab", name: "Barracks (Tech Lab)" },
      { id: "dropship", name: "Dropship" },
      { id: "engineering-bay", name: "Engineering Bay" },
      { id: "factory", name: "Factory" },
      { id: "supply-depot", name: "Supply Depot" }
    ],
    units: [
      { unitId: "point-defense-drone", name: "Point Defense Drone", tier: { level: "T2" } }
    ]
  }, "playerB");

  const protossRoster = importArmyBuilderRoster({
    faction: "Daelaam",
    factionCard: { id: "daelaam", name: "Daelaam" },
    tacticalCards: [
      { id: "gate-chronoboosted", name: "Gate Chronoboosted" },
      { id: "nexus", name: "Nexus" },
      { id: "overcharged-nexus", name: "Overcharged Nexus" },
      { id: "power-field", name: "Power Field" },
      { id: "twilight-council", name: "Twilight Council" },
      { id: "warp-gate", name: "Warp Gate" },
      { id: "warp-prism", name: "Warp Prism" }
    ],
    units: [
      { unitId: "artanis", name: "Artanis", tier: { level: "T2" } },
      { unitId: "pylon", name: "Pylon", tier: { level: "T2" } }
    ]
  }, "playerA");

  assert.deepEqual(zergRoster.army.map(unit => unit.templateId), ["omega_worm", "roachling"]);
  assert.equal(zergRoster.summary.skippedCards, 0);

  assert.deepEqual(terranRoster.army.map(unit => unit.templateId), ["point_defense_drone"]);
  assert.equal(terranRoster.summary.skippedCards, 0);

  assert.deepEqual(protossRoster.army.map(unit => unit.templateId), ["artanis", "pylon"]);
  assert.equal(protossRoster.summary.skippedCards, 0);
});

test("selected upgrades modify imported unit profiles in the created game state", () => {
  const zergRoster = importArmyBuilderRoster({
    faction: "Kerrigan's Swarm",
    factionCard: { id: "kerrigans-swarm", name: "Kerrigan's Swarm" },
    tacticalCards: [],
    units: [
      {
        unitId: "zergling",
        name: "Zergling",
        tier: { level: "T2" },
        selectedUpgrades: [{ name: "Shredding Claws" }, { name: "Adrenal Glands" }]
      },
      {
        unitId: "hydralisk",
        name: "Hydralisk",
        tier: { level: "T2" },
        selectedUpgrades: [{ name: "Grooved Spines" }]
      }
    ]
  }, "playerA");

  const terranRoster = importArmyBuilderRoster({
    faction: "Raynor's Raiders",
    factionCard: { id: "raynors-raiders", name: "Raynor's Raiders" },
    tacticalCards: [],
    units: [
      {
        unitId: "marine",
        name: "Marine",
        tier: { level: "T2" },
        selectedUpgrades: [{ name: "Combat Shield" }, { name: "Bayonet" }, { name: "Slugthrower" }]
      }
    ]
  }, "playerB");

  const protossRoster = importArmyBuilderRoster({
    faction: "Khalai",
    factionCard: { id: "khalai", name: "Khalai" },
    tacticalCards: [],
    units: [
      {
        unitId: "zealot",
        name: "Zealot",
        tier: { level: "T2" },
        selectedUpgrades: [{ name: "Leg Enhancements" }, { name: "Zealous Round" }, { name: "My Life for Aiur" }]
      }
    ]
  }, "playerA");

  assert.equal(zergRoster.summary.appliedUpgrades, 3);
  assert.equal(zergRoster.summary.ignoredUpgrades, 0);
  assert.equal(terranRoster.summary.appliedUpgrades, 3);
  assert.equal(terranRoster.summary.ignoredUpgrades, 0);
  assert.equal(protossRoster.summary.appliedUpgrades, 2);
  assert.equal(protossRoster.summary.partialUpgrades, 0);
  assert.equal(protossRoster.summary.ignoredUpgrades, 1);
  assert.deepEqual(zergRoster.army[0].upgradeSummary.applied, ["Shredding Claws", "Adrenal Glands"]);
  assert.deepEqual(protossRoster.army[0].upgradeSummary.applied, ["Leg Enhancements", "Zealous Round"]);
  assert.deepEqual(protossRoster.army[0].upgradeSummary.partial, []);
  assert.deepEqual(protossRoster.army[0].upgradeSummary.ignored, ["My Life for Aiur"]);

  const setup = buildSetupFromImportedRosters({
    baseSetup: {
      missionId: "take_and_hold",
      deploymentId: "crossfire",
      firstPlayerMarkerHolder: "playerA",
      armyA: [],
      armyB: [],
      tacticalCardsA: [],
      tacticalCardsB: [],
      rules: { gridMode: true }
    },
    rosterA: zergRoster,
    rosterB: terranRoster
  });

  const state = createInitialGameState(setup);
  const zergling = state.units.playerA_zergling_t2_1;
  const hydralisk = state.units.playerA_hydralisk_2;
  const marine = state.units.playerB_marine_t2_1;

  assert.equal(zergling.meleeWeapons[0].name, "Shredding Claws");
  assert.deepEqual(zergling.meleeWeapons[0].surge.tags, ["Light", "Armoured"]);
  assert.equal(zergling.meleeWeapons[0].precision, 2);
  assert.equal(hydralisk.rangedWeapons[0].longRange, 16);
  assert.equal(marine.abilities.includes("combat_shield"), true);
  assert.equal(marine.rangedWeapons[0].antiEvade, 1);
  assert.equal(marine.meleeWeapons[0].name, "Bayonet");
  assert.deepEqual(marine.importedUpgrades.applied, ["Combat Shield", "Bayonet", "Slugthrower"]);
});

test("solid-field projectors now import as an applied upgrade for sentries", () => {
  const protossRoster = importArmyBuilderRoster({
    faction: "Khalai",
    factionCard: { id: "khalai", name: "Khalai" },
    tacticalCards: [],
    units: [
      {
        unitId: "sentry",
        name: "Sentry",
        tier: { level: "T2" },
        selectedUpgrades: [{ name: "Solid-Field Projectors" }]
      }
    ]
  }, "playerA");

  assert.equal(protossRoster.summary.appliedUpgrades, 1);
  assert.equal(protossRoster.summary.partialUpgrades, 0);
  assert.deepEqual(protossRoster.army[0].upgradeSummary.applied, ["Solid-Field Projectors"]);
});

test("remaining medic and roach upgrades now import as applied instead of partial", () => {
  const terranRoster = importArmyBuilderRoster({
    faction: "Terran Armed Forces",
    factionCard: { id: "terran-armed-forces", name: "Terran Armed Forces" },
    tacticalCards: [],
    units: [
      {
        unitId: "medic",
        name: "Medic",
        tier: { level: "T2" },
        selectedUpgrades: [{ name: "A-13 Flash Grenade Launcher" }, { name: "Stabilizer Medpacks" }]
      }
    ]
  }, "playerA");

  const zergRoster = importArmyBuilderRoster({
    faction: "Kerrigan's Swarm",
    factionCard: { id: "kerrigans-swarm", name: "Kerrigan's Swarm" },
    tacticalCards: [],
    units: [
      {
        unitId: "roach",
        name: "Roach",
        tier: { level: "T2" },
        selectedUpgrades: [{ name: "Ancillary Carapace" }, { name: "Lurking" }]
      }
    ]
  }, "playerB");

  assert.equal(terranRoster.summary.appliedUpgrades, 2);
  assert.equal(terranRoster.summary.partialUpgrades, 0);
  assert.deepEqual(terranRoster.army[0].upgradeSummary.applied, ["A-13 Flash Grenade Launcher", "Stabilizer Medpacks"]);

  assert.equal(zergRoster.summary.appliedUpgrades, 2);
  assert.equal(zergRoster.summary.partialUpgrades, 0);
  assert.deepEqual(zergRoster.army[0].upgradeSummary.applied, ["Ancillary Carapace", "Lurking"]);
});
