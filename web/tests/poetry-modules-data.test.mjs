import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readJson(path) {
  const url = new URL("../public/data/" + path, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

test("poem-world preview payloads carry the expected records", async () => {
  const places = await readJson("poem-world-places.json");
  const links = await readJson("poem-world-links.json");

  assert.equal(places.recordType, "poem-world-places-frontend");
  assert.equal(places.reviewState, "candidate-preview");
  assert.equal(places.places.length, 119);
  assert.ok(places.places.every((place) => typeof place.name === "string"));

  assert.equal(links.recordType, "poem-world-links-frontend");
  // The batch expansion grew these counts; keep the floor so later
  // releases must at least preserve the previously released coverage.
  assert.ok(links.counts.point >= 3477);
  assert.ok(links.counts.region >= 556);
  assert.equal(links.pointLinks.length, links.counts.point);
  assert.equal(links.regionLinks.length, links.counts.region);
  assert.ok(
    links.pointLinks.every(
      (link) =>
        typeof link.workTitle === "string" &&
        typeof link.excerpt === "string" &&
        typeof link.openingLine === "string" &&
        typeof link.placeId === "string",
    ),
  );

  const liBaiLongTitle = links.pointLinks.find(
    (link) => link.workId === "corpus-li-bai-8338e3db-3f5d-49fa-b1c1-1ebcc9678d27",
  );
  assert.equal(liBaiLongTitle?.openingLine, "张衡殊不乐，应有四愁诗。");
});

test("poet-social preview payload carries the accepted edges", async () => {
  const payload = await readJson("poet-social-edges.json");

  assert.equal(payload.recordType, "poet-social-edges-frontend");
  assert.equal(payload.reviewState, "auto-accepted-preview");
  assert.equal(payload.person.id, "su-shi");
  assert.equal(payload.edges.length, 510);
  assert.ok(
    payload.edges.every(
      (edge) =>
        typeof edge.otherName === "string" &&
        Array.isArray(edge.displayBuckets) &&
        edge.displayBuckets.length > 0 &&
        ["probable", "possible"].includes(edge.confidence),
    ),
  );
});

test("poet-social network payload carries a knowledge-graph view", async () => {
  const payload = await readJson("poet-social-network.json");

  assert.equal(payload.recordType, "poet-social-network-frontend");
  assert.equal(payload.reviewState, "auto-accepted-preview");
  assert.equal(payload.person.id, "su-shi");
  assert.equal(payload.counts.people, payload.people.length);
  assert.equal(payload.counts.edges, payload.edges.length);
  assert.ok(payload.counts.people >= 500);
  assert.ok(payload.counts.edges >= 1500);
  assert.ok(payload.counts.secondaryEdges > 900);
  assert.ok(
    payload.edges.some(
      (edge) => edge.source !== "su-shi" && edge.target !== "su-shi",
    ),
  );

  const ids = new Set(payload.people.map((person) => person.id));
  assert.ok(
    payload.edges.every(
      (edge) =>
        ids.has(edge.source) &&
        ids.has(edge.target) &&
        Array.isArray(edge.displayBuckets) &&
        edge.displayBuckets.length > 0 &&
        ["probable", "possible"].includes(edge.confidence) &&
        typeof edge.evidenceCount === "number",
    ),
  );
});

test("horizontal poet-social previews retain reviewed direct edges and source-referenced core bridges", async () => {
  const index = await readJson("poet-social-index.json");

  assert.equal(index.recordType, "poet-social-index-frontend");
  assert.equal(index.reviewState, "candidate-preview");
  assert.equal(
    index.previewScope,
    "reviewed-direct-plus-source-referenced-core-bridges",
  );
  assert.ok(index.poets.length >= 27);
  assert.ok(
    index.poets.reduce((total, poet) => total + poet.counts.directEdges, 0) >=
      2113,
  );

  await Promise.all(
    index.poets.map(async (poet) => {
      const payload = await readJson(`poet-social/${poet.id}.json`);
      assert.equal(payload.recordType, "poet-social-network-frontend");
      assert.equal(payload.reviewState, "candidate-preview");
      assert.equal(
        payload.previewScope,
        "reviewed-direct-plus-source-referenced-core-bridges",
      );
      assert.equal(payload.person.id, poet.id);
      assert.equal(payload.counts.edges, poet.counts.edges);
      assert.equal(
        payload.counts.edges,
        payload.counts.directEdges + payload.counts.secondaryEdges,
      );
      assert.equal(payload.counts.coreDirectEdges, Math.min(20, payload.counts.directEdges));
      assert.ok(payload.counts.secondaryEdges <= 12);
      const directEdges = payload.edges.filter(
        (edge) => edge.source === poet.id || edge.target === poet.id,
      );
      const bridgeEdges = payload.edges.filter(
        (edge) => edge.source !== poet.id && edge.target !== poet.id,
      );
      assert.equal(directEdges.length, payload.counts.directEdges);
      assert.equal(bridgeEdges.length, payload.counts.secondaryEdges);
      assert.ok(
        directEdges.every(
          (edge) =>
            edge.origin === "review" &&
            (edge.source === poet.id || edge.target === poet.id) &&
            edge.decisionState === "auto-accepted" &&
            Array.isArray(edge.sourceRefs) &&
            edge.sourceRefs.length > 0,
        ),
      );
      assert.ok(
        bridgeEdges.every(
          (edge) =>
            edge.origin === "cbdb-network" &&
            !("decisionState" in edge) &&
            Array.isArray(edge.sourceRefs) &&
            edge.sourceRefs.length > 0,
        ),
      );
    }),
  );
});

test("two social-reader pilots reuse published event evidence without promoting graph edges", async () => {
  const expected = new Map([
    ["bai-ju-yi", "net-bai-ju-yi-cbdb-32248"],
    ["su-shi", "net-su-shi-cbdb-1493"],
  ]);

  for (const [poetId, edgeId] of expected) {
    const payload = await readJson(`poet-social/${poetId}.json`);
    assert.equal(payload.reviewState, "candidate-preview");
    assert.equal(payload.readerContent.releaseId, "poet-social-reader-pilot-20260820");
    assert.equal(payload.readerContent.reviewState, "published-event-evidence");
    assert.ok(payload.readerContent.overviewEvents.length >= 2);
    assert.equal(payload.readerContent.stories.length, 1);
    assert.equal(payload.readerContent.stories[0].edgeId, edgeId);
    assert.ok(
      payload.readerContent.stories[0].events.every(
        (event) =>
          event.reviewStatus === "published" &&
          Array.isArray(event.sourceRefs) &&
          event.sourceRefs.length > 0,
      ),
    );
    assert.ok(
      payload.edges.some(
        (edge) => edge.id === edgeId && edge.decisionState === "auto-accepted",
      ),
    );
  }
});

test("release manifest records the preview release", async () => {
  const manifest = await readJson("poetry-modules-manifest.json");
  assert.equal(manifest.recordType, "poetry-modules-frontend-release");
  assert.equal(manifest.reviewState, "candidate-preview");
  assert.equal(manifest.files.length, 4);
  assert.ok(Array.isArray(manifest.pendingGates));
});
