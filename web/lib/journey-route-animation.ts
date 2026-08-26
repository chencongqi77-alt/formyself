export type JourneyRouteEventPoint = Readonly<{
  id: string;
  placeId: string;
}>;

export type JourneyRoutePlacePoint = Readonly<{
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}>;

export type JourneyRouteStop = Readonly<{
  eventId: string;
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
}>;

export type JourneyRouteLeg = Readonly<{
  from: JourneyRouteStop;
  to: JourneyRouteStop;
}>;

/** Build every mappable journey node in event order, including later revisits. */
export function journeyRouteStops(
  events: readonly JourneyRouteEventPoint[],
  places: readonly JourneyRoutePlacePoint[],
): JourneyRouteStop[] {
  const placeById = new Map(
    places
      .filter(
        (place) =>
          Number.isFinite(place.latitude) && Number.isFinite(place.longitude),
      )
      .map((place) => [place.id, place]),
  );

  return events.flatMap((event) => {
    const place = placeById.get(event.placeId);
    return place
      ? [
          {
            eventId: event.id,
            placeId: place.id,
            name: place.name,
            latitude: place.latitude,
            longitude: place.longitude,
          },
        ]
      : [];
  });
}

/**
 * Build the visible route in event order. A numbered map station represents a
 * place, so later events at a place that is already on the route do not create
 * a second stop with the same number.
 */
export function distinctJourneyRouteStops(
  events: readonly JourneyRouteEventPoint[],
  places: readonly JourneyRoutePlacePoint[],
): JourneyRouteStop[] {
  const seenPlaceIds = new Set<string>();
  return journeyRouteStops(events, places).filter((stop) => {
    if (seenPlaceIds.has(stop.placeId)) return false;
    seenPlaceIds.add(stop.placeId);
    return true;
  });
}

/** Return the first segment for callers that only need a route preview. */
export function firstDistinctJourneyLeg(
  events: readonly JourneyRouteEventPoint[],
  places: readonly JourneyRoutePlacePoint[],
): JourneyRouteLeg | null {
  const stops = distinctJourneyRouteStops(events, places);
  return stops.length > 1 ? { from: stops[0], to: stops[1] } : null;
}
