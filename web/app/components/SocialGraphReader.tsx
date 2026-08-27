"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  arrangeKnowledgeGraph,
  knowledgeGraphCardSize,
  knowledgeGraphStraightLinkGeometry,
  type KnowledgeGraphCluster,
} from "../../lib/knowledge-graph-presentation";
import { deriveRelationshipGraphFocus } from "../../lib/relationship-graph-focus";
import { visibleSocialGraphEdges } from "../../lib/social-graph-visibility";
import { GraphZoomControls } from "./GraphZoomControls";
import type {
  RelationshipStoryLink,
  RelationshipStoryPerson,
} from "./RelationshipStoryPanel";
import { SocialGraphStage } from "./ReadingModuleTemplate";

export type SocialGraphReaderNode = RelationshipStoryPerson & {
  cluster: KnowledgeGraphCluster;
  searchDescription?: string;
};

export type SocialGraphReaderEdge = RelationshipStoryLink;

type PositionedNode = SocialGraphReaderNode & {
  x: number;
  y: number;
};

type ReaderSelection = {
  selectedPerson: SocialGraphReaderNode | null;
  selectedEdgeId: string;
  relationships: SocialGraphReaderEdge[];
  peopleById: ReadonlyMap<string, SocialGraphReaderNode>;
  close: () => void;
};

type SocialGraphReaderProps = {
  anchorId: string;
  anchorName: string;
  nodes: readonly SocialGraphReaderNode[];
  edges: readonly SocialGraphReaderEdge[];
  bucketLabels: Readonly<Record<string, string>>;
  bucketOrder?: readonly string[];
  graphAriaLabel?: string;
  directoryAriaLabel?: string;
  searchAriaLabel?: string;
  provenance: ReactNode;
  renderInspector: (selection: ReaderSelection) => ReactNode;
};

const VIEW_WIDTH = 1600;
const VIEW_HEIGHT = 1000;
const VIEW_CENTER_X = VIEW_WIDTH / 2;
const VIEW_CENTER_Y = VIEW_HEIGHT / 2;

const DEFAULT_BUCKET_ORDER = [
  "kin",
  "teacher-student",
  "fellow-student",
  "friend",
  "friendship",
  "patron",
  "opponent",
  "literary-exchange",
  "colleague",
  "official",
  "admirer",
  "wrote-about",
  "undetermined",
  "other",
];

const BUCKET_COLORS: Record<string, string> = {
  friend: "#176b69",
  friendship: "#176b69",
  "fellow-student": "#3d7a5f",
  "teacher-student": "#a33a2c",
  kin: "#b0793a",
  patron: "#8a7a2f",
  opponent: "#6e4a56",
  admirer: "#4d6f9e",
  "literary-exchange": "#2f6d77",
  "wrote-about": "#7a6a2f",
  colleague: "#58718a",
  official: "#58718a",
  undetermined: "#8a8a8a",
  other: "#9a9a9a",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function primaryBucket(
  edge: Pick<SocialGraphReaderEdge, "displayBuckets">,
  bucketOrder: readonly string[],
): string {
  return (
    bucketOrder.find((bucket) => edge.displayBuckets.includes(bucket)) ??
    edge.displayBuckets[0] ??
    "other"
  );
}

function dominantBucket(
  edges: readonly SocialGraphReaderEdge[],
  personId: string,
  bucketOrder: readonly string[],
): string {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.source !== personId && edge.target !== personId) continue;
    for (const bucket of edge.displayBuckets) {
      const count = edge.bucketCounts[bucket] ?? 1;
      counts.set(bucket, (counts.get(bucket) ?? 0) + count);
    }
  }
  return (
    [...counts.entries()].sort(
      ([leftBucket, leftCount], [rightBucket, rightCount]) =>
        rightCount - leftCount ||
        bucketOrder.indexOf(leftBucket) - bucketOrder.indexOf(rightBucket),
    )[0]?.[0] ?? "other"
  );
}

