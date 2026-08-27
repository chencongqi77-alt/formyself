import assert from "node:assert/strict";
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

test("knowledge graph defaults to unresolved human exceptions", () => {
  assert.equal(DEFAULT_GRAPH_SCOPE, "exceptions");

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

  assert.deepEqual(ids(deriveBookAgentGraphView([confirmed, pending, rejected])), ["pending"]);
  assert.deepEqual(
    ids(deriveBookAgentGraphView([confirmed, pending, rejected], { selectedId: "confirmed" })),
    ["pending"],
    "a previously selected confirmed relation must not leak into the default exception scope",
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

  const exceptionView = deriveBookAgentGraphView([pending, confirmed]);
  assert.deepEqual(exceptionView.groups[0].assessmentIds, ["pending-copy"]);

  const lowRiskView = deriveBookAgentGraphView([pending, confirmed], { scope: "all", risk: "low" });
  assert.deepEqual(lowRiskView.groups[0].assessmentIds, ["confirmed-copy"]);
});

test("explicit expansion stays inside the current scope and semantic subgraph", () => {
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

  const view = deriveBookAgentGraphView([journeyPending, journeyConfirmed, socialPending], {
    subgraph: "journey",
    expandedEntityId: "su-shi",
  });
  assert.deepEqual(ids(view), ["journey-pending"]);
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
