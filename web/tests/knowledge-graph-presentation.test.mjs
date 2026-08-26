import assert from "node:assert/strict";
import test from "node:test";

import {
  arrangeKnowledgeGraph,
  knowledgeGraphCardSize,
  knowledgeGraphLinkGeometry,
  knowledgeGraphStraightLinkGeometry,
} from "../lib/knowledge-graph-presentation.ts";

test("knowledge graph presentation keeps a shared stable card composition", () => {
  const nodes = [
    { id: "anchor", name: "白居易", degree: 4, x: 0, y: 0 },
    { id: "kin", name: "白敏中", degree: 1, x: 0, y: 0 },
    { id: "literary", name: "元稹", degree: 3, x: 0, y: 0 },
  ];

  arrangeKnowledgeGraph(nodes, {
    anchorId: "anchor",
    width: 1600,
    height: 1000,
    clusterForNode: (node) => (node.id === "kin" ? "kin" : "literary"),
  });

  assert.deepEqual(
    nodes.map(({ id, x, y }) => ({ id, x, y })),
    [
      { id: "anchor", x: 740, y: 520 },
      { id: "kin", x: 380, y: 650 },
      { id: "literary", x: 1180, y: 380 },
    ],
  );
  assert.deepEqual(knowledgeGraphCardSize("元稹"), { width: 84, height: 44 });

  const geometry = knowledgeGraphLinkGeometry(
    "anchor-literary",
    { name: "白居易", x: 740, y: 520, isAnchor: true },
    { name: "元稹", x: 1180, y: 380, isAnchor: false },
  );
  assert.match(geometry.path, /^M .+ Q .+ .+$/);
  assert.ok(Number.isFinite(geometry.labelX));
  assert.ok(Number.isFinite(geometry.labelY));

  const straightGeometry = knowledgeGraphStraightLinkGeometry(
    { name: "白居易", x: 740, y: 520, isAnchor: true },
    { name: "元稹", x: 1180, y: 380, isAnchor: false },
  );
  assert.match(straightGeometry.path, /^M .+ L .+ .+$/);
  assert.doesNotMatch(straightGeometry.path, / Q /);
  assert.ok(Number.isFinite(straightGeometry.labelX));
  assert.ok(Number.isFinite(straightGeometry.labelY));
});
