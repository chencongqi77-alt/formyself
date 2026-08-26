import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { relationshipReadingCollection } from "../lib/relationship-reading.ts";

const dataRoot = new URL("../public/data/", import.meta.url);

async function loadJson(path) {
  return JSON.parse(await readFile(new URL(path, dataRoot), "utf8"));
}

const [samples, people, places, events, works, sources, workPlaceLinks] = await Promise.all([
  loadJson("reading-samples.json"),
  loadJson("people.json"),
  loadJson("places.json"),
  loadJson("events.json"),
  loadJson("works.json"),
  loadJson("sources.json"),
  loadJson("work-place-links.json"),
]);

const storyIds = new Set(samples.storyCards.map((story) => story.id));
const evidenceIds = new Set(samples.evidence.map((evidence) => evidence.id));
const sourceIds = new Set(sources.map((source) => source.id));
const entityIds = {
  person: new Set([
    ...people.map((person) => person.id),
    ...samples.entities.people.map((person) => person.id),
  ]),
  place: new Set(places.map((place) => place.id)),
  work: new Set([
    ...works.map((work) => work.id),
    ...samples.entities.works.map((work) => work.id),
  ]),
  event: new Set(events.map((event) => event.id)),
};

test("reading samples keep story, evidence, and anchor references closed", () => {
  assert.equal(new Set(samples.storyCards.map((story) => story.id)).size, samples.storyCards.length);

  for (const evidence of samples.evidence) {
    assert.ok(sourceIds.has(evidence.sourceId), `missing source: ${evidence.sourceId}`);
    assert.ok(evidence.locator?.kind);
    assert.ok(evidence.locator?.path);
    assert.ok(evidence.purpose);
  }

  for (const story of samples.storyCards) {
    assert.ok(story.title && story.summary, `incomplete story card: ${story.id}`);
    assert.ok(["fact", "tradition", "interpretation"].includes(story.claimType));
    assert.ok(story.evidenceIds.length > 0, `story needs evidence: ${story.id}`);
    for (const evidenceId of story.evidenceIds) {
      assert.ok(evidenceIds.has(evidenceId), `missing evidence: ${evidenceId}`);
    }
    for (const anchor of story.anchorRefs) {
      assert.ok(entityIds[anchor.type]?.has(anchor.id), `missing ${anchor.type}: ${anchor.id}`);
    }
  }
});

test("view mappings point to existing events, stories, places, and works", () => {
  for (const event of events) {
    for (const storyId of event.storyIds ?? []) {
      assert.ok(storyIds.has(storyId), `event ${event.id} points to missing story: ${storyId}`);
    }
  }
  for (const link of workPlaceLinks) {
    for (const storyId of link.storyIds ?? []) {
      assert.ok(storyIds.has(storyId), `link ${link.id} points to missing story: ${storyId}`);
    }
  }

  for (const [eventId, mappedStoryIds] of Object.entries(
    samples.views.journey.eventStoryIds,
  )) {
    assert.ok(entityIds.event.has(eventId), `missing journey event: ${eventId}`);
    for (const storyId of mappedStoryIds) assert.ok(storyIds.has(storyId));
  }

  for (const spotlight of samples.views.poemWorld.spotlights) {
    assert.ok(entityIds.place.has(spotlight.placeId));
    for (const storyId of spotlight.storyIds) assert.ok(storyIds.has(storyId));
    for (const work of spotlight.works) assert.ok(entityIds.work.has(work.workId));
  }

  for (const relationship of samples.views.social.relationships) {
    assert.equal(relationship.pairIds.length, 2);
    for (const personId of relationship.pairIds) assert.ok(entityIds.person.has(personId));
    for (const storyId of relationship.storyIds) assert.ok(storyIds.has(storyId));
  }
});

test("tradition cards stay out of the social edge model", () => {
  const tradition = samples.storyCards.find(
    (story) => story.id === "story-place-huanghelou-cui-hao-li-bai",
  );
  assert.equal(tradition.claimType, "tradition");
  assert.ok(tradition.disclaimer);
  assert.equal(
    samples.views.social.relationships.some((relationship) =>
      relationship.pairIds.includes("cui-hao"),
    ),
    false,
  );
});

test("the Su Shi–Wang An Shi reading collection is generated from the sample bundle", () => {
  const collection = relationshipReadingCollection("wang-an-shi", "su-shi");
  assert.ok(collection);
  assert.equal(collection.storyReferences.length, 3);
  assert.equal(collection.workReferences.length, 3);
  assert.equal(collection.storyReferences[0].sourceRefs[0].sourceId, "kanripo-kr2a0032");
});
