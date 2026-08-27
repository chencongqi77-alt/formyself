"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";

import type { BookAnalysisResult } from "../../lib/book-agent";
import {
  classifyGraphSubgraph,
  deriveBookAgentGraphView,
  MAX_VISIBLE_EDGES,
  MAX_VISIBLE_NODES,
  type BookAgentGraphEntityKind,
  type BookAgentGraphSubgraph,
} from "../../lib/book-agent-graph-policy";
import type { RelationshipAssessment, VerificationRisk, VerificationStatus } from "../../lib/book-agent-verification";
import styles from "../agent.module.css";

type GraphNodeKind = BookAgentGraphEntityKind | "aggregate";
type RiskFilter = "exceptions" | VerificationRisk | "all";

type GraphNode = {
  id: string;
  label: string;
  kind: GraphNodeKind;
  x: number;
  y: number;
  hiddenRelationCount: number;
};

type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  status: VerificationStatus;
  assessmentIds: string[];
  primaryAssessmentId: string | null;
  auxiliary?: boolean;
};

const GRAPH_WIDTH = 820;
const GRAPH_HEIGHT = 570;

const STATUS_LABELS: Record<VerificationStatus, string> = {
  confirmed: "已确认",
  pending: "待审核",
  conflict: "冲突",
  "low-confidence": "低可信",
};

const SUBGRAPH_TABS: Array<{ id: BookAgentGraphSubgraph; label: string }> = [
  { id: "overview", label: "风险总览" },
  { id: "journey", label: "人物—地点" },
  { id: "social", label: "人物—人物" },
  { id: "poemWorld", label: "作品—地点" },
];

const RISK_FILTERS: Array<{ value: RiskFilter; label: string }> = [
  { value: "exceptions", label: "待人工处理" },
  { value: "high", label: "高风险" },
  { value: "medium", label: "中风险" },
  { value: "low", label: "低风险（折叠查看）" },
  { value: "all", label: "全部有效关系（限量）" },
];

function compactLabel(label: string, limit: number): string {
  const clean = label.replace(/^《|》$/g, "");
  return clean.length > limit ? clean.slice(0, limit) + "…" : clean;
}

function distribute(
  nodes: Array<Omit<GraphNode, "x" | "y">>,
  x: number,
  top: number,
  bottom: number,
): GraphNode[] {
  if (!nodes.length) return [];
  const step = (bottom - top) / (nodes.length + 1);
  return nodes.map((node, index) => ({ ...node, x, y: top + step * (index + 1) }));
}

function positionNodes(
  nodes: Array<Omit<GraphNode, "x" | "y">>,
  subgraph: BookAgentGraphSubgraph,
  focusPersonId: string,
): GraphNode[] {
  const sorted = [...nodes].sort((left, right) => {
    if (left.id === focusPersonId) return -1;
    if (right.id === focusPersonId) return 1;
    return left.label.localeCompare(right.label, "zh-CN");
  });
  const people = sorted.filter((node) => node.kind === "person");
  const works = sorted.filter((node) => node.kind === "work");
  const places = sorted.filter((node) => node.kind === "place");
  const aggregates = sorted.filter((node) => node.kind === "aggregate");

  if (subgraph === "social") {
    const focus = people.filter((node) => node.id === focusPersonId);
    const others = people.filter((node) => node.id !== focusPersonId);
    return [
      ...focus.map((node) => ({ ...node, x: 150, y: 275 })),
      ...distribute(others, 655, 50, 500),
      ...distribute(works, 410, 70, 470),
      ...distribute(places, 410, 80, 490),
      ...aggregates.map((node) => ({ ...node, x: 405, y: 515 })),
    ];
  }
  if (subgraph === "journey") {
    const focus = people.filter((node) => node.id === focusPersonId);
    const others = people.filter((node) => node.id !== focusPersonId);
    return [
      ...focus.map((node) => ({ ...node, x: 120, y: 275 })),
      ...distribute(others, 245, 70, 480),
      ...distribute(works, 400, 65, 485),
      ...distribute(places, 660, 45, 510),
      ...aggregates.map((node) => ({ ...node, x: 395, y: 520 })),
    ];
  }
  if (subgraph === "poemWorld") {
    return [
      ...distribute(people, 90, 80, 470),
      ...distribute(works, 235, 45, 510),
      ...distribute(places, 660, 45, 510),
      ...aggregates.map((node) => ({ ...node, x: 450, y: 520 })),
    ];
  }
  return [
    ...distribute(people, 125, 45, 505),
    ...distribute(works, 385, 50, 500),
    ...distribute(places, 680, 45, 505),
    ...aggregates.map((node) => ({ ...node, x: 410, y: 520 })),
  ];
}

