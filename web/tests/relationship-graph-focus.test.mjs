import assert from "node:assert/strict";
import test from "node:test";

import { deriveRelationshipGraphFocus } from "../lib/relationship-graph-focus.ts";

const edges = [
  { id: "a-b", source: "a", target: "b" },
  { id: "a-c", source: "a", target: "c" },
  { id: "b-d", source: "b", target: "d" },
];

function ids(values) {
  return [...values].toSorted();
}

test("node hover reveals every incident relation label and overrides selected focus", () => {
  const focus = deriveRelationshipGraphFocus({
    edges,
    hoverNodeId: "a",
    selectedNodeId: "b",
  });

  assert.equal(focus.focusNodeId, "a");
  assert.deepEqual(ids(focus.highlightedEdgeIds), ["a-b", "a-c"]);
  assert.deepEqual(ids(focus.labelEdgeIds), ["a-b", "a-c"]);
});

test("edge hover reveals only that edge label while preserving node focus", () => {
  const focus = deriveRelationshipGraphFocus({
    edges,
    hoverNodeId: "a",
    hoverEdgeId: "b-d",
    selectedNodeId: "b",
  });

  assert.equal(focus.focusNodeId, "a");
  assert.deepEqual(ids(focus.highlightedEdgeIds), ["a-b", "a-c"]);
  assert.deepEqual(ids(focus.labelEdgeIds), ["b-d"]);
});

test("a persistent selection highlights incident edges without leaving labels open", () => {
  const focus = deriveRelationshipGraphFocus({
    edges,
    selectedNodeId: "b",
  });

  assert.equal(focus.focusNodeId, "b");
  assert.deepEqual(ids(focus.highlightedEdgeIds), ["a-b", "b-d"]);
  assert.deepEqual(ids(focus.labelEdgeIds), []);
});

test("an idle graph has neither focus nor transient labels", () => {
  const focus = deriveRelationshipGraphFocus({ edges });

  assert.equal(focus.focusNodeId, "");
  assert.deepEqual(ids(focus.highlightedEdgeIds), []);
  assert.deepEqual(ids(focus.labelEdgeIds), []);
});
