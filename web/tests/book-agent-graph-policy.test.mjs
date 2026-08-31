import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_GRAPH_SCOPE,
  MAX_VISIBLE_EDGES,
  MAX_VISIBLE_RELATION_GROUPS,
  MAX_VISIBLE_NODES,
  aggregateGraphAssessments,
  classifyGraphSubgraph,
  deriveBookAgentGraphView,
} from "../lib/book-agent-graph-policy.ts";

function assessment({
  id,
  kind = "journey",
  sourceId = "su-shi",
  targetId = `target-${id}`,
  relationLabel = "到访",
  reviewState = "needs-review",
  risk = "high",
  policyStatus = "pending",
  displayStatus = policyStatus,
  evidenceIds = [`evidence-${id}`],
  linkedStoryIds = [`story-${id}`],
  startYear,
  endYear,
}) {
  return {
    id,
    kind,
    sourceId,
    sourceLabel: sourceId,
    targetId,
    targetLabel: targetId,
    title: `${sourceId} — ${relationLabel} — ${targetId}`,
    relationLabel,
    confidence: risk === "low" ? 90 : 55,
    risk,
    policyStatus,
    displayStatus,
    reasonCode: risk === "low" ? "cross-verified" : "evidence-insufficient",
    reason: "测试关系",
    evidenceIds,
    evidenceExcerpt: "测试原文",
    evidenceLocator: "第 1 段",
    existingChecks: [],
    webSearchRequired: risk !== "low",
    linkedStoryIds,
    reviewState,
    autoApproved: risk === "low",
    startYear,
    endYear,
  };
}

function ids(view) {
  return view.groups.flatMap((group) => group.assessmentIds);
}

test("knowledge graph defaults to every valid relationship", () => {
  assert.equal(DEFAULT_GRAPH_SCOPE, "all");

  const pending = assessment({ id: "pending" });
  const confirmed = assessment({
    id: "confirmed",
    reviewState: "approved-private-preview",
    risk: "low",
    policyStatus: "confirmed",
  });
  const rejected = assessment({
    id: "rejected",
    reviewState: "rejected",
    policyStatus: "conflict",
    displayStatus: "conflict",
  });

  const defaultView = deriveBookAgentGraphView([confirmed, pending, rejected]);
  assert.deepEqual(new Set(ids(defaultView)), new Set(["confirmed", "pending"]));
  assert.equal(defaultView.hiddenByDensityCount, 0);
  assert.deepEqual(
    ids(deriveBookAgentGraphView([confirmed, pending, rejected], { scope: "exceptions" })),
    ["pending"],
    "the explicit exception scope must not include an already confirmed relation",
  );
  assert.deepEqual(
    new Set(ids(deriveBookAgentGraphView([confirmed, pending, rejected], { scope: "all" }))),
    new Set(["confirmed", "pending"]),
  );
});

test("every relationship kind maps to one stable semantic subgraph", () => {
  assert.equal(classifyGraphSubgraph(assessment({ id: "journey", kind: "journey" })), "journey");
  assert.equal(classifyGraphSubgraph(assessment({ id: "poem", kind: "poemWorld" })), "poemWorld");
  assert.equal(classifyGraphSubgraph(assessment({ id: "social", kind: "social" })), "social");

  const assessments = [
    assessment({ id: "journey", kind: "journey" }),
    assessment({ id: "poem", kind: "poemWorld" }),
    assessment({ id: "social", kind: "social" }),
  ];
  const poemView = deriveBookAgentGraphView(assessments, { subgraph: "poemWorld" });
  assert.deepEqual(ids(poemView), ["poem"]);
  assert.deepEqual(poemView.subgraphCounts, { journey: 1, poemWorld: 1, social: 1 });

  const selectedElsewhere = deriveBookAgentGraphView(assessments, {
    subgraph: "journey",
    selectedId: "poem",
  });
  assert.deepEqual(ids(selectedElsewhere), ["journey"], "an out-of-scope selection must not leak into a semantic subgraph");
});

