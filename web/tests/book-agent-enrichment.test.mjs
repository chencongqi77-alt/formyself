import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { analyzeBook, sha256Hex } from "../lib/book-agent.ts";

const dataRoot = new URL("../public/data/", import.meta.url);

async function loadJson(path) {
  return JSON.parse(await readFile(new URL(path, dataRoot), "utf8"));
}

test("historical book analysis keeps book evidence separate while enriching all three private volumes", async () => {
  const [people, places, works, events, workPlaceLinks, corpusWorks, social, text] = await Promise.all([
    loadJson("people.json"),
    loadJson("places.json"),
    loadJson("works.json"),
    loadJson("events.json"),
    loadJson("work-place-links.json"),
    loadJson("corpus/su-shi.json"),
    loadJson("poet-social/su-shi.json"),
    readFile(new URL("../../examples/book-agent-historical-regression.txt", import.meta.url), "utf8"),
  ]);
  const result = await analyzeBook({
    text,
    fileName: "book-agent-historical-regression.txt",
    bookTitle: "苏轼年谱与作品关系回归测试稿",
    poetName: "苏轼",
    fileSha256: await sha256Hex(text),
    catalogs: {
      people,
      places,
      works,
      reference: { events, workPlaceLinks, corpusWorks, social },
    },
  });

  const placeById = new Map(result.draft.entities.places.map((place) => [place.id, place.label]));
  const journeyPlaces = new Set(result.draft.volumes.journey.items.map((item) => placeById.get(item.placeId)));
  assert.ok(journeyPlaces.has("徐州"));
  assert.ok(journeyPlaces.has("湖州"));
  assert.ok(journeyPlaces.has("黄州"));

  assert.equal(result.references.status, "available");
  assert.equal(result.references.sources.every((source) => source.available), true);
  assert.equal(result.references.journeyByPlace.huzhou?.[0]?.title, "湖州任上被召赴狱");
  assert.ok((result.references.worksByPlace.huzhou?.length ?? 0) >= 7);
  assert.ok(result.references.worksByPlace.huzhou?.every((work) => work.sourceIds.length > 0));
  assert.ok(result.references.worksByPlace.huangzhou?.some((work) => work.title === "赤壁赋"));
  assert.deepEqual(
    result.references.worksByPlace.huangzhou?.find((work) => work.title === "初到黄州")?.text,
    [
      "自笑平生为口忙，老来事业转荒唐。",
      "长江绕郭知鱼美，好竹连山觉笋香。",
    ],
  );
  const yellowTower = result.references.worksByPlace.xuzhou?.find(
    (work) => work.title === "九日黄楼作",
  );
  assert.equal(yellowTower?.text.length, 12);
  assert.equal(yellowTower?.eventId, "su-shi-xining-xuzhou-flood");
  assert.equal(yellowTower?.certainty, "verified");
  assert.equal(yellowTower?.text.at(-1), "一杯相属君勿辞，此景何殊泛清霅。");
  const personNames = new Map(result.draft.entities.people.map((person) => [person.id, person.name]));
  const textBackedPairs = result.draft.volumes.social.edges
    .map((edge) => [personNames.get(edge.sourcePersonId), personNames.get(edge.targetPersonId)].join("—"))
    .sort();
  assert.deepEqual(textBackedPairs, ["苏轼—苏辙", "苏轼—黄庭坚"].sort());
  assert.deepEqual(
    result.references.socialEdges.map((edge) => edge.targetName).sort(),
    ["苏辙", "黄庭坚"].sort(),
  );
  assert.ok(result.references.socialEdges.every((edge) => edge.sourceIds.includes("cbdb-20260718")));

  const poemAuthors = new Map(result.draft.entities.works.map((work) => [work.id, work.authorPersonId]));
  assert.ok(result.draft.volumes.poemWorld.items.every((item) => poemAuthors.get(item.workId) === "su-shi"));
  assert.ok(result.draft.volumes.social.edges.every((edge) => edge.sourcePersonId === "su-shi" || edge.targetPersonId === "su-shi"));
  assert.equal(result.validation.valid, true);
});

test("CBDB never creates a private social relation from a bare person mention", async () => {
  const [people, places, works, events, workPlaceLinks, corpusWorks, social] = await Promise.all([
    loadJson("people.json"),
    loadJson("places.json"),
    loadJson("works.json"),
    loadJson("events.json"),
    loadJson("work-place-links.json"),
    loadJson("corpus/su-shi.json"),
    loadJson("poet-social/su-shi.json"),
  ]);
  const text = "本书提到苏轼、苏辙与黄庭坚的名字。";
  const result = await analyzeBook({
    text,
    fileName: "cbdb-name-only-regression.txt",
    bookTitle: "CBDB 关系准入回归测试稿",
    poetName: "苏轼",
    fileSha256: await sha256Hex(text),
    catalogs: {
      people,
      places,
      works,
      reference: { events, workPlaceLinks, corpusWorks, social },
    },
  });

  assert.deepEqual(result.draft.volumes.social.edges, []);
  assert.deepEqual(result.references.socialEdges, []);
});
