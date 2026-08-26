"use client";

import type { ReactNode } from "react";
import Link from "next/link";

export type WorkReadingRelationType =
  | "composed-at"
  | "inscribed-at"
  | "describes-place"
  | "mentioned-place";

export type WorkReadingWork = {
  id: string;
  title: string;
  genre?: string;
  text: string[];
  libraryStatus?: "corpus";
};

export type WorkReadingEvent = {
  id: string;
  title: string;
  summary: string;
  lifeStage?: string;
  timeLabel?: string;
  startYear?: number;
  endYear?: number;
  sequence?: number;
};

export type WorkReadingPlaceRelation = {
  id: string;
  relationType: WorkReadingRelationType;
  certainty: "verified" | "probable";
  timeLabel?: string;
  note?: string;
  placeName: string;
  modernName?: string;
};

type WorkReadingTemplateProps = {
  work: WorkReadingWork;
  personName: string;
  lede: string;
  relatedEvents: WorkReadingEvent[];
  relatedPlaces: WorkReadingPlaceRelation[];
  backLabel: string;
  backHref?: string;
  onBack?: () => void;
  emptyEventMessage?: string;
  emptyPlaceMessage?: string;
  contextSupplement?: ReactNode;
};

function relationLabel(relationType: WorkReadingRelationType) {
  switch (relationType) {
    case "composed-at":
      return "创作于此";
    case "inscribed-at":
      return "题写于此";
    case "describes-place":
      return "题咏此地";
    case "mentioned-place":
      return "写到此地";
  }
}

function relationStatement(relation: WorkReadingPlaceRelation) {
  switch (relation.relationType) {
    case "composed-at":
      return `这篇作品作于${relation.placeName}。`;
    case "inscribed-at":
      return `这篇作品题写于${relation.placeName}。`;
    case "describes-place":
      return `作品以${relation.placeName}为明确的题咏空间；这不等同于已经确认创作地点。`;
    case "mentioned-place":
      return `题目或正文提及${relation.placeName}，暂不据此推定创作地点。`;
  }
}

function eventTimeLabel(event: WorkReadingEvent) {
  if (event.timeLabel?.trim()) return event.timeLabel.trim();
  if (!Number.isFinite(event.startYear) || !Number.isFinite(event.endYear)) {
    return "仅知史料顺序";
  }
  return event.startYear === event.endYear
    ? String(event.startYear)
    : String(event.startYear) + "—" + String(event.endYear);
}

function hasSequence(event: WorkReadingEvent): event is WorkReadingEvent & { sequence: number } {
  return Number.isFinite(event.sequence);
}

// Original text stays intact in the data layer. This only creates shorter
// visual beats for the fixed-height reader when a paragraph is unusually long.
function splitReadingParagraph(paragraph: string) {
  const source = paragraph.trim();
  if ([...source].length <= 56) return source ? [source] : [];

  const sentences = source.match(/[^。！？；]+[。！？；]?/g) ?? [source];
  return sentences.flatMap((sentence) => {
    const cleanSentence = sentence.trim();
    if ([...cleanSentence].length <= 56) return cleanSentence ? [cleanSentence] : [];
    return (cleanSentence.match(/[^，、]+[，、]?/g) ?? [cleanSentence])
      .map((part) => part.trim())
      .filter(Boolean);
  });
}

export function isLongWorkReading(text: readonly string[]) {
  const normalized = text.map((line) => line.trim()).filter(Boolean);
  const textLength = normalized.reduce(
    (total, line) => total + [...line.replace(/\s/g, "")].length,
    0,
  );
  return (
    normalized.length > 12 ||
    textLength > 280 ||
    normalized.some((line) => [...line.replace(/\s/g, "")].length > 56)
  );
}

