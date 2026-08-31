"use client";

import { useMemo, useState } from "react";

import type { BookAnalysisResult } from "../../lib/book-agent";
import {
  JOURNEY_RELATION_OPTIONS,
  POEM_RELATION_OPTIONS,
  SOCIAL_RELATION_OPTIONS,
  summarizeVerification,
  type RelationshipAssessment,
  type VerificationReasonCode,
  type VerificationRisk,
} from "../../lib/book-agent-verification";
import { BookAgentKnowledgeGraph } from "./BookAgentKnowledgeGraph";
import styles from "../agent.module.css";

const RISK_LABELS: Record<VerificationRisk, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

function relationValue(result: BookAnalysisResult, assessment: RelationshipAssessment): string {
  if (assessment.kind === "journey") {
    return result.draft.volumes.journey.items.find((item) => item.id === assessment.id)?.predicate ?? "visited";
  }
  if (assessment.kind === "poemWorld") {
    return result.draft.volumes.poemWorld.items.find((item) => item.id === assessment.id)?.relationType ?? "mentioned-place";
  }
  return result.draft.volumes.social.edges.find((item) => item.id === assessment.id)?.relationTypes[0] ?? "other";
}

function relationOptions(assessment: RelationshipAssessment): ReadonlyArray<readonly [string, string]> {
  if (assessment.kind === "journey") return JOURNEY_RELATION_OPTIONS;
  if (assessment.kind === "poemWorld") return POEM_RELATION_OPTIONS;
  return SOCIAL_RELATION_OPTIONS;
}

function reasonLabel(code: VerificationReasonCode): string {
  if (code === "cross-verified") return "交叉核验通过";
  if (code === "conflict") return "来源冲突";
  return "证据不足";
}

function assessmentReasonLabel(assessment: RelationshipAssessment): string {
  if (assessment.decisionAction === "modified" && assessment.reviewState === "needs-review") return "修改后待确认";
  return reasonLabel(assessment.reasonCode);
}

function sourceStateLabel(state: RelationshipAssessment["existingChecks"][number]["state"]): string {
  if (state === "supporting") return "支持";
  if (state === "not-found") return "未找到";
  if (state === "unavailable") return "不可用";
  return "不适用";
}

function SourceStateMark({ state }: { state: RelationshipAssessment["existingChecks"][number]["state"] }) {
  const className = "verificationSource" + state.replace(/(^|-)([a-z])/g, (_match, _dash, letter: string) => letter.toUpperCase());
  return <span className={styles[className]}>{sourceStateLabel(state)}</span>;
}

function conciseAgentJudgment(assessment: RelationshipAssessment): string {
  if (assessment.decisionAction === "modified" && assessment.reviewState === "needs-review") {
    return "关系类型已经修改，需要确认新语义后再通过。";
  }
  if (assessment.reasonCode === "cross-verified") {
    return "原文与既有资料相互印证，可进入私有草稿。";
  }
  if (assessment.reasonCode === "conflict") {
    return "来源之间存在冲突，当前关系不宜直接通过。";
  }
  return `现有证据尚不足以确认“${assessment.relationLabel}”，建议人工复核。`;
}

function evidenceSourceCount(result: BookAnalysisResult, assessment: RelationshipAssessment): number {
  const evidenceById = new Map(result.draft.evidence.map((evidence) => [evidence.id, evidence]));
  const sourceIds = new Set<string>();
  for (const evidenceId of assessment.evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    if (evidence) sourceIds.add(`book:${evidence.sourceFileId}`);
  }
  for (const check of assessment.existingChecks) {
    if (check.state !== "supporting") continue;
    if (check.sourceIds.length) {
      check.sourceIds.forEach((sourceId) => sourceIds.add(`reference:${sourceId}`));
    } else {
      sourceIds.add(`reference:${check.id.split(":")[0]}`);
    }
  }
  return sourceIds.size;
}

function displayRelationshipTitle(title: string): string {
  return title.replace(/《《/g, "《").replace(/》》/g, "》");
}

function ReviewPanelToggleIcon({ direction }: { direction: "collapse" | "expand" }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d={direction === "collapse" ? "M7 4l6 6-6 6" : "M13 4l-6 6 6 6"} />
      <path d={direction === "collapse" ? "M16 3v14" : "M4 3v14"} />
    </svg>
  );
}

