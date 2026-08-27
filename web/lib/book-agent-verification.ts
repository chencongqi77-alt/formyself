import {
  validateBookDraft,
  type BookAnalysisDraft,
  type BookAnalysisResult,
  type ReviewState,
} from "./book-agent";

export type VerificationRelationKind = "journey" | "poemWorld" | "social";
export type VerificationRisk = "low" | "medium" | "high";
export type VerificationStatus = "confirmed" | "pending" | "conflict" | "low-confidence";
export type VerificationReasonCode = "cross-verified" | "evidence-insufficient" | "conflict";
export type VerificationCheckState = "supporting" | "not-found" | "unavailable" | "not-applicable";
export type VerificationDecisionActor = "agent" | "human";
export type VerificationDecisionAction = "needs-review" | "approved" | "rejected" | "modified";

export interface VerificationDecisionRecord {
  relationId: string;
  actor: VerificationDecisionActor;
  action: VerificationDecisionAction;
  decidedAt: string;
  confidence: number;
  risk: VerificationRisk;
  reasonCode: VerificationReasonCode;
  reason: string;
  forceHumanReview: boolean;
}

export interface BookVerificationMetadata {
  policyVersion: "relationship-risk-v1";
  assessedAt: string;
  decisions: Record<string, VerificationDecisionRecord>;
}

type BookAnalysisWithVerification = BookAnalysisResult & {
  verification?: BookVerificationMetadata;
};

export interface VerificationCheck {
  id: string;
  label: string;
  detail: string;
  state: VerificationCheckState;
  sourceIds: string[];
}

export interface RelationshipAssessment {
  id: string;
  kind: VerificationRelationKind;
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
  title: string;
  relationLabel: string;
  confidence: number;
  risk: VerificationRisk;
  policyStatus: VerificationStatus;
  displayStatus: VerificationStatus;
  reasonCode: VerificationReasonCode;
  reason: string;
  evidenceIds: string[];
  evidenceExcerpt: string;
  evidenceLocator: string;
  existingChecks: VerificationCheck[];
  webSearchRequired: boolean;
  linkedStoryIds: string[];
  reviewState: ReviewState;
  autoApproved: boolean;
  decisionActor?: VerificationDecisionActor;
  decisionAction?: VerificationDecisionAction;
  startYear?: number;
  endYear?: number;
  sourceEntityType: "person" | "place" | "work";
  targetEntityType: "person" | "place" | "work";
}

export interface VerificationSummary {
  assessments: RelationshipAssessment[];
  pendingExceptions: RelationshipAssessment[];
  autoApprovedCount: number;
  resolvedByHumanCount: number;
  rejectedCount: number;
  highRiskCount: number;
  insufficientCount: number;
  conflictCount: number;
  complete: boolean;
}

export const JOURNEY_RELATION_OPTIONS = [
  ["born-at", "出生于"],
  ["died-at", "卒于"],
  ["resided-at", "居于"],
  ["visited", "到访"],
  ["traveled-to", "行至"],
  ["held-office-at", "任职于"],
  ["exiled-to", "谪居"],
  ["studied-at", "从学于"],
  ["stayed-at", "寄居"],
] as const;

export const POEM_RELATION_OPTIONS = [
  ["composed-at", "作于"],
  ["inscribed-at", "题于"],
  ["describes-place", "题咏"],
  ["mentioned-place", "写到"],
] as const;

export const SOCIAL_RELATION_OPTIONS = [
  ["kin", "亲属"],
  ["literary-exchange", "文学交往"],
  ["official", "同僚 / 官场"],
  ["teacher-student", "师生"],
  ["friendship", "交游"],
  ["other", "往来"],
] as const;

const JOURNEY_LABELS = new Map<string, string>(JOURNEY_RELATION_OPTIONS);
const POEM_LABELS = new Map<string, string>(POEM_RELATION_OPTIONS);
const SOCIAL_LABELS = new Map<string, string>(SOCIAL_RELATION_OPTIONS);

