import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataRoot = new URL("../public/data/", import.meta.url);
const corpusPeople = [
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
];

async function loadJson(path) {
  return JSON.parse(await readFile(new URL(path, dataRoot), "utf8"));
}

async function loadAllWorks() {
  const curated = await loadJson("works.json");
  const corpusGroups = await Promise.all(
    corpusPeople.map((personId) => loadJson(`corpus/${personId}.json`)),
  );
  return [...curated, ...corpusGroups.flat()];
}

test("published work-place links are traceable and reference real records", async () => {
  const [links, works, places, events, sources, corpusSource] = await Promise.all([
    loadJson("work-place-links.json"),
    loadAllWorks(),
    loadJson("places.json"),
    loadJson("events.json"),
    loadJson("sources.json"),
    loadJson("corpus/source.json"),
  ]);

  const workById = new Map(works.map((work) => [work.id, work]));
  const placeById = new Map(places.map((place) => [place.id, place]));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const sourceIds = new Set([...sources, corpusSource].map((source) => source.id));
  const linkIds = new Set();
  const linkedWorkPlaceRelations = new Set();
  const relationTypes = new Set([
    "composed-at",
    "inscribed-at",
    "describes-place",
    "mentioned-place",
  ]);

  assert.ok(links.length >= 50, "the published catalogue must retain the initial batch");

  for (const link of links) {
    assert.ok(!linkIds.has(link.id), `duplicate link id: ${link.id}`);
    linkIds.add(link.id);
    const relationKey = `${link.workId}\u001f${link.placeId}\u001f${link.relationType}`;
    assert.ok(
      !linkedWorkPlaceRelations.has(relationKey),
      `duplicate work/place/relation: ${relationKey}`,
    );
    linkedWorkPlaceRelations.add(relationKey);

    const work = workById.get(link.workId);
    assert.ok(work, `missing work: ${link.workId}`);
    assert.equal(work.personId, link.personId);
    assert.ok(placeById.has(link.placeId), `missing place: ${link.placeId}`);
    assert.ok(relationTypes.has(link.relationType), `invalid relation: ${link.relationType}`);
    assert.ok(["verified", "probable"].includes(link.certainty));
    assert.equal(link.reviewStatus, "published");
    assert.ok(link.note.trim());
    assert.ok(Array.isArray(link.sourceRefs) && link.sourceRefs.length > 0);

    for (const reference of link.sourceRefs) {
      assert.ok(sourceIds.has(reference.sourceId), `missing source: ${reference.sourceId}`);
      assert.ok(reference.locator?.kind);
      assert.ok(reference.purpose?.trim());
    }

    if (link.eventId) {
      const event = eventById.get(link.eventId);
      assert.ok(event, `missing event: ${link.eventId}`);
      assert.equal(event.personId, link.personId);
      assert.equal(event.placeId, link.placeId);
      assert.ok(
        link.relationType === "composed-at" || link.relationType === "inscribed-at",
        "event links are reserved for creation or inscription relationships",
      );
    }
  }

  const linksByPerson = Object.fromEntries(
    corpusPeople.map((personId) => [
      personId,
      links.filter((link) => link.personId === personId).length,
    ]),
  );
  const initialMinimums = {
    "su-shi": 13,
    "du-fu": 13,
    "li-bai": 14,
    "xin-qiji": 10,
    "cao-cao": 0,
    "li-qingzhao": 0,
    "lu-you": 0,
    "wang-an-shi": 0,
    "ou-yang-xiu": 0,
    "huang-ting-jian": 0,
    "qin-guan": 0,
    "yang-wan-li": 0,
  };
  for (const [personId, minimum] of Object.entries(initialMinimums)) {
    assert.ok(
      linksByPerson[personId] >= minimum,
      `${personId} should retain every initial published link`,
    );
  }
});

test("known life-stage associations are not presented as works written at that place", async () => {
  const [links, works, events] = await Promise.all([
    loadJson("work-place-links.json"),
    loadJson("works.json"),
    loadJson("events.json"),
  ]);
  const forbiddenPairs = new Set([
    "du-fu-xin-an-li:tonggu",
    "du-fu-shi-hao-li:tonggu",
    "du-fu-xin-hun-bie:tonggu",
    "su-shi-liuyue-ershi-ye-duhai:danzhou",
  ]);

  for (const link of links) {
    assert.ok(
      !forbiddenPairs.has(`${link.workId}:${link.placeId}`),
      `misleading place link returned: ${link.workId}:${link.placeId}`,
    );
  }

  for (const work of works.filter((item) => forbiddenPairs.has(`${item.id}:tonggu`) ||
    forbiddenPairs.has(`${item.id}:danzhou`))) {
    assert.ok(!work.placeIds?.length, `${work.id} must not claim a composition place`);
    assert.ok(!work.eventIds?.length, `${work.id} must not claim a composition event`);
  }

  assert.deepEqual(
    events.find((event) => event.id === "du-fu-qianyuan-tonggu")?.workIds,
    [],
  );
  assert.deepEqual(
    events.find((event) => event.id === "su-shi-shaosheng-danzhou-exile")?.workIds,
    [],
  );
});

test("famous works expose explicit composition and subject distinctions", async () => {
  const links = await loadJson("work-place-links.json");
  const byWorkId = new Map(links.map((link) => [link.workId, link]));

  assert.deepEqual(
    {
      placeId: byWorkId.get("corpus-su-shi-7836c1286f092172")?.placeId,
      relationType: byWorkId.get("corpus-su-shi-7836c1286f092172")?.relationType,
    },
    { placeId: "mizhou", relationType: "composed-at" },
  );
  assert.deepEqual(
    {
      placeId: byWorkId.get("corpus-du-fu-5d05fef6-e4aa-48e5-917d-c29d0e6d6b33")
        ?.placeId,
      relationType: byWorkId.get(
        "corpus-du-fu-5d05fef6-e4aa-48e5-917d-c29d0e6d6b33",
      )?.relationType,
    },
    { placeId: "yueyang", relationType: "composed-at" },
  );
  assert.equal(
    byWorkId.get("corpus-li-bai-4838bc46-446b-44cb-8296-29eed12cf343")
      ?.relationType,
    "describes-place",
  );
  assert.equal(
    byWorkId.get("xin-qiji-yong-yu-le-jingkou-beigu-ting-huai-gu")
      ?.relationType,
    "describes-place",
  );
});
