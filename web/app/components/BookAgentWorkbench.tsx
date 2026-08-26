"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  analyzeBook,
  approveDraft,
  buildReleaseManifest,
  enrichBookAnalysisReferences,
  loadBookAgentCatalogs,
  sha256Hex,
  updateDraftReviewState,
  validateBookDraft,
  type BookAnalysisResult,
  type ReviewState,
} from "../../lib/book-agent";
import { BookAgentPrivateViews } from "./BookAgentPrivateViews";
import type { PrivateViewKey } from "./private-view";
import styles from "../agent.module.css";

type Phase = "idle" | "reading" | "analyzing" | "ready" | "error";

type ModelStatus = {
  configured: boolean;
  provider: string;
  model: string;
};

const REVIEW_LABELS: Record<ReviewState, string> = {
  "candidate-preview": "候选预览",
  "needs-review": "待审核",
  "approved-private-preview": "审核通过",
  rejected: "已驳回",
};

type ReviewKind = "journey" | "poemWorld" | "social" | "story";

type ReviewQueueItem = {
  id: string;
  kind: ReviewKind;
  title: string;
  type: string;
  detail: string;
  evidenceIds: string[];
  storySummary?: string;
};

const REVIEW_KIND_LABELS: Record<ReviewKind, string> = {
  journey: "行迹候选",
  poemWorld: "诗境候选",
  social: "交游候选",
  story: "故事卡",
};

const REVIEW_KIND_ORDER: ReviewKind[] = ["journey", "poemWorld", "social", "story"];

function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = "utf-8";
  return new TextDecoder(encoding).decode(buffer);
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function downloadJson(name: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

function excerptFor(result: BookAnalysisResult, evidenceIds: string[]): string {
  const evidence = result.draft.evidence.find((item) => evidenceIds.includes(item.id));
  if (!evidence) return "暂无可回读片段";
  const { startOffset, endOffset } = evidence.locator;
  return result.sourceText.slice(startOffset, endOffset).replace(/\s+/g, " ").slice(0, 180);
}

function reviewClass(state: ReviewState): string {
  return `${styles.badge} ${styles[`badge${state.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) as "candidatePreview"}`] ?? ""}`;
}

function ReviewButtons({
  state,
  onChange,
}: {
  state: ReviewState;
  onChange: (state: ReviewState) => void;
}) {
  return (
    <div className={`${styles.reviewButtons} ${styles.reviewDecisionButtons}`} role="group" aria-label="审核决策">
      <button
        type="button"
        className={`${state === "approved-private-preview" ? styles.reviewButtonActive : styles.reviewButton} ${styles.reviewDecisionButton}`}
        onClick={() => onChange("approved-private-preview")}
      >
        通过，进入下一页 →
      </button>
      <button
        type="button"
        className={`${state === "rejected" ? styles.reviewButtonDanger : styles.reviewButton} ${styles.reviewDecisionButton}`}
        onClick={() => onChange("rejected")}
      >
        驳回，进入下一页 →
      </button>
    </div>
  );
}

const JOURNEY_REVIEW_LABELS: Record<string, string> = {
  "born-at": "出生于",
  "died-at": "卒于",
  "resided-at": "居于",
  visited: "游历",
  "traveled-to": "行至",
  "held-office-at": "任职于",
  "exiled-to": "谪居",
  "studied-at": "从学于",
  "stayed-at": "寄居",
};

const POEM_REVIEW_LABELS: Record<string, string> = {
  "composed-at": "作于",
  "inscribed-at": "题于",
  "describes-place": "题咏",
  "mentioned-place": "写到",
};

const SOCIAL_REVIEW_LABELS: Record<string, string> = {
  kin: "亲属",
  "literary-exchange": "文学唱和",
  official: "同僚 / 官场",
  "teacher-student": "师生",
  friendship: "交游",
  other: "往来",
};

function reviewStorySummary(draft: BookAnalysisResult["draft"], storyIds: string[]): string | undefined {
  return draft.storyCards.find((story) => storyIds.includes(story.id))?.summary;
}

