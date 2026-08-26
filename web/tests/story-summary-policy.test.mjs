import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  countPlaceIntroCharacters,
  countStorySummaryCharacters,
  getPlaceIntroStatus,
  getStorySummaryStatus,
  placeIntroPolicy,
  storySummaryPolicy,
} from "../lib/story-summary-policy.mjs";

const events = JSON.parse(
  await readFile(new URL("../public/data/events.json", import.meta.url), "utf8"),
);
const places = JSON.parse(
  await readFile(new URL("../public/data/places.json", import.meta.url), "utf8"),
);

test("story summary policy has an ordered target range", () => {
  assert.ok(storySummaryPolicy.hardMin < storySummaryPolicy.targetMin);
  assert.ok(storySummaryPolicy.targetMin <= storySummaryPolicy.targetMax);
  assert.ok(storySummaryPolicy.targetMax < storySummaryPolicy.hardMax);
});

test("existing story summaries remain inside the hard content boundary", () => {
  for (const event of events) {
    const length = countStorySummaryCharacters(event.summary);
    const status = getStorySummaryStatus(event.summary);

    assert.ok(
      length >= storySummaryPolicy.hardMin && length <= storySummaryPolicy.hardMax,
      `${event.id} has ${length} effective characters (${status})`,
    );
    assert.equal(status, "on-target", `${event.id} should use the display target range`);
  }
});

test("place introductions remain inside the page-zero display range", () => {
  for (const place of places) {
    const length = countPlaceIntroCharacters(place.intro);
    const status = getPlaceIntroStatus(place.intro);

    assert.ok(
      length >= placeIntroPolicy.hardMin && length <= placeIntroPolicy.hardMax,
      `${place.id} has ${length} effective characters (${status})`,
    );
    assert.equal(status, "on-target", `${place.id} should use the display target range`);
  }
});