test("graph density is capped while an explicitly selected relation remains visible", () => {
  assert.equal(MAX_VISIBLE_RELATION_GROUPS, 8);
  assert.equal(MAX_VISIBLE_NODES, 9);
  assert.equal(MAX_VISIBLE_EDGES, 8);
  const assessments = Array.from({ length: MAX_VISIBLE_RELATION_GROUPS + 5 }, (_, index) =>
    assessment({ id: `relation-${String(index + 1).padStart(2, "0")}` }),
  );
  const selectedId = assessments.at(-1).id;
  const view = deriveBookAgentGraphView(assessments, { selectedId });

  assert.equal(view.groups.length, MAX_VISIBLE_RELATION_GROUPS);
  assert.ok(ids(view).includes(selectedId));
  assert.equal(view.totalGroupCount, assessments.length);
  assert.equal(view.truncated, true);
});

test("comprehensive overview interleaves pending and confirmed relations at the density limit", () => {
  const pending = Array.from({ length: MAX_VISIBLE_RELATION_GROUPS }, (_, index) =>
    assessment({ id: `pending-${index}` }),
  );
  const confirmed = Array.from({ length: MAX_VISIBLE_RELATION_GROUPS }, (_, index) =>
    assessment({
      id: `confirmed-${index}`,
      reviewState: "approved-private-preview",
      risk: "low",
      policyStatus: "confirmed",
      displayStatus: "confirmed",
    }),
  );
  const view = deriveBookAgentGraphView([...pending, ...confirmed]);
  const visible = ids(view);

  assert.equal(view.groups.length, MAX_VISIBLE_RELATION_GROUPS);
  assert.equal(view.totalGroupCount, pending.length + confirmed.length);
  assert.equal(view.hiddenByDensityCount, pending.length + confirmed.length - MAX_VISIBLE_RELATION_GROUPS);
  assert.ok(visible.some((id) => id.startsWith("pending-")));
  assert.ok(visible.some((id) => id.startsWith("confirmed-")));
});

test("duplicate relations aggregate evidence and stories without consuming extra density slots", () => {
  const first = assessment({
    id: "duplicate-a",
    sourceId: "su-shi",
    targetId: "huangzhou",
    relationLabel: "谪居",
    evidenceIds: ["evidence-a", "evidence-shared"],
    linkedStoryIds: ["story-a"],
  });
  const second = assessment({
    id: "duplicate-b",
    sourceId: "su-shi",
    targetId: "huangzhou",
    relationLabel: "谪居",
    evidenceIds: ["evidence-b", "evidence-shared"],
    linkedStoryIds: ["story-b"],
  });

  const groups = aggregateGraphAssessments([first, second]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].occurrenceCount, 2);
  assert.deepEqual(groups[0].assessmentIds, ["duplicate-a", "duplicate-b"]);
  assert.deepEqual(groups[0].evidenceIds, ["evidence-a", "evidence-shared", "evidence-b"]);
  assert.deepEqual(groups[0].linkedStoryIds, ["story-a", "story-b"]);
});

test("scope and risk filters run before duplicate relations aggregate", () => {
  const pending = assessment({ id: "pending-copy", sourceId: "su-shi", targetId: "huangzhou", relationLabel: "谪居" });
  const confirmed = assessment({
    id: "confirmed-copy",
    sourceId: "su-shi",
    targetId: "huangzhou",
    relationLabel: "谪居",
    reviewState: "approved-private-preview",
    risk: "low",
    policyStatus: "confirmed",
    displayStatus: "confirmed",
  });

  const exceptionView = deriveBookAgentGraphView([pending, confirmed], { scope: "exceptions" });
  assert.deepEqual(exceptionView.groups[0].assessmentIds, ["pending-copy"]);

  const lowRiskView = deriveBookAgentGraphView([pending, confirmed], { scope: "all", risk: "low" });
  assert.deepEqual(lowRiskView.groups[0].assessmentIds, ["confirmed-copy"]);
});

