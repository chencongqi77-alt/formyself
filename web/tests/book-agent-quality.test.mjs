import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analyzeBook,
  approveDraft,
  buildReleaseManifest,
  mergeBookAgentModelResult,
  sha256Hex,
  validateBookDraft,
} from "../lib/book-agent.ts";

const fixtureCatalogs = {
  people: [
    { id: "su-shi", name: "苏轼", aliases: ["东坡"] },
    { id: "wang-an-shi", name: "王安石", aliases: [] },
    { id: "li-bai", name: "李白", aliases: ["太白"] },
    { id: "meng-hao-ran", name: "孟浩然", aliases: [] },
  ],
  places: [
    { id: "changan", name: "长安", historicalNames: [], sourceCoordinates: { x: 108.94, y: 34.34 } },
    { id: "huangzhou", name: "黄州", historicalNames: [], sourceCoordinates: { x: 114.88, y: 30.44 } },
    { id: "hangzhou", name: "杭州", historicalNames: [], sourceCoordinates: { x: 120.15, y: 30.27 } },
    { id: "xihu", name: "西湖", historicalNames: [], sourceCoordinates: { x: 120.14, y: 30.25 } },
    { id: "yangzhou", name: "扬州", historicalNames: [], sourceCoordinates: { x: 119.42, y: 32.39 } },
    { id: "huanghelou", name: "黄鹤楼", historicalNames: [], sourceCoordinates: { x: 114.30, y: 30.55 } },
  ],
  works: [
    { id: "su-work", personId: "su-shi", title: "东坡小记", genre: "文" },
    { id: "li-work", personId: "li-bai", title: "太白小记", genre: "诗" },
  ],
};

async function analyzeFixture(text, hashCharacter = "d") {
  return analyzeBook({
    text,
    fileName: "quality-fixture.txt",
    bookTitle: "中心人物作用域测试",
    poetName: "苏轼",
    fileSha256: hashCharacter.repeat(64),
    catalogs: fixtureCatalogs,
  });
}

function summarize(result) {
  const draft = result.draft;
  const people = new Map(draft.entities.people.map((person) => [person.id, person.name]));
  const places = new Map(draft.entities.places.map((place) => [place.id, place.label]));
  const works = new Map(draft.entities.works.map((work) => [work.id, work]));
  return {
    journey: draft.volumes.journey.items.map((item) => ({
      place: places.get(item.placeId),
      predicate: item.predicate,
    })),
    poemWorld: draft.volumes.poemWorld.items.map((item) => ({
      work: works.get(item.workId)?.title,
      author: people.get(works.get(item.workId)?.authorPersonId),
      place: places.get(item.placeId),
      relationType: item.relationType,
    })),
    social: draft.volumes.social.edges.map((edge) => ({
      source: people.get(edge.sourcePersonId),
      target: people.get(edge.targetPersonId),
    })),
  };
}

test("mixed-person local analysis keeps only the selected poet and binds poem relations per clause", async () => {
  const result = await analyzeFixture([
    "苏轼生于长安，后来寓居黄州。",
    "李白生于扬州，后来游历杭州。",
    "苏轼《东坡小记》作于杭州，作品写西湖，又提到黄州。",
    "李白《太白小记》题写黄鹤楼，诗中提到扬州。",
    "苏轼与王安石往来，二人有书信唱和。",
    "李白与孟浩然往来。",
  ].join("\n"));

  assert.deepEqual(summarize(result), {
    journey: [
      { place: "长安", predicate: "born-at" },
      { place: "黄州", predicate: "resided-at" },
    ],
    poemWorld: [
      { work: "东坡小记", author: "苏轼", place: "杭州", relationType: "composed-at" },
      { work: "东坡小记", author: "苏轼", place: "西湖", relationType: "describes-place" },
      { work: "东坡小记", author: "苏轼", place: "黄州", relationType: "mentioned-place" },
    ],
    social: [{ source: "苏轼", target: "王安石" }],
  });
  assert.equal(result.validation.valid, true);
});

test("social extraction does not create cross-clause Cartesian-product relationships", async () => {
  const result = await analyzeFixture("苏轼与王安石往来，李白与孟浩然唱和。", "e");
  assert.deepEqual(summarize(result).social, [{ source: "苏轼", target: "王安石" }]);
});

