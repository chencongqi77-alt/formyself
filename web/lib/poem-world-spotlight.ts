import curatedWorks from "../public/data/works.json" with { type: "json" };
import curatedPeople from "../public/data/people.json" with { type: "json" };

import {
  evidenceForIds,
  readingSamples,
  sampleWorkForId,
  storyCardsForIds,
  type ReadingLocator,
  type ReadingSamplesPayload,
} from "./reading-samples.ts";

export const DEFAULT_POEM_WORLD_PLACE_ID = "huanghelou";
// Keep the first view at a national scale: the selected tower remains a clear
// anchor, while the surrounding poetry geography and cluster density stay in
// view.
export const DEFAULT_POEM_WORLD_SPOTLIGHT_ZOOM = 4;

type PoemWorldPlaceLike = {
  id: string;
  name: string;
};

type SourceReference = {
  sourceId: string;
  locator: string;
  reviewState: "published" | "candidate-preview";
};

type CuratedWork = {
  id: string;
  personId: string;
  title: string;
  genre: string;
  text: string[];
  sourceRefs?: {
    sourceId: string;
    locator: ReadingLocator;
  }[];
};

type CuratedPerson = {
  id: string;
  name: string;
};

export type PoemWorldSpotlightWork = {
  id: string;
  workId?: string;
  personId: string;
  personName: string;
  title: string;
  genre: string;
  contextLabel: string;
  lines: readonly string[];
  sourceRefs: readonly SourceReference[];
};

export type PoemWorldSpotlight = {
  placeId: string;
  storyIds: readonly string[];
  introduction: string;
  traditionNotice: string;
  works: readonly PoemWorldSpotlightWork[];
};

const curatedWorkRecords = curatedWorks as unknown as CuratedWork[];
const curatedPersonRecords = curatedPeople as unknown as CuratedPerson[];

function locatorText(locator: ReadingLocator): string {
  if (locator.recordId) return `${locator.path}#/${locator.recordId}`;
  if (locator.startLine === undefined || locator.endLine === undefined) {
    return locator.path;
  }
  return `${locator.path}:${locator.startLine}-${locator.endLine}`;
}

function sourceRefsFromEvidenceIds(
  evidenceIds: readonly string[],
  payload: ReadingSamplesPayload,
): SourceReference[] {
  return evidenceForIds(evidenceIds, payload).map((evidence) => ({
    sourceId: evidence.sourceId,
    locator: locatorText(evidence.locator),
    reviewState: evidence.reviewStatus,
  }));
}

function sourceRefsFromCuratedWork(work: CuratedWork): SourceReference[] {
  return (work.sourceRefs ?? []).map((sourceRef) => ({
    sourceId: sourceRef.sourceId,
    locator: locatorText(sourceRef.locator),
    reviewState: "published",
  }));
}

function personNameFor(
  personId: string,
  payload: ReadingSamplesPayload,
): string {
  return (
    payload.entities.people.find((person) => person.id === personId)?.name ??
    curatedPersonRecords.find((person) => person.id === personId)?.name ??
    personId
  );
}

function buildSpotlight(
  spotlight: ReadingSamplesPayload["views"]["poemWorld"]["spotlights"][number],
  payload: ReadingSamplesPayload,
): PoemWorldSpotlight {
  const story = storyCardsForIds(spotlight.storyIds, payload)[0];
  const works = spotlight.works.flatMap((workRef) => {
    const sampleWork = sampleWorkForId(workRef.workId, payload);
    const curatedWork = curatedWorkRecords.find(
      (work) => work.id === workRef.workId,
    );
    const work = sampleWork ?? curatedWork;
    if (!work) return [];

    const isPublishedWork = Boolean(curatedWork);
    return [
      {
        id: work.id,
        workId: isPublishedWork ? work.id : undefined,
        personId: work.personId,
        personName: personNameFor(work.personId, payload),
        title: work.title,
        genre: work.genre,
        contextLabel: workRef.contextLabel,
        lines: work.text,
        sourceRefs: workRef.evidenceIds?.length
          ? sourceRefsFromEvidenceIds(workRef.evidenceIds, payload)
          : sampleWork
            ? sourceRefsFromEvidenceIds(sampleWork.evidenceIds, payload)
            : sourceRefsFromCuratedWork(curatedWork),
      },
    ];
  });

  return {
    placeId: spotlight.placeId,
    storyIds: spotlight.storyIds,
    introduction:
      story?.summary ?? "这里的作品与地点故事正在整理中。",
    traditionNotice: story?.disclaimer ?? "",
    works,
  };
}

export const HUANGHELOU_SPOTLIGHT: PoemWorldSpotlight = buildSpotlight(
  readingSamples.views.poemWorld.spotlights.find(
    (spotlight) => spotlight.placeId === DEFAULT_POEM_WORLD_PLACE_ID,
  ) ?? {
    id: "spotlight-huanghelou",
    placeId: DEFAULT_POEM_WORLD_PLACE_ID,
    storyIds: [],
    works: [],
  },
  readingSamples,
);

export function selectPoemWorldDefaultPlaceId(
  places: readonly PoemWorldPlaceLike[],
  placeWorkCounts: ReadonlyMap<string, number>,
  personId: string,
): string {
  if (!personId && places.some((place) => place.id === DEFAULT_POEM_WORLD_PLACE_ID)) {
    return DEFAULT_POEM_WORLD_PLACE_ID;
  }

  let selectedPlace: PoemWorldPlaceLike | undefined;
  let selectedCount = 0;

  for (const place of places) {
    const count = placeWorkCounts.get(place.id) ?? 0;
    if (
      count > 0 &&
      (!selectedPlace ||
        count > selectedCount ||
        (count === selectedCount &&
          place.name.localeCompare(selectedPlace.name, "zh-CN") < 0))
    ) {
      selectedPlace = place;
      selectedCount = count;
    }
  }

  return selectedPlace?.id ?? "";
}

export function poemWorldSpotlightFor(
  placeId: string,
  personId: string,
  payload: ReadingSamplesPayload = readingSamples,
): PoemWorldSpotlight | undefined {
  if (personId) return undefined;
  const spotlight = payload.views.poemWorld.spotlights.find(
    (item) => item.placeId === placeId,
  );
  if (payload === readingSamples && placeId === DEFAULT_POEM_WORLD_PLACE_ID) {
    return HUANGHELOU_SPOTLIGHT;
  }
  return spotlight ? buildSpotlight(spotlight, payload) : undefined;
}
