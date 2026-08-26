import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_POEM_WORLD_PLACE_ID,
  DEFAULT_POEM_WORLD_SPOTLIGHT_ZOOM,
  HUANGHELOU_SPOTLIGHT,
  poemWorldSpotlightFor,
  selectPoemWorldDefaultPlaceId,
} from "../lib/poem-world-spotlight.ts";

const places = [
  { id: "changan", name: "长安" },
  { id: "huanghelou", name: "黄鹤楼" },
  { id: "jiangxia", name: "江夏" },
];

test("poem-world opens at Yellow Crane Tower for the unfiltered overview", () => {
  const counts = new Map([
    ["changan", 443],
    ["huanghelou", 37],
  ]);

  assert.equal(
    selectPoemWorldDefaultPlaceId(places, counts, ""),
    DEFAULT_POEM_WORLD_PLACE_ID,
  );
  assert.equal(DEFAULT_POEM_WORLD_SPOTLIGHT_ZOOM, 4);
});

test("poem-world retains a useful data-driven default when a poet is selected", () => {
  const counts = new Map([
    ["changan", 5],
    ["huanghelou", 2],
  ]);

  assert.equal(
    selectPoemWorldDefaultPlaceId(places, counts, "li-bai"),
    "changan",
  );
});

test("Yellow Crane Tower spotlight keeps the curated reading order and link", () => {
  assert.equal(poemWorldSpotlightFor("huanghelou", ""), HUANGHELOU_SPOTLIGHT);
  assert.equal(poemWorldSpotlightFor("huanghelou", "li-bai"), undefined);
  assert.deepEqual(
    HUANGHELOU_SPOTLIGHT.works.map((work) => [work.personName, work.title]),
    [
      ["崔颢", "黄鹤楼"],
      ["李白", "黄鹤楼送孟浩然之广陵"],
    ],
  );
  assert.match(HUANGHELOU_SPOTLIGHT.introduction, /李白.*崔颢.*自愧不如/);
  assert.match(HUANGHELOU_SPOTLIGHT.introduction, /隔着多年的时空/);
  assert.equal(
    HUANGHELOU_SPOTLIGHT.works[1].workId,
    "li-bai-huanghelou-song-meng-haoran",
  );
  assert.equal(
    HUANGHELOU_SPOTLIGHT.works[0].sourceRefs[0].reviewState,
    "candidate-preview",
  );
  assert.equal(
    HUANGHELOU_SPOTLIGHT.works[1].sourceRefs[0].reviewState,
    "published",
  );
});