test("explicit expansion stays inside the selected scope and semantic subgraph", () => {
  const journeyPending = assessment({ id: "journey-pending", kind: "journey" });
  const journeyConfirmed = assessment({
    id: "journey-confirmed",
    kind: "journey",
    reviewState: "approved-private-preview",
    risk: "low",
    policyStatus: "confirmed",
    displayStatus: "confirmed",
  });
  const socialPending = assessment({ id: "social-pending", kind: "social", targetId: "friend" });

  const comprehensiveView = deriveBookAgentGraphView([journeyPending, journeyConfirmed, socialPending], {
    subgraph: "journey",
    expandedEntityId: "su-shi",
  });
  assert.deepEqual(new Set(ids(comprehensiveView)), new Set(["journey-pending", "journey-confirmed"]));

  const exceptionView = deriveBookAgentGraphView([journeyPending, journeyConfirmed, socialPending], {
    scope: "exceptions",
    subgraph: "journey",
    expandedEntityId: "su-shi",
  });
  assert.deepEqual(ids(exceptionView), ["journey-pending"]);
});

test("inclusive time filtering keeps overlapping dated relations and hides unknown dates", () => {
  const assessments = [
    assessment({ id: "before", startYear: 1070, endYear: 1072 }),
    assessment({ id: "overlap", startYear: 1080, endYear: 1083 }),
    assessment({ id: "after", startYear: 1090, endYear: 1091 }),
    assessment({ id: "unknown" }),
  ];

  const view = deriveBookAgentGraphView(assessments, {
    timeRange: { startYear: 1082, endYear: 1086 },
  });
  assert.deepEqual(ids(view), ["overlap"]);

  const exactBoundary = deriveBookAgentGraphView(assessments, {
    timeRange: { startYear: 1083, endYear: 1083 },
  });
  assert.deepEqual(ids(exactBoundary), ["overlap"]);
});

test("separate duplicate dates never create a synthetic time span", () => {
  const assessments = [
    assessment({ id: "early", sourceId: "su-shi", targetId: "huangzhou", relationLabel: "谪居", startYear: 1000 }),
    assessment({ id: "late", sourceId: "su-shi", targetId: "huangzhou", relationLabel: "谪居", startYear: 1100 }),
  ];
  assert.deepEqual(ids(deriveBookAgentGraphView(assessments, {
    timeRange: { startYear: 1050, endYear: 1050 },
  })), []);

  const withUndated = deriveBookAgentGraphView([
    ...assessments,
    assessment({ id: "undated", sourceId: "su-shi", targetId: "xuzhou" }),
  ], {
    timeRange: { startYear: 1050, endYear: 1050 },
    includeUndated: true,
  });
  assert.deepEqual(ids(withUndated), ["undated"]);
});

