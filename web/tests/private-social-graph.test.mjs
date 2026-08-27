import assert from "node:assert/strict";
import test from "node:test";

import { mergePrivateSocialEdges } from "../lib/private-social-graph.ts";

function edge({
  id,
  source = "su-shi",
  target,
  relationTypes,
  evidenceIds,
  storyIds = [],
}) {
  return {
    id,
    sourcePersonId: source,
    targetPersonId: target,
    relationTypes,
    placeIds: [],
    workIds: [],
    storyIds,
    evidenceIds,
    reviewState: "accepted",
  };
}

test("private social preview draws one relationship per unordered person pair", () => {
  const merged = mergePrivateSocialEdges([
    edge({
      id: "social-1",
      target: "huang-ting-jian",
      relationTypes: ["friendship"],
      evidenceIds: ["seg-1"],
      storyIds: ["story-1"],
    }),
    edge({
      id: "social-2",
      source: "huang-ting-jian",
      target: "su-shi",
      relationTypes: ["literary-exchange"],
      evidenceIds: ["seg-2"],
      storyIds: ["story-2"],
    }),
    edge({
      id: "social-3",
      target: "wang-an-shi",
      relationTypes: ["official"],
      evidenceIds: ["seg-3"],
    }),
  ]);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].sourceEdgeIds, ["social-1", "social-2"]);
  assert.deepEqual(merged[0].relationTypes, ["friendship", "literary-exchange"]);
  assert.deepEqual(merged[0].evidenceIds, ["seg-1", "seg-2"]);
  assert.deepEqual(merged[0].storyIds, ["story-1", "story-2"]);
  assert.equal(merged[1].targetPersonId, "wang-an-shi");
});
