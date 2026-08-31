"use client";

import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";

import type { BookAnalysisResult } from "../../lib/book-agent";
import {
  DEFAULT_GRAPH_SCOPE,
  deriveBookAgentGraphView,
  type BookAgentGraphEntityKind,
  type BookAgentGraphSubgraph,
} from "../../lib/book-agent-graph-policy";
import type { RelationshipAssessment, VerificationStatus } from "../../lib/book-agent-verification";
import styles from "../agent.module.css";

type GraphNodeKind = BookAgentGraphEntityKind;

type GraphNode = {
  id: string;
  label: string;
  kind: GraphNodeKind;
  x: number;
  y: number;
  hiddenRelationCount: number;
  compact: boolean;
  isFocus: boolean;
  timeLabel?: string;
  firstYear?: number;
};

type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  status: VerificationStatus;
  assessmentIds: string[];
  primaryAssessmentId: string | null;
  occurrenceCount: number;
};

const GRAPH_WIDTH = 840;
const GRAPH_HEIGHT = 600;
const GRAPH_CONTENT_CENTER_X = GRAPH_WIDTH / 2;
const GRAPH_CONTENT_CENTER_Y = GRAPH_HEIGHT / 2;
const EXPANDED_GRAPH_GROUP_LIMIT = 10;
const EXPANDED_GRAPH_NODE_LIMIT = 11;

const STATUS_LABELS: Record<VerificationStatus, string> = {
  confirmed: "已确认",
  pending: "待审核",
  conflict: "冲突",
  "low-confidence": "低可信",
};

const SUBGRAPH_TABS: Array<{ id: BookAgentGraphSubgraph; label: string }> = [
  { id: "overview", label: "综合图谱" },
  { id: "journey", label: "人物—地点" },
  { id: "social", label: "人物—人物" },
  { id: "poemWorld", label: "作品—地点" },
];

const NODE_KIND_LABELS: Record<GraphNodeKind, string> = {
  person: "人物",
  place: "地点",
  work: "作品",
};

const NODE_KIND_RANK: Record<GraphNodeKind, number> = {
  person: 0,
  place: 1,
  work: 2,
};

function compactLabel(label: string, limit: number): string {
  const clean = label.replace(/^《|》$/g, "");
  return clean.length > limit ? clean.slice(0, limit) + "…" : clean;
}

function spreadBetween(count: number, start: number, end: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(start + end) / 2];
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
}

function distributeColumn(
  nodes: Array<Omit<GraphNode, "x" | "y">>,
  x: number,
  top: number,
  bottom: number,
): GraphNode[] {
  const positions = spreadBetween(nodes.length, top, bottom);
  return nodes.map((node, index) => ({ ...node, x, y: positions[index], compact: nodes.length > 5 }));
}

function orbitPositions(
  count: number,
  radiusX = 270,
  radiusY = 210,
): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  const startAngle = count <= 2 ? 0 : -Math.PI / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = startAngle + (Math.PI * 2 * index) / count;
    return {
      x: GRAPH_CONTENT_CENTER_X + Math.cos(angle) * radiusX,
      y: GRAPH_CONTENT_CENTER_Y + Math.sin(angle) * radiusY,
    };
  });
}

function positionOverviewNodes(
  nodes: Array<Omit<GraphNode, "x" | "y">>,
  focusPersonId: string,
): GraphNode[] {
  const focus = nodes.find((node) => node.id === focusPersonId);
  const people = nodes.filter((node) => node.kind === "person" && node.id !== focusPersonId);
  const places = nodes.filter((node) => node.kind === "place");
  const works = nodes.filter((node) => node.kind === "work");
  const surrounding = [...people, ...places, ...works];
  const positions = orbitPositions(surrounding.length);
  const compactByKind: Record<GraphNodeKind, boolean> = {
    person: people.length > 4,
    place: places.length > 4,
    work: works.length > 2,
  };

  return [
    ...(focus ? [{ ...focus, x: GRAPH_CONTENT_CENTER_X, y: GRAPH_CONTENT_CENTER_Y, compact: false }] : []),
    ...surrounding.map((node, index) => ({
      ...node,
      ...positions[index],
      compact: compactByKind[node.kind],
    })),
  ];
}

