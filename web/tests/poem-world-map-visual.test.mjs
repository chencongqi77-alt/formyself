import assert from "node:assert/strict";
import test from "node:test";

import { TILE_PROVIDERS } from "../lib/mapTileLayers.ts";
import { poemWorldMarkerVisual } from "../lib/poem-world-map-visual.ts";

test("poem-world markers grow and deepen with related-work density", () => {
  const low = poemWorldMarkerVisual(1, 443);
  const middle = poemWorldMarkerVisual(26, 443);
  const high = poemWorldMarkerVisual(443, 443);

  assert.ok(low.radius < middle.radius);
  assert.ok(middle.radius < high.radius);
  assert.ok(low.lightness > middle.lightness);
  assert.ok(middle.lightness > high.lightness);
  assert.match(low.fillColor, /^hsl\(145 38% /);
  assert.ok(high.diameter <= 22);
});

test("poem-world overview clusters stay circularly compact at extreme counts", () => {
  const empty = poemWorldMarkerVisual(0, 443, "cluster");
  const maximum = poemWorldMarkerVisual(443, 443, "cluster");
  const capped = poemWorldMarkerVisual(100_000, 443, "cluster");

  assert.ok(empty.diameter < maximum.diameter);
  assert.equal(maximum.diameter, capped.diameter);
  assert.equal(maximum.lightness, capped.lightness);
  assert.ok(maximum.diameter <= 38);
});

test("raster map fallback keeps provider place labels visible", () => {
  const carto = TILE_PROVIDERS.find((provider) => provider.id === "carto");

  assert.ok(carto);
  assert.match(carto.url, /\/voyager\//);
  assert.doesNotMatch(carto.url, /voyager_nolabels/);
});
