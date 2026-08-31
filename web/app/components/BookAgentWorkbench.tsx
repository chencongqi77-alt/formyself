"use client";

import { useEffect, useRef, useState } from "react";

import {
  analyzeBook,
  buildReleaseManifest,
  enrichBookAnalysisReferences,
  loadBookAgentCatalogs,
  sha256Hex,
  type BookAnalysisResult,
} from "../../lib/book-agent";
import {
  applyAutomaticVerificationPolicy,
  buildVerificationReport,
  summarizeVerification,
  updateVerificationDecision,
  updateVerificationRelationType,
} from "../../lib/book-agent-verification";
import { BookAgentPrivateViews } from "./BookAgentPrivateViews";
import { BookAgentVerificationWorkbench } from "./BookAgentVerificationWorkbench";
import type { PrivateViewKey } from "./private-view";
import styles from "../agent.module.css";

type Phase = "idle" | "reading" | "analyzing" | "ready" | "error";

type ModelStatus = {
  configured: boolean;
  provider: string;
  model: string;
};

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
  const [modelConsent, setModelConsent] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [privateReleaseManifest, setPrivateReleaseManifest] = useState<Record<string, unknown> | null>(null);

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

  const chooseFile = (nextFile: File | null) => {
    setError("");
    setPrivateReleaseManifest(null);
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
      } else {
        analysis = await analyzeBook({ text, fileName: file.name, bookTitle, poetName, fileSha256, catalogs });
        analysis.model = { engine: "local-rules" };
      }
      setResult(applyAutomaticVerificationPolicy(analysis));
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
          setResult(applyAutomaticVerificationPolicy(fallback));
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

  const updateTarget = (targetId: string, state: "approved-private-preview" | "rejected") => {
    setResult((current) => current ? updateVerificationDecision(current, targetId, state) : current);
    setPrivateReleaseManifest(null);
  };

  const modifyTarget = (targetId: string, nextValue: string) => {
    setResult((current) => current ? updateVerificationRelationType(current, targetId, nextValue) : current);
    setPrivateReleaseManifest(null);
  };

  const createRelease = () => {
    if (!result) return;
    if (!result.validation.valid || !summarizeVerification(result).complete) return;
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
    downloadJson(`${result.draft.source.bookId}.verification.json`, buildVerificationReport(result));
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setPhase("idle");
    setError("");
    setPrivateReleaseManifest(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const draft = result?.draft;
  const releaseReady = Boolean(result && draft && result.validation.valid && summarizeVerification(result).complete);

  if (result && draft && privateReleaseManifest) {
    return (
      <BookAgentPrivateViews
        result={result}
        manifest={privateReleaseManifest}
        activeView={activePrivateView}
        onBackToReview={() => {
          setPrivateReleaseManifest(null);
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
            <h1>上传书籍，让 Agent 先核验关系</h1>
            <p className={styles.lede}>
              Agent 会先用原文、站内资料、CBDB 与 chinese-poetry 交叉验证。低风险关系自动进入私有草稿，只把冲突、高风险和证据不足的内容交给你处理。
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
                <span>我同意在当前设备内处理这份书籍文本，并理解只有满足自动核验策略的低风险关系会直接进入私有草稿。</span>
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
                <span>启用大模型增强：书籍文本会发送到已配置的模型服务；模型负责发现候选，可信度、风险与发布边界仍由核验策略决定。</span>
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

      {result && draft ? (
        <BookAgentVerificationWorkbench
          key={result.draft.bundleId}
          result={result}
          onDecision={updateTarget}
          onModify={modifyTarget}
          onDownload={downloadDraft}
          onReset={reset}
          onCreateRelease={createRelease}
          releaseReady={releaseReady}
        />
      ) : null}
    </div>
  );
}
