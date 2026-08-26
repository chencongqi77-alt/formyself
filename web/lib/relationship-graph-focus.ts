/**
 * The minimal graph contract needed to calculate transient relationship focus.
 * Domain adapters keep their evidence payloads; this module only coordinates
 * ids so every poetry graph reader behaves the same way.
 */
export type RelationshipGraphFocusEdge = Readonly<{
  id: string;
  source: string;
  target: string;
}>;

export type RelationshipGraphFocusInput = Readonly<{
  edges: readonly RelationshipGraphFocusEdge[];
  hoverNodeId?: string | null;
  hoverEdgeId?: string | null;
  selectedNodeId?: string | null;
}>;

export type RelationshipGraphFocus = Readonly<{
  /** A pointer/focus hover takes precedence over a persistent selection. */
  focusNodeId: string;
  /** Edges incident to the active node; empty when no node is active. */
  highlightedEdgeIds: ReadonlySet<string>;
  /** Labels are deliberately transient, matching the established social graph. */
  labelEdgeIds: ReadonlySet<string>;
}>;

function presentId(value: string | null | undefined): string {
  return value ?? "";
}

function incidentEdgeIds(
  edges: readonly RelationshipGraphFocusEdge[],
  nodeId: string,
): Set<string> {
  if (!nodeId) return new Set<string>();
  return new Set(
    edges
      .filter((edge) => edge.source === nodeId || edge.target === nodeId)
      .map((edge) => edge.id),
  );
}

/**
 * Preserve the interaction semantics of the established social graph:
 *
 * - hover a node: focus that node and reveal labels for all of its incident edges;
 * - hover an edge: reveal only that edge's label;
 * - leave the pointer: retain a clicked node as visual focus, but do not leave
 *   relation labels open.
 */
export function deriveRelationshipGraphFocus({
  edges,
  hoverNodeId,
  hoverEdgeId,
  selectedNodeId,
}: RelationshipGraphFocusInput): RelationshipGraphFocus {
  const hoveredNodeId = presentId(hoverNodeId);
  const hoveredEdgeId = presentId(hoverEdgeId);
  const focusNodeId = hoveredNodeId || presentId(selectedNodeId);

  return {
    focusNodeId,
    highlightedEdgeIds: incidentEdgeIds(edges, focusNodeId),
    labelEdgeIds: hoveredEdgeId
      ? new Set([hoveredEdgeId])
      : incidentEdgeIds(edges, hoveredNodeId),
  };
}
