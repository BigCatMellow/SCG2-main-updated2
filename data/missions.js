export const MISSION_DATA = {
  take_and_hold: {
    id: "take_and_hold",
    name: "Take and Hold",
    roundLimit: 5,
    startingSupply: 4,
    supplyEscalation: 2,
    objectiveControlRangeInches: 2,
    vpPerControlledObjective: 1,
    pacing: {
      roundLimit: 5,
      finalRoundUnlimitedSupply: true
    },
    setupVariants: {
      recommendedDeployments: ["crossfire"],
      markerLayout: "standard_three_marker"
    },
    scoringWindows: [
      {
        id: "primary_cleanup",
        timing: "cleanup",
        rounds: "all",
        type: "controlled_markers",
        vpPerMarker: 1
      }
    ],
    instantWinConditions: [
      {
        id: "dominate_board",
        type: "control_all_markers"
      },
      {
        id: "vp_surge",
        type: "vp_threshold",
        threshold: 10
      }
    ]
  },
  domination_protocol: {
    id: "domination_protocol",
    name: "Domination Protocol",
    roundLimit: 5,
    startingSupply: 5,
    supplyEscalation: 2,
    objectiveControlRangeInches: 2,
    vpPerControlledObjective: 1,
    pacing: {
      roundLimit: 5,
      finalRoundUnlimitedSupply: true
    },
    setupVariants: {
      recommendedDeployments: ["crossfire"],
      markerLayout: "center_priority"
    },
    scoringWindows: [
      {
        id: "early_cleanup",
        timing: "cleanup",
        rounds: [1, 2],
        type: "controlled_markers",
        vpPerMarker: 1
      },
      {
        id: "center_late_game",
        timing: "cleanup",
        rounds: { min: 3, max: 5 },
        type: "specific_marker_control",
        markerId: "obj1",
        vpValue: 2
      }
    ],
    instantWinConditions: [
      {
        id: "vp_threshold_fastwin",
        type: "vp_threshold",
        threshold: 12
      }
    ]
  }
};

export function getMission(missionId) {
  const mission = MISSION_DATA[missionId];
  if (!mission) throw new Error(`Unknown mission: ${missionId}`);
  return mission;
}