function EvidenceInspector({
  result,
  assessment,
  onDecision,
  onModify,
}: {
  result: BookAnalysisResult;
  assessment: RelationshipAssessment;
  onDecision: (state: "approved-private-preview" | "rejected") => void;
  onModify: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nextRelationValue, setNextRelationValue] = useState(() => relationValue(result, assessment));
  const primaryEvidence = result.draft.evidence.find((item) => assessment.evidenceIds.includes(item.id));
  const sourceCount = evidenceSourceCount(result, assessment);
  const context = primaryEvidence
    ? result.sourceText
      .slice(Math.max(0, primaryEvidence.locator.startOffset - 100), Math.min(result.sourceText.length, primaryEvidence.locator.endOffset + 100))
      .replace(/\s+/g, " ")
      .trim()
    : assessment.evidenceExcerpt;

  return (
    <div className={styles.reviewDetails} aria-label="所选关系的证据与处理">
      <header className={styles.reviewDetailsHeader}>
        <h2>{displayRelationshipTitle(assessment.title)}</h2>
      </header>

      <div className={styles.reviewSummaryMetrics} aria-label="关系核验摘要">
        <div>
          <span>可信度</span>
          <strong>{assessment.confidence}%</strong>
        </div>
        <div className={assessment.reasonCode === "cross-verified" ? styles.reviewRiskMetric : `${styles.reviewRiskMetric} ${styles.reviewRiskMetricAlert}`}>
          <span>风险状态</span>
          <strong>{assessmentReasonLabel(assessment)}</strong>
          <small>风险 {RISK_LABELS[assessment.risk]}</small>
        </div>
        <div>
          <span>证据来源</span>
          <strong>{sourceCount} 处</strong>
        </div>
      </div>

      <section className={styles.reviewAgentSummary}>
        <span>Agent 判断</span>
        <p>{conciseAgentJudgment(assessment)}</p>
      </section>

      <details className={styles.reviewVerificationDetails}>
        <summary>
          <span>查看核验详情</span>
          <small>原文 · 站内 · 联网 · 判断</small>
        </summary>
        <div className={styles.reviewVerificationBody}>
          <section className={styles.reviewSection}>
            <h3>原文证据</h3>
            <blockquote>“{assessment.evidenceExcerpt}”</blockquote>
            <p className={styles.reviewEvidenceLocator}>{assessment.evidenceLocator}</p>
            <p className={styles.reviewContext}>{context}</p>
          </section>

          <section className={styles.reviewSection}>
            <h3>站内资料</h3>
            {assessment.existingChecks.length ? (
              <ul className={styles.reviewSourceList}>
                {assessment.existingChecks.map((check) => (
                  <li key={check.id}>
                    <div><strong>{check.label}</strong><SourceStateMark state={check.state} /></div>
                    <p>{check.detail}</p>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.reviewEmptyCopy}>暂无可核验资料。</p>}
          </section>

          <section className={styles.reviewSection}>
            <h3>联网结果</h3>
            <p className={styles.reviewWebResult} data-search-required={assessment.webSearchRequired}>
              <strong>{assessment.webSearchRequired ? "待检索" : "未触发"}</strong>
              {assessment.webSearchRequired
                ? "内部资料不足，尚未产生联网结果。"
                : "当前内部证据已满足核验条件。"}
            </p>
          </section>

          <section className={styles.reviewSection}>
            <h3>详细 Agent 判断</h3>
            <p className={styles.reviewAgentReason}>{assessment.reason}</p>
          </section>
        </div>
      </details>

      <footer className={styles.reviewActions}>
        {editing ? (
          <div className={styles.reviewRelationEditor}>
            <label htmlFor={`relation-editor-${assessment.id}`}>修改关系类型</label>
            <select id={`relation-editor-${assessment.id}`} value={nextRelationValue} onChange={(event) => setNextRelationValue(event.target.value)}>
              {relationOptions(assessment).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <div>
              <button type="button" onClick={() => setEditing(false)}>取消</button>
              <button type="button" className={styles.reviewSaveButton} onClick={() => { onModify(nextRelationValue); setEditing(false); }}>保存</button>
            </div>
          </div>
        ) : (
          <div className={styles.reviewActionGrid}>
            <button type="button" className={styles.reviewApproveButton} onClick={() => onDecision("approved-private-preview")} disabled={assessment.reviewState === "approved-private-preview"}>通过</button>
            <button type="button" onClick={() => { setNextRelationValue(relationValue(result, assessment)); setEditing(true); }}>修改</button>
            <button type="button" className={styles.reviewRejectButton} onClick={() => onDecision("rejected")} disabled={assessment.reviewState === "rejected"}>驳回</button>
          </div>
        )}
      </footer>
    </div>
  );
}

export function BookAgentVerificationWorkbench({
  result,
  onDecision,
  onModify,
  onDownload,
  onReset,
  onCreateRelease,
  releaseReady,
}: {
  result: BookAnalysisResult;
  onDecision: (targetId: string, state: "approved-private-preview" | "rejected") => void;
  onModify: (targetId: string, value: string) => void;
  onDownload: () => void;
  onReset: () => void;
  onCreateRelease: () => void;
  releaseReady: boolean;
}) {
  const summary = useMemo(() => summarizeVerification(result), [result]);
  const [selectedId, setSelectedId] = useState<string | null>(() => summary.pendingExceptions[0]?.id ?? null);
  const [reviewCollapsed, setReviewCollapsed] = useState(false);
  const assessmentById = useMemo(() => new Map(summary.assessments.map((assessment) => [assessment.id, assessment])), [summary.assessments]);
  const activeAssessment = selectedId ? assessmentById.get(selectedId) ?? null : null;
  const pendingIndex = activeAssessment
    ? summary.pendingExceptions.findIndex((assessment) => assessment.id === activeAssessment.id)
    : -1;

  const selectRelativePending = (offset: number): void => {
    const count = summary.pendingExceptions.length;
    if (!count) return;
    const nextIndex = pendingIndex < 0 ? 0 : (pendingIndex + offset + count) % count;
    setSelectedId(summary.pendingExceptions[nextIndex].id);
  };

  const decideAndAdvance = (state: "approved-private-preview" | "rejected"): void => {
    if (!activeAssessment) return;
    const nextAssessment = summary.pendingExceptions.find((assessment) => assessment.id !== activeAssessment.id);
    onDecision(activeAssessment.id, state);
    setSelectedId(nextAssessment?.id ?? null);
  };

  return (
    <section
      className={styles.verificationWorkbench}
      data-review-collapsed={reviewCollapsed ? "true" : "false"}
      aria-label="Agent 自动核验知识图谱工作台"
    >
      <div className={styles.verificationMainGrid}>
        <div className={styles.knowledgeGraphColumn}>
          <BookAgentKnowledgeGraph result={result} assessments={summary.assessments} selectedId={activeAssessment?.id ?? null} onSelect={setSelectedId} />
        </div>

        <aside
          id="agent-review-console"
          className={`${styles.reviewConsole} ${reviewCollapsed ? styles.reviewConsoleCollapsed : ""}`}
          aria-label="异常关系与处理"
        >
          <button
            type="button"
            className={styles.reviewConsoleExpand}
            aria-controls="agent-review-console-content"
            aria-expanded={!reviewCollapsed}
            aria-label="展开右侧核验卡片"
            title="展开核验卡片"
            hidden={!reviewCollapsed}
            onClick={() => setReviewCollapsed(false)}
          >
            <ReviewPanelToggleIcon direction="expand" />
            <small>展开核验</small>
          </button>

          <div id="agent-review-console-content" className={styles.reviewConsoleContent} hidden={reviewCollapsed}>
            <header className={styles.reviewQueueHeader}>
              <details className={styles.reviewQueueDisclosure}>
                <summary>
                  <strong>{summary.pendingExceptions.length
                    ? pendingIndex >= 0 ? `待核验 ${summary.pendingExceptions.length}` : "图中关系"
                    : "核验完成"}</strong>
                  {summary.pendingExceptions.length ? <span>·</span> : null}
                  {summary.pendingExceptions.length ? (
                    <small>{pendingIndex >= 0 ? `${pendingIndex + 1} / ${summary.pendingExceptions.length}` : `待核验 ${summary.pendingExceptions.length}`}</small>
                  ) : null}
                </summary>
                {summary.pendingExceptions.length ? (
                  <ol className={styles.reviewQueue} aria-label="待处理异常关系">
                    {summary.pendingExceptions.map((assessment, index) => (
                      <li key={assessment.id}>
                        <button type="button" className={activeAssessment?.id === assessment.id ? styles.reviewQueueItemActive : styles.reviewQueueItem} onClick={() => setSelectedId(assessment.id)}>
                          <span className={styles.reviewQueueNumber}>{String(index + 1).padStart(2, "0")}</span>
                          <strong>{displayRelationshipTitle(assessment.title)}</strong>
                          <small>{assessment.confidence}%</small>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </details>
              <div className={styles.reviewQueueNavigation}>
                <button type="button" aria-label="上一条待核验关系" onClick={() => selectRelativePending(-1)} disabled={!summary.pendingExceptions.length}>‹</button>
                <button type="button" aria-label="下一条待核验关系" onClick={() => selectRelativePending(1)} disabled={!summary.pendingExceptions.length}>›</button>
                <button
                  type="button"
                  className={styles.reviewConsoleCollapse}
                  aria-controls="agent-review-console-content"
                  aria-expanded={!reviewCollapsed}
                  aria-label="收起右侧核验卡片"
                  title="收起核验卡片"
                  onClick={() => setReviewCollapsed(true)}
                >
                  <ReviewPanelToggleIcon direction="collapse" />
                </button>
                <details className={styles.reviewUtilityMenu}>
                  <summary aria-label="更多操作"><span aria-hidden="true">···</span></summary>
                  <div>
                    <button type="button" onClick={onDownload}>下载 draft 与校验报告</button>
                    <button type="button" onClick={onReset}>重新上传</button>
                  </div>
                </details>
              </div>
            </header>

            {activeAssessment ? (
              <EvidenceInspector
                key={activeAssessment.id}
                result={result}
                assessment={activeAssessment}
                onDecision={decideAndAdvance}
                onModify={(value) => onModify(activeAssessment.id, value)}
              />
            ) : (
              <div className={styles.reviewCompleteState}>
                <strong>{summary.complete ? "异常已处理完毕" : "请选择一条异常关系"}</strong>
                <p>{summary.complete ? "全部关系均已有明确处理结果，可生成私有发布包。" : "从图谱中选择关系即可查看证据与判断。"}</p>
                {summary.complete ? <button type="button" onClick={onCreateRelease} disabled={!releaseReady}>生成私有发布包</button> : null}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
