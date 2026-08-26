import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const corpusRoot = new URL("../public/data/corpus/", import.meta.url);
const people = [
  "su-shi",
  "du-fu",
  "li-bai",
  "xin-qiji",
  "cao-cao",
  "li-qingzhao",
  "lu-you",
  "wang-an-shi",
  "ou-yang-xiu",
  "huang-ting-jian",
  "qin-guan",
  "yang-wan-li",
  "fan-cheng-da",
  "zhou-bang-yan",
  "su-zhe",
  "yan-shu",
  "lin-bu",
  "zhang-xiao-xiang",
  "wen-tian-xiang",
  "bai-ju-yi",
  "wang-wei",
  "du-mu",
  "li-shang-yin",
  "meng-hao-ran",
  "wang-chang-ling",
  "gao-shi",
  "li-he",
];

async function loadJson(name) {
  return JSON.parse(await readFile(new URL(name, corpusRoot), "utf8"));
}

test("poet corpus index exposes the complete reference library", async () => {
  const index = await loadJson("index.json");
  const corePeople = people.slice(0, 12);

  const indexTotal = Object.values(index.people).reduce(
    (sum, person) => sum + person.total,
    0,
  );
  assert.equal(index.total, indexTotal);
  assert.ok(index.total >= 26404);
  assert.deepEqual(
    Object.fromEntries(
      corePeople.map((personId) => [personId, index.people[personId].total]),
    ),
    {
      "su-shi": 3186,
      "du-fu": 1489,
      "li-bai": 1207,
      "xin-qiji": 783,
      "cao-cao": 26,
      "li-qingzhao": 86,
      "lu-you": 9416,
      "wang-an-shi": 1769,
      "ou-yang-xiu": 1196,
      "huang-ting-jian": 2396,
      "qin-guan": 558,
      "yang-wan-li": 4292,
    },
  );
  assert.equal(index.source.license, "MIT");
  for (const personId of people) {
    assert.ok(
      index.people[personId]?.name,
      `${personId} should have a name in the corpus index`,
    );
    assert.ok(
      index.people[personId].total > 0,
      `${personId} corpus should not be empty`,
    );
  }
});

test("corpus records are searchable, traceable, and never invent map links", async () => {
  const allIds = new Set();
  const index = await loadJson("index.json");

  for (const personId of people) {
    const works = await loadJson(`${personId}.json`);
    assert.equal(
      works.length,
      index.people[personId].total,
      `${personId} corpus should match the published index total`,
    );

    for (const work of works) {
      assert.equal(work.personId, personId);
      assert.ok(work.id.startsWith(`corpus-${personId}-`));
      assert.ok(!allIds.has(work.id), `duplicate corpus id: ${work.id}`);
      allIds.add(work.id);

      assert.ok(work.title.trim());
      assert.ok(Array.isArray(work.text) && work.text.length > 0);
      assert.ok(work.text.every((line) => typeof line === "string" && line.trim()));
      assert.equal(work.libraryStatus, "corpus");
      assert.equal(work.sourceRecord?.sourceId, "chinese-poetry");
      assert.ok(work.sourceRecord?.file);
      assert.ok(work.sourceRecord?.recordId);
      assert.equal(work.placeIds, undefined);
      assert.equal(work.eventIds, undefined);
    }
  }

  assert.equal(allIds.size, index.total);
});

test("well-known works are present in the generated index", async () => {
  const expectations = {
    "su-shi": ["水调歌头", "念奴娇", "题西林壁"],
    "du-fu": ["望岳", "春夜喜雨", "登高"],
    "li-bai": ["静夜思", "将进酒", "蜀道难"],
    "xin-qiji": ["青玉案", "永遇乐", "破阵子"],
    "cao-cao": ["观沧海", "龟虽寿", "短歌行"],
    "li-qingzhao": ["如梦令", "声声慢", "醉花阴"],
    "lu-you": ["游山西村", "示儿", "书愤"],
    "wang-an-shi": ["泊船瓜洲", "元日", "登飞来峰"],
    "ou-yang-xiu": ["蝶恋花", "生查子", "采桑子"],
    "huang-ting-jian": ["清平乐", "寄黄几复", "登快阁"],
    "qin-guan": ["鹊桥仙", "踏莎行", "浣溪沙"],
    "yang-wan-li": ["小池", "晓出浄慈送林子方", "宿新市徐公店"],
  };

  for (const [personId, terms] of Object.entries(expectations)) {
    const works = await loadJson(`${personId}.json`);
    for (const term of terms) {
      assert.ok(
        works.some((work) => work.title.includes(term)),
        `${personId} corpus should contain ${term}`,
      );
    }
  }
});

test("featured long-form works retain complete readable text", async () => {
  const worksUrl = new URL("../public/data/works.json", import.meta.url);
  const works = JSON.parse(await readFile(worksUrl, "utf8"));

  for (const [id, expectedOpening] of [
    ["su-shi-chibi-fu", "壬戌之秋"],
    ["su-shi-hou-chibi-fu", "是岁十月之望"],
  ]) {
    const work = works.find((item) => item.id === id);
    assert.equal(work?.isFullText, true, `${id} should be marked as full text`);
    assert.ok(work.text.length >= 10, `${id} should not be reduced to a short excerpt`);
    assert.match(work.text.join(""), new RegExp(expectedOpening));
  }
});
