export const DEPLOYMENT_DATA = {
  crossfire: {
    id: "crossfire",
    name: "Crossfire",
    boardWidthInches: 36,
    boardHeightInches: 36,
    entryEdges: {
      playerA: { side: "west" },
      playerB: { side: "east" }
    },
    zoneOfInfluenceDepth: 6,
    missionMarkers: [
      { id: "obj1", x: 18, y: 18 },
      { id: "obj2", x: 18, y: 10 },
      { id: "obj3", x: 18, y: 26 }
    ]
  }
};

export function getDeployment(deploymentId) {
  const deployment = DEPLOYMENT_DATA[deploymentId];
  if (!deployment) throw new Error(`Unknown deployment: ${deploymentId}`);
  return deployment;
}