function relationshipLabel(
  edge: SocialGraphReaderEdge,
  bucketLabels: Readonly<Record<string, string>>,
  bucketOrder: readonly string[],
): string {
  const bucket = primaryBucket(edge, bucketOrder);
  const label = bucketLabels[bucket] ?? bucket;
  const remaining = Math.max(0, edge.displayBuckets.length - 1);
  return remaining ? `${label} +${remaining}` : label;
}

function chooseReadingPerson(edge: SocialGraphReaderEdge, anchorId: string): string {
  if (edge.source === anchorId) return edge.target;
  if (edge.target === anchorId) return edge.source;
  return edge.source;
}

/**
 * The one presentation template for both the published social reader and the
 * Agent workbench preview. Callers adapt evidence-backed domain records into
 * nodes and edges; this component owns every graph UI and interaction detail.
 */
export function SocialGraphReader({
  anchorId,
  anchorName,
  nodes,
  edges,
  bucketLabels,
  bucketOrder = DEFAULT_BUCKET_ORDER,
  graphAriaLabel = `${anchorName}交游圈知识图谱`,
  directoryAriaLabel = "交游人物列表",
  searchAriaLabel = "搜索人物姓名",
  provenance,
  renderInspector,
}: SocialGraphReaderProps) {
  const [selectedNodeId, setSelectedNodeId] = useState(anchorId);
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [hoveredNodeId, setHoveredNodeId] = useState("");
  const [hoveredEdgeId, setHoveredEdgeId] = useState("");
  const [query, setQuery] = useState("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [, setRenderRevision] = useState(0);

  const graph = useMemo(() => {
    const includedIds = new Set<string>([anchorId]);
    for (const edge of edges) {
      includedIds.add(edge.source);
      includedIds.add(edge.target);
    }
    const positionedNodes: PositionedNode[] = nodes
      .filter((node) => includedIds.has(node.id))
      .map((node) => ({ ...node, x: 0, y: 0 }));
    arrangeKnowledgeGraph(positionedNodes, {
      anchorId,
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      clusterForNode: (node) => node.cluster,
    });
    const byId = new Map(positionedNodes.map((node) => [node.id, node]));
    const positionedEdges = edges.flatMap((edge) => {
      const sourceNode = byId.get(edge.source);
      const targetNode = byId.get(edge.target);
      return sourceNode && targetNode
        ? [{ ...edge, sourceNode, targetNode }]
        : [];
    });
    return { nodes: positionedNodes, links: positionedEdges, byId };
  }, [anchorId, edges, nodes]);

  const bucketOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph.links) {
      for (const bucket of edge.displayBuckets) {
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      }
    }
    const keys = [
      ...bucketOrder,
      ...[...counts.keys()].filter((bucket) => !bucketOrder.includes(bucket)),
    ];
    return keys.flatMap((bucket) => {
      const count = counts.get(bucket) ?? 0;
      return count ? [{ bucket, count }] : [];
    });
  }, [bucketOrder, graph.links]);

  const presentationEdges = useMemo(
    () =>
      bucketFilter
        ? graph.links.filter((edge) => edge.displayBuckets.includes(bucketFilter))
        : graph.links,
    [bucketFilter, graph.links],
  );

  const shownNodeIds = useMemo(() => {
    const ids = new Set<string>([anchorId]);
    for (const edge of presentationEdges) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
    return ids;
  }, [anchorId, presentationEdges]);

  const visibleEdges = useMemo(
    () =>
      visibleSocialGraphEdges(presentationEdges, {
        anchorId,
        revealNodeId: selectedNodeId || hoveredNodeId,
      }),
    [anchorId, hoveredNodeId, presentationEdges, selectedNodeId],
  );

  const focus = useMemo(
    () =>
      deriveRelationshipGraphFocus({
        edges: visibleEdges,
        hoverNodeId: hoveredNodeId,
        hoverEdgeId: hoveredEdgeId || selectedEdgeId,
        selectedNodeId,
      }),
    [hoveredEdgeId, hoveredNodeId, selectedEdgeId, selectedNodeId, visibleEdges],
  );

  const relationLabelIds = useMemo(
    () =>
      hoveredEdgeId || selectedEdgeId
        ? new Set([hoveredEdgeId || selectedEdgeId])
        : new Set<string>(),
    [hoveredEdgeId, selectedEdgeId],
  );

  const visibleNodes = useMemo(
    () => graph.nodes.filter((node) => shownNodeIds.has(node.id)),
    [graph.nodes, shownNodeIds],
  );

  const searchMatches = useMemo(() => {
    const needle = query.trim();
    if (!needle) return [];
    return visibleNodes
      .filter((node) => node.name.includes(needle))
      .sort(
        (left, right) =>
          right.degree - left.degree || left.name.localeCompare(right.name, "zh-CN"),
      )
      .slice(0, 8);
  }, [query, visibleNodes]);

  const selectedPerson = graph.byId.get(selectedNodeId) ?? null;
  const selectedRelationships = useMemo(
    () =>
      selectedNodeId
        ? graph.links
            .filter(
              (edge) =>
                edge.source === selectedNodeId || edge.target === selectedNodeId,
            )
            .sort(
              (left, right) =>
                right.evidenceCount - left.evidenceCount ||
                left.displayBuckets[0].localeCompare(right.displayBuckets[0]),
            )
        : [],
    [graph.links, selectedNodeId],
  );

  const directEdgeCount = graph.links.filter(
    (edge) => edge.source === anchorId || edge.target === anchorId,
  ).length;
  const bridgeEdgeCount = graph.links.length - directEdgeCount;

  const svgWrapRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<SVGGElement>(null);
  const graphRef = useRef(graph);
  const viewState = useRef({ x: 0, y: 0, k: 1 });
  const panRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const applyView = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { x, y, k } = viewState.current;
    view.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
  }, []);

  const screenToUser = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!svg || !rect) return { x: clientX, y: clientY, scale: 1 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM();
    if (matrix) {
      const user = point.matrixTransform(matrix.inverse());
      return { x: user.x, y: user.y, scale: matrix.a };
    }
    return {
      x: ((clientX - rect.left) / rect.width) * VIEW_WIDTH,
      y: ((clientY - rect.top) / rect.height) * VIEW_HEIGHT,
      scale: rect.width / VIEW_WIDTH,
    };
  }, []);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const view = viewState.current;
      const nextZoom = clamp(view.k * factor, 0.2, 7);
      const user = screenToUser(clientX, clientY);
      const graphX = (user.x - view.x) / view.k;
      const graphY = (user.y - view.y) / view.k;
      view.k = nextZoom;
      view.x = user.x - graphX * nextZoom;
      view.y = user.y - graphY * nextZoom;
      applyView();
    },
    [applyView, screenToUser],
  );

  const fitGraph = useCallback(() => {
    const currentGraph = graphRef.current;
    const fittedNodes = currentGraph.nodes.filter((node) => shownNodeIds.has(node.id));
    if (!fittedNodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of fittedNodes) {
      const size = node.isAnchor
        ? { width: 108, height: 108 }
        : knowledgeGraphCardSize(node.name);
      minX = Math.min(minX, node.x - size.width / 2);
      minY = Math.min(minY, node.y - size.height / 2);
      maxX = Math.max(maxX, node.x + size.width / 2);
      maxY = Math.max(maxY, node.y + size.height / 2);
    }
    const padding = 70;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    const zoom = clamp(Math.min(VIEW_WIDTH / width, VIEW_HEIGHT / height), 0.2, 2);
    viewState.current = {
      k: zoom,
      x: VIEW_CENTER_X - ((minX + maxX) / 2) * zoom,
      y: VIEW_CENTER_Y - ((minY + maxY) / 2) * zoom,
    };
    applyView();
  }, [applyView, shownNodeIds]);

  useEffect(() => {
    graphRef.current = graph;
    viewState.current = { x: 0, y: 0, k: 1 };
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      fitGraph();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [fitGraph, graph]);

  useEffect(() => {
    const wrap = svgWrapRef.current;
    if (!wrap) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.18 : 1 / 1.18);
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const centerOnNode = useCallback(
    (id: string) => {
      const node = graphRef.current.byId.get(id);
      if (!node) return;
      const view = viewState.current;
      view.k = Math.max(view.k, 1.4);
      view.x = VIEW_CENTER_X - node.x * view.k;
      view.y = VIEW_CENTER_Y - node.y * view.k;
      applyView();
    },
    [applyView],
  );

  const selectNode = useCallback((id: string) => {
    setSelectedNodeId(id);
    setSelectedEdgeId("");
  }, []);

  const selectEdge = useCallback(
    (edge: SocialGraphReaderEdge) => {
      setSelectedNodeId(chooseReadingPerson(edge, anchorId));
      setSelectedEdgeId(edge.id);
    },
    [anchorId],
  );

  const clearSelection = useCallback(() => {
    setSelectedNodeId("");
    setSelectedEdgeId("");
    setHoveredNodeId("");
    setHoveredEdgeId("");
  }, []);

  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent, id: string) => {
      event.stopPropagation();
      if (!graphRef.current.byId.has(id)) return;
      dragRef.current = {
        id,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (drag) {
        const node = graphRef.current.byId.get(drag.id);
        if (!node) return;
        if (
          Math.abs(event.clientX - drag.startX) > 3 ||
          Math.abs(event.clientY - drag.startY) > 3
        ) {
          drag.moved = true;
        }
        const user = screenToUser(event.clientX, event.clientY);
        const view = viewState.current;
        node.x = clamp((user.x - view.x) / view.k, 0, VIEW_WIDTH);
        node.y = clamp((user.y - view.y) / view.k, 0, VIEW_HEIGHT);
        setRenderRevision((current) => current + 1);
        return;
      }
      const pan = panRef.current;
      if (!pan) return;
      const view = viewState.current;
      const scale = screenToUser(event.clientX, event.clientY).scale;
      view.x = pan.originX + (event.clientX - pan.startX) / scale;
      view.y = pan.originY + (event.clientY - pan.startY) / scale;
      applyView();
    },
    [applyView, screenToUser],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (dragRef.current) return;
      panRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: viewState.current.x,
        originY: viewState.current.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const endPointer = useCallback(() => {
    if (dragRef.current) {
      suppressClickRef.current = dragRef.current.moved;
      dragRef.current = null;
    }
    panRef.current = null;
  }, []);

  const zoomCenter = useCallback(
    (factor: number) => {
      const wrap = svgWrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt],
  );

  const inspector = renderInspector({
    selectedPerson,
    selectedEdgeId,
    relationships: selectedRelationships,
    peopleById: graph.byId,
    close: clearSelection,
  });

  return (
    <SocialGraphStage
      graph={
        <section
          ref={svgWrapRef}
          className="social-graph"
          aria-label={graphAriaLabel}
        >
          <div className="social-graph-tools">
            <label className="social-search">
              <span className="sr-only">搜索人物</span>
              <input
                type="search"
                value={query}
                placeholder="搜索人物姓名…"
                onChange={(event) => setQuery(event.target.value)}
                aria-label={searchAriaLabel}
              />
              {searchMatches.length ? (
                <ul className="social-search-results">
                  {searchMatches.map((node) => (
                    <li key={node.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setBucketFilter("");
                          setQuery("");
                          selectNode(node.id);
                          centerOnNode(node.id);
                        }}
                      >
                        <strong>{node.name}</strong>
                        <span>{node.searchDescription ?? `${node.degree} 对关系`}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </label>
            <label className="social-bucket-filter">
              <span className="sr-only">关系类型</span>
              <select
                value={bucketFilter}
                aria-label="按关系类型筛选"
                onChange={(event) => {
                  setBucketFilter(event.target.value);
                  clearSelection();
                }}
              >
                <option value="">全部关系 · {graph.links.length} 条</option>
                {bucketOptions.map(({ bucket, count }) => (
                  <option key={bucket} value={bucket}>
                    {bucketLabels[bucket] ?? bucket} · {count}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="social-graph-line-key"
              aria-label={`实线表示与中心人物直接往来；选择或悬停人物后，虚线显示该人物与圈内人物之间的往来`}
            >
              <span>
                <i aria-hidden="true" />与{anchorName}直接往来 · {directEdgeCount}
              </span>
              <span>
                <i className="is-bridge" aria-hidden="true" />
                选择人物后显示圈内往来 · {bridgeEdgeCount}
              </span>
            </div>
          </div>

          <section className="social-mobile-directory" aria-label={directoryAriaLabel}>
            <div className="social-mobile-directory-heading">
              <strong>人物索引</strong>
              <span>点击人物查看关系与证据</span>
            </div>
            <ul>
              {[...visibleNodes]
                .sort(
                  (left, right) =>
                    Number(right.isAnchor) - Number(left.isAnchor) ||
                    right.degree - left.degree ||
                    left.name.localeCompare(right.name, "zh-CN"),
                )
                .map((node) => {
                  const bucket = node.isAnchor
                    ? "target"
                    : dominantBucket(graph.links, node.id, bucketOrder);
                  return (
                    <li key={node.id}>
                      <button
                        type="button"
                        className={selectedNodeId === node.id ? "is-active" : ""}
                        aria-pressed={selectedNodeId === node.id}
                        onClick={() => selectNode(node.id)}
                      >
                        <strong>{node.name}</strong>
                        <span>
                          {node.isAnchor
                            ? "中心人物"
                            : bucketLabels[bucket] ?? "圈内人物"}
                        </span>
                        <small>{node.degree} 对关系</small>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </section>

          <svg
            ref={svgRef}
            className="social-svg"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            role="application"
            aria-label={`${graphAriaLabel}：${visibleNodes.length} 位人物、${visibleEdges.length} 对关系`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onClick={(event) => {
              if (event.target === event.currentTarget) clearSelection();
            }}
          >
            <g ref={viewRef} transform="translate(0 0) scale(1)">
              {visibleEdges.map((edge) => {
                const bucket = primaryBucket(edge, bucketOrder);
                const color = BUCKET_COLORS[bucket] ?? "#9a9a9a";
                const focused = focus.highlightedEdgeIds.has(edge.id);
                const geometry = knowledgeGraphStraightLinkGeometry(
                  edge.sourceNode,
                  edge.targetNode,
                );
                const bridge = edge.source !== anchorId && edge.target !== anchorId;
                const label = relationshipLabel(edge, bucketLabels, bucketOrder);
                const showLabel = relationLabelIds.has(edge.id);
                const labelWidth = Math.max(58, label.length * 15 + 20);
                return (
                  <g
                    key={edge.id}
                    className="kg-edge-interactive"
                    role="button"
                    tabIndex={0}
                    aria-label={`打开${edge.sourceNode.name}与${edge.targetNode.name}的关系档案`}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectEdge(edge);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectEdge(edge);
                      }
                    }}
                    onPointerEnter={() => setHoveredEdgeId(edge.id)}
                    onPointerLeave={() =>
                      setHoveredEdgeId((current) => (current === edge.id ? "" : current))
                    }
                  >
                    <path
                      className="kg-edge-hit-area"
                      d={geometry.path}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={24}
                      pointerEvents="stroke"
                    />
                    <path
                      className={`kg-edge is-knowledge-edge${bridge ? " is-bridge" : ""}${focused ? " is-focused" : ""}`}
                      d={geometry.path}
                      stroke="#343b3d"
                      strokeWidth={focused ? 2.2 : 1.5}
                      strokeOpacity={
                        focus.focusNodeId
                          ? focused
                            ? bridge
                              ? 0.76
                              : 0.86
                            : 0.07
                          : bridge
                            ? 0.42
                            : 0.68
                      }
                    >
                      <title>
                        {`${edge.sourceNode.name} ↔ ${edge.targetNode.name} · ${edge.displayBuckets
                          .map((value) => bucketLabels[value] ?? value)
                          .join("、")} · 证据 ${edge.evidenceCount} 条`}
                      </title>
                    </path>
                    {showLabel ? (
                      <g
                        className="kg-edge-label"
                        transform={`translate(${geometry.labelX} ${geometry.labelY})`}
                        pointerEvents="none"
                      >
                        <rect
                          x={-labelWidth / 2}
                          y={-14}
                          width={labelWidth}
                          height={28}
                          rx={5}
                          fill="rgb(255 253 248 / 96%)"
                          stroke={color}
                          strokeWidth={1}
                        />
                        <text textAnchor="middle" y={5} fill={color}>
                          {label}
                        </text>
                      </g>
                    ) : null}
                  </g>
                );
              })}

              {visibleNodes.map((node) => {
                const isFocus = focus.focusNodeId === node.id;
                const isNeighbor = presentationEdges.some(
                  (edge) =>
                    (edge.source === focus.focusNodeId && edge.target === node.id) ||
                    (edge.target === focus.focusNodeId && edge.source === node.id),
                );
                const dimmed = Boolean(
                  focus.focusNodeId && !isFocus && !isNeighbor,
                );
                const selected = selectedNodeId === node.id;
                const card = knowledgeGraphCardSize(node.name);
                return (
                  <g
                    key={node.id}
                    className={`kg-node kg-node-card${isFocus ? " is-focus" : ""}${dimmed ? " is-dimmed" : ""}${node.isAnchor ? " is-target" : ""}`}
                    transform={`translate(${node.x} ${node.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.name}，${node.isAnchor ? "中心人物" : "圈内人物"}，${node.degree} 对关系`}
                    onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      selectNode(node.id);
                    }}
                    onPointerEnter={() => setHoveredNodeId(node.id)}
                    onPointerLeave={() =>
                      setHoveredNodeId((current) => (current === node.id ? "" : current))
                    }
                    onFocus={() => setHoveredNodeId(node.id)}
                    onBlur={() =>
                      setHoveredNodeId((current) => (current === node.id ? "" : current))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectNode(node.id);
                      }
                    }}
                  >
                    {node.isAnchor ? (
                      <circle
                        className="kg-node-card-shape"
                        r={isFocus ? 52 : 48}
                        fill={selected ? "#f6e6ab" : "#d9b7dc"}
                        stroke="#343b3d"
                        strokeWidth={isFocus ? 3 : 2}
                      />
                    ) : (
                      <rect
                        className="kg-node-card-shape"
                        x={-card.width / 2}
                        y={-card.height / 2}
                        width={card.width}
                        height={card.height}
                        rx={8}
                        fill={selected ? "#f6e6ab" : "#c7e6e7"}
                        stroke="#343b3d"
                        strokeWidth={isFocus ? 3 : 2}
                      />
                    )}
                    {selected ? (
                      node.isAnchor ? (
                        <circle
                          r={57}
                          fill="none"
                          stroke="#a33a2c"
                          strokeWidth={1.6}
                          strokeDasharray="4 4"
                        />
                      ) : (
                        <rect
                          x={-card.width / 2 - 5}
                          y={-card.height / 2 - 5}
                          width={card.width + 10}
                          height={card.height + 10}
                          rx={11}
                          fill="none"
                          stroke="#a33a2c"
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                        />
                      )
                    ) : null}
                    <text
                      className="kg-node-card-label"
                      textAnchor="middle"
                      y={node.isAnchor ? 7 : 5}
                    >
                      {node.name}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          <GraphZoomControls
            onZoomIn={() => zoomCenter(1.3)}
            onZoomOut={() => zoomCenter(1 / 1.3)}
          />

          <details className="social-provenance">
            <summary>数据说明</summary>
            <p>{provenance}</p>
          </details>
        </section>
      }
      inspector={inspector}
    />
  );
}
