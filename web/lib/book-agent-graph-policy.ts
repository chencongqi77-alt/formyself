import type {
  RelationshipAssessment,
  VerificationReasonCode,
  VerificationRisk,
  VerificationStatus,
} from "./book-agent-verification";

export const DEFAULT_GRAPH_SCOPE = "exceptions" as const;
export const MAX_VISIBLE_RELATION_GROUPS = 8;
export const MAX_VISIBLE_NODES = 9;
export const MAX_VISIBLE_EDGES = 8;

export type BookAgentGraphScope = "exceptions" | "all";
export type BookAgentGraphSubgraph = "overview" | "journey" | "social" | "poemWorld";
export type BookAgentGraphEntityKind = "person" | "place" | "work";

export type GraphAssessment = RelationshipAssessment & {
  startYear?: number;
  endYear?: number;
  sourceEntityType?: BookAgentGraphEntityKind;
  targetEntityType?: BookAgentGraphEntityKind;
};

export interface BookAgentGraphRelationGroup {
  key: string;
  primaryAssessmentId: string;
  assessmentIds: string[];
  kind: RelationshipAssessment["kind"];
  sourceId: string;
  sourceLabel: string;
  sourceEntityType: BookAgentGraphEntityKind;
  targetId: string;
  targetLabel: string;
  targetEntityType: BookAgentGraphEntityKind;
  relationLabel: string;
  risk: VerificationRisk;
  displayStatus: VerificationStatus;
  reasonCode: VerificationReasonCode;
  reviewState: RelationshipAssessment["reviewState"];
  confidence: number;
  occurrenceCount: number;
  evidenceIds: string[];
  linkedStoryIds: string[];
  startYear?: number;
  endYear?: number;
}

export interface BookAgentGraphViewOptions {
  scope?: BookAgentGraphScope;
  subgraph?: BookAgentGraphSubgraph;
  risk?: VerificationRisk | "all";
  relationLabel?: string | "all";
  entityKind?: BookAgentGraphEntityKind | "all";
  timeRange?: { startYear: number; endYear: number };
  includeUndated?: boolean;
  focusEntityIds?: string[];
  selectedId?: string | null;
  expandedEntityId?: string | null;
  maxGroups?: number;
  maxNodes?: number;
}

export interface BookAgentGraphView {
  scope: BookAgentGraphScope;
  subgraph: BookAgentGraphSubgraph;
  groups: BookAgentGraphRelationGroup[];
  totalGroupCount: number;
  truncated: boolean;
  collapsedGroupCount: number;
  collapsedLowRiskCount: number;
  hiddenByDensityCount: number;
  expandedRelatedCount: number;
  storyIds: string[];
  expandableRelationCounts: Record<string, number>;
  subgraphCounts: Record<Exclude<BookAgentGraphSubgraph, "overview">, number>;
}

const RISK_RANK: Record<VerificationRisk, number> = { high: 0, medium: 1, low: 2 };
const STATUS_RANK: Record<VerificationStatus, number> = {
  conflict: 0,
  "low-confidence": 1,
  pending: 2,
  confirmed: 3,
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function reviewPending(assessment: Pick<RelationshipAssessment, "reviewState">): boolean {
  return assessment.reviewState === "needs-review" || assessment.reviewState === "candidate-preview";
}

function inferredEntityKinds(assessment: Pick<RelationshipAssessment, "kind">): [BookAgentGraphEntityKind, BookAgentGraphEntityKind] {
  if (assessment.kind === "journey") return ["person", "place"];
  if (assessment.kind === "poemWorld") return ["work", "place"];
  return ["person", "person"];
}

function relationKey(assessment: RelationshipAssessment): string {
  return `${assessment.sourceId}|${assessment.relationLabel}|${assessment.targetId}`;
}

function minDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => typeof value === "number");
  return defined.length ? Math.min(...defined) : undefined;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => typeof value === "number");
  return defined.length ? Math.max(...defined) : undefined;
}

function assessmentPriority(left: RelationshipAssessment, right: RelationshipAssessment): number {
  const pendingDifference = Number(reviewPending(right)) - Number(reviewPending(left));
  if (pendingDifference) return pendingDifference;
  const riskDifference = RISK_RANK[left.risk] - RISK_RANK[right.risk];
  if (riskDifference) return riskDifference;
  const statusDifference = STATUS_RANK[left.displayStatus] - STATUS_RANK[right.displayStatus];
  return statusDifference || left.id.localeCompare(right.id);
}

export function classifyGraphSubgraph(
  assessment: Pick<RelationshipAssessment, "kind">,
): Exclude<BookAgentGraphSubgraph, "overview"> {
  return assessment.kind;
}