function curveFor(source: GraphNode, target: GraphNode, index: number): { path: string; labelX: number; labelY: number } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const bend = ((index % 3) - 1) * 18;
  const controlX = source.x + dx / 2 - (Math.abs(dx) < 90 ? 76 : 0);
  const controlY = source.y + dy / 2 + bend;
  const labelX = 0.25 * source.x + 0.5 * controlX + 0.25 * target.x;
  const labelY = 0.25 * source.y + 0.5 * controlY + 0.25 * target.y;
  return {
    path: "M " + source.x + " " + source.y + " Q " + controlX + " " + controlY + " " + target.x + " " + target.y,
    labelX,
    labelY,
  };
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
  expanded,
  onActivate,
}: {
  node: GraphNode;
  selected: boolean;
  expanded: boolean;
  onActivate: () => void;
}) {
  const kindClass = "graphNode" + node.kind[0].toUpperCase() + node.kind.slice(1);
  const className = [
    styles.graphNode,
    styles[kindClass],
    selected ? styles.graphNodeSelected : "",
    expanded ? styles.graphNodeExpanded : "",
  ].filter(Boolean).join(" ");
  const interactive = node.kind === "aggregate" || node.hiddenRelationCount > 0 || expanded;
  const actionLabel = node.kind === "aggregate"
    ? "查看折叠关系"
    : expanded
      ? "收起展开"
      : node.hiddenRelationCount > 0
        ? "展开 " + node.hiddenRelationCount + " 条相关关系"
        : "";
  const onKeyDown = (event: KeyboardEvent<SVGGElement>): void => {
    if (!interactive || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onActivate();
  };
  const commonProps = {
    className,
    role: interactive ? "button" : undefined,
    tabIndex: interactive ? 0 : undefined,
    "aria-label": interactive ? node.label + "，" + actionLabel : node.label,
    onClick: interactive ? onActivate : undefined,
    onKeyDown,
  };
  const action = actionLabel ? (
    <g className={styles.graphNodeAction} aria-hidden="true">
      <rect x={node.x - 58} y={node.y + 42} width="116" height="23" />
      <text x={node.x} y={node.y + 57}>{actionLabel}</text>
    </g>
  ) : null;

  if (node.kind === "person") {
    return (
      <g {...commonProps}>
        <circle cx={node.x} cy={node.y} r="38" />
        <text x={node.x} y={node.y + 5}>{compactLabel(node.label, 5)}</text>
        {action}
      </g>
    );
  }
  if (node.kind === "place") {
    return (
      <g {...commonProps}>
        <path d={"M " + node.x + " " + (node.y - 36) + " L " + (node.x + 48) + " " + node.y + " L " + node.x + " " + (node.y + 36) + " L " + (node.x - 48) + " " + node.y + " Z"} />
        <text x={node.x} y={node.y + 5}>{compactLabel(node.label, 6)}</text>
        {action}
      </g>
    );
  }
  if (node.kind === "aggregate") {
    return (
      <g {...commonProps}>
        <rect x={node.x - 72} y={node.y - 31} width="144" height="62" />
        <text x={node.x} y={node.y - 4}>低风险关系</text>
        <text x={node.x} y={node.y + 17}>+{node.label}</text>
        {action}
      </g>
    );
  }
  return (
    <g {...commonProps}>
      <rect x={node.x - 72} y={node.y - 29} width="144" height="58" />
      <text x={node.x} y={node.y + 5}>《{compactLabel(node.label, 8)}》</text>
      {action}
    </g>
  );
}

function riskFilterOptions(filter: RiskFilter): { scope: "exceptions" | "all"; risk: VerificationRisk | "all" } {
  if (filter === "exceptions") return { scope: "exceptions", risk: "all" };
  return { scope: "all", risk: filter };
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
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("exceptions");
  const [relationFilter, setRelationFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState<BookAgentGraphEntityKind | "all">("all");
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [includeUndated, setIncludeUndated] = useState(false);
  const [focusPersonId, setFocusPersonId] = useState(result.draft.poet.id);
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [storyDrawerOpen, setStoryDrawerOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);

  const riskOptions = riskFilterOptions(riskFilter);
  const people = result.draft.entities.people;
  const focusEntityIds = useMemo(() => [
    focusPersonId,
    ...result.draft.entities.works.filter((work) => work.authorPersonId === focusPersonId).map((work) => work.id),
  ], [focusPersonId, result.draft.entities.works]);
  const availableRelationLabels = useMemo(() => {
    const labels = assessments
      .filter((assessment) => subgraph === "overview" || classifyGraphSubgraph(assessment) === subgraph)
      .map((assessment) => assessment.relationLabel);
    return [...new Set(labels)].sort((left, right) => left.localeCompare(right, "zh-CN"));
  }, [assessments, subgraph]);
  const effectiveRelationFilter = relationFilter === "all" || availableRelationLabels.includes(relationFilter)
    ? relationFilter
    : "all";
  const parsedStart = timeStart ? Number(timeStart) : undefined;
  const parsedEnd = timeEnd ? Number(timeEnd) : undefined;
  const timeRange = useMemo(() => {
    if (!Number.isFinite(parsedStart) && !Number.isFinite(parsedEnd)) return undefined;
    const startYear = Number.isFinite(parsedStart) ? parsedStart as number : Number.MIN_SAFE_INTEGER;
    const endYear = Number.isFinite(parsedEnd) ? parsedEnd as number : Number.MAX_SAFE_INTEGER;
    return startYear <= endYear
      ? { startYear, endYear }
      : { startYear: endYear, endYear: startYear };
  }, [parsedEnd, parsedStart]);
  const view = useMemo(() => deriveBookAgentGraphView(assessments, {
    scope: riskOptions.scope,
    risk: riskOptions.risk,
    subgraph,
    relationLabel: effectiveRelationFilter,
    entityKind: entityFilter,
    timeRange,
    includeUndated,
    focusEntityIds,
    selectedId,
    expandedEntityId: expandedNodeId,
  }), [
    assessments,
    effectiveRelationFilter,
    entityFilter,
    expandedNodeId,
    focusEntityIds,
    includeUndated,
    riskOptions.risk,
    riskOptions.scope,
    selectedId,
    subgraph,
    timeRange,
  ]);

  const graph = useMemo(() => {
    const peopleById = new Map(result.draft.entities.people.map((item) => [item.id, item.name]));
    const visibleRelatedCounts = new Map<string, number>();
    for (const group of view.groups) {
      visibleRelatedCounts.set(group.sourceId, (visibleRelatedCounts.get(group.sourceId) ?? 0) + 1);
      visibleRelatedCounts.set(group.targetId, (visibleRelatedCounts.get(group.targetId) ?? 0) + 1);
    }
    const rawNodes = new Map<string, Omit<GraphNode, "x" | "y">>();
    const addNode = (id: string, label: string, kind: GraphNodeKind): void => {
      if (rawNodes.has(id)) return;
      rawNodes.set(id, {
        id,
        label,
        kind,
        hiddenRelationCount: Math.max(0, (view.expandableRelationCounts[id] ?? 0) - (visibleRelatedCounts.get(id) ?? 0)),
      });
    };
    for (const group of view.groups) {
      addNode(group.sourceId, group.sourceLabel, group.sourceEntityType);
      addNode(group.targetId, group.targetLabel, group.targetEntityType);
    }
    if (!rawNodes.size && peopleById.has(focusPersonId)) {
      addNode(focusPersonId, peopleById.get(focusPersonId) ?? focusPersonId, "person");
    }
    if (view.collapsedLowRiskCount > 0 && rawNodes.size < MAX_VISIBLE_NODES && view.groups.length < MAX_VISIBLE_EDGES) {
      addNode("__collapsed-low-risk__", String(view.collapsedLowRiskCount), "aggregate");
    }
    const nodes = positionNodes([...rawNodes.values()], subgraph, focusPersonId);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edges: GraphEdge[] = view.groups.map((group) => ({
      id: group.key,
      sourceId: group.sourceId,
      targetId: group.targetId,
      label: group.occurrenceCount > 1 ? group.relationLabel + " ×" + group.occurrenceCount : group.relationLabel,
      status: group.displayStatus,
      assessmentIds: group.assessmentIds,
      primaryAssessmentId: selectedId && group.assessmentIds.includes(selectedId) ? selectedId : group.primaryAssessmentId,
    }));
    const aggregateSource = nodeById.get(focusPersonId) ?? nodes.find((node) => node.kind !== "aggregate");
    if (aggregateSource && nodeById.has("__collapsed-low-risk__")) {
      edges.push({
        id: "__collapsed-low-risk-edge__",
        sourceId: aggregateSource.id,
        targetId: "__collapsed-low-risk__",
        label: "低风险已折叠",
        status: "confirmed",
        assessmentIds: [],
        primaryAssessmentId: null,
        auxiliary: true,
      });
    }
    return { nodes, edges, nodeById };
  }, [
    focusPersonId,
    result.draft.entities.people,
    selectedId,
    subgraph,
    view,
  ]);

  const selectedAssessment = assessments.find((assessment) => assessment.id === selectedId);
  const hasVisibleSelection = Boolean(selectedId && view.groups.some((group) => group.assessmentIds.includes(selectedId)));
  const selectedNodeIds = new Set(selectedAssessment && hasVisibleSelection ? [selectedAssessment.sourceId, selectedAssessment.targetId] : []);
  const storyCards = result.draft.storyCards.filter((story) => view.storyIds.includes(story.id));
  const riskSummary = useMemo(() => {
    const pending = assessments.filter((assessment) => (
      assessment.reviewState === "needs-review" || assessment.reviewState === "candidate-preview"
    ));
    return {
      high: pending.filter((assessment) => assessment.risk === "high").length,
      conflict: pending.filter((assessment) => assessment.reasonCode === "conflict").length,
      insufficient: pending.filter((assessment) => assessment.reasonCode === "evidence-insufficient").length,
      lowConfidence: pending.filter((assessment) => assessment.policyStatus === "low-confidence").length,
    };
  }, [assessments]);
  const expandedNode = graph.nodes.find((node) => node.id === expandedNodeId);
  const focusLabel = expandedNode
    ? `展开：${expandedNode.label}`
    : selectedAssessment && hasVisibleSelection
      ? `关系链：${selectedAssessment.title}`
      : `人物：${people.find((person) => person.id === focusPersonId)?.name ?? focusPersonId}`;

  useEffect(() => {
    if (selectedId && !hasVisibleSelection) onSelect(null);
  }, [hasVisibleSelection, onSelect, selectedId]);

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
      x: GRAPH_WIDTH / 2 - (source.x + target.x) / 2,
      y: GRAPH_HEIGHT / 2 - (source.y + target.y) / 2,
    });
  };

  const activateNode = (node: GraphNode): void => {
    if (node.kind === "aggregate") {
      setRiskFilter("low");
      setExpandedNodeId(null);
      resetView();
      return;
    }
    setExpandedNodeId(expandedNodeId === node.id ? null : node.id);
    resetView();
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

  const clearGraphFilters = (): void => {
    setRiskFilter("exceptions");
    setRelationFilter("all");
    setEntityFilter("all");
    setTimeStart("");
    setTimeEnd("");
    setIncludeUndated(false);
    setExpandedNodeId(null);
  };

  return (
    <section className={styles.knowledgeGraphPanel} aria-label="异常关系分层知识图谱">
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
            onClick={() => {
              setSubgraph(tab.id);
              setExpandedNodeId(null);
              resetView();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.graphFilterBar} aria-label="图谱筛选">
        <label>
          <span>风险等级</span>
          <select
            value={riskFilter}
            onChange={(event) => {
              setRiskFilter(event.target.value as RiskFilter);
              setExpandedNodeId(null);
            }}
          >
            {RISK_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>关系类型</span>
          <select
            value={effectiveRelationFilter}
            onChange={(event) => {
              setRelationFilter(event.target.value);
              setExpandedNodeId(null);
            }}
          >
            <option value="all">全部类型</option>
            {availableRelationLabels.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>实体类型</span>
          <select
            value={entityFilter}
            onChange={(event) => {
              setEntityFilter(event.target.value as BookAgentGraphEntityKind | "all");
              setExpandedNodeId(null);
            }}
          >
            <option value="all">全部实体</option>
            <option value="person">人物</option>
            <option value="place">地点</option>
            <option value="work">作品</option>
          </select>
        </label>
        <fieldset className={styles.graphTimeFilter}>
          <legend>时间范围</legend>
          <input
            type="number"
            inputMode="numeric"
            aria-label="起始年份"
            placeholder="起年"
            value={timeStart}
            onChange={(event) => {
              setTimeStart(event.target.value);
              setExpandedNodeId(null);
            }}
          />
          <span aria-hidden="true">—</span>
          <input
            type="number"
            inputMode="numeric"
            aria-label="结束年份"
            placeholder="止年"
            value={timeEnd}
            onChange={(event) => {
              setTimeEnd(event.target.value);
              setExpandedNodeId(null);
            }}
          />
          <label className={styles.graphUndatedToggle}>
            <input type="checkbox" checked={includeUndated} onChange={(event) => setIncludeUndated(event.target.checked)} />
            <span>含时间不详</span>
          </label>
        </fieldset>
        <button type="button" className={styles.graphClearFilters} onClick={clearGraphFilters}>恢复默认</button>
      </div>

      <div className={styles.graphFocusBar}>
        <label>
          <span>人物范围</span>
          <select
            value={focusPersonId}
            onChange={(event) => {
              setFocusPersonId(event.target.value);
              setExpandedNodeId(null);
              resetView();
            }}
          >
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        <span>当前聚焦 · {focusLabel}</span>
      </div>

      <div
        id="agent-graph-panel"
        className={styles.graphCanvasShell}
        role="tabpanel"
        aria-labelledby={`agent-graph-tab-${subgraph}`}
      >
        {subgraph === "overview" ? (
          <div className={styles.graphRiskSummary} aria-label="异常风险分布">
            <span><strong>{riskSummary.high}</strong>高风险</span>
            <span><strong>{riskSummary.conflict}</strong>冲突</span>
            <span><strong>{riskSummary.insufficient}</strong>证据不足</span>
            <span><strong>{riskSummary.lowConfidence}</strong>低可信</span>
          </div>
        ) : null}

        <div className={styles.graphLegend} aria-label="关系状态图例">
          {(Object.keys(STATUS_LABELS) as VerificationStatus[]).map((status) => {
            const statusClass = "graphLegend" + status.replace(/(^|-)([a-z])/g, (_match, _dash, letter: string) => letter.toUpperCase());
            return (
              <span key={status} className={styles[statusClass]}>
                <i aria-hidden="true" />{STATUS_LABELS[status]}
              </span>
            );
          })}
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
          role="group"
          aria-label={(SUBGRAPH_TABS.find((tab) => tab.id === subgraph)?.label ?? "知识图谱") + "，当前显示 " + graph.nodes.length + " 个实体、" + view.groups.length + " 条候选关系"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <defs>
            <marker id="agent-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M0 0 8 4 0 8Z" />
            </marker>
          </defs>
          <g transform={"translate(" + pan.x + " " + pan.y + ") translate(" + GRAPH_WIDTH / 2 + " " + GRAPH_HEIGHT / 2 + ") scale(" + zoom + ") translate(" + -GRAPH_WIDTH / 2 + " " + -GRAPH_HEIGHT / 2 + ")"}>
            {graph.edges.map((edge, index) => {
              const source = graph.nodeById.get(edge.sourceId);
              const target = graph.nodeById.get(edge.targetId);
              if (!source || !target) return null;
              const curve = curveFor(source, target, index);
              const selected = Boolean(selectedId && edge.assessmentIds.includes(selectedId));
               const faded = Boolean(hasVisibleSelection && !selected && !edge.auxiliary);
              const statusClass = "graphEdge" + edge.status.replace(/(^|-)([a-z])/g, (_match, _dash, letter: string) => letter.toUpperCase());
              const edgeClass = [
                styles.graphEdge,
                styles[statusClass],
                selected ? styles.graphEdgeSelected : "",
                faded ? styles.graphEdgeFaded : "",
                edge.auxiliary ? styles.graphEdgeAuxiliary : "",
              ].filter(Boolean).join(" ");
              const activate = (): void => {
                if (edge.primaryAssessmentId) onSelect(edge.primaryAssessmentId);
              };
              const onKeyDown = (event: KeyboardEvent<SVGGElement>): void => {
                if (!edge.primaryAssessmentId || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                activate();
              };
              const labelWidth = Math.max(54, Math.min(130, edge.label.length * 13 + 18));
              return (
                <g
                  key={edge.id}
                  className={edgeClass}
                  role={edge.primaryAssessmentId ? "button" : undefined}
                  tabIndex={edge.primaryAssessmentId ? 0 : undefined}
                  aria-label={edge.primaryAssessmentId ? edge.label + "，" + STATUS_LABELS[edge.status] + "，点击查看证据" : edge.label}
                  onClick={activate}
                  onKeyDown={onKeyDown}
                >
                  <path className={styles.graphEdgeHitArea} d={curve.path} />
                  {edge.status === "conflict" ? <path className={styles.graphEdgeConflictUnderlay} d={curve.path} /> : null}
                  <path className={styles.graphEdgeLine} d={curve.path} markerEnd={edge.auxiliary ? undefined : "url(#agent-graph-arrow)"} />
                  <rect className={styles.graphEdgeLabelBackground} x={curve.labelX - labelWidth / 2} y={curve.labelY - 12} width={labelWidth} height="23" />
                  <text className={styles.graphEdgeLabel} x={curve.labelX} y={curve.labelY + 4}>{compactLabel(edge.label, 9)}</text>
                </g>
              );
            })}
            {graph.nodes.map((node) => (
              <NodeShape
                key={node.id}
                node={node}
                selected={selectedNodeIds.has(node.id)}
                expanded={expandedNodeId === node.id}
                onActivate={() => activateNode(node)}
              />
            ))}
          </g>
        </svg>

        {!view.groups.length ? (
          <div className={styles.graphEmptyState}>
            <strong>当前筛选没有待处理关系</strong>
            <p>可以调整风险、关系类型或时间范围；低风险关系仍保持折叠。</p>
          </div>
        ) : null}

        <div className={styles.graphDensityNote}>
          主图 {view.groups.length} 条 · 折叠 {view.collapsedGroupCount} 条
          {view.hiddenByDensityCount > 0 ? " · 其中 " + view.hiddenByDensityCount + " 条触发密度上限" : " · 画面密度正常"}
        </div>

        {storyDrawerOpen ? (
          <aside className={styles.graphStoryDrawer} aria-label="关联故事卡">
            <header><strong>关联故事卡</strong><button type="button" onClick={() => setStoryDrawerOpen(false)}>关闭</button></header>
            {storyCards.length ? (
              <ol>{storyCards.slice(0, 4).map((story) => <li key={story.id}><strong>{story.title}</strong><span>{story.summary}</span></li>)}</ol>
            ) : <p>当前可见关系没有关联故事卡。</p>}
          </aside>
        ) : null}
      </div>

      <footer className={styles.graphCanvasFooter}>
        <span>{expandedNodeId ? "已展开一层关系，再次点击节点可收起" : "点击节点只展开一层相关关系"}</span>
        <button type="button" onClick={() => setStoryDrawerOpen((current) => !current)}>查看关联故事卡 {storyCards.length}</button>
      </footer>
    </section>
  );
}

function clampZoom(value: number): number {
  return clamp(value, 0.78, 1.35);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
