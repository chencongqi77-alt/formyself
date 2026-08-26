import rawReadingSamples from "../public/data/reading-samples.json" with { type: "json" };

export type ReadingReviewStatus = "candidate-preview" | "published";

export type ReadingLocator = {
  kind: string;
  path: string;
  startLine?: number;
  endLine?: number;
  recordId?: string;
};

export type ReadingEvidence = {
  id: string;
  sourceId: string;
  locator: ReadingLocator;
  purpose: string;
  reviewStatus: ReadingReviewStatus;
};

export type ReadingAnchorRef = {
  type: "person" | "place" | "work" | "event";
  id: string;
};

export type ReadingStoryCard = {
  id: string;
  kind: "journey" | "place" | "relationship";
  claimType: "fact" | "tradition" | "interpretation";
  eyebrow?: string;
  title: string;
  summary: string;
  paragraphs?: string[];
  disclaimer?: string;
  anchorRefs: ReadingAnchorRef[];
  evidenceIds: string[];
  reviewStatus: ReadingReviewStatus;
};

export type ReadingSamplePerson = {
  id: string;
  name: string;
  reviewStatus: ReadingReviewStatus;
};

export type ReadingSampleWork = {
  id: string;
  personId: string;
  title: string;
  genre: string;
  text: string[];
  evidenceIds: string[];
  reviewStatus: ReadingReviewStatus;
};

export type ReadingPoemWorldWorkRef = {
  workId: string;
  contextLabel: string;
  evidenceIds?: string[];
};

export type ReadingPoemWorldSpotlight = {
  id: string;
  placeId: string;
  storyIds: string[];
  works: ReadingPoemWorldWorkRef[];
};

export type ReadingRelationshipWorkReference = {
  id: string;
  title: string;
  summary: string;
  sourceStatus: "approved-source" | "corpus-reference";
  workIds: string[];
  evidenceIds?: string[];
};

export type ReadingRelationshipSample = {
  pairIds: [string, string];
  edgeId: string;
  storyIds: string[];
  readerSummary: string;
  workReferences: ReadingRelationshipWorkReference[];
};

export type ReadingSamplesPayload = {
  schemaVersion: string;
  recordType: string;
  reviewStatus: ReadingReviewStatus;
  notes: string[];
  evidence: ReadingEvidence[];
  entities: {
    people: ReadingSamplePerson[];
    works: ReadingSampleWork[];
  };
  storyCards: ReadingStoryCard[];
  views: {
    journey: {
      eventStoryIds: Record<string, string[]>;
    };
    poemWorld: {
      spotlights: ReadingPoemWorldSpotlight[];
    };
    social: {
      relationships: ReadingRelationshipSample[];
    };
  };
};

export const readingSamples = rawReadingSamples as unknown as ReadingSamplesPayload;

export function storyCardsForIds(
  storyIds: readonly string[],
  payload: ReadingSamplesPayload = readingSamples,
): ReadingStoryCard[] {
  const cardsById = new Map(payload.storyCards.map((story) => [story.id, story]));
  return storyIds.flatMap((storyId) => {
    const story = cardsById.get(storyId);
    return story ? [story] : [];
  });
}

export function evidenceForIds(
  evidenceIds: readonly string[],
  payload: ReadingSamplesPayload = readingSamples,
): ReadingEvidence[] {
  const evidenceById = new Map(payload.evidence.map((item) => [item.id, item]));
  return evidenceIds.flatMap((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    return evidence ? [evidence] : [];
  });
}

export function sampleWorkForId(
  workId: string,
  payload: ReadingSamplesPayload = readingSamples,
): ReadingSampleWork | undefined {
  return payload.entities.works.find((work) => work.id === workId);
}