test("subject switches and adjacent works do not leak later places into the selected poet", async () => {
  const journeyResult = await analyzeFixture("苏轼生于长安，李白寓居黄州，后来游历杭州。", "2");
  assert.deepEqual(summarize(journeyResult).journey, [{ place: "长安", predicate: "born-at" }]);

  const text = "苏轼《东坡小记》写西湖，李白《太白小记》题写黄鹤楼。";
  const base = await analyzeFixture(text, "3");
  assert.deepEqual(summarize(base).poemWorld, [
    { work: "东坡小记", author: "苏轼", place: "西湖", relationType: "describes-place" },
  ]);
  const merged = await mergeBookAgentModelResult(base, {
    people: [], places: [], works: [], journey: [], social: [],
    poemWorld: [{
      workTitle: "东坡小记",
      placeName: "黄鹤楼",
      relationType: "inscribed-at",
      segmentIds: ["seg-1"],
      storyTitle: "错误的跨作品地点",
      storySummary: "待审核。",
    }],
  }, fixtureCatalogs);
  assert.deepEqual(summarize(merged).poemWorld, summarize(base).poemWorld);
});

test("place names inside work titles do not become journey or composition locations", async () => {
  const catalogs = structuredClone(fixtureCatalogs);
  catalogs.works.push({ id: "chibi-fu", personId: "su-shi", title: "赤壁赋", genre: "赋" });
  catalogs.places.push({ id: "chibi", name: "赤壁", historicalNames: [], sourceCoordinates: { x: 114.87, y: 30.44 } });
  const titleOnlyResult = await analyzeBook({
    text: "苏轼前往书房阅读《赤壁赋》。",
    fileName: "title-only-place-fixture.txt",
    bookTitle: "标题地点测试",
    poetName: "苏轼",
    fileSha256: "7".repeat(64),
    catalogs,
  });
  assert.deepEqual(summarize(titleOnlyResult).journey, []);
  assert.deepEqual(summarize(titleOnlyResult).poemWorld, []);

  const centralResult = await analyzeBook({
    text: "苏轼《赤壁赋》作于黄州，作品描写赤壁。",
    fileName: "title-place-fixture.txt",
    bookTitle: "标题地点测试",
    poetName: "苏轼",
    fileSha256: "8".repeat(64),
    catalogs,
  });
  assert.deepEqual(summarize(centralResult).poemWorld, [
    { work: "赤壁赋", author: "苏轼", place: "黄州", relationType: "composed-at" },
    { work: "赤壁赋", author: "苏轼", place: "赤壁", relationType: "describes-place" },
  ]);
});

test("incidental co-mentions and discourse markers do not create false connections", async () => {
  const result = await analyzeFixture("苏轼与王安石同时列入目录。至于杭州，苏轼只在诗中提到。", "4");
  assert.deepEqual(summarize(result).journey, []);
  assert.deepEqual(summarize(result).social, []);
});

test("negated actions, composition claims and relationships stay out of every queue", async () => {
  const text = "苏轼未曾到达杭州。苏轼《东坡小记》并非作于黄州。苏轼与李白并无交游。";
  const base = await analyzeFixture(text, "6");
  assert.deepEqual(summarize(base), { journey: [], poemWorld: [], social: [] });
  const merged = await mergeBookAgentModelResult(base, {
    people: [], places: [], works: [],
    journey: [{ personName: "苏轼", placeName: "杭州", predicate: "traveled-to", timeLabel: null, segmentIds: ["seg-1"], storyTitle: "错误行迹", storySummary: "待审核。" }],
    poemWorld: [{ workTitle: "东坡小记", placeName: "黄州", relationType: "composed-at", segmentIds: ["seg-2"], storyTitle: "错误诗境", storySummary: "待审核。" }],
    social: [{ sourcePersonName: "苏轼", targetPersonName: "李白", relationTypes: ["friendship"], placeNames: [], workTitles: [], segmentIds: ["seg-3"], storyTitle: "错误交游", storySummary: "待审核。" }],
  }, fixtureCatalogs);
  assert.deepEqual(summarize(merged), { journey: [], poemWorld: [], social: [] });
});

test("a canonical poet alias still resolves the selected-person scope", async () => {
  const result = await analyzeBook({
    text: "苏轼生于长安。苏轼《东坡小记》写西湖。",
    fileName: "alias-fixture.txt",
    bookTitle: "别名测试",
    poetName: "东坡",
    fileSha256: "5".repeat(64),
    catalogs: fixtureCatalogs,
  });
  assert.equal(result.draft.poet.id, "su-shi");
  assert.equal(result.draft.poet.name, "苏轼");
  assert.deepEqual(summarize(result).journey, [{ place: "长安", predicate: "born-at" }]);
  assert.deepEqual(summarize(result).poemWorld, [
    { work: "东坡小记", author: "苏轼", place: "西湖", relationType: "describes-place" },
  ]);
});