function positionJourneyNodes(
  nodes: Array<Omit<GraphNode, "x" | "y">>,
  focusPersonId: string,
): GraphNode[] {
  const focus = nodes.find((node) => node.id === focusPersonId);
  const places = nodes
    .filter((node) => node.kind === "place")
    .sort((left, right) => (left.firstYear ?? Number.MAX_SAFE_INTEGER) - (right.firstYear ?? Number.MAX_SAFE_INTEGER));
  const others = nodes.filter((node) => node.kind !== "place" && node.id !== focusPersonId);
  const placePositions = orbitPositions(places.length);
  return [
    ...(focus ? [{ ...focus, x: GRAPH_CONTENT_CENTER_X, y: GRAPH_CONTENT_CENTER_Y, compact: false }] : []),
    ...places.map((node, index) => ({
      ...node,
      ...placePositions[index],
      compact: places.length > 6,
    })),
    ...distributeColumn(others, 110, 430, 530).map((node) => ({ ...node, compact: true })),
  ];
}

function positionSocialNodes(
  nodes: Array<Omit<GraphNode, "x" | "y">>,
  focusPersonId: string,
): GraphNode[] {
  const focus = nodes.find((node) => node.id === focusPersonId);
  const people = nodes.filter((node) => node.kind === "person" && node.id !== focusPersonId);
  const positions = orbitPositions(people.length);
  return [
    ...(focus ? [{ ...focus, x: GRAPH_CONTENT_CENTER_X, y: GRAPH_CONTENT_CENTER_Y, compact: false }] : []),
    ...people.map((node, index) => {
      return {
        ...node,
        ...positions[index],
        compact: people.length > 7,
      };
    }),
  ];
}

function positionPoemWorldNodes(nodes: Array<Omit<GraphNode, "x" | "y">>): GraphNode[] {
  const works = nodes.filter((node) => node.kind === "work");
  const places = nodes.filter((node) => node.kind === "place");
  const people = nodes.filter((node) => node.kind === "person");
  return [
    ...distributeColumn(works, 235, 105, 500),
    ...distributeColumn(places, 545, 105, 500),
    ...distributeColumn(people, 88, 180, 420).map((node) => ({ ...node, compact: true })),
  ];
}

function positionNodes(
  nodes: Array<Omit<GraphNode, "x" | "y">>,
  subgraph: BookAgentGraphSubgraph,
  focusPersonId: string,
): GraphNode[] {
  if (subgraph === "journey") return positionJourneyNodes(nodes, focusPersonId);
  if (subgraph === "social") return positionSocialNodes(nodes, focusPersonId);
  if (subgraph === "poemWorld") return positionPoemWorldNodes(nodes);
  return positionOverviewNodes(nodes, focusPersonId);
}

function curveFor(
  source: GraphNode,
  target: GraphNode,
  index: number,
  subgraph: BookAgentGraphSubgraph,
): { path: string; labelX: number; labelY: number } {
  const start = nodeAnchor(source, target);
  const end = nodeAnchor(target, source);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const bend = ((index % 3) - 1) * 14;
  if (subgraph === "journey") {
    const direction = end.y < start.y ? -1 : 1;
    const sourceLane = ((index % 5) - 2) * 5;
    const firstControlX = start.x + Math.max(58, dx * 0.3);
    const secondControlX = end.x - Math.max(48, dx * 0.24);
    return {
      path: `M ${start.x} ${start.y} C ${firstControlX} ${start.y + sourceLane} ${secondControlX} ${end.y} ${end.x} ${end.y}`,
      labelX: start.x + dx * 0.57,
      labelY: start.y + dy * 0.57 - direction * 23,
    };
  }
  if (subgraph === "poemWorld") {
    const firstControlX = start.x + Math.max(90, dx * 0.38);
    const secondControlX = end.x - Math.max(90, dx * 0.38);
    return {
      path: `M ${start.x} ${start.y} C ${firstControlX} ${start.y + bend} ${secondControlX} ${end.y - bend} ${end.x} ${end.y}`,
      labelX: start.x + dx * 0.52,
      labelY: start.y + dy * 0.5 + bend,
    };
  }
  const controlX = start.x + dx / 2 - (Math.abs(dx) < 80 ? 48 : 0);
  const controlY = start.y + dy / 2 + bend;
  return {
    path: `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`,
    labelX: 0.25 * start.x + 0.5 * controlX + 0.25 * end.x,
    labelY: 0.25 * start.y + 0.5 * controlY + 0.25 * end.y,
  };
}

function nodeHalfSize(node: GraphNode): { x: number; y: number } {
  if (node.kind === "person") {
    const radius = node.isFocus ? 44 : node.compact ? 25 : 31;
    return { x: radius, y: radius };
  }
  if (node.kind === "place") return node.compact ? { x: 36, y: 22 } : { x: 48, y: 27 };
  return node.compact ? { x: 61, y: 23 } : { x: 68, y: 27 };
}