export function aggregateGraphAssessments(
  assessments: GraphAssessment[],
): BookAgentGraphRelationGroup[] {
  const groups = new Map<string, GraphAssessment[]>();
  for (const assessment of assessments) {
    if (assessment.reviewState === "rejected") continue;
    const key = relationKey(assessment);
    groups.set(key, [...(groups.get(key) ?? []), assessment]);
  }

  return [...groups.entries()].map(([key, records]) => {
    const ordered = [...records].sort(assessmentPriority);
    const primary = ordered[0];
    const [fallbackSourceKind, fallbackTargetKind] = inferredEntityKinds(primary);
    return {
      key,
      primaryAssessmentId: primary.id,
      assessmentIds: records.map((record) => record.id),
      kind: primary.kind,
      sourceId: primary.sourceId,
      sourceLabel: primary.sourceLabel,
      sourceEntityType: primary.sourceEntityType ?? fallbackSourceKind,
      targetId: primary.targetId,
      targetLabel: primary.targetLabel,
      targetEntityType: primary.targetEntityType ?? fallbackTargetKind,
      relationLabel: primary.relationLabel,
      risk: primary.risk,
      displayStatus: primary.displayStatus,
      reasonCode: primary.reasonCode,
      reviewState: primary.reviewState,
      confidence: Math.min(...records.map((record) => record.confidence)),
      occurrenceCount: records.length,
      evidenceIds: unique(records.flatMap((record) => record.evidenceIds)),
      linkedStoryIds: unique(records.flatMap((record) => record.linkedStoryIds)),
      startYear: minDefined(records.map((record) => record.startYear)),
      endYear: maxDefined(records.map((record) => record.endYear ?? record.startYear)),
    };
  });
}

function matchesTimeRange(
  assessment: GraphAssessment,
  range: BookAgentGraphViewOptions["timeRange"],
  includeUndated: boolean,
): boolean {
  if (!range) return true;
  if (typeof assessment.startYear !== "number" && typeof assessment.endYear !== "number") return includeUndated;
  const start = assessment.startYear ?? assessment.endYear as number;
  const end = assessment.endYear ?? assessment.startYear as number;
  return start <= range.endYear && end >= range.startYear;
}

function matchesFocus(assessment: GraphAssessment, focusIds: Set<string>): boolean {
  return !focusIds.size || focusIds.has(assessment.sourceId) || focusIds.has(assessment.targetId);
}

function groupPending(group: BookAgentGraphRelationGroup): boolean {
  return group.reviewState === "needs-review" || group.reviewState === "candidate-preview";
}

function groupPriority(
  selectedId: string | null | undefined,
  expandedEntityId: string | null | undefined,
): (left: BookAgentGraphRelationGroup, right: BookAgentGraphRelationGroup) => number {
  return (left, right) => {
    const leftSelected = Boolean(selectedId && left.assessmentIds.includes(selectedId));
    const rightSelected = Boolean(selectedId && right.assessmentIds.includes(selectedId));
    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
    const leftExpanded = Boolean(expandedEntityId && (left.sourceId === expandedEntityId || left.targetId === expandedEntityId));
    const rightExpanded = Boolean(expandedEntityId && (right.sourceId === expandedEntityId || right.targetId === expandedEntityId));
    if (leftExpanded !== rightExpanded) return leftExpanded ? -1 : 1;
    const pendingDifference = Number(groupPending(right)) - Number(groupPending(left));
    if (pendingDifference) return pendingDifference;
    const riskDifference = RISK_RANK[left.risk] - RISK_RANK[right.risk];
    if (riskDifference) return riskDifference;
    const statusDifference = STATUS_RANK[left.displayStatus] - STATUS_RANK[right.displayStatus];
    return statusDifference || left.primaryAssessmentId.localeCompare(right.primaryAssessmentId);
  };
}

function limitByNodeDensity(
  groups: BookAgentGraphRelationGroup[],
  maxGroups: number,
  maxNodes: number,
): BookAgentGraphRelationGroup[] {
  const visible: BookAgentGraphRelationGroup[] = [];
  const nodeIds = new Set<string>();
  for (const group of groups) {
    if (visible.length >= maxGroups) break;
    const nextNodeIds = new Set(nodeIds);
    nextNodeIds.add(group.sourceId);
    nextNodeIds.add(group.targetId);
    if (nextNodeIds.size > maxNodes) continue;
    visible.push(group);
    nextNodeIds.forEach((id) => nodeIds.add(id));
  }
  return visible;
}

