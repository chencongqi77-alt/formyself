import assert from "node:assert/strict";
import test from "node:test";

import { visibleSocialGraphEdges } from "../lib/social-graph-visibility.ts";

const edges = [
  { id: "su-huang", source: "su", target: "huang" },
  { id: "su-wang", source: "su", target: "wang" },
  { id: "huang-wang", source: "huang", target: "wang" },
  { id: "ouyang-wang", source: "ouyang", target: "wang" },
];

function ids(values) {
  return values.map((edge) => edge.id);
}

test("social overview keeps direct ties and withholds cross-circle links", () => {
  assert.deepEqual(
    ids(visibleSocialGraphEdges(edges, { anchorId: "su" })),
    ["su-huang", "su-wang"],
  );
});

test("focusing a person reveals only that person's cross-circle links", () => {
  assert.deepEqual(
    ids(
      visibleSocialGraphEdges(edges, {
        anchorId: "su",
        revealNodeId: "wang",
      }),
    ),
    ["su-huang", "su-wang", "huang-wang", "ouyang-wang"],
  );
});
