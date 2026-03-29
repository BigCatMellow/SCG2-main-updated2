import { createUnitStateFromTemplate } from "../data/units.js";
import { getMission } from "../data/missions.js";
import { getDeployment } from "../data/deployments.js";

function createTerrain() {
  return [
    { id: "t1", kind: "blocker", impassable: true, rect: { minX: 11, minY: 14, maxX: 15, maxY: 18 } },
    { id: "t2", kind: "blocker", impassable: true, rect: { minX: 21, minY: 18, maxX: 25, maxY: 22 } },
    { id: "t3", kind: "grass", impassable: false, rect: { minX: 15, minY: 7, maxX: 20, maxY: 11 } },
    { id: "t4", kind: "elevated_cover", impassable: false, rect: { minX: 16, minY: 24, maxX: 22, maxY: 28 } }
  ];
}

function createDefaultHand(playerId, cardIds = ["focused_fire", "rapid_relocation"]) {
  return cardIds.map((cardId, index) => ({
    instanceId: `${playerId}_card_${cardId}_${index + 1}`,
    cardId
  }));
}

export function createInitialGameState({
  missionId,
  deploymentId,
  armyA,
  armyB,
  tacticalCardsA = ["focused_fire", "rapid_relocation"],
  tacticalCardsB = ["focused_fire", "rapid_relocation"],
  rules = { gridMode: false },
  firstPlayerMarkerHolder = "playerA"
}) {
  const mission = getMission(missionId);
  const deployment = getDeployment(deploymentId);
  const units = {};
  const reserveA = [];
  const reserveB = [];

  for (const entry of armyA) {
    const unit = createUnitStateFromTemplate(entry.templateId, "playerA", entry.id, { selectedUpgrades: entry.selectedUpgrades ?? [] });
    units[unit.id] = unit;
    reserveA.push(unit.id);
  }
  for (const entry of armyB) {
    const unit = createUnitStateFromTemplate(entry.templateId, "playerB", entry.id, { selectedUpgrades: entry.selectedUpgrades ?? [] });
    units[unit.id] = unit;
    reserveB.push(unit.id);
  }

  return {
    round: 1,
    phase: "movement",
    mission,
    deployment,
    board: {
      widthInches: deployment.boardWidthInches,
      heightInches: deployment.boardHeightInches,
      terrain: createTerrain(),
      creepZones: []
    },
    rules: {
      gridMode: Boolean(rules?.gridMode)
    },
    players: {
      playerA: {
        vp: 0,
        reserveUnitIds: reserveA,
        battlefieldUnitIds: [],
        supplyPool: mission.startingSupply,
        availableSupply: mission.startingSupply,
        hasPassedThisPhase: false,
        hand: createDefaultHand("playerA", tacticalCardsA),
        discardPile: []
      },
      playerB: {
        vp: 0,
        reserveUnitIds: reserveB,
        battlefieldUnitIds: [],
        supplyPool: mission.startingSupply,
        availableSupply: mission.startingSupply,
        hasPassedThisPhase: false,
        hand: createDefaultHand("playerB", tacticalCardsB),
        discardPile: []
      }
    },
    units,
    combatQueue: [],
    effects: [],
    lastCombatReport: [],
    lastRoundSummary: null,
    objectiveControl: Object.fromEntries(deployment.missionMarkers.map(marker => [marker.id, { objectiveId: marker.id, controller: null, playerASupply: 0, playerBSupply: 0, contested: false }])),
    winner: null,
    firstPlayerMarkerHolder,
    activePlayer: firstPlayerMarkerHolder,
    log: [
      {
        type: "phase",
        text: `Round 1 begins. Movement Phase active. ${firstPlayerMarkerHolder === "playerA" ? "Blue" : "Red"} player has first activation.`,
        round: 1,
        phase: "movement"
      }
    ]
  };
}

export function cloneState(state) {
  return structuredClone(state);
}

export function appendLog(state, type, text) {
  state.log.push({ type, text, round: state.round, phase: state.phase });
}

export function getUnit(state, unitId) {
  return state.units[unitId] ?? null;
}

export function getPlayerUnits(state, playerId) {
  return Object.values(state.units).filter(unit => unit.owner === playerId);
}

export function getBattlefieldUnits(state, playerId) {
  return getPlayerUnits(state, playerId).filter(unit => unit.status.location === "battlefield");
}

export function getReserveUnits(state, playerId) {
  return getPlayerUnits(state, playerId).filter(unit => unit.status.location === "reserves");
}