export function deriveBookAgentGraphView(
  assessments: GraphAssessment[],
  options: BookAgentGraphViewOptions = {},
): BookAgentGraphView {
  const scope = options.scope ?? DEFAULT_GRAPH_SCOPE;
  const subgraph = options.subgraph ?? "overview";
  const focusIds = new Set(options.focusEntityIds ?? []);
  const selectedId = options.selectedId ?? null;
  const expandedEntityId = options.expandedEntityId ?? null;
  const allGroups = aggregateGraphAssessments(assessments);
  const subgraphCounts = allGroups.reduce<Record<Exclude<BookAgentGraphSubgraph, "overview">, number>>(
    (counts, group) => ({ ...counts, [classifyGraphSubgraph(group)]: counts[classifyGraphSubgraph(group)] + 1 }),
    { journey: 0, poemWorld: 0, social: 0 },
  );

  const commonFiltered = assessments.filter((assessment) => {
    if (assessment.reviewState === "rejected") return false;
    if (options.risk && options.risk !== "all" && assessment.risk !== options.risk) return false;
    if (options.relationLabel && options.relationLabel !== "all" && assessment.relationLabel !== options.relationLabel) return false;
    const [sourceKind, targetKind] = inferredEntityKinds(assessment);
    const effectiveSourceKind = assessment.sourceEntityType ?? sourceKind;
    const effectiveTargetKind = assessment.targetEntityType ?? targetKind;
    if (options.entityKind && options.entityKind !== "all" && effectiveSourceKind !== options.entityKind && effectiveTargetKind !== options.entityKind) return false;
    if (!matchesTimeRange(assessment, options.timeRange, options.includeUndated ?? false)) return false;
    return true;
  });

  const inCurrentSubgraph = (assessment: GraphAssessment): boolean => (
    subgraph === "overview" || classifyGraphSubgraph(assessment) === subgraph
  );
  const structurallyFiltered = commonFiltered.filter((assessment) => {
    if (!inCurrentSubgraph(assessment)) return false;
    return matchesFocus(assessment, focusIds);
  });
  const scopeFiltered = commonFiltered.filter((assessment) => scope === "all" || reviewPending(assessment));
  const scoped = structurallyFiltered.filter((assessment) => scope === "all" || reviewPending(assessment));
  const expanded = expandedEntityId
    ? scopeFiltered.filter((assessment) => (
        inCurrentSubgraph(assessment)
        && (assessment.sourceId === expandedEntityId || assessment.targetId === expandedEntityId)
      ))
    : [];
  const selected = selectedId
    ? scopeFiltered.filter((assessment) => inCurrentSubgraph(assessment) && assessment.id === selectedId)
    : [];
  const candidateAssessments = unique([...scoped, ...expanded, ...selected]);
  const candidates = aggregateGraphAssessments(candidateAssessments);
  const ordered = [...candidates].sort(groupPriority(selectedId, expandedEntityId));
  const groups = limitByNodeDensity(
    ordered,
    options.maxGroups ?? MAX_VISIBLE_RELATION_GROUPS,
    options.maxNodes ?? MAX_VISIBLE_NODES,
  );
  const structuralGroups = aggregateGraphAssessments(structurallyFiltered);
  const visibleKeys = new Set(groups.map((group) => group.key));
  const collapsedLowRiskCount = scope === "exceptions"
    ? structuralGroups
      .filter((group) => group.risk === "low" && group.displayStatus === "confirmed" && !visibleKeys.has(group.key))
      .reduce((total, group) => total + group.occurrenceCount, 0)
    : 0;
  const expandableGroups = aggregateGraphAssessments(
    scopeFiltered.filter((assessment) => inCurrentSubgraph(assessment)),
  );
  const expandableRelationCounts = expandableGroups.reduce<Record<string, number>>((counts, group) => {
    counts[group.sourceId] = (counts[group.sourceId] ?? 0) + 1;
    counts[group.targetId] = (counts[group.targetId] ?? 0) + 1;
    return counts;
  }, {});
  const expandedRelatedCount = expandedEntityId
    ? expandableGroups.filter((group) => group.sourceId === expandedEntityId || group.targetId === expandedEntityId).length
    : 0;

  return {
    scope,
    subgraph,
    groups,
    totalGroupCount: candidates.length,
    truncated: groups.length < candidates.length,
    collapsedGroupCount: Math.max(0, structuralGroups.length - groups.length),
    collapsedLowRiskCount,
    hiddenByDensityCount: Math.max(0, candidates.length - groups.length),
    expandedRelatedCount,
    storyIds: unique(groups.flatMap((group) => group.linkedStoryIds)),
    expandableRelationCounts,
    subgraphCounts,
  };
}
