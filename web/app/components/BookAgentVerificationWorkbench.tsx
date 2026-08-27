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

type ExceptionFilter = "all" | "high" | "insufficient" | "conflict";
type SearchRequestState = "idle" | "requested";

const RISK_LABELS: Record<VerificationRisk, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const FILTER_LABELS: Array<{ id: ExceptionFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "high", label: "高风险" },
  { id: "insufficient", label: "证据不足" },
  { id: "conflict", label: "冲突" },
];

function filterException(assessment: RelationshipAssessment, filter: ExceptionFilter): boolean {
  if (filter === "high") return assessment.risk === "high";
  if (filter === "insufficient") return assessment.reasonCode === "evidence-insufficient";
  if (filter === "conflict") return assessment.reasonCode === "conflict";
  return true;
}

function countForFilter(
  assessments: RelationshipAssessment[],
  filter: ExceptionFilter,
): number {
  return assessments.filter((assessment) => filterException(assessment, filter)).length;
}

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

function statusCopy(assessment: RelationshipAssessment): string {
  if (assessment.reviewState === "approved-private-preview") return assessment.decisionActor === "agent" ? "Agent 自动通过" : "人工已通过";
  if (assessment.reviewState === "rejected") return "人工已驳回";
  if (assessment.reasonCode === "conflict") return "资料冲突";
  if (assessment.policyStatus === "low-confidence") return "低可信";
  return "待人工处理";
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

function SourceStateMark({ state }: { state: RelationshipAssessment["existingChecks"][number]["state"] }) {
  const text = state === "supporting" ? "支持" : state === "not-found" ? "未找到" : state === "unavailable" ? "不可用" : "不适用";
  return <span className={styles[`verificationSource${state.replace(/(^|-)([a-z])/g, (_match, _dash, letter: string) => letter.toUpperCase())}`]}>{text}</span>;
}

function AgentStatusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16.5 8.5" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={open ? styles.chevronOpen : ""}>
      <path d="m5 3 5 5-5 5" />
    </svg>
  );
}