function buildReviewQueue(result: BookAnalysisResult): ReviewQueueItem[] {
  const { draft } = result;
  const placeLabel = (placeId: string) => draft.entities.places.find((place) => place.id === placeId)?.label ?? placeId;
  const workTitle = (workId: string) => draft.entities.works.find((work) => work.id === workId)?.title ?? workId;
  const personName = (personId: string) => draft.entities.people.find((person) => person.id === personId)?.name ?? personId;

  return [
    ...draft.volumes.journey.items.map((item) => ({
      id: item.id,
      kind: "journey" as const,
      title: `${JOURNEY_REVIEW_LABELS[item.predicate] ?? item.predicate}${placeLabel(item.placeId)}`,
      type: "人物 · 地点 · 时间",
      detail: `${item.time?.label ?? "时间未定"} · ${item.mapEligible ? "可落地图层" : "文字线索"}`,
      evidenceIds: item.evidenceIds,
      storySummary: reviewStorySummary(draft, item.storyIds),
    })),
    ...draft.volumes.poemWorld.items.map((item) => ({
      id: item.id,
      kind: "poemWorld" as const,
      title: `${workTitle(item.workId)} · ${item.placeId ? placeLabel(item.placeId) : "地点待补充"}`,
      type: "作品 · 地点 · 诗境关系",
      detail: item.relationType ? (POEM_REVIEW_LABELS[item.relationType] ?? item.relationType) : "关系语义未定",
      evidenceIds: item.evidenceIds,
      storySummary: reviewStorySummary(draft, item.storyIds),
    })),
    ...draft.volumes.social.edges.map((edge) => ({
      id: edge.id,
      kind: "social" as const,
      title: `${personName(edge.sourcePersonId)} × ${personName(edge.targetPersonId)}`,
      type: edge.relationTypes.map((type) => SOCIAL_REVIEW_LABELS[type] ?? type).join(" · "),
      detail: `${edge.time?.label ?? "时间未定"}${edge.placeIds.length ? ` · ${edge.placeIds.length} 处关联地点` : ""}`,
      evidenceIds: edge.evidenceIds,
      storySummary: reviewStorySummary(draft, edge.storyIds),
    })),
    ...draft.storyCards.map((card) => ({
      id: card.id,
      kind: "story" as const,
      title: card.title,
      type: `${card.kind} · ${card.anchorRefs.length} 个锚点`,
      detail: "共享叙事只组织已有连接，不创造新的关系。",
      evidenceIds: card.evidenceIds,
      storySummary: card.summary,
    })),
  ];
}

function reviewStateForTarget(
  draft: BookAnalysisResult["draft"],
  target: ReviewQueueItem,
): ReviewState {
  if (target.kind === "journey") return draft.volumes.journey.items.find((item) => item.id === target.id)?.reviewState ?? "needs-review";
  if (target.kind === "poemWorld") return draft.volumes.poemWorld.items.find((item) => item.id === target.id)?.reviewState ?? "needs-review";
  if (target.kind === "social") return draft.volumes.social.edges.find((item) => item.id === target.id)?.reviewState ?? "needs-review";
  return draft.storyCards.find((item) => item.id === target.id)?.reviewState ?? "needs-review";
}

function ReviewPage({
  result,
  item,
  currentIndex,
  total,
  onReview,
  onBack,
}: {
  result: BookAnalysisResult;
  item: ReviewQueueItem;
  currentIndex: number;
  total: number;
  onReview: (state: ReviewState) => void;
  onBack: () => void;
}) {
  const state = reviewStateForTarget(result.draft, item);
  return (
    <section className={styles.reviewPage} aria-label={`审核第 ${currentIndex + 1} 个候选`}>
      <header className={styles.reviewPageHeader}>
        <div>
          <p className={styles.sectionKicker}>{REVIEW_KIND_LABELS[item.kind]} · 私有草稿</p>
          <h3>{item.title}</h3>
        </div>
        <div className={styles.reviewPageCounter}>
          <strong>{String(currentIndex + 1).padStart(2, "0")}</strong>
          <span>/ {String(total).padStart(2, "0")} 页</span>
        </div>
      </header>

      <div className={styles.reviewPageBody}>
        <article className={styles.reviewEvidencePanel}>
          <div className={styles.reviewDetailMeta}>
            <span>{item.type}</span>
            <span>{item.detail}</span>
            <span className={reviewClass(state)}>{REVIEW_LABELS[state]}</span>
          </div>
          <div className={styles.reviewEvidenceBlock}>
            <p className={styles.reviewEvidenceLabel}>原文证据 · {result.draft.evidence.find((evidence) => item.evidenceIds.includes(evidence.id))?.locator.label ?? "未定位"}</p>
            <blockquote>“{excerptFor(result, item.evidenceIds)}”</blockquote>
            <span>{item.evidenceIds.length} 个 evidenceId · 审核通过后才会进入私有前端视图</span>
          </div>
          {item.storySummary ? (
            <div className={styles.reviewStoryPreview}>
              <p>关联故事卡</p>
              <span>{item.storySummary}</span>
            </div>
          ) : null}
        </article>

        <aside className={styles.reviewDecisionPanel}>
          <p className={styles.sectionKicker}>当前页面审核</p>
          <h4>{state === "approved-private-preview" ? "这条候选已通过" : state === "rejected" ? "这条候选已驳回" : "确认这条候选是否成立"}</h4>
          <p>完成当前判断后，工作台会自动进入下一页，不需要回到长列表继续向下找。</p>
          <ReviewButtons state={state} onChange={onReview} />
          <button className={styles.reviewBackButton} type="button" onClick={onBack} disabled={currentIndex === 0}>
            ← 返回上一页
          </button>
        </aside>
      </div>

      <footer className={styles.reviewPageFooter}>
        <span>审核队列按 行迹 → 诗境 → 交游 → 故事卡 排列</span>
        <span>当前只修改私有 draft，不会改写公开数据</span>
      </footer>
    </section>
  );
}