test("verification UI presents a comprehensive graph without a low-risk pseudo node", async () => {
  const [graphSource, workbenchSource, shellSource, stylesSource] = await Promise.all([
    readFile(new URL("../app/components/BookAgentKnowledgeGraph.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/BookAgentVerificationWorkbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/BookAgentWorkbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/agent.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(graphSource, /label: "综合图谱"/);
  assert.match(graphSource, /scope: DEFAULT_GRAPH_SCOPE/);
  assert.match(graphSource, /function positionOverviewNodes/);
  assert.match(graphSource, /function positionJourneyNodes/);
  assert.match(graphSource, /function positionSocialNodes/);
  assert.match(graphSource, /function positionPoemWorldNodes/);
  assert.match(graphSource, /data-node-kind/);
  assert.match(graphSource, /rx=\{placeHalfHeight\}/, "places use rounded seal or capsule nodes");
  assert.match(graphSource, /graphEdgeLabelGroup/);
  assert.match(graphSource, /graphEdgeCountBadge/);
  assert.match(graphSource, /graphNodeFaded/);
  assert.match(graphSource, /graphNodeFoldBadge/);
  assert.match(graphSource, /graphNodeHitArea/);
  assert.match(graphSource, /graphFoldButton/);
  assert.match(graphSource, /role: "button"/);
  assert.match(graphSource, /"aria-pressed": active/);
  assert.match(graphSource, /setActiveNodeId\(node\.id\)/);
  assert.match(graphSource, /GRAPH_CONTENT_CENTER_X = GRAPH_WIDTH \/ 2/);
  assert.match(graphSource, /x: GRAPH_CONTENT_CENTER_X, y: GRAPH_CONTENT_CENTER_Y/);
  assert.match(graphSource, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(graphSource, /const stableRawNodes = \[\.\.\.rawNodes\.values\(\)\]\.sort/);
  assert.match(graphSource, /const nextAssessmentId = nextEdge \? assessmentIdForEdge\(nextEdge\) : null/);
  assert.doesNotMatch(graphSource, /expandedNodeId|setExpandedNodeId/);
  const stableViewMemo = graphSource.match(/const view = useMemo\(\(\) => deriveBookAgentGraphView[\s\S]*?\n  \]\);/);
  assert.ok(stableViewMemo, "the rendered graph view memo must be present");
  assert.doesNotMatch(stableViewMemo[0], /selectedId|expandedEntityId/, "selection must not change graph topology or layout");
  assert.match(graphSource, /EXPANDED_GRAPH_GROUP_LIMIT = 10/);
  assert.doesNotMatch(graphSource, /__collapsed-low-risk__|低风险已折叠|低风险（折叠查看）|异常关系分层知识图谱/);
  assert.doesNotMatch(graphSource, /RiskFilter|graphFilterBar|graphFocusBar|graphDensityNote|graphCanvasFooter|storyDrawerOpen|graphStatusSummary/);
  assert.doesNotMatch(graphSource, /graphNodeAction/);
  assert.match(workbenchSource, /useState<string \| null>\(\(\) => summary\.pendingExceptions\[0\]\?\.id \?\? null\)/);
  assert.match(workbenchSource, /reviewConsole/);
  assert.match(workbenchSource, /reviewQueue/);
  assert.match(workbenchSource, /reviewSummaryMetrics/);
  assert.match(workbenchSource, /evidenceSourceCount/);
  assert.match(workbenchSource, /data-review-collapsed/);
  assert.match(workbenchSource, /reviewConsoleCollapsed/);
  assert.match(workbenchSource, /aria-label="收起右侧核验卡片"/);
  assert.match(workbenchSource, /aria-label="展开右侧核验卡片"/);
  assert.match(workbenchSource, /className=\{styles\.reviewConsoleContent\} hidden=\{reviewCollapsed\}/);
  assert.match(workbenchSource, /<details className=\{styles\.reviewVerificationDetails\}>/);
  assert.match(workbenchSource, /原文证据/);
  assert.match(workbenchSource, /站内资料/);
  assert.match(workbenchSource, /联网结果/);
  assert.match(workbenchSource, /详细 Agent 判断/);
  assert.doesNotMatch(workbenchSource, /exceptionRail|exceptionFilters|graphStatusFooter|searchRequests/);
  assert.doesNotMatch(workbenchSource, /Agent 已完成本轮初筛|仅异常需人工处理|verificationStatusBar|modelNotice/);
  assert.doesNotMatch(shellSource, /setNotice|notice=\{notice\}/);
  assert.match(stylesSource, /\.reviewConsole/);
  assert.match(stylesSource, /\.graphEdge:hover \.graphEdgeLabelGroup/);
  assert.match(stylesSource, /\.graphNodeFaded/);
  assert.match(stylesSource, /\.graphInteractionNote/);
  assert.match(stylesSource, /\.graphFoldButton/);
  assert.match(stylesSource, /\.graphNode:hover/);
  assert.match(stylesSource, /\.reviewConsole\.reviewConsoleCollapsed/);
  assert.match(stylesSource, /data-review-collapsed="true"/);
  assert.doesNotMatch(stylesSource, /\.verificationStatusBar|\.verificationPipeline|\.modelNotice/);
});
