import assert from "node:assert/strict";
import test from "node:test";

import {
  distinctJourneyRouteStops,
  firstDistinctJourneyLeg,
  journeyRouteStops,
} from "../lib/journey-route-animation.ts";

test("journey route keeps later visits to the same mapped place", () => {
  const stops = journeyRouteStops(
    [
      { id: "event-1", placeId: "hangzhou" },
      { id: "event-2", placeId: "xuzhou" },
      { id: "event-3", placeId: "hangzhou" },
      { id: "event-4", placeId: "missing" },
    ],
    [
      { id: "hangzhou", name: "杭州", latitude: 30.27, longitude: 120.15 },
      { id: "xuzhou", name: "徐州", latitude: 34.26, longitude: 117.2 },
    ],
  );

  assert.deepEqual(
    stops.map((stop) => [stop.placeId, stop.eventId]),
    [
      ["hangzhou", "event-1"],
      ["xuzhou", "event-2"],
      ["hangzhou", "event-3"],
    ],
  );
});

test("journey route includes every mappable place once in event order", () => {
  const stops = distinctJourneyRouteStops(
    [
      { id: "event-1", placeId: "hangzhou" },
      { id: "event-2", placeId: "taian" },
      { id: "event-3", placeId: "hangzhou" },
      { id: "event-4", placeId: "xuzhou" },
      { id: "event-5", placeId: "missing" },
    ],
    [
      { id: "hangzhou", name: "杭州", latitude: 30.27, longitude: 120.15 },
      { id: "taian", name: "泰安", latitude: 36.2, longitude: 117.12 },
      { id: "xuzhou", name: "徐州", latitude: 34.26, longitude: 117.2 },
    ],
  );

  assert.deepEqual(
    stops.map((stop) => [stop.placeId, stop.eventId]),
    [
      ["hangzhou", "event-1"],
      ["taian", "event-2"],
      ["xuzhou", "event-4"],
    ],
  );
});

test("first journey preview leg skips repeated events at station one", () => {
  const leg = firstDistinctJourneyLeg(
    [
      { id: "event-1", placeId: "hangzhou" },
      { id: "event-2", placeId: "hangzhou" },
      { id: "event-3", placeId: "taian" },
      { id: "event-4", placeId: "xuzhou" },
    ],
    [
      { id: "hangzhou", name: "杭州", latitude: 30.27, longitude: 120.15 },
      { id: "taian", name: "泰安", latitude: 36.2, longitude: 117.12 },
      { id: "xuzhou", name: "徐州", latitude: 34.26, longitude: 117.2 },
    ],
  );

  assert.deepEqual(leg, {
    from: {
      eventId: "event-1",
      placeId: "hangzhou",
      name: "杭州",
      latitude: 30.27,
      longitude: 120.15,
    },
    to: {
      eventId: "event-3",
      placeId: "taian",
      name: "泰安",
      latitude: 36.2,
      longitude: 117.12,
    },
  });
});

test("first journey preview leg ignores missing and invalid coordinates", () => {
  const leg = firstDistinctJourneyLeg(
    [
      { id: "event-missing", placeId: "missing" },
      { id: "event-invalid", placeId: "invalid" },
      { id: "event-1", placeId: "one" },
      { id: "event-2", placeId: "two" },
    ],
    [
      { id: "invalid", name: "待考", latitude: Number.NaN, longitude: 1 },
      { id: "one", name: "一站", latitude: 30, longitude: 120 },
      { id: "two", name: "二站", latitude: 31, longitude: 121 },
    ],
  );

  assert.equal(leg?.from.placeId, "one");
  assert.equal(leg?.to.placeId, "two");
});

test("first journey preview leg is unavailable with fewer than two places", () => {
  assert.equal(
    firstDistinctJourneyLeg(
      [{ id: "event-1", placeId: "one" }],
      [{ id: "one", name: "一站", latitude: 30, longitude: 120 }],
    ),
    null,
  );
});