type BookAgentWorkbenchProps = {
  activePrivateView: PrivateViewKey;
  onPrivatePreviewChange: (active: boolean) => void;
};

export function BookAgentWorkbench({
  activePrivateView,
  onPrivatePreviewChange,
}: BookAgentWorkbenchProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [bookTitle, setBookTitle] = useState("");
  const [poetName, setPoetName] = useState("");
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<BookAnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modelConsent, setModelConsent] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [privateReleaseManifest, setPrivateReleaseManifest] = useState<Record<string, unknown> | null>(null);
  const [reviewCursor, setReviewCursor] = useState(0);

  useEffect(() => {
    onPrivatePreviewChange(Boolean(privateReleaseManifest));
  }, [onPrivatePreviewChange, privateReleaseManifest]);

  useEffect(() => {
    let active = true;
    fetch("/api/agent/status")
      .then(async (response) => response.ok ? await response.json() as ModelStatus : null)
      .then((status) => {
        if (active && status) setModelStatus(status);
      })
      .catch(() => {
        if (active) setModelStatus({ configured: false, provider: "local-only", model: "规则分析器" });
      });
    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => {
    if (!result) return null;
    const { draft } = result;
    return {
      people: draft.entities.people.length,
      places: draft.entities.places.length,
      works: draft.entities.works.length,
      stories: draft.storyCards.length,
      journey: draft.volumes.journey.items.length,
      poemWorld: draft.volumes.poemWorld.items.length,
      social: draft.volumes.social.edges.length,
    };
  }, [result]);

  const chooseFile = (nextFile: File | null) => {
    setError("");
    setNotice("");
    setPrivateReleaseManifest(null);
    setReviewCursor(0);
    if (!nextFile) return;
    const extension = nextFile.name.toLowerCase().slice(nextFile.name.lastIndexOf("."));
    if (![".txt", ".text", ".md"].includes(extension)) {
      setFile(null);
      setError("网页端原型先支持 .txt / .text / .md；扫描 PDF 和文本层 PDF 请走本地 Python agent。 ");
      return;
    }
    if (nextFile.size === 0) {
      setFile(null);
      setError("文件为空，无法开始分析。");
      return;
    }
    setFile(nextFile);
    setBookTitle((current) => current || baseName(nextFile.name));
    setPhase("idle");
    setResult(null);
  };

  const runAnalysis = async () => {
    if (!file) {
      setError("请先选择一本文本书籍。");
      return;
    }
    if (!bookTitle.trim() || !poetName.trim()) {
      setError("请补充书名和中心人物；它们会写入私有 draft 的 source / poet 字段。");
      return;
    }
    if (!consent) {
      setError("请确认允许在当前设备内处理这份书籍文本。");
      return;
    }
    setError("");
    setPrivateReleaseManifest(null);
    setReviewCursor(0);
    setPhase("reading");
    try {
      const buffer = await file.arrayBuffer();
      const text = decodeText(buffer);
      if (!text.trim()) throw new Error("文件没有可分析的文本内容。");
      setPhase("analyzing");
      const fileSha256 = await sha256Hex(buffer);
      const catalogs = await loadBookAgentCatalogs(poetName);
      let analysis: BookAnalysisResult;
      if (modelConsent) {
        const response = await fetch("/api/agent/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            fileName: file.name,
            bookTitle,
            poetName,
            fileSha256,
            catalogs: { people: catalogs.people, places: catalogs.places, works: catalogs.works },
          }),
        });
        const payload = await response.json() as { analysis?: BookAnalysisResult; error?: string };
        if (!response.ok || !payload.analysis) throw new Error(payload.error || "大模型分析接口没有返回结果。");
        analysis = enrichBookAnalysisReferences(payload.analysis, catalogs);
        if (analysis.model?.warning) setNotice(analysis.model.warning);
      } else {
        analysis = await analyzeBook({ text, fileName: file.name, bookTitle, poetName, fileSha256, catalogs });
        analysis.model = { engine: "local-rules" };
      }
      setResult(analysis);
      setPhase("ready");
    } catch (caught) {
      if (modelConsent) {
        try {
          const fallbackBuffer = await file.arrayBuffer();
          const fallbackText = decodeText(fallbackBuffer);
          const fallbackSha256 = await sha256Hex(fallbackBuffer);
          const fallbackCatalogs = await loadBookAgentCatalogs(poetName);
          const fallback = await analyzeBook({ text: fallbackText, fileName: file.name, bookTitle, poetName, fileSha256: fallbackSha256, catalogs: fallbackCatalogs });
          fallback.model = {
            engine: "local-fallback",
            warning: caught instanceof Error ? caught.message : "大模型分析失败，已回退本地规则分析。",
          };
          setNotice(fallback.model.warning ?? "大模型分析失败，已回退本地规则分析。");
          setResult(fallback);
          setPhase("ready");
          return;
        } catch (fallbackCaught) {
          setError(fallbackCaught instanceof Error ? fallbackCaught.message : "本地回退分析也失败了。");
        }
      } else {
        setError(caught instanceof Error ? caught.message : "分析失败，请换一个文本文件重试。");
      }
      setPhase("error");
    }
  };

  const updateTarget = (targetId: string, state: ReviewState) => {
    if (!result) return;
    const draft = updateDraftReviewState(result.draft, targetId, state);
    setResult({ ...result, draft, validation: validateBookDraft(draft) });
    setPrivateReleaseManifest(null);
  };

  const approveAll = () => {
    if (!result) return;
    const draft = approveDraft(result.draft);
    setResult({ ...result, draft, validation: validateBookDraft(draft) });
    setPrivateReleaseManifest(null);
    setReviewCursor(reviewQueue.length);
  };

  const createRelease = () => {
    if (!result) return;
    if (!result.validation.valid || !reviewComplete) return;
    setPrivateReleaseManifest(buildReleaseManifest(result.draft));
  };

  const downloadPrivateManifest = () => {
    if (!result || !privateReleaseManifest) return;
    downloadJson(`${result.draft.source.bookId}.release-manifest.json`, privateReleaseManifest);
  };

  const downloadDraft = () => {
    if (!result) return;
    downloadJson(`${result.draft.source.bookId}.draft.json`, result.draft);
    downloadJson(`${result.draft.source.bookId}.validation.json`, result.validation);
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setPhase("idle");
    setError("");
    setNotice("");
    setPrivateReleaseManifest(null);
    setReviewCursor(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const draft = result?.draft;
  const reviewQueue = result ? buildReviewQueue(result) : [];
  const activeReviewIndex = Math.min(reviewCursor, reviewQueue.length);
  const activeReview = reviewQueue[activeReviewIndex] ?? null;
  const reviewedCount = result
    ? reviewQueue.filter((item) => {
        const state = reviewStateForTarget(result.draft, item);
        return state === "approved-private-preview" || state === "rejected";
      }).length
    : 0;
  const firstRejectedIndex = result
    ? reviewQueue.findIndex((item) => reviewStateForTarget(result.draft, item) === "rejected")
    : -1;
  const reviewComplete = Boolean(result && activeReviewIndex >= reviewQueue.length);
  const releaseReady = Boolean(result && draft && result.validation.valid && reviewComplete);

  const reviewCurrentTarget = (state: ReviewState) => {
    if (!activeReview) return;
    updateTarget(activeReview.id, state);
    setReviewCursor(activeReviewIndex + 1);
  };

  if (result && draft && summary && privateReleaseManifest) {
    return (
      <BookAgentPrivateViews
        result={result}
        manifest={privateReleaseManifest}
        activeView={activePrivateView}
        onBackToReview={() => {
          setPrivateReleaseManifest(null);
          setReviewCursor(0);
        }}
        onReset={reset}
        onDownload={downloadPrivateManifest}
      />
    );
  }

  return (
    <div className={`${styles.workbench} ${result ? styles.workbenchWithResult : ""}`}>
      {!result ? (
        <section className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>书籍分析工作台</p>
            <h1>上传书籍，提取可核对的诗人线索</h1>
            <p className={styles.lede}>
              从原文中提取人物、地点、作品和交游线索，并为每条候选保留证据定位，方便你逐条审核。
            </p>
          </div>
        </section>
      ) : null}

      {!result ? (
        <section className={styles.intakeGrid} aria-label="书籍上传与分析设置">
          <div className={styles.uploadPanel}>
            <p className={styles.sectionKicker}>01 / 上传</p>
            <h2>把一本书交给 Agent</h2>
            <p>支持导入书籍文本，并从人物、情节与线索开始分析。</p>
            <input
              ref={fileInputRef}
              className={styles.hiddenInput}
              type="file"
              accept=".txt,.text,.md,text/plain,text/markdown"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <button className={styles.fileButton} type="button" onClick={() => fileInputRef.current?.click()}>
              选择书籍文件
            </button>
            <div className={file ? styles.filePicked : styles.fileEmpty}>
              {file ? (
                <>
                  <strong>{file.name}</strong>
                  <span>{Math.ceil(file.size / 1024)} KB · 等待分析</span>
                </>
              ) : (
                <>尚未选择文件</>
              )}
            </div>
            <p className={styles.mutedNote}>输入边界：文本层 PDF 暂由本地脚本处理，扫描件不会被猜测。</p>
          </div>

          <div className={styles.setupPanel}>
            <p className={styles.sectionKicker}>02 / 任务信息</p>
            <h2>告诉 Agent 从谁开始读</h2>
            <label>
              书名
              <input value={bookTitle} onChange={(event) => setBookTitle(event.target.value)} placeholder="例如：东坡全集" />
            </label>
            <label>
              中心人物
              <input value={poetName} onChange={(event) => setPoetName(event.target.value)} placeholder="例如：苏轼" />
            </label>
            <label className={styles.consentRow}>
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>我同意在当前设备内处理这份书籍文本，并理解输出仍是待审核候选。</span>
            </label>
            <div className={styles.modelChoice}>
              <div className={styles.modelChoiceHeader}>
                <span className={styles.sectionKicker}>可选增强</span>
                <strong>{modelStatus === null ? "检测中…" : modelStatus.configured ? "已配置" : "未配置"}</strong>
              </div>
              <p>
                {modelStatus?.configured
                  ? `当前可用：${modelStatus.provider} / ${modelStatus.model}`
                  : "未检测到模型服务，仍可使用本地规则分析。"}
              </p>
              <label className={styles.consentRow}>
                <input
                  type="checkbox"
                  checked={modelConsent}
                  disabled={!modelStatus?.configured}
                  onChange={(event) => setModelConsent(event.target.checked)}
                />
                <span>启用大模型增强：书籍文本会发送到已配置的模型服务；模型只产出待审核候选，不直接发布。</span>
              </label>
            </div>
            <div className={styles.setupActions}>
              <button className={styles.analyzeButton} type="button" onClick={runAnalysis} disabled={phase === "reading" || phase === "analyzing"}>
                {phase === "reading" || phase === "analyzing" ? "Agent 正在整理…" : "开始全自动分析"}
                <span aria-hidden="true">→</span>
              </button>
              {error ? <p className={styles.errorMessage} role="alert">{error}</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {result && draft && summary ? (
           <section className={styles.resultArea} aria-label="书籍分析审核工作台">
            {notice ? <p className={styles.modelNotice} role="status">{notice}</p> : null}

            <div className={styles.reviewWorkspace}>
              <aside className={styles.reviewRail} aria-label="审核队列概览">
                <div className={styles.reviewRailHeading}>
                  <div>
                    <p className={styles.sectionKicker}>审核队列</p>
                    <strong>{reviewedCount} / {reviewQueue.length}</strong>
                  </div>
                  <span>页</span>
                </div>
                <p className={styles.reviewRailIntro}>每次只看一个候选。点击判断后自动进入下一页，避免在草稿列表里反复向下滚动。</p>
                <ol className={styles.reviewRailList}>
                  {REVIEW_KIND_ORDER.map((kind) => {
                    const items = reviewQueue.filter((item) => item.kind === kind);
                    const done = result ? items.filter((item) => {
                      const state = reviewStateForTarget(result.draft, item);
                      return state === "approved-private-preview" || state === "rejected";
                    }).length : 0;
                    const firstIndex = reviewQueue.findIndex((item) => item.kind === kind);
                    const isCurrent = activeReview?.kind === kind;
                    return (
                      <li key={kind}>
                        <button type="button" className={isCurrent ? styles.reviewRailItemActive : styles.reviewRailItem} onClick={() => firstIndex >= 0 && setReviewCursor(firstIndex)} disabled={!items.length}>
                          <span>{REVIEW_KIND_LABELS[kind]}</span>
                          <strong>{done} / {items.length}</strong>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <div className={styles.reviewRailStats}>
                  <span><strong>{summary.people}</strong>人物</span>
                  <span><strong>{summary.places}</strong>地点</span>
                  <span><strong>{summary.works}</strong>作品</span>
                  <span><strong>{summary.stories}</strong>故事卡</span>
                </div>
                <button type="button" className={styles.reviewRailAction} onClick={downloadDraft}>下载 draft + 校验报告</button>
                <button type="button" className={styles.reviewRailAction} onClick={reset}>重新上传</button>
              </aside>

              <div className={styles.reviewPageSlot}>
                {reviewComplete ? (
                  <section className={styles.reviewCompletePage} aria-label="审核完成">
                    <div className={styles.reviewCompleteMark} aria-hidden="true">✓</div>
                    <p className={styles.sectionKicker}>REVIEW COMPLETE · NEXT PAGE</p>
                    <h3>审核完成，进入私有发布预览</h3>
                    <p>{firstRejectedIndex >= 0 ? "已通过的候选会进入私有发布包；被驳回的候选会被排除，不会阻断本次私有预览。" : "现在可以生成只属于本次 job 的私有发布包，并打开真实的三卷前端视图。"}</p>
                    <div className={styles.reviewCompleteStats}>
                      <span><strong>{summary.journey}</strong>行迹候选</span>
                      <span><strong>{summary.poemWorld}</strong>诗境候选</span>
                      <span><strong>{summary.social}</strong>交游候选</span>
                      <span><strong>{summary.stories}</strong>故事卡</span>
                    </div>
                    {result.validation.issues.length ? (
                      <details className={styles.reviewValidationDetails}>
                        <summary>查看自动校验明细 · {result.validation.errorCount} 个错误 · {result.validation.warningCount} 个提醒</summary>
                        <ul>{result.validation.issues.map((issue) => <li key={`${issue.code}-${issue.path}`}>{issue.message}</li>)}</ul>
                      </details>
                    ) : null}
                    <div className={styles.reviewCompleteActions}>
                      {firstRejectedIndex >= 0 ? <button type="button" className={styles.secondaryLightButton} onClick={() => setReviewCursor(firstRejectedIndex)}>回到第 {firstRejectedIndex + 1} 页修改</button> : null}
                      <button type="button" className={styles.secondaryLightButton} onClick={approveAll}>{firstRejectedIndex >= 0 ? "通过未驳回项" : "全部通过"}</button>
                      <button type="button" className={styles.primaryLightButton} onClick={createRelease} disabled={!releaseReady}>生成私有发布包 →</button>
                    </div>
                  </section>
                ) : activeReview ? (
                  <ReviewPage
                    result={result}
                    item={activeReview}
                    currentIndex={activeReviewIndex}
                    total={reviewQueue.length}
                    onReview={reviewCurrentTarget}
                    onBack={() => setReviewCursor(Math.max(0, activeReviewIndex - 1))}
                  />
                ) : (
                  <section className={styles.reviewCompletePage} aria-label="没有候选">
                    <p className={styles.sectionKicker}>NO REVIEW ITEMS</p>
                    <h3>当前书籍没有生成可审核候选</h3>
                    <p>可以下载 draft 查看原始分析结果，或重新上传一本书开始新的 job。</p>
                    <button type="button" className={styles.secondaryLightButton} onClick={reset}>重新上传</button>
                  </section>
                )}
              </div>
            </div>
          </section>
      ) : null}
    </div>
  );
}