export function WorkReadingTemplate({
  work,
  personName,
  lede,
  relatedEvents,
  relatedPlaces,
  backLabel,
  backHref,
  onBack,
  emptyEventMessage,
  emptyPlaceMessage,
  contextSupplement,
}: WorkReadingTemplateProps) {
  const text = work.text.map((line) => line.trim()).filter(Boolean);
  const textLength = text.reduce(
    (total, line) => total + [...line.replace(/\s/g, "")].length,
    0,
  );
  const titleLength = [...work.title.replace(/\s/g, "")].length;
  const isLongTitle = titleLength > 24;
  const isLongReading = isLongWorkReading(text);
  const readingLines = isLongReading
    ? text.flatMap((paragraph) => splitReadingParagraph(paragraph))
    : text;
  const noEventText = emptyEventMessage ?? (
    work.libraryStatus === "corpus"
      ? "这篇作品尚未关联具体人生地点或写作年代，避免把不确定的关联当成史实。"
      : "这篇作品的具体人生事件仍在整理中。"
  );
  const noPlaceText = emptyPlaceMessage ?? "暂无明确的创作地点或题咏地点；系统不会根据篇名自动猜测。";

  return (
    <>
      {backHref ? (
        <Link className="reading-back" href={backHref}>
          ← {backLabel}
        </Link>
      ) : (
        <button className="reading-back reading-back-button" type="button" onClick={onBack}>
          ← {backLabel}
        </button>
      )}

      <article className="work-reading">
        <header className="work-reading-hero">
          <div className="work-reading-hero-main">
            <span className="work-reading-genre">{personName} · {work.genre ?? "诗"}</span>
            <h1 className={isLongTitle ? "is-long-title" : undefined} title={work.title}>
              {work.title}
            </h1>
            {isLongTitle ? (
              <details className="work-title-disclosure">
                <summary>查看完整题名（{titleLength} 字）</summary>
                <p>{work.title}</p>
              </details>
            ) : null}
            <p className="work-reading-lede">{lede}</p>
          </div>
          <aside className="work-reading-facts" aria-label="作品信息">
            <div className="work-reading-facts-header">
              <p>作品信息</p>
            </div>
            <dl className="work-reading-metrics">
              <div>
                <dt>作者</dt>
                <dd>{personName}</dd>
              </div>
              <div>
                <dt>体裁</dt>
                <dd>{work.genre ?? "诗"}</dd>
              </div>
              <div>
                <dt>篇幅</dt>
                <dd>{text.length} 段 · 约 {textLength} 字</dd>
              </div>
            </dl>
          </aside>
        </header>

        <div className="work-reading-body">
          <section
            className={
              "work-reading-poem" + (isLongReading ? " work-reading-poem--long" : "")
            }
            aria-labelledby="poem-heading"
          >
            <div className="poem-heading-row">
              <h2 id="poem-heading">正文</h2>
              <span className="poem-reading-count">{text.length} 段</span>
            </div>
            <div
              className={"poem-reader" + (isLongReading ? " poem-reader--scroll" : "")}
              tabIndex={isLongReading ? 0 : undefined}
              aria-label={isLongReading ? `${work.title} 正文，可在此滚动阅读` : undefined}
            >
              <div className={isLongReading ? "poem-lines is-long" : "poem-lines"}>
                {readingLines.length ? (
                  readingLines.map((line, index) => <p key={`${work.id}-${index}`}>{line}</p>)
                ) : (
                  <p>暂未找到可回读正文。</p>
                )}
              </div>
            </div>
          </section>

          <aside className="work-reading-aside">
            <section className="reading-context" aria-labelledby="context-heading">
              <p className="work-reading-label">人生坐标</p>
              <h2 id="context-heading">它落在{personName}的哪段行迹里</h2>
              {relatedEvents.length > 0 ? (
                <div className="reading-context-list">
                  {relatedEvents.map((event, index) => (
                    <article key={event.id} className="reading-context-item">
                      <p>
                        {eventTimeLabel(event)}
                        {hasSequence(event) && ` · 顺序 ${event.sequence ?? index + 1}`}
                        {event.lifeStage ? ` · ${event.lifeStage}` : ""}
                      </p>
                      <h3>{event.title}</h3>
                      <span>{event.summary}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="reading-context-empty">{noEventText}</p>
              )}

              {relatedPlaces.length > 0 ? (
                <div className="reading-places" aria-label="作品与地点关系">
                  {relatedPlaces.map((relation) => (
                    <article className="reading-place-relation" key={relation.id}>
                      <header>
                        <div>
                          <p>{relationLabel(relation.relationType)}</p>
                          <h3>
                            {relation.placeName}
                            {relation.modernName ? <span>今：{relation.modernName}</span> : null}
                          </h3>
                        </div>
                        <span className={`relation-certainty relation-certainty--${relation.certainty}`}>
                          {relation.certainty === "verified" ? "已核实" : "较可信"}
                        </span>
                      </header>
                      {relation.timeLabel ? <p className="relation-time">{relation.timeLabel}</p> : null}
                      <p>{relationStatement(relation)}</p>
                      {relation.note ? <p>{relation.note}</p> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="reading-context-empty">{noPlaceText}</p>
              )}
              {contextSupplement}
            </section>
          </aside>
        </div>
      </article>
    </>
  );
}
