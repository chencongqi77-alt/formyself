import {
  evidenceForIds,
  readingSamples,
  type ReadingSamplesPayload,
} from "./reading-samples.ts";

/**
 * Reader-only relationship materials.
 *
 * The social graph remains the source of relationship edges. These cards are
 * a separate, evidence-linked reading layer generated from the shared sample
 * bundle, so a story card never creates a new graph edge by itself.
 */

export type RelationshipReadingSourceRef = {
  sourceId: string;
  purpose?: string;
  locator: {
    path: string;
    startLine: number;
    endLine: number;
  };
};

export type RelationshipStoryReference = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  paragraphs: string[];
  sourceRefs: RelationshipReadingSourceRef[];
};

export type RelationshipWorkReference = {
  id: string;
  title: string;
  summary: string;
  sourceStatus: "approved-source" | "corpus-reference";
  workIds: string[];
  sourceRefs?: RelationshipReadingSourceRef[];
};

export type RelationshipReadingCollection = {
  pairIds: readonly [string, string];
  readerSummary: string;
  storyReferences: RelationshipStoryReference[];
  workReferences: RelationshipWorkReference[];
};

function sourceRefsForEvidenceIds(
  evidenceIds: readonly string[],
  payload: ReadingSamplesPayload,
): RelationshipReadingSourceRef[] {
  return evidenceForIds(evidenceIds, payload).flatMap((evidence) => {
    const { startLine, endLine } = evidence.locator;
    if (startLine === undefined || endLine === undefined) return [];
    return [
      {
        sourceId: evidence.sourceId,
        purpose: evidence.purpose,
        locator: {
          path: evidence.locator.path,
          startLine,
          endLine,
        },
      },
    ];
  });
}

export function relationshipReadingCollection(
  firstPersonId: string,
  secondPersonId: string,
  payload: ReadingSamplesPayload = readingSamples,
): RelationshipReadingCollection | null {
  const sample = payload.views.social.relationships.find((relationship) => {
    const [left, right] = relationship.pairIds;
    return (
      (left === firstPersonId && right === secondPersonId) ||
      (left === secondPersonId && right === firstPersonId)
    );
  });

  if (!sample) return null;

  const storyCardsById = new Map(
    payload.storyCards.map((story) => [story.id, story]),
  );
  const storyReferences = sample.storyIds.flatMap((storyId) => {
    const story = storyCardsById.get(storyId);
    if (!story) return [];
    return [
      {
        id: story.id,
        eyebrow: story.eyebrow ?? "交游线索",
        title: story.title,
        summary: story.summary,
        paragraphs: story.paragraphs ?? [],
        sourceRefs: sourceRefsForEvidenceIds(story.evidenceIds, payload),
      },
    ];
  });

  return {
    pairIds: sample.pairIds,
    readerSummary: sample.readerSummary,
    storyReferences,
    workReferences: sample.workReferences.map((reference) => ({
      id: reference.id,
      title: reference.title,
      summary: reference.summary,
      sourceStatus: reference.sourceStatus,
      workIds: reference.workIds,
      sourceRefs: reference.evidenceIds?.length
        ? sourceRefsForEvidenceIds(reference.evidenceIds, payload)
        : undefined,
    })),
  };
}

export function relationshipDetailHref(anchorId: string, edgeId: string): string {
  return `/social/${encodeURIComponent(anchorId)}/relationships/${encodeURIComponent(edgeId)}`;
}

export function socialRelationshipHref(personId: string): string {
  return `/social?person=${encodeURIComponent(personId)}`;
}

export function socialWorkReadingHref(workId: string, personId: string): string {
  const params = new URLSearchParams({ from: "social", person: personId });
  return `/works/${encodeURIComponent(workId)}?${params.toString()}`;
}
