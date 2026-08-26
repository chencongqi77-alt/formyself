/**
 * Keep the social graph legible without removing any admitted relationship.
 * Direct ties to the focal poet form the quiet overview. Source-backed ties
 * among those people are disclosed only when one of their endpoints is in
 * focus, where the reader can follow them without crossing the whole map.
 */
export type SocialGraphVisibilityEdge = Readonly<{
  source: string;
  target: string;
}>;

export function visibleSocialGraphEdges<
  TEdge extends SocialGraphVisibilityEdge,
>(
  edges: readonly TEdge[],
  {
    anchorId,
    revealNodeId = "",
  }: {
    anchorId: string;
    revealNodeId?: string;
  },
): TEdge[] {
  return edges.filter(
    (edge) =>
      edge.source === anchorId ||
      edge.target === anchorId ||
      (Boolean(revealNodeId) &&
        (edge.source === revealNodeId || edge.target === revealNodeId)),
  );
}