function EvidenceInspector({
  result,
  assessment,
  searchState,
  onSearch,
  onDecision,
  onModify,
}: {
  result: BookAnalysisResult;
  assessment: RelationshipAssessment;
  searchState: SearchRequestState;
  onSearch: () => void;
  onDecision: (state: "approved-private-preview" | "rejected") => void;
  onModify: (value: string) => void;
}) {
  const [showContext, setShowContext] = useState(false);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nextRelationValue, setNextRelationValue] = useState(() => relationValue(result, assessment));
  const primaryEvidence = result.draft.evidence.find((item) => assessment.evidenceIds.includes(item.id));
  const context = primaryEvidence
    ? result.sourceText
      .slice(Math.max(0, primaryEvidence.locator.startOffset - 100), Math.min(result.sourceText.length, primaryEvidence.locator.endOffset + 100))
      .replace(/\s+/g, " ")
      .trim()
    : assessment.evidenceExcerpt;
  const reviewFinished = assessment.reviewState === "approved-private-preview" || assessment.reviewState === "rejected";

  return (
    <aside className={styles.evidenceInspector} aria-label="所选关系的异常处理与证据">
      <header className={styles.evidenceInspectorHeader}>
        <div className={styles.inspectorTitleRow}>
          <p>{reviewFinished ? "关系证据" : "异常处理"}</p>
          <span className={styles[`inspectorState${assessment.displayStatus.replace(/(^|-)([a-z])/g, (_match, _dash, letter: string) => letter.toUpperCase())}`]}>{statusCopy(assessment)}</span>
        </div>
        <h2>{assessment.title}</h2>
        <dl className={styles.inspectorMetrics}>
          <div><dt>可信度</dt><dd>{assessment.confidence}%</dd></div>
          <div><dt>风险</dt><dd>{RISK_LABELS[assessment.risk]}</dd></div>
          <div><dt>异常</dt><dd>{assessmentReasonLabel(assessment)}</dd></div>
        </dl>
      </header>

      <div className={styles.evidenceInspectorScroll}>
        <section className={styles.evidenceSection}>
          <div className={styles.evidenceSectionHeading}>
            <span aria-hidden="true">一</span>
            <div><p>原文证据</p><small>{assessment.evidenceLocator} · {assessment.evidenceIds.length} 个 evidenceId</small></div>
          </div>
          <blockquote>“{assessment.evidenceExcerpt}”</blockquote>
          <button type="button" className={styles.evidenceTextAction} onClick={() => setShowContext((current) => !current)}>
            {showContext ? "收起上下文" : "查看上下文"}<ChevronIcon open={showContext} />
          </button>
          {showContext ? <p className={styles.evidenceContext}>{context}</p> : null}
        </section>

        <section className={styles.evidenceSection}>
          <div className={styles.evidenceSectionHeading}>
            <span aria-hidden="true">二</span>
            <div><p>已有资料</p><small>先核对站内数据、CBDB 与 chinese-poetry</small></div>
          </div>
          <div className={styles.verificationSourceList}>
            {assessment.existingChecks.map((check) => {
              const expanded = expandedSourceId === check.id;
              return (
                <div key={check.id} className={styles.verificationSourceRow}>
                  <button type="button" onClick={() => setExpandedSourceId(expanded ? null : check.id)} aria-expanded={expanded}>
                    <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                    <span className={styles.verificationSourceMeta}><SourceStateMark state={check.state} /><ChevronIcon open={expanded} /></span>
                  </button>
                  {expanded ? <p>{check.sourceIds.length ? `来源标识：${check.sourceIds.join("、")}` : "当前没有可展示的来源标识。"}</p> : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className={styles.evidenceSection}>
          <div className={styles.evidenceSectionHeading}>
            <span aria-hidden="true">三</span>
            <div><p>联网结果</p><small>仅在内部资料不足时触发</small></div>
          </div>
          <div className={styles.webSearchResult}>
            {searchState === "requested" ? (
              <>
                <strong>已记录继续检索请求</strong>
                <p>当前环境未配置独立联网检索源，因此没有把无来源摘要写入判断；接入检索服务后可在此追加标题、站点与检索时间。</p>
              </>
            ) : assessment.webSearchRequired ? (
              <>
                <strong>尚未联网 · 内部资料不足</strong>
                <p>Agent 已停在内部核验阶段，等待人工决定是否继续检索。</p>
              </>
            ) : (
              <>
                <strong>未触发 · 内部资料已足够</strong>
                <p>本条关系没有逐条联网，现有来源已经满足自动核验或人工判断所需。</p>
              </>
            )}
          </div>
        </section>

        <section className={styles.evidenceSection}>
          <div className={styles.evidenceSectionHeading}>
            <span aria-hidden="true">四</span>
            <div><p>Agent 判断</p><small>风险与可信度分开计算</small></div>
          </div>
          <p className={styles.agentReason}>{assessment.reason}</p>
          <div className={styles.agentReasonFactors}>
            <span>原文直证 {assessment.evidenceIds.length ? "✓" : "—"}</span>
            <span>内部支持 {assessment.existingChecks.some((check) => check.state === "supporting") ? "✓" : "—"}</span>
            <span>联网 {assessment.webSearchRequired ? "按需" : "未触发"}</span>
          </div>
        </section>
      </div>

      <footer className={styles.inspectorActions}>
        {editing ? (
          <div className={styles.relationEditor}>
            <label htmlFor={`relation-editor-${assessment.id}`}>修改关系类型</label>
            <select id={`relation-editor-${assessment.id}`} value={nextRelationValue} onChange={(event) => setNextRelationValue(event.target.value)}>
              {relationOptions(assessment).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <div>
              <button type="button" onClick={() => setEditing(false)}>取消</button>
              <button type="button" className={styles.relationEditorSave} onClick={() => { onModify(nextRelationValue); setEditing(false); }}>保存并重新核验</button>
            </div>
          </div>
        ) : (
          <div className={styles.inspectorActionGrid}>
            <button type="button" className={styles.inspectorApproveButton} onClick={() => onDecision("approved-private-preview")} disabled={assessment.reviewState === "approved-private-preview"}>通过</button>
            <button type="button" onClick={() => { setNextRelationValue(relationValue(result, assessment)); setEditing(true); }}>修改</button>
            <button type="button" className={styles.inspectorRejectButton} onClick={() => onDecision("rejected")} disabled={assessment.reviewState === "rejected"}>驳回</button>
            <button type="button" onClick={onSearch} disabled={searchState === "requested"}>{searchState === "requested" ? "已请求检索" : "继续检索"}</button>
          </div>
        )}
      </footer>
    </aside>
  );
}

export function BookAgentVerificationWorkbench({
  result,
  notice,
  onDecision,
  onModify,
  onDownload,
  onReset,
  onCreateRelease,
  releaseReady,
}: {
  result: BookAnalysisResult;
  notice?: string;
  onDecision: (targetId: string, state: "approved-private-preview" | "rejected") => void;
  onModify: (targetId: string, value: string) => void;
  onDownload: () => void;
  onReset: () => void;
  onCreateRelease: () => void;
  releaseReady: boolean;
}) {
  const summary = useMemo(() => summarizeVerification(result), [result]);
  const [filter, setFilter] = useState<ExceptionFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(() => summary.pendingExceptions[0]?.id ?? null);
  const [searchRequests, setSearchRequests] = useState<Record<string, SearchRequestState>>({});
  const filteredExceptions = summary.pendingExceptions.filter((assessment) => filterException(assessment, filter));
  const activeAssessment = summary.assessments.find((assessment) => assessment.id === selectedId)
    ?? null;

  return (
    <section className={styles.verificationWorkbench} aria-label="Agent 自动核验知识图谱工作台">
      <header className={styles.verificationStatusBar}>
        <div className={styles.verificationStatusLead}>
          <AgentStatusIcon />
          <div><strong>Agent 已完成本轮初筛</strong><span>{summary.autoApprovedCount} 条低风险关系已自动通过</span></div>
        </div>
        <div className={styles.verificationPipeline} aria-label="自动核验顺序">
          <span>原文</span><i aria-hidden="true" />
          <span>站内资料</span><i aria-hidden="true" />
          <span>CBDB / chinese-poetry</span><i aria-hidden="true" />
          <span>必要时联网</span>
        </div>
        <div className={styles.verificationStatusAside}>
          <strong>仅异常需人工处理</strong>
          <span>{summary.pendingExceptions.length} 条待处理 · {summary.rejectedCount} 条已驳回</span>
        </div>
      </header>
      {notice ? <p className={styles.modelNotice} role="status">{notice}</p> : null}

      <div className={styles.verificationMainGrid}>
        <aside className={styles.exceptionRail} aria-label="异常关系列表">
          <header className={styles.exceptionRailHeader}>
            <div><h2>异常关系</h2><span>{summary.pendingExceptions.length}</span></div>
            <p>低风险关系不进入此列</p>
          </header>
          <div className={styles.exceptionFilters} role="tablist" aria-label="异常筛选">
            {FILTER_LABELS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={filter === item.id ? styles.exceptionFilterActive : ""} onClick={() => setFilter(item.id)}>
                {item.label}<span>{countForFilter(summary.pendingExceptions, item.id)}</span>
              </button>
            ))}
          </div>
          <ol className={styles.exceptionList}>
            {filteredExceptions.length ? filteredExceptions.map((assessment, index) => (
              <li key={assessment.id}>
                <button type="button" className={activeAssessment?.id === assessment.id ? styles.exceptionItemActive : styles.exceptionItem} onClick={() => setSelectedId(assessment.id)}>
                  <span className={styles.exceptionItemIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.exceptionItemBody}>
                    <strong>{assessment.title}</strong>
                    <small>{assessmentReasonLabel(assessment)} · 可信度 {assessment.confidence}%</small>
                  </span>
                  <span className={styles.exceptionItemRisk}>风险 {RISK_LABELS[assessment.risk]}</span>
                </button>
              </li>
            )) : (
              <li className={styles.exceptionEmpty}>当前筛选下没有待处理关系。</li>
            )}
          </ol>
          <footer className={styles.exceptionRailFooter}>
            <div><strong>{summary.autoApprovedCount}</strong><span>条低风险关系已自动通过</span></div>
            <div><strong>{summary.pendingExceptions.length}</strong><span>条转人工异常处理</span></div>
            <div className={styles.exceptionUtilityActions}>
              <button type="button" onClick={onDownload}>下载 draft 与校验报告</button>
              <button type="button" onClick={onReset}>重新上传</button>
            </div>
          </footer>
        </aside>

        <div className={styles.knowledgeGraphColumn}>
          <BookAgentKnowledgeGraph result={result} assessments={summary.assessments} selectedId={activeAssessment?.id ?? null} onSelect={setSelectedId} />
          <div className={styles.graphStatusFooter}>
            <span>本次新增关系 {summary.assessments.length}</span>
            <span>已确认 {summary.assessments.filter((assessment) => assessment.displayStatus === "confirmed").length}</span>
            <span>待处理 {summary.pendingExceptions.length}</span>
            {summary.complete ? <button type="button" onClick={onCreateRelease} disabled={!releaseReady}>生成私有发布包</button> : <em>处理完异常后可生成私有发布包</em>}
          </div>
        </div>

        {activeAssessment ? (
          <EvidenceInspector
            key={activeAssessment.id}
            result={result}
            assessment={activeAssessment}
            searchState={searchRequests[activeAssessment.id] ?? "idle"}
            onSearch={() => setSearchRequests((current) => ({ ...current, [activeAssessment.id]: "requested" }))}
            onDecision={(state) => { onDecision(activeAssessment.id, state); setSelectedId(null); }}
            onModify={(value) => onModify(activeAssessment.id, value)}
          />
        ) : (
          <aside className={styles.evidenceInspector} aria-label="请选择关系查看证据">
            <div className={styles.inspectorEmpty}>
              <strong>{summary.assessments.length ? "点选一条关系" : "本次没有生成关系"}</strong>
              <p>{summary.assessments.length
                ? "在异常列表或中间图谱中选择关系，查看原文、已有资料、联网结果与 Agent 判断理由。"
                : "请下载 draft 检查原始分析结果，或重新上传包含明确人物、地点与作品关系的文本。"}</p>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