function nodeAnchor(node: GraphNode, toward: GraphNode): { x: number; y: number } {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  if (!dx && !dy) return { x: node.x, y: node.y };
  const halfSize = nodeHalfSize(node);
  if (node.kind === "person") {
    const length = Math.hypot(dx, dy);
    return {
      x: node.x + (dx / length) * halfSize.x,
      y: node.y + (dy / length) * halfSize.y,
    };
  }
  const scale = 1 / Math.max(Math.abs(dx) / halfSize.x, Math.abs(dy) / halfSize.y);
  return { x: node.x + dx * scale, y: node.y + dy * scale };
}

function GraphControlIcon({ name }: { name: "plus" | "minus" | "fit" | "focus" }) {
  if (name === "plus" || name === "minus") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="M12.5 12.5 17 17M5.8 8.5h5.4" />
        {name === "plus" ? <path d="M8.5 5.8v5.4" /> : null}
      </svg>
    );
  }
  if (name === "fit") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
        <path d="M7 7h6v6H7z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3a7 7 0 1 1-6.3 4" />
      <path d="M3 3v4h4" />
      <circle cx="10" cy="10" r="2" />
    </svg>
  );
}

function NodeShape({
  node,
  selected,
  active,
  previewed,
  faded,
  onActivate,
  onHoverChange,
  onFocusChange,
}: {
  node: GraphNode;
  selected: boolean;
  active: boolean;
  previewed: boolean;
  faded: boolean;
  onActivate: () => void;
  onHoverChange: (hovered: boolean) => void;
  onFocusChange: (focused: boolean) => void;
}) {
  const kindClass = "graphNode" + node.kind[0].toUpperCase() + node.kind.slice(1);
  const className = [
    styles.graphNode,
    styles[kindClass],
    node.compact ? styles.graphNodeCompact : "",
    node.isFocus ? styles.graphNodeFocus : "",
    selected ? styles.graphNodeSelected : "",
    active ? styles.graphNodeActive : "",
    previewed ? styles.graphNodePreview : "",
    faded ? styles.graphNodeFaded : "",
  ].filter(Boolean).join(" ");
  const actionLabel = node.hiddenRelationCount > 0
    ? `查看相邻关系，另有 ${node.hiddenRelationCount} 条关系可通过展开更多显示`
    : "查看相邻关系";
  const labelY = node.y + 5;
  const halfSize = nodeHalfSize(node);
  const personRadius = halfSize.x;
  const placeHalfWidth = halfSize.x;
  const placeHalfHeight = halfSize.y;
  const workWidth = halfSize.x * 2;
  const workHeight = halfSize.y * 2;
  const onKeyDown = (event: KeyboardEvent<SVGGElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onActivate();
  };
  const commonProps = {
    className,
    "data-node-kind": node.kind,
    "data-node-id": node.id,
    "data-active": active ? "true" : "false",
    role: "button",
    tabIndex: 0,
    "aria-pressed": active,
    "aria-label": node.label + "，" + actionLabel,
    onClick: onActivate,
    onKeyDown,
    onMouseEnter: () => onHoverChange(true),
    onMouseLeave: () => onHoverChange(false),
    onFocus: () => onFocusChange(true),
    onBlur: () => onFocusChange(false),
  };
  const badgeOffset = node.kind === "person"
    ? { x: personRadius * 0.72, y: -personRadius * 0.72 }
    : { x: halfSize.x - 3, y: -halfSize.y + 3 };
  const badge = node.hiddenRelationCount > 0 ? (
    <g className={styles.graphNodeFoldBadge} transform={`translate(${node.x + badgeOffset.x} ${node.y + badgeOffset.y})`} aria-hidden="true">
      <rect x="-17" y="-11" width="34" height="22" rx="11" />
      <text x="0" y="4">+{node.hiddenRelationCount}</text>
    </g>
  ) : null;

  if (node.kind === "person") {
    return (
      <g {...commonProps}>
        <circle className={styles.graphNodeHitArea} cx={node.x} cy={node.y} r={Math.max(personRadius, 36)} />
        <circle cx={node.x} cy={node.y} r={personRadius} />
        <text x={node.x} y={labelY}>{compactLabel(node.label, node.compact ? 3 : 5)}</text>
        {badge}
      </g>
    );
  }
  if (node.kind === "place") {
    return (
      <g {...commonProps}>
        <rect
          className={styles.graphNodeHitArea}
          x={node.x - placeHalfWidth - 5}
          y={node.y - 35}
          width={(placeHalfWidth + 5) * 2}
          height="70"
          rx="35"
        />
        <rect
          x={node.x - placeHalfWidth}
          y={node.y - placeHalfHeight}
          width={placeHalfWidth * 2}
          height={placeHalfHeight * 2}
          rx={placeHalfHeight}
        />
        <text x={node.x} y={labelY}>{compactLabel(node.label, node.compact ? 5 : 6)}</text>
        {badge}
        {node.timeLabel ? <text className={styles.graphNodeTime} x={node.x} y={node.y + placeHalfHeight + 22}>{node.timeLabel}</text> : null}
      </g>
    );
  }
  return (
    <g {...commonProps}>
      <rect
        className={styles.graphNodeHitArea}
        x={node.x - workWidth / 2 - 6}
        y={node.y - Math.max(workHeight + 10, 70) / 2}
        width={workWidth + 12}
        height={Math.max(workHeight + 10, 70)}
        rx="12"
      />
      <rect x={node.x - workWidth / 2} y={node.y - workHeight / 2} width={workWidth} height={workHeight} rx="9" />
      <path
        className={styles.graphWorkBookmarkTail}
        d={`M ${node.x - 10} ${node.y + workHeight / 2 - 1} L ${node.x} ${node.y + workHeight / 2 + 11} L ${node.x + 10} ${node.y + workHeight / 2 - 1} Z`}
      />
      <text x={node.x} y={labelY}>《{compactLabel(node.label, node.compact ? 6 : 8)}》</text>
      {badge}
    </g>
  );
}

