/**
 * Visual scale for poem-world map markers. Counts are intentionally compressed
 * logarithmically: a prolific place should stand out without covering nearby
 * places or the base map.
 */
export type PoemWorldMarkerKind = "place" | "cluster";

export type PoemWorldMarkerVisual = Readonly<{
  density: number;
  diameter: number;
  radius: number;
  lightness: number;
  fillColor: string;
  borderColor: string;
  labelColor: string;
}>;

const markerDiameters: Record<
  PoemWorldMarkerKind,
  Readonly<{ min: number; max: number }>
> = {
  // Individual places remain deliberately small, even at the densest end of
  // the scale, so nearby place names and map labels remain legible.
  place: { min: 11.5, max: 22 },
  // Overview clusters need room for the existing place-count label, but must
  // still leave the geographic context visible.
  cluster: { min: 24, max: 38 },
};

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Return a compact, light-green visual whose area and depth both increase with
 * the number of works. `maximumWorkCount` is the current filtered view's
 * reference value, so switching poets keeps smaller distributions readable.
 */
export function poemWorldMarkerVisual(
  workCount: number,
  maximumWorkCount: number,
  kind: PoemWorldMarkerKind = "place",
): PoemWorldMarkerVisual {
  const maximum = Math.max(1, nonNegativeFinite(maximumWorkCount));
  const boundedCount = Math.min(maximum, nonNegativeFinite(workCount));
  const density = Math.log1p(boundedCount) / Math.log1p(maximum);
  const range = markerDiameters[kind];
  const diameter = range.min + (range.max - range.min) * density;
  // The palette deliberately stays in the light-green family. Greater density
  // lowers lightness rather than changing hue, so the meaning is consistent.
  const lightness = 84 - density * 28;

  return {
    density,
    diameter,
    radius: diameter / 2,
    lightness,
    fillColor: `hsl(145 38% ${lightness.toFixed(1)}%)`,
    borderColor: `hsl(145 31% ${Math.max(36, lightness - 20).toFixed(1)}%)`,
    labelColor: density >= 0.45 ? "#fffdf7" : "#174e39",
  };
}