const JOURNEY_REFERENCE_CUES: Record<string, RegExp> = {
  "born-at": /出生|生于|诞生/,
  "died-at": /卒于|去世|逝世|病逝|身故/,
  "resided-at": /寓居|居住|居于|迁居|定居|住在/,
  visited: /游历|游于|到访|过访|拜访|游赤壁|游览/,
  "traveled-to": /抵达|到达|前往|赴任|行至|迁往|到黄州|到湖州|到徐州/,
  "held-office-at": /任职|知州|知府|太守|通判|任上|团练副使|官于/,
  "exiled-to": /谪居|贬谪|贬至|流放|团练副使/,
  "studied-at": /从学|求学|师从|就学/,
  "stayed-at": /寄居|暂住|寓居|停留/,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function reviewFinished(state: ReviewState): boolean {
  return state === "approved-private-preview" || state === "rejected";
}

function decisionFor(result: BookAnalysisResult, relationId: string): VerificationDecisionRecord | undefined {
  return (result as BookAnalysisWithVerification).verification?.decisions[relationId];
}

function decisionRecord(
  assessment: RelationshipAssessment,
  actor: VerificationDecisionActor,
  action: VerificationDecisionAction,
  forceHumanReview: boolean,
): VerificationDecisionRecord {
  return {
    relationId: assessment.id,
    actor,
    action,
    decidedAt: new Date().toISOString(),
    confidence: assessment.confidence,
    risk: assessment.risk,
    reasonCode: assessment.reasonCode,
    reason: assessment.reason,
    forceHumanReview,
  };
}

function excerptFor(result: BookAnalysisResult, evidenceIds: string[]): { text: string; locator: string; directCount: number; contradicts: boolean } {
  const evidence = result.draft.evidence.filter((item) => evidenceIds.includes(item.id));
  const primary = evidence.find((item) => item.support === "direct") ?? evidence[0];
  if (!primary) {
    return { text: "暂无可回读的原文片段。", locator: "未定位", directCount: 0, contradicts: false };
  }
  const text = result.sourceText
    .slice(primary.locator.startOffset, primary.locator.endOffset)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  return {
    text: text || "原文片段为空。",
    locator: primary.locator.label,
    directCount: evidence.filter((item) => item.support === "direct").length,
    contradicts: evidence.some((item) => item.support === "contradicts"),
  };
}

function statusFor(
  confidence: number,
  supports: number,
  contradicts: boolean,
): { status: VerificationStatus; risk: VerificationRisk; reasonCode: VerificationReasonCode; reason: string } {
  if (contradicts) {
    return {
      status: "conflict",
      risk: "high",
      reasonCode: "conflict",
      reason: "原文与既有资料出现冲突，不能自动写入关系图。",
    };
  }
  if (confidence >= 82 && supports > 0) {
    return {
      status: "confirmed",
      risk: "low",
      reasonCode: "cross-verified",
      reason: "原文证据与至少一项既有资料相互印证，满足低风险自动通过条件。",
    };
  }
  if (confidence < 58) {
    return {
      status: "low-confidence",
      risk: "high",
      reasonCode: "evidence-insufficient",
      reason: "原文线索较弱，且内部资料不足，需人工判断或继续检索。",
    };
  }
  return {
    status: "pending",
    risk: confidence < 70 ? "high" : "medium",
    reasonCode: "evidence-insufficient",
    reason: "关系方向基本可读，但缺少足够的时间、事件或交叉来源支撑。",
  };
}

function displayStatus(policyStatus: VerificationStatus, reviewState: ReviewState): VerificationStatus {
  if (reviewState === "approved-private-preview") return "confirmed";
  if (reviewState === "rejected") return "conflict";
  return policyStatus;
}

function displayStatusForDecision(
  policyStatus: VerificationStatus,
  reviewState: ReviewState,
  decision: VerificationDecisionRecord | undefined,
): VerificationStatus {
  if (decision?.forceHumanReview && !reviewFinished(reviewState)) return "pending";
  return displayStatus(policyStatus, reviewState);
}

function reasonForDecision(
  decision: VerificationDecisionRecord | undefined,
  fallback: string,
): string {
  return decision?.forceHumanReview
    ? "关系类型已由人工修改，Agent 已完成重新核验；需人工确认新语义后才能进入私有发布包。"
    : fallback;
}

function buildJourneyAssessments(result: BookAnalysisResult): RelationshipAssessment[] {
  const { draft, references } = result;
  const places = new Map(draft.entities.places.map((place) => [place.id, place]));
  return draft.volumes.journey.items.map((item) => {
    const place = places.get(item.placeId);
    const original = excerptFor(result, item.evidenceIds);
    const events = references.journeyByPlace[item.placeId] ?? [];
    const relationCue = JOURNEY_REFERENCE_CUES[item.predicate];
    const supportingEvents = relationCue
      ? events.filter((event) => relationCue.test(`${event.title}\n${event.summary}\n${event.lifeStage ?? ""}\n${event.role ?? ""}`))
      : [];
    const preciseYear = item.time?.startYear;
    const datedEvents = supportingEvents.filter((event) => typeof event.startYear === "number" || typeof event.endYear === "number");
    const timeConflict = typeof preciseYear === "number" && datedEvents.length > 0 && !datedEvents.some((event) => {
      const start = event.startYear ?? event.endYear ?? preciseYear;
      const end = event.endYear ?? event.startYear ?? preciseYear;
      return preciseYear >= start - 1 && preciseYear <= end + 1;
    });
    const confidence = clamp(
      42
        + (original.directCount > 0 ? 22 : 0)
        + (place?.resolutionState === "resolved" ? 10 : 0)
        + (item.mapEligible ? 4 : 0)
        + (supportingEvents.length > 0 ? 22 : events.length > 0 ? 5 : 0)
        + (item.time?.precision === "year" ? 4 : 0)
        - (timeConflict ? 38 : 0),
      15,
      98,
    );
    const policy = statusFor(confidence, supportingEvents.length, original.contradicts || timeConflict);
    const checks: VerificationCheck[] = [
      {
        id: `published-events:${item.placeId}`,
        label: "站内行迹资料",
        detail: supportingEvents.length
          ? `${supportingEvents.length} 条同地点、同关系语义记录：${supportingEvents.slice(0, 2).map((event) => event.title).join("；")}`
          : events.length
            ? `找到 ${events.length} 条同地点资料，但关系语义与“${JOURNEY_LABELS.get(item.predicate) ?? item.predicate}”不一致。`
          : "未找到可直接对应的已发布行迹记录。",
        state: supportingEvents.length ? "supporting" : references.sources.find((source) => source.id === "published-events")?.available ? "not-found" : "unavailable",
        sourceIds: events.flatMap((event) => event.sourceIds),
      },
    ];
    const relationLabel = JOURNEY_LABELS.get(item.predicate) ?? item.predicate;
    const decision = decisionFor(result, item.id);
    const autoApproved = policy.risk === "low" && policy.status === "confirmed" && !decision?.forceHumanReview;
    return {
      id: item.id,
      kind: "journey",
      sourceId: draft.poet.id,
      sourceLabel: draft.poet.name,
      targetId: item.placeId,
      targetLabel: place?.label ?? item.placeId,
      title: `${draft.poet.name} — ${relationLabel} — ${place?.label ?? item.placeId}`,
      relationLabel,
      confidence,
      risk: policy.risk,
      policyStatus: policy.status,
      displayStatus: displayStatusForDecision(policy.status, item.reviewState, decision),
      reasonCode: policy.reasonCode,
      reason: reasonForDecision(decision, policy.reason),
      evidenceIds: item.evidenceIds,
      evidenceExcerpt: original.text,
      evidenceLocator: original.locator,
      existingChecks: checks,
      webSearchRequired: !autoApproved && supportingEvents.length === 0,
      linkedStoryIds: item.storyIds,
      reviewState: item.reviewState,
      autoApproved,
      decisionActor: decision?.actor,
      decisionAction: decision?.action,
      startYear: item.time?.startYear,
      endYear: item.time?.endYear,
      sourceEntityType: "person",
      targetEntityType: "place",
    };
  });
}

function buildPoemAssessments(result: BookAnalysisResult): RelationshipAssessment[] {
  const { draft, references } = result;
  const places = new Map(draft.entities.places.map((place) => [place.id, place]));
  const works = new Map(draft.entities.works.map((work) => [work.id, work]));
  return draft.volumes.poemWorld.items.flatMap((item) => {
    if (!item.placeId) return [];
    const place = places.get(item.placeId);
    const work = works.get(item.workId);
    const original = excerptFor(result, item.evidenceIds);
    const placeWorks = references.worksByPlace[item.placeId] ?? [];
    const exactWorks = placeWorks.filter((candidate) => candidate.id === item.workId || candidate.title === work?.title);
    const strongWorks = exactWorks.filter((candidate) => {
      if (item.relationType === "composed-at" || item.relationType === "inscribed-at") {
        return candidate.origin === "published-work-place-link" && candidate.relationType === item.relationType;
      }
      return true;
    });
    const semanticMismatch = exactWorks.length > 0
      && (item.relationType === "composed-at" || item.relationType === "inscribed-at")
      && strongWorks.length === 0;
    const supports = strongWorks.length;
    const confidence = clamp(
      40
        + (original.directCount > 0 ? 22 : 0)
        + (work?.discoveryState === "matched" ? 10 : 0)
        + (place?.resolutionState === "resolved" ? 8 : 0)
        + (strongWorks.length > 0 ? 22 : exactWorks.length > 0 ? 8 : 0)
        - (semanticMismatch ? 8 : 0),
      15,
      98,
    );
    const policy = statusFor(confidence, supports, original.contradicts);
    const sourceAvailable = references.sources.find((source) => source.id === "chinese-poetry")?.available ?? false;
    const checks: VerificationCheck[] = [
      {
        id: `chinese-poetry:${item.workId}:${item.placeId}`,
        label: "chinese-poetry / 站内作品关系",
        detail: strongWorks.length
          ? `${strongWorks.length} 条同作品、同地点资料可佐证${item.relationType === "composed-at" ? "创作地" : "作品空间关系"}。`
          : exactWorks.length
            ? "找到同作品与地点记录，但其语义不足以直接证明当前关系。"
            : "未找到同作品、同地点的可比记录。",
        state: strongWorks.length ? "supporting" : sourceAvailable ? "not-found" : "unavailable",
        sourceIds: exactWorks.flatMap((candidate) => candidate.sourceIds),
      },
    ];
    const relationLabel = POEM_LABELS.get(item.relationType ?? "") ?? "关联地点";
    const decision = decisionFor(result, item.id);
    const autoApproved = policy.risk === "low" && policy.status === "confirmed" && !decision?.forceHumanReview;
    return [{
      id: item.id,
      kind: "poemWorld" as const,
      sourceId: item.workId,
      sourceLabel: work?.title ?? item.workId,
      targetId: item.placeId,
      targetLabel: place?.label ?? item.placeId,
      title: `《${(work?.title ?? item.workId).replace(/^《|》$/g, "")}》— ${relationLabel} — ${place?.label ?? item.placeId}`,
      relationLabel,
      confidence,
      risk: policy.risk,
      policyStatus: policy.status,
      displayStatus: displayStatusForDecision(policy.status, item.reviewState, decision),
      reasonCode: policy.reasonCode,
      reason: reasonForDecision(decision, semanticMismatch
        ? "已有作品资料只支持地点被题咏或提及，尚不足以证明创作地。"
        : policy.reason),
      evidenceIds: item.evidenceIds,
      evidenceExcerpt: original.text,
      evidenceLocator: original.locator,
      existingChecks: checks,
      webSearchRequired: !autoApproved && strongWorks.length === 0,
      linkedStoryIds: item.storyIds,
      reviewState: item.reviewState,
      autoApproved,
      decisionActor: decision?.actor,
      decisionAction: decision?.action,
      sourceEntityType: "work",
      targetEntityType: "place",
    }];
  });
}

function buildSocialAssessments(result: BookAnalysisResult): RelationshipAssessment[] {
  const { draft, references } = result;
  const people = new Map(draft.entities.people.map((person) => [person.id, person]));
  const referenceByPair = new Map(references.socialEdges.map((edge) => [pairKey(edge.sourcePersonId, edge.targetPersonId), edge]));
  return draft.volumes.social.edges.map((edge) => {
    const source = people.get(edge.sourcePersonId);
    const target = people.get(edge.targetPersonId);
    const original = excerptFor(result, edge.evidenceIds);
    const reference = referenceByPair.get(pairKey(edge.sourcePersonId, edge.targetPersonId));
    const relationOverlap = reference
      ? edge.relationTypes.some((type) => reference.relationTypes.includes(type))
      : false;
    const referenceDoesNotSupportType = Boolean(reference && !relationOverlap);
    const confidence = clamp(
      40
        + (original.directCount > 0 ? 24 : 0)
        + (source?.resolutionState === "resolved" ? 5 : 0)
        + (target?.resolutionState === "resolved" ? 8 : 0)
        + (reference && relationOverlap ? 24 : reference ? 7 : 0)
        + (edge.time?.precision === "year" ? 3 : 0)
        - (referenceDoesNotSupportType ? 15 : 0),
      15,
      98,
    );
    const policy = statusFor(confidence, reference && relationOverlap ? 1 : 0, original.contradicts);
    const cbdbAvailable = references.sources.find((item) => item.id === "cbdb")?.available ?? false;
    const checks: VerificationCheck[] = [
      {
        id: `cbdb:${edge.id}`,
        label: "CBDB 人物关系",
        detail: reference
          ? `${reference.relationLabels.join("、")}；${reference.evidenceCount || "已有"} 条关系证据，来源 ${reference.sourceIds.join("、") || "CBDB"}。`
          : "当前站内 CBDB 快照未找到同一人物对的可比关系。",
        state: reference && relationOverlap ? "supporting" : cbdbAvailable ? "not-found" : "unavailable",
        sourceIds: reference?.sourceIds ?? [],
      },
    ];
    const relationLabel = edge.relationTypes.map((type) => SOCIAL_LABELS.get(type) ?? type).join(" · ");
    const decision = decisionFor(result, edge.id);
    const autoApproved = policy.risk === "low" && policy.status === "confirmed" && !decision?.forceHumanReview;
    return {
      id: edge.id,
      kind: "social",
      sourceId: edge.sourcePersonId,
      sourceLabel: source?.name ?? edge.sourcePersonId,
      targetId: edge.targetPersonId,
      targetLabel: target?.name ?? edge.targetPersonId,
      title: `${source?.name ?? edge.sourcePersonId} — ${relationLabel} — ${target?.name ?? edge.targetPersonId}`,
      relationLabel,
      confidence,
      risk: policy.risk,
      policyStatus: policy.status,
      displayStatus: displayStatusForDecision(policy.status, edge.reviewState, decision),
      reasonCode: policy.reasonCode,
      reason: reasonForDecision(decision, referenceDoesNotSupportType ? "CBDB 记录了同一人物对，但其关系类型不足以直接支持当前原文关系；这不等同于反证。" : policy.reason),
      evidenceIds: edge.evidenceIds,
      evidenceExcerpt: original.text,
      evidenceLocator: original.locator,
      existingChecks: checks,
      webSearchRequired: !autoApproved && !reference,
      linkedStoryIds: edge.storyIds,
      reviewState: edge.reviewState,
      autoApproved,
      decisionActor: decision?.actor,
      decisionAction: decision?.action,
      startYear: edge.time?.startYear,
      endYear: edge.time?.endYear,
      sourceEntityType: "person",
      targetEntityType: "person",
    };
  });
}

export function assessBookRelationships(result: BookAnalysisResult): RelationshipAssessment[] {
  return [
    ...buildJourneyAssessments(result),
    ...buildPoemAssessments(result),
    ...buildSocialAssessments(result),
  ];
}

function setRelationReviewState(draft: BookAnalysisDraft, targetId: string, nextState: ReviewState): void {
  for (const item of draft.volumes.journey.items) if (item.id === targetId) item.reviewState = nextState;
  for (const item of draft.volumes.poemWorld.items) if (item.id === targetId) item.reviewState = nextState;
  for (const item of draft.volumes.social.edges) if (item.id === targetId) item.reviewState = nextState;
}

function synchronizeStoryStates(draft: BookAnalysisDraft): void {
  const parentStates = new Map<string, ReviewState[]>();
  const collect = (storyIds: string[], state: ReviewState): void => {
    for (const storyId of storyIds) {
      const states = parentStates.get(storyId) ?? [];
      states.push(state);
      parentStates.set(storyId, states);
    }
  };
  draft.volumes.journey.items.forEach((item) => collect(item.storyIds, item.reviewState));
  draft.volumes.poemWorld.items.forEach((item) => collect(item.storyIds, item.reviewState));
  draft.volumes.social.edges.forEach((item) => collect(item.storyIds, item.reviewState));
  for (const story of draft.storyCards) {
    const states = parentStates.get(story.id) ?? [];
    if (!states.length) {
      if (!reviewFinished(story.reviewState)) story.reviewState = "approved-private-preview";
      continue;
    }
    if (states.some((state) => !reviewFinished(state))) story.reviewState = "needs-review";
    else if (states.every((state) => state === "rejected")) story.reviewState = "rejected";
    else story.reviewState = "approved-private-preview";
  }
}

function synchronizeDraftReviewState(draft: BookAnalysisDraft): void {
  const relationStates = [
    ...draft.volumes.journey.items.map((item) => item.reviewState),
    ...draft.volumes.poemWorld.items.map((item) => item.reviewState),
    ...draft.volumes.social.edges.map((item) => item.reviewState),
  ];
  draft.reviewState = relationStates.some((state) => !reviewFinished(state))
    ? "needs-review"
    : "approved-private-preview";
}

function reviseLinkedStories(
  draft: BookAnalysisDraft,
  storyIds: string[],
  title: string,
  relationLabel: string,
): void {
  for (const story of draft.storyCards) {
    if (!storyIds.includes(story.id)) continue;
    story.title = title;
    story.summary = `关系类型已由人工修改为“${relationLabel}”，当前叙事只组织原文证据与实体锚点；重新核验并通过前，不作为已确认事实。`;
    story.reviewState = "needs-review";
  }
}

export function applyAutomaticVerificationPolicy(result: BookAnalysisResult): BookAnalysisResult {
  const assessments = assessBookRelationships(result);
  const next = structuredClone(result) as BookAnalysisWithVerification;
  const assessedAt = new Date().toISOString();
  const decisions = { ...(next.verification?.decisions ?? {}) };
  for (const assessment of assessments) {
    if (assessment.autoApproved && !reviewFinished(assessment.reviewState)) {
      setRelationReviewState(next.draft, assessment.id, "approved-private-preview");
    }
    decisions[assessment.id] = decisionRecord(
      assessment,
      "agent",
      assessment.autoApproved ? "approved" : "needs-review",
      false,
    );
  }
  next.verification = { policyVersion: "relationship-risk-v1", assessedAt, decisions };
  synchronizeStoryStates(next.draft);
  synchronizeDraftReviewState(next.draft);
  next.validation = validateBookDraft(next.draft);
  return next;
}

export function updateVerificationDecision(
  result: BookAnalysisResult,
  targetId: string,
  nextState: "approved-private-preview" | "rejected",
): BookAnalysisResult {
  const next = structuredClone(result) as BookAnalysisWithVerification;
  setRelationReviewState(next.draft, targetId, nextState);
  synchronizeStoryStates(next.draft);
  synchronizeDraftReviewState(next.draft);
  next.validation = validateBookDraft(next.draft);
  const assessment = assessBookRelationships(next).find((item) => item.id === targetId);
  if (assessment) {
    const assessedAt = next.verification?.assessedAt ?? new Date().toISOString();
    next.verification = {
      policyVersion: "relationship-risk-v1",
      assessedAt,
      decisions: {
        ...(next.verification?.decisions ?? {}),
        [targetId]: decisionRecord(assessment, "human", nextState === "rejected" ? "rejected" : "approved", false),
      },
    };
  }
  return next;
}

export function updateVerificationRelationType(
  result: BookAnalysisResult,
  targetId: string,
  nextValue: string,
): BookAnalysisResult {
  const next = structuredClone(result) as BookAnalysisWithVerification;
  const journeyValues = new Set(JOURNEY_RELATION_OPTIONS.map(([value]) => value));
  const poemValues = new Set(POEM_RELATION_OPTIONS.map(([value]) => value));
  const socialValues = new Set(SOCIAL_RELATION_OPTIONS.map(([value]) => value));
  const journey = next.draft.volumes.journey.items.find((item) => item.id === targetId);
  const poem = next.draft.volumes.poemWorld.items.find((item) => item.id === targetId);
  const social = next.draft.volumes.social.edges.find((item) => item.id === targetId);
  if (journey && journeyValues.has(nextValue as typeof JOURNEY_RELATION_OPTIONS[number][0])) {
    journey.predicate = nextValue as typeof journey.predicate;
    journey.reviewState = "needs-review";
    const place = next.draft.entities.places.find((item) => item.id === journey.placeId);
    const label = JOURNEY_LABELS.get(nextValue) ?? nextValue;
    reviseLinkedStories(next.draft, journey.storyIds, `${next.draft.poet.name}${label}${place?.label ?? journey.placeId} · 行迹线索`, label);
  } else if (poem && poemValues.has(nextValue as typeof POEM_RELATION_OPTIONS[number][0])) {
    poem.relationType = nextValue as NonNullable<typeof poem.relationType>;
    poem.reviewState = "needs-review";
    const work = next.draft.entities.works.find((item) => item.id === poem.workId);
    const place = next.draft.entities.places.find((item) => item.id === poem.placeId);
    const label = POEM_LABELS.get(nextValue) ?? nextValue;
    reviseLinkedStories(next.draft, poem.storyIds, `《${work?.title ?? poem.workId}》${label}${place?.label ?? poem.placeId ?? "地点待定"} · 作品关系线索`, label);
  } else if (social && socialValues.has(nextValue as typeof SOCIAL_RELATION_OPTIONS[number][0])) {
    social.relationTypes = [nextValue as typeof social.relationTypes[number]];
    social.reviewState = "needs-review";
    const source = next.draft.entities.people.find((item) => item.id === social.sourcePersonId);
    const target = next.draft.entities.people.find((item) => item.id === social.targetPersonId);
    const label = SOCIAL_LABELS.get(nextValue) ?? nextValue;
    reviseLinkedStories(next.draft, social.storyIds, `${source?.name ?? social.sourcePersonId}与${target?.name ?? social.targetPersonId} · ${label}线索`, label);
  }
  synchronizeStoryStates(next.draft);
  synchronizeDraftReviewState(next.draft);
  next.validation = validateBookDraft(next.draft);
  const assessment = assessBookRelationships(next).find((item) => item.id === targetId);
  if (assessment) {
    const assessedAt = next.verification?.assessedAt ?? new Date().toISOString();
    next.verification = {
      policyVersion: "relationship-risk-v1",
      assessedAt,
      decisions: {
        ...(next.verification?.decisions ?? {}),
        [targetId]: decisionRecord(assessment, "human", "modified", true),
      },
    };
  }
  return next;
}

export function summarizeVerification(result: BookAnalysisResult): VerificationSummary {
  const assessments = assessBookRelationships(result);
  const pendingExceptions = assessments.filter((assessment) => !reviewFinished(assessment.reviewState));
  return {
    assessments,
    pendingExceptions,
    autoApprovedCount: assessments.filter((assessment) => assessment.decisionActor === "agent" && assessment.decisionAction === "approved" && assessment.reviewState === "approved-private-preview").length,
    resolvedByHumanCount: assessments.filter((assessment) => assessment.decisionActor === "human" && assessment.reviewState === "approved-private-preview").length,
    rejectedCount: assessments.filter((assessment) => assessment.reviewState === "rejected").length,
    highRiskCount: pendingExceptions.filter((assessment) => assessment.risk === "high").length,
    insufficientCount: pendingExceptions.filter((assessment) => assessment.reasonCode === "evidence-insufficient").length,
    conflictCount: pendingExceptions.filter((assessment) => assessment.reasonCode === "conflict").length,
    complete: assessments.every((assessment) => reviewFinished(assessment.reviewState)),
  };
}

export function buildVerificationReport(result: BookAnalysisResult): Record<string, unknown> {
  const metadata = (result as BookAnalysisWithVerification).verification;
  return {
    policyVersion: metadata?.policyVersion ?? "relationship-risk-v1",
    assessedAt: metadata?.assessedAt ?? null,
    sources: result.references.sources,
    summary: summarizeVerification(result),
    decisions: metadata?.decisions ?? {},
  };
}