function GraphBackdrop({
  subgraph,
  nodes,
}: {
  subgraph: BookAgentGraphSubgraph;
  nodes: GraphNode[];
}) {
  const people = nodes.filter((node) => node.kind === "person" && !node.isFocus);
  const places = nodes
    .filter((node) => node.kind === "place")
    .sort((left, right) => (left.firstYear ?? Number.MAX_SAFE_INTEGER) - (right.firstYear ?? Number.MAX_SAFE_INTEGER));
  const works = nodes.filter((node) => node.kind === "work");
  const titlePosition = (cluster: GraphNode[], fallbackAngle: number): { x: number; y: number } => {
    const vector = cluster.reduce((sum, node) => {
      const dx = node.x - GRAPH_CONTENT_CENTER_X;
      const dy = node.y - GRAPH_CONTENT_CENTER_Y;
      const length = Math.hypot(dx, dy) || 1;
      return { x: sum.x + dx / length, y: sum.y + dy / length };
    }, { x: 0, y: 0 });
    const angle = Math.hypot(vector.x, vector.y) > 0.01 ? Math.atan2(vector.y, vector.x) : fallbackAngle;
    return {
      x: clamp(GRAPH_CONTENT_CENTER_X + Math.cos(angle) * 315, 54, GRAPH_WIDTH - 54),
      y: clamp(GRAPH_CONTENT_CENTER_Y + Math.sin(angle) * 252, 38, GRAPH_HEIGHT - 30),
    };
  };
  const peopleTitle = titlePosition(people, -Math.PI / 2);
  const placeTitle = titlePosition(places, 0);
  const workTitle = titlePosition(works, Math.PI / 2);

  return (
    <g className={styles.graphNarrativeBackdrop} aria-hidden="true">
      {subgraph === "overview" ? (
        <>
          {people.length ? <text className={styles.graphClusterTitle} x={peopleTitle.x} y={peopleTitle.y}>人物</text> : null}
          {places.length ? <text className={styles.graphClusterTitle} x={placeTitle.x} y={placeTitle.y}>地点</text> : null}
          {works.length ? <text className={styles.graphClusterTitle} x={workTitle.x} y={workTitle.y}>作品</text> : null}
        </>
      ) : null}
      {subgraph === "journey" && places.length ? (
        <>
          <ellipse className={styles.graphJourneyGuide} cx={GRAPH_CONTENT_CENTER_X} cy={GRAPH_CONTENT_CENTER_Y} rx="270" ry="210" />
          {places.map((place) => (
            <path key={place.id} className={styles.graphJourneyStem} d={`M ${GRAPH_CONTENT_CENTER_X} ${GRAPH_CONTENT_CENTER_Y} L ${place.x} ${place.y}`} />
          ))}
        </>
      ) : null}
      {subgraph === "social" ? (
        <>
          {nodes.filter((node) => node.kind === "person" && !node.isFocus).length > 3
            ? <ellipse className={styles.graphSocialOrbit} cx={GRAPH_CONTENT_CENTER_X} cy={GRAPH_CONTENT_CENTER_Y} rx="270" ry="210" />
            : null}
        </>
      ) : null}
      {subgraph === "poemWorld" ? (
        <>
          <text className={styles.graphClusterTitle} x="235" y="54">作品</text>
          <text className={styles.graphClusterTitle} x="545" y="54">地点</text>
        </>
      ) : null}
    </g>
  );
}

