import type { SocialEdge } from "./book-agent";

export type MergedPrivateSocialEdge = SocialEdge & {
  sourceEdgeIds: string[];
};

function pairKey(edge: Pick<SocialEdge, "sourcePersonId" | "targetPersonId">) {
  return edge.sourcePersonId < edge.targetPersonId
    ? `${edge.sourcePersonId}|${edge.targetPersonId}`
    : `${edge.targetPersonId}|${edge.sourcePersonId}`;
}

function union<T>(left: readonly T[], right: readonly T[]): T[] {
  return [...new Set([...left, ...right])];
}

/**
 * One visual relationship represents one unordered pair of people. Multiple
 * admitted passages may support that pair, so their relation, story, and
 * evidence ids are retained together instead of drawing overlapping lines.
 */
export function mergePrivateSocialEdges(
  edges: readonly SocialEdge[],
): MergedPrivateSocialEdge[] {
  const merged = new Map<string, MergedPrivateSocialEdge>();
  for (const edge of edges) {
    const key = pairKey(edge);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        ...edge,
        relationTypes: [...edge.relationTypes],
        placeIds: [...edge.placeIds],
        workIds: [...edge.workIds],
        storyIds: [...edge.storyIds],
        evidenceIds: [...edge.evidenceIds],
        sourceEdgeIds: [edge.id],
      });
      continue;
    }
    current.relationTypes = union(current.relationTypes, edge.relationTypes);
    current.placeIds = union(current.placeIds, edge.placeIds);
    current.workIds = union(current.workIds, edge.workIds);
    current.storyIds = union(current.storyIds, edge.storyIds);
    current.evidenceIds = union(current.evidenceIds, edge.evidenceIds);
    current.sourceEdgeIds = union(current.sourceEdgeIds, [edge.id]);
    current.time ??= edge.time;
  }
  return [...merged.values()];
}
