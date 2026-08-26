import assert from "node:assert/strict";
import test from "node:test";

import { poemWorldDisplayExcerpt } from "../lib/poem-world-display.ts";

test("poem-world cards prefer the corpus opening line over title-match evidence", () => {
  assert.equal(
    poemWorldDisplayExcerpt({
      workTitle: "张相公出镇荆州寻除太子詹事",
      openingLine: "张衡殊不乐，应有四愁诗。",
      excerpt: "张相公出镇荆州寻除太子詹事",
    }),
    "张衡殊不乐，应有四愁诗。",
  );
});

test("poem-world cards never repeat a title as if it were a poem line", () => {
  assert.equal(
    poemWorldDisplayExcerpt({
      workTitle: "黄鹤楼",
      excerpt: "黄鹤楼",
    }),
    "",
  );
  assert.equal(
    poemWorldDisplayExcerpt({
      workTitle: "题黄鹤楼",
      excerpt: "黄鹤楼前月满川。",
    }),
    "黄鹤楼前月满川。",
  );
});
