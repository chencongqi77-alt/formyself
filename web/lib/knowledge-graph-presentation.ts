export type KnowledgeGraphCluster =
  | "kin"
  | "learning"
  | "literary"
  | "reception"
  | "other";

type PositionedKnowledgeNode = {
  id: string;
  name: string;
  degree: number;
  x: number;
  y: number;
};

type KnowledgeGraphGeometryNode = {
  name: string;
  x: number;
  y: number;
  isAnchor: boolean;
};

/**
 * Position cards with the same stable knowledge-graph composition used by
 * the social reader. The caller supplies only an editorial display cluster;
 * this helper neither reads nor infers any relationship data.
 */
export function arrangeKnowledgeGraph<TNode extends PositionedKnowledgeNode>(
  nodes: TNode[],
  {
    anchorId,
    width,
    height,
    clusterForNode,
  }: {
    anchorId: string;
    width: number;
    height: number;
    clusterForNode: (node: TNode) => KnowledgeGraphCluster;
  },
): void {
  const scaleX = width / 1600;
  const scaleY = height / 1000;
  const anchor = nodes.find((node) => node.id === anchorId);
  if (anchor) {
    anchor.x = 740 * scaleX;
    anchor.y = 520 * scaleY;
  }

  const clusterAnchors: Record<KnowledgeGraphCluster, { x: number; y: number }> = {
    kin: { x: 380 * scaleX, y: 650 * scaleY },
    learning: { x: 750 * scaleX, y: 205 * scaleY },
    literary: { x: 1180 * scaleX, y: 380 * scaleY },
    reception: { x: 1080 * scaleX, y: 760 * scaleY },
    other: { x: 360 * scaleX, y: 245 * scaleY },
  };
  const clusters = new Map<KnowledgeGraphCluster, TNode[]>();

  for (const node of nodes) {
    if (node.id === anchorId) continue;
    const cluster = clusterForNode(node);
    const group = clusters.get(cluster);
    if (group) group.push(node);
    else clusters.set(cluster, [node]);
  }

  for (const [cluster, group] of clusters) {
    const position = clusterAnchors[cluster];
    const ordered = [...group].sort(
      (left, right) =>
        right.degree - left.degree || left.name.localeCompare(right.name, "zh-CN"),
    );
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(ordered.length))));
    const rows = Math.ceil(ordered.length / columns);
    ordered.forEach((node, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      node.x = position.x + (column - (columns - 1) / 2) * 148 * scaleX;
      node.y = position.y + (row - (rows - 1) / 2) * 86 * scaleY;
    });
  }
}

export function knowledgeGraphCardSize(name: string) {
  return {
    width: Math.max(84, [...name].length * 22 + 28),
    height: 44,
  };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function connectionPoint(
  node: KnowledgeGraphGeometryNode,
  towardX: number,
  towardY: number,
): { x: number; y: number } {
  const dx = towardX - node.x;
  const dy = towardY - node.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  if (node.isAnchor) {
    return {
      x: node.x + (dx / distance) * 52,
      y: node.y + (dy / distance) * 52,
    };
  }

  const { width, height } = knowledgeGraphCardSize(node.name);
  const scale =
    1 / Math.max(Math.abs(dx) / (width / 2), Math.abs(dy) / (height / 2));
  return { x: node.x + dx * scale, y: node.y + dy * scale };
}

/** Return the shared card-to-card curve and its readable label position. */
export function knowledgeGraphLinkGeometry(
  id: string,
  sourceNode: KnowledgeGraphGeometryNode,
  targetNode: KnowledgeGraphGeometryNode,
): { path: string; labelX: number; labelY: number } {
  const source = connectionPoint(sourceNode, targetNode.x, targetNode.y);
  const target = connectionPoint(targetNode, sourceNode.x, sourceNode.y);
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const bend = 20 + (stableHash(id) % 20);
  const direction = stableHash(`${id}:curve`) % 2 === 0 ? 1 : -1;
  const controlX = (source.x + target.x) / 2 + (-dy / distance) * bend * direction;
  const controlY = (source.y + target.y) / 2 + (dx / distance) * bend * direction;
  const labelT = sourceNode.isAnchor ? 0.72 : targetNode.isAnchor ? 0.28 : 0.54;
  const inverseT = 1 - labelT;

  return {
    path: `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`,
    labelX:
      inverseT * inverseT * source.x +
      2 * inverseT * labelT * controlX +
      labelT * labelT * target.x,
    labelY:
      inverseT * inverseT * source.y +
      2 * inverseT * labelT * controlY +
      labelT * labelT * target.y,
  };
}

/** Return a direct card-to-card link while keeping endpoints outside each card. */
export function knowledgeGraphStraightLinkGeometry(
  sourceNode: KnowledgeGraphGeometryNode,
  targetNode: KnowledgeGraphGeometryNode,
): { path: string; labelX: number; labelY: number } {
  const source = connectionPoint(sourceNode, targetNode.x, targetNode.y);
  const target = connectionPoint(targetNode, sourceNode.x, sourceNode.y);

  return {
    path: `M ${source.x} ${source.y} L ${target.x} ${target.y}`,
    labelX: (source.x + target.x) / 2,
    labelY: (source.y + target.y) / 2,
  };
}
