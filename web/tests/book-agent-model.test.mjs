import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analyzeBook,
  mergeBookAgentModelResult,
} from "../lib/book-agent.ts";
import { handleBookAgentApi } from "../lib/book-agent-api.ts";

const dataRoot = new URL("../public/data/", import.meta.url);

async function loadJson(path) {
  return JSON.parse(await readFile(new URL(path, dataRoot), "utf8"));
}

const catalogs = {
  people: await loadJson("people.json"),
  places: await loadJson("places.json"),
  works: await loadJson("works.json"),
};

const journeyFixtureCatalogs = {
  people: [{ id: "su-shi", name: "苏轼", aliases: [] }],
  places: [
    { id: "changan", name: "长安", historicalNames: [], sourceCoordinates: { x: 108.94, y: 34.34 } },
    { id: "huangzhou", name: "黄州", historicalNames: [], sourceCoordinates: { x: 114.88, y: 30.44 } },
    { id: "hangzhou", name: "杭州", historicalNames: [], sourceCoordinates: { x: 120.15, y: 30.27 } },
  ],
  works: [],
};

function journeyFacts(result) {
  const places = new Map(result.draft.entities.places.map((place) => [place.id, place.label]));
  return result.draft.volumes.journey.items.map((item) => ({
    place: places.get(item.placeId),
    predicate: item.predicate,
    sequence: item.sequence,
  }));
}

test("local journey extraction binds each clause action to its own place in source order", async () => {
  const result = await analyzeBook({
    text: "苏轼生于长安，后来寓居黄州，曾游历杭州。",
    fileName: "journey-clause-fixture.txt",
    bookTitle: "行迹分句测试",
    poetName: "苏轼",
    fileSha256: "b".repeat(64),
    catalogs: journeyFixtureCatalogs,
  });

  assert.deepEqual(journeyFacts(result), [
    { place: "长安", predicate: "born-at", sequence: 1 },
    { place: "黄州", predicate: "resided-at", sequence: 2 },
    { place: "杭州", predicate: "visited", sequence: 3 },
  ]);
});

test("model merge rejects predicates that conflict with explicit place-action evidence", async () => {
  const base = await analyzeBook({
    text: "苏轼生于长安，后来寓居黄州，曾游历杭州。",
    fileName: "journey-model-conflict-fixture.txt",
    bookTitle: "行迹模型冲突测试",
    poetName: "苏轼",
    fileSha256: "c".repeat(64),
    catalogs: journeyFixtureCatalogs,
  });
  const result = await mergeBookAgentModelResult(base, {
    people: [],
    places: [],
    works: [],
    journey: ["长安", "黄州", "杭州"].map((placeName) => ({
      personName: "苏轼",
      placeName,
      predicate: "born-at",
      timeLabel: null,
      segmentIds: ["seg-1"],
      storyTitle: `出生于${placeName}`,
      storySummary: "模型生成的待审核摘要。",
    })),
    poemWorld: [],
    social: [],
  }, journeyFixtureCatalogs);

  assert.deepEqual(journeyFacts(result), [
    { place: "长安", predicate: "born-at", sequence: 1 },
    { place: "黄州", predicate: "resided-at", sequence: 2 },
    { place: "杭州", predicate: "visited", sequence: 3 },
  ]);
});

test("model candidates are merged into evidence-backed private volumes", async () => {
  const base = await analyzeBook({
    text: "苏轼到达杭州。苏轼与某友往来，未知小记写新城。",
    fileName: "model-fixture.txt",
    bookTitle: "模型候选测试书",
    poetName: "苏轼",
    fileSha256: "a".repeat(64),
    catalogs,
  });
  const result = await mergeBookAgentModelResult(base, {
    people: [
      { name: "某友", aliases: [], segmentIds: ["seg-2"], note: "原文人物候选" },
    ],
    places: [
      { name: "新城", historicalNames: [], segmentIds: ["seg-2"], note: "原文地点候选" },
    ],
    works: [
      { title: "未知小记", authorName: null, segmentIds: ["seg-2"], note: "原文作品候选" },
    ],
    journey: [
      {
        personName: "苏轼",
        placeName: "杭州",
        predicate: "traveled-to",
        timeLabel: null,
        segmentIds: ["seg-1"],
        storyTitle: "模型识别的杭州行迹",
        storySummary: "只基于原文片段的待审核摘要。",
      },
    ],
    poemWorld: [
      {
        workTitle: "未知小记",
        placeName: "新城",
        relationType: "describes-place",
        segmentIds: ["seg-2"],
        storyTitle: "未知作品与新城",
        storySummary: "只基于原文片段的作品空间候选。",
      },
    ],
    social: [
      {
        sourcePersonName: "苏轼",
        targetPersonName: "某友",
        relationTypes: ["friendship"],
        placeNames: ["新城"],
        workTitles: ["未知小记"],
        segmentIds: ["seg-2"],
        storyTitle: "苏轼与某友的往来",
        storySummary: "只基于原文片段的待审核关系候选。",
      },
    ],
  }, catalogs);

  assert.equal(result.validation.valid, true);
  assert.ok(result.draft.entities.people.some((person) => person.name === "某友"));
  assert.ok(result.draft.entities.places.some((place) => place.label === "新城"));
  assert.ok(result.draft.entities.works.some((work) => work.title === "未知小记"));
  assert.ok(result.draft.volumes.journey.items.some((item) => item.predicate === "traveled-to"));
  assert.ok(result.draft.volumes.poemWorld.items.some((item) => item.relationType === "describes-place"));
  assert.ok(result.draft.volumes.social.edges.some((edge) => edge.relationTypes.includes("friendship")));
  for (const story of result.draft.storyCards) {
    assert.ok(story.evidenceIds.length > 0);
    assert.ok(story.anchorRefs.length > 0);
    assert.equal(story.disclaimerCode, "not-independent-historical-fact");
  }
});

test("model status never exposes an API key", async () => {
  const response = await handleBookAgentApi(
    new Request("http://localhost/api/agent/status"),
    { DEEPSEEK_API_KEY: "test-secret", DEEPSEEK_MODEL: "test-model" },
  );
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.deepEqual(status, { configured: true, provider: "deepseek", model: "test-model" });
  assert.doesNotMatch(JSON.stringify(status), /test-secret/);
});