export function BookAgentKnowledgeGraph({
  result,
  assessments,
  selectedId,
  onSelect,
}: {
  result: BookAnalysisResult;
  assessments: RelationshipAssessment[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [subgraph, setSubgraph] = useState<BookAgentGraphSubgraph>("overview");
  const focusPersonId = result.draft.poet.id;
  const [revealMore, setRevealMore] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [focusedEdgeId, setFocusedEdgeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const assessmentById = useMemo(() => new Map(assessments.map((assessment) => [assessment.id, assessment])), [assessments]);

  const focusEntityIds = useMemo(() => [
    focusPersonId,
    ...result.draft.entities.works.filter((work) => work.authorPersonId === focusPersonId).map((work) => work.id),
  ], [focusPersonId, result.draft.entities.works]);
  const view = useMemo(() => deriveBookAgentGraphView(assessments, {
    scope: DEFAULT_GRAPH_SCOPE,
    subgraph,
    focusEntityIds,
    maxGroups: revealMore ? EXPANDED_GRAPH_GROUP_LIMIT : undefined,
    maxNodes: revealMore ? EXPANDED_GRAPH_NODE_LIMIT : undefined,
  }), [
    assessments,
    focusEntityIds,
    revealMore,
    subgraph,
  ]);

  const graph = useMemo(() => {
    const peopleById = new Map(result.draft.entities.people.map((item) => [item.id, item.name]));
    const visibleRelatedCounts = new Map<string, number>();
    for (const group of view.groups) {
      visibleRelatedCounts.set(group.sourceId, (visibleRelatedCounts.get(group.sourceId) ?? 0) + 1);
      visibleRelatedCounts.set(group.targetId, (visibleRelatedCounts.get(group.targetId) ?? 0) + 1);
    }
    const rawNodes = new Map<string, Omit<GraphNode, "x" | "y">>();
    const addNode = (
      id: string,
      label: string,
      kind: GraphNodeKind,
      time?: { label?: string; firstYear?: number },
    ): void => {
      const previous = rawNodes.get(id);
      if (previous) {
        if (time?.firstYear !== undefined && (previous.firstYear === undefined || time.firstYear < previous.firstYear)) {
          rawNodes.set(id, { ...previous, timeLabel: time.label, firstYear: time.firstYear });
        }
        return;
      }
      rawNodes.set(id, {
        id,
        label,
        kind,
        hiddenRelationCount: Math.max(0, (view.expandableRelationCounts[id] ?? 0) - (visibleRelatedCounts.get(id) ?? 0)),
        compact: false,
        isFocus: id === focusPersonId,
        timeLabel: time?.label,
        firstYear: time?.firstYear,
      });
    };
    for (const group of view.groups) {
      const datedRecords = group.assessmentIds
        .map((id) => assessmentById.get(id))
        .filter((assessment): assessment is RelationshipAssessment => Boolean(assessment))
        .filter((assessment) => assessment.startYear !== undefined || assessment.endYear !== undefined)
        .sort((left, right) => (left.startYear ?? left.endYear ?? Number.MAX_SAFE_INTEGER) - (right.startYear ?? right.endYear ?? Number.MAX_SAFE_INTEGER));
      const timeLabels = [...new Set(datedRecords.map((assessment) => {
        const start = assessment.startYear ?? assessment.endYear;
        const end = assessment.endYear ?? assessment.startYear;
        return start === end ? String(start) : `${start}—${end}`;
      }))];
      const time = datedRecords.length
        ? { label: timeLabels.slice(0, 2).join(" / "), firstYear: datedRecords[0].startYear ?? datedRecords[0].endYear }
        : undefined;
      addNode(group.sourceId, group.sourceLabel, group.sourceEntityType, subgraph === "journey" && group.sourceEntityType === "place" ? time : undefined);
      addNode(group.targetId, group.targetLabel, group.targetEntityType, subgraph === "journey" && group.targetEntityType === "place" ? time : undefined);
    }
    if (subgraph !== "poemWorld" && peopleById.has(focusPersonId)) {
      addNode(focusPersonId, peopleById.get(focusPersonId) ?? focusPersonId, "person");
    }
    const stableRawNodes = [...rawNodes.values()].sort((left, right) => (
      NODE_KIND_RANK[left.kind] - NODE_KIND_RANK[right.kind]
      || left.label.localeCompare(right.label, "zh-CN")
      || left.id.localeCompare(right.id)
    ));
    const nodes = positionNodes(stableRawNodes, subgraph, focusPersonId);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edges: GraphEdge[] = view.groups.map((group) => ({
      id: group.key,
      sourceId: group.sourceId,
      targetId: group.targetId,
      label: group.relationLabel,
      status: group.displayStatus,
      assessmentIds: group.assessmentIds,
      primaryAssessmentId: group.primaryAssessmentId,
      occurrenceCount: group.occurrenceCount,
    }));
    return { nodes, edges, nodeById };
  }, [
    assessmentById,
    focusPersonId,
    result.draft.entities.people,
    subgraph,
    view,
  ]);

  const selectedAssessment = selectedId ? assessmentById.get(selectedId) : undefined;
  const hasVisibleSelection = Boolean(selectedId && view.groups.some((group) => group.assessmentIds.includes(selectedId)));
  const selectedNodeIds = useMemo(
    () => new Set(selectedAssessment && hasVisibleSelection ? [selectedAssessment.sourceId, selectedAssessment.targetId] : []),
    [hasVisibleSelection, selectedAssessment],
  );
  const previewNodeId = hoveredNodeId ?? focusedNodeId;
  const previewEdgeId = hoveredEdgeId ?? focusedEdgeId;
  const previewContext = useMemo(() => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    if (previewEdgeId) {
      const edge = graph.edges.find((candidate) => candidate.id === previewEdgeId);
      if (edge) {
        edgeIds.add(edge.id);
        nodeIds.add(edge.sourceId);
        nodeIds.add(edge.targetId);
      }
      return { nodeIds, edgeIds };
    }
    if (!previewNodeId) return { nodeIds, edgeIds };
    nodeIds.add(previewNodeId);
    for (const edge of graph.edges) {
      if (edge.sourceId !== previewNodeId && edge.targetId !== previewNodeId) continue;
      edgeIds.add(edge.id);
      nodeIds.add(edge.sourceId);
      nodeIds.add(edge.targetId);
    }
    return { nodeIds, edgeIds };
  }, [graph.edges, previewEdgeId, previewNodeId]);
  const hasPreview = previewContext.edgeIds.size > 0 || previewContext.nodeIds.size > 0;
  const activeNode = activeNodeId ? graph.nodeById.get(activeNodeId) : undefined;
  const selectedEdge = selectedId
    ? graph.edges.find((edge) => edge.assessmentIds.includes(selectedId))
    : undefined;
  const selectedEdgeSource = selectedEdge ? graph.nodeById.get(selectedEdge.sourceId) : undefined;
  const selectedEdgeTarget = selectedEdge ? graph.nodeById.get(selectedEdge.targetId) : undefined;
  const activeNodeRelationCount = activeNode
    ? view.expandableRelationCounts[activeNode.id] ?? graph.edges.filter((edge) => edge.sourceId === activeNode.id || edge.targetId === activeNode.id).length
    : 0;
  const assessmentIdForEdge = (edge: GraphEdge): string | null => (
    selectedId && edge.assessmentIds.includes(selectedId) ? selectedId : edge.primaryAssessmentId
  );

  const resetView = (): void => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const focusSelected = (): void => {
    if (!selectedAssessment) return resetView();
    const source = graph.nodeById.get(selectedAssessment.sourceId);
    const target = graph.nodeById.get(selectedAssessment.targetId);
    if (!source || !target) return resetView();
    setZoom(1.12);
    setPan({
      x: GRAPH_CONTENT_CENTER_X - (source.x + target.x) / 2,
      y: GRAPH_HEIGHT / 2 - (source.y + target.y) / 2,
    });
  };

  const activateNode = (node: GraphNode): void => {
    const incidentEdges = graph.edges.filter((edge) => edge.sourceId === node.id || edge.targetId === node.id);
    const currentEdge = incidentEdges.find((edge) => Boolean(selectedId && edge.assessmentIds.includes(selectedId)));
    const nextEdge = currentEdge
      ?? incidentEdges.find((edge) => edge.status !== "confirmed")
      ?? incidentEdges[0];
    const nextAssessmentId = nextEdge ? assessmentIdForEdge(nextEdge) : null;
    if (nextAssessmentId) onSelect(nextAssessmentId);
    setActiveNodeId(node.id);
  };

  const toggleRevealMore = (): void => {
    setRevealMore((current) => !current);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({ x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y });
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>): void => {
    event.preventDefault();
    setZoom((current) => clampZoom(current + (event.deltaY > 0 ? -0.08 : 0.08)));
  };

  const switchSubgraph = (nextSubgraph: BookAgentGraphSubgraph): void => {
    const nextView = deriveBookAgentGraphView(assessments, {
      scope: DEFAULT_GRAPH_SCOPE,
      subgraph: nextSubgraph,
      focusEntityIds,
    });
    const selectedStillVisible = Boolean(selectedId && nextView.groups.some((group) => group.assessmentIds.includes(selectedId)));
    if (!selectedStillVisible) onSelect(nextView.groups[0]?.primaryAssessmentId ?? null);
    setSubgraph(nextSubgraph);
    setRevealMore(false);
    setActiveNodeId(null);
    setHoveredNodeId(null);
    setFocusedNodeId(null);
    setHoveredEdgeId(null);
    setFocusedEdgeId(null);
    resetView();
  };

  return (
    <section className={styles.knowledgeGraphPanel} aria-label="综合关系知识图谱">
      <div className={styles.graphModeTabs} role="tablist" aria-label="知识图谱视图">
        {SUBGRAPH_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`agent-graph-tab-${tab.id}`}
            aria-controls="agent-graph-panel"
            aria-selected={subgraph === tab.id}
            className={subgraph === tab.id ? styles.graphModeTabActive : ""}
            onClick={() => switchSubgraph(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id="agent-graph-panel"
        className={styles.graphCanvasShell}
        data-graph-view={subgraph}
        role="tabpanel"
        aria-labelledby={`agent-graph-tab-${subgraph}`}
      >
        <div className={styles.graphInteractionNote} data-emphasis={activeNode || selectedEdge ? "true" : "false"} aria-live="polite">
          <span>{activeNode ? NODE_KIND_LABELS[activeNode.kind] : selectedEdge ? "当前关系" : "浏览提示"}</span>
          <strong>
            {activeNode
              ? activeNode.label
              : selectedEdge && selectedEdgeSource && selectedEdgeTarget
                ? `${selectedEdgeSource.label} · ${selectedEdge.label} · ${selectedEdgeTarget.label}`
                : SUBGRAPH_TABS.find((tab) => tab.id === subgraph)?.label}
          </strong>
          <small>
            {activeNode
              ? `${activeNodeRelationCount} 条相关关系${revealMore ? " · 已展开更多" : " · 点击连线查看核验"}`
              : selectedEdge
                ? "点击连线查看核验，悬停节点预览关联"
                : "点击节点聚焦，点击连线查看核验"}
          </small>
        </div>

        <div className={styles.graphControls} role="group" aria-label="图谱视图控制">
          <button type="button" onClick={() => setZoom((current) => clampZoom(current + 0.1))} aria-label="放大图谱"><GraphControlIcon name="plus" /></button>
          <button type="button" onClick={() => setZoom((current) => clampZoom(current - 0.1))} aria-label="缩小图谱"><GraphControlIcon name="minus" /></button>
          <button type="button" onClick={resetView} aria-label="适应画布"><GraphControlIcon name="fit" /></button>
          <button type="button" onClick={focusSelected} aria-label="回到当前关系"><GraphControlIcon name="focus" /></button>
        </div>

        <svg
          className={styles.knowledgeGraphSvg}
          viewBox={"0 0 " + GRAPH_WIDTH + " " + GRAPH_HEIGHT}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label={(SUBGRAPH_TABS.find((tab) => tab.id === subgraph)?.label ?? "知识图谱") + "，当前显示 " + graph.nodes.length + " 个实体、" + view.groups.length + " 组关系"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <defs>
            <marker id="agent-graph-arrow-confirmed" markerWidth="7" markerHeight="7" refX="6.5" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
              <path className={styles.graphArrowConfirmed} d="M0 0 7 3.5 0 7Z" />
            </marker>
            <marker id="agent-graph-arrow-alert" markerWidth="7" markerHeight="7" refX="6.5" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
              <path className={styles.graphArrowAlert} d="M0 0 7 3.5 0 7Z" />
            </marker>
          </defs>
          <g transform={"translate(" + pan.x + " " + pan.y + ") translate(" + GRAPH_CONTENT_CENTER_X + " " + GRAPH_HEIGHT / 2 + ") scale(" + zoom + ") translate(" + -GRAPH_CONTENT_CENTER_X + " " + -GRAPH_HEIGHT / 2 + ")"}>
            <GraphBackdrop subgraph={subgraph} nodes={graph.nodes} />
            {graph.edges.map((edge, index) => {
              const source = graph.nodeById.get(edge.sourceId);
              const target = graph.nodeById.get(edge.targetId);
              if (!source || !target) return null;
              const curve = curveFor(source, target, index, subgraph);
              const selected = Boolean(selectedId && edge.assessmentIds.includes(selectedId));
              const previewed = previewContext.edgeIds.has(edge.id);
              const faded = hasPreview ? !previewed : Boolean(hasVisibleSelection && !selected);
              const arrowMarkerId = selected || edge.status !== "confirmed"
                ? "agent-graph-arrow-alert"
                : "agent-graph-arrow-confirmed";
              const statusClass = "graphEdge" + edge.status.replace(/(^|-)([a-z])/g, (_match, _dash, letter: string) => letter.toUpperCase());
              const edgeClass = [
                styles.graphEdge,
                styles[statusClass],
                selected ? styles.graphEdgeSelected : "",
                previewed ? styles.graphEdgePreview : "",
                faded ? styles.graphEdgeFaded : "",
              ].filter(Boolean).join(" ");
              const activate = (): void => {
                const nextAssessmentId = assessmentIdForEdge(edge);
                if (nextAssessmentId) {
                  setActiveNodeId(null);
                  onSelect(nextAssessmentId);
                }
              };
              const onKeyDown = (event: KeyboardEvent<SVGGElement>): void => {
                if (!assessmentIdForEdge(edge) || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                activate();
              };
              const labelWidth = Math.max(52, Math.min(126, edge.label.length * 14 + 22));
              return (
                <g
                  key={edge.id}
                  className={edgeClass}
                  data-relation-id={edge.id}
                  data-relation-count={edge.occurrenceCount}
                  data-selected={selected ? "true" : "false"}
                  role={edge.primaryAssessmentId ? "button" : undefined}
                  tabIndex={edge.primaryAssessmentId ? 0 : undefined}
                  aria-pressed={edge.primaryAssessmentId ? selected : undefined}
                  aria-label={(edge.occurrenceCount > 1 ? `${edge.label}，重复 ${edge.occurrenceCount} 次` : edge.label) + "，" + STATUS_LABELS[edge.status] + (edge.primaryAssessmentId ? "，点击查看证据" : "")}
                  onClick={(event) => {
                    event.stopPropagation();
                    activate();
                  }}
                  onKeyDown={onKeyDown}
                  onMouseEnter={() => setHoveredEdgeId(edge.id)}
                  onMouseLeave={() => setHoveredEdgeId(null)}
                  onFocus={() => setFocusedEdgeId(edge.id)}
                  onBlur={() => setFocusedEdgeId(null)}
                >
                  <path className={styles.graphEdgeHitArea} d={curve.path} />
                  {edge.status === "conflict" ? <path className={styles.graphEdgeConflictUnderlay} d={curve.path} /> : null}
                  <path className={styles.graphEdgeLine} d={curve.path} markerEnd={`url(#${arrowMarkerId})`} />
                  <g className={styles.graphEdgeLabelGroup}>
                    <rect className={styles.graphEdgeLabelBackground} x={curve.labelX - labelWidth / 2} y={curve.labelY - 14} width={labelWidth} height="28" rx="14" />
                    <text className={styles.graphEdgeLabel} x={curve.labelX} y={curve.labelY + 5}>{compactLabel(edge.label, 8)}</text>
                    {edge.occurrenceCount > 1 ? (
                      <g className={styles.graphEdgeCountBadge} transform={`translate(${curve.labelX + labelWidth / 2 + 19} ${curve.labelY})`}>
                        <rect x="-16" y="-12" width="32" height="24" rx="12" />
                        <text x="0" y="5">×{edge.occurrenceCount}</text>
                      </g>
                    ) : null}
                  </g>
                </g>
              );
            })}
            {graph.nodes.map((node) => (
              <NodeShape
                key={node.id}
                node={node}
                selected={selectedNodeIds.has(node.id)}
                active={activeNodeId === node.id}
                previewed={previewContext.nodeIds.has(node.id)}
                faded={hasPreview
                  ? !previewContext.nodeIds.has(node.id)
                  : Boolean(hasVisibleSelection && !selectedNodeIds.has(node.id) && activeNodeId !== node.id)}
                onActivate={() => activateNode(node)}
                onHoverChange={(hovered) => setHoveredNodeId(hovered ? node.id : null)}
                onFocusChange={(focused) => setFocusedNodeId(focused ? node.id : null)}
              />
            ))}
          </g>
        </svg>

        {view.hiddenByDensityCount > 0 || revealMore ? (
          <button
            type="button"
            className={styles.graphFoldButton}
            data-expanded={revealMore ? "true" : "false"}
            aria-expanded={revealMore}
            onClick={toggleRevealMore}
          >
            <span>{revealMore ? `已显示 ${view.groups.length} / ${view.totalGroupCount}` : `+${view.hiddenByDensityCount} 条关系`}</span>
            <small>{revealMore ? "收起" : "展开更多"}</small>
          </button>
        ) : null}

        {!view.groups.length ? (
          <div className={styles.graphEmptyState}>
            <strong>当前子图没有可显示关系</strong>
            <p>可切换上方图谱类型查看其他关系。</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function clampZoom(value: number): number {
  return clamp(value, 0.78, 1.35);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