test("model merge rejects non-selected journeys, works and relationships", async () => {
  const text = [
    "苏轼到达杭州。",
    "李白生于扬州。",
    "苏轼《东坡小记》写西湖。",
    "李白《太白小记》题写黄鹤楼。",
    "苏轼与王安石往来。",
    "李白与孟浩然往来。",
  ].join("");
  const base = await analyzeFixture(text, "f");
  const result = await mergeBookAgentModelResult(base, {
    people: [],
    places: [],
    works: [],
    journey: [
      { personName: "东坡", placeName: "杭州", predicate: "traveled-to", timeLabel: null, segmentIds: ["seg-1"], storyTitle: "苏轼到杭州", storySummary: "待审核。" },
      { personName: "李白", placeName: "扬州", predicate: "born-at", timeLabel: null, segmentIds: ["seg-2"], storyTitle: "李白生于扬州", storySummary: "待审核。" },
    ],
    poemWorld: [
      { workTitle: "东坡小记", placeName: "西湖", relationType: "describes-place", segmentIds: ["seg-3"], storyTitle: "东坡小记与西湖", storySummary: "待审核。" },
      { workTitle: "太白小记", placeName: "黄鹤楼", relationType: "inscribed-at", segmentIds: ["seg-4"], storyTitle: "太白小记与黄鹤楼", storySummary: "待审核。" },
    ],
    social: [
      { sourcePersonName: "东坡", targetPersonName: "王安石", relationTypes: ["friendship"], placeNames: [], workTitles: [], segmentIds: ["seg-5"], storyTitle: "苏王往来", storySummary: "待审核。" },
      { sourcePersonName: "李白", targetPersonName: "孟浩然", relationTypes: ["friendship"], placeNames: [], workTitles: [], segmentIds: ["seg-6"], storyTitle: "李孟往来", storySummary: "待审核。" },
    ],
  }, fixtureCatalogs);

  assert.deepEqual(summarize(result), {
    journey: [{ place: "杭州", predicate: "traveled-to" }],
    poemWorld: [{ work: "东坡小记", author: "苏轼", place: "西湖", relationType: "describes-place" }],
    social: [{ source: "苏轼", target: "王安石" }],
  });
});

test("draft validation and release manifests enforce selected-poet scope", async () => {
  const result = await analyzeFixture("苏轼《东坡小记》写西湖。李白《太白小记》题写黄鹤楼。苏轼与王安石往来。李白与孟浩然往来。", "1");
  const unsafe = structuredClone(result.draft);
  const centralPoem = unsafe.volumes.poemWorld.items[0];
  const centralSocial = unsafe.volumes.social.edges[0];
  assert.ok(centralPoem && centralSocial);
  unsafe.volumes.poemWorld.items.push({ ...centralPoem, id: "unsafe-li-poem", workId: "li-work" });
  unsafe.volumes.social.edges.push({ ...centralSocial, id: "unsafe-li-social", sourcePersonId: "li-bai", targetPersonId: "meng-hao-ran" });
  const codes = new Set(validateBookDraft(unsafe).issues.map((issue) => issue.code));
  assert.ok(codes.has("poem-out-of-scope"));
  assert.ok(codes.has("social-out-of-scope"));

  const approved = approveDraft(result.draft);
  const manifest = buildReleaseManifest(approved);
  const acceptedEntityIds = new Set(manifest.acceptedEntityIds);
  assert.ok(acceptedEntityIds.has("su-shi"));
  assert.ok(acceptedEntityIds.has("su-work"));
  assert.ok(!acceptedEntityIds.has("li-bai"));
  assert.ok(!acceptedEntityIds.has("meng-hao-ran"));
  assert.ok(!acceptedEntityIds.has("li-work"));
});

test("the real demo book has no Li Bai candidates when Su Shi is selected", async () => {
  const dataRoot = new URL("../public/data/", import.meta.url);
  const catalogs = {
    people: JSON.parse(await readFile(new URL("people.json", dataRoot), "utf8")),
    places: JSON.parse(await readFile(new URL("places.json", dataRoot), "utf8")),
    works: JSON.parse(await readFile(new URL("works.json", dataRoot), "utf8")),
  };
  const text = await readFile(new URL("../../examples/book-agent-demo.txt", import.meta.url), "utf8");
  const result = await analyzeBook({
    text,
    fileName: "book-agent-demo.txt",
    bookTitle: "Agent 三卷测试书",
    poetName: "苏轼",
    fileSha256: await sha256Hex(text),
    catalogs,
  });
  const summary = summarize(result);
  assert.deepEqual(summary.journey.map((item) => item.place), ["长安", "黄州", "杭州"]);
  assert.ok(summary.poemWorld.every((item) => item.author === "苏轼"));
  assert.ok(summary.social.every((edge) => edge.source === "苏轼" || edge.target === "苏轼"));
  assert.doesNotMatch(JSON.stringify({ poemWorld: summary.poemWorld, social: summary.social }), /李白|孟浩然|黄鹤楼送孟浩然之广陵/);
});
