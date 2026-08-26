"use client";

import Link from "next/link";
import { useMemo } from "react";

import { relationshipReadingCollection } from "../../lib/relationship-reading";

const EMPTY_FEATURED_STORY_IDS: readonly string[] = [];

export type RelationshipStoryPerson = {
  id: string;
  name: string;
  birthYear: number | null;
  deathYear: number | null;
  degree: number;
  isAnchor: boolean;
};

export type RelationshipStorySource = {
  sourceId: string;
  purpose?: string;
  locator?: Record<string, unknown>;
};

export type RelationshipStoryLink = {
  id: string;
  source: string;
  target: string;
  displayBuckets: string[];
  bucketCounts: Record<string, number>;
  confidence: "probable" | "possible";
  evidenceCount: number;
  titleSignalCount: number;
  years: {
    startYear: number | null;
    endYear: number | null;
    precision: string;
  };
  sourceRefs?: RelationshipStorySource[];
};

export type RelationshipStoryPilotEvent = {
  id: string;
  title: string;
  summary: string;
  sourceRefs: RelationshipStorySource[];
  reviewStatus: string;
};

export type RelationshipStoryPilot = {
  id: string;
  edgeId: string;
  otherPersonId: string;
  otherName: string;
  reviewState: string;
  events: RelationshipStoryPilotEvent[];
};

type RelationshipStoryPanelProps = {
  anchorId: string;
  anchorName: string;
  selectedPerson: RelationshipStoryPerson;
  peopleById: ReadonlyMap<string, RelationshipStoryPerson>;
  relationships: RelationshipStoryLink[];
  relationshipLabels: Record<string, string>;
  pilotStories?: readonly RelationshipStoryPilot[];
  featuredStoryIds?: readonly string[];
  requestedStoryId?: string;
  relationshipDetailHref?: (edgeId: string) => string | undefined;
  evidenceSectionLabel?: string;
  evidenceSectionNote?: string;
  pilotStoryLabel?: string;
  onClose: () => void;
};

const EMPTY_PILOT_STORIES: readonly RelationshipStoryPilot[] = [];

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.75 6.75 17.25 17.25M17.25 6.75 6.75 17.25" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 12h14m-5.25-5.25L18.5 12l-5.25 5.25" />
    </svg>
  );
}

function lifespansLabel(person: RelationshipStoryPerson): string {
  if (person.birthYear && person.deathYear) {
    return `${person.birthYear}–${person.deathYear}`;
  }
  if (person.birthYear) return `${person.birthYear} 年生`;
  if (person.deathYear) return `${person.deathYear} 年卒`;
  return "生卒年待考";
}

function isAnchorLink(edge: RelationshipStoryLink, anchorId: string): boolean {
  return edge.source === anchorId || edge.target === anchorId;
}

function storyScore(edge: RelationshipStoryLink): number {
  const relationVariety = edge.displayBuckets.length * 60;
  const kinBonus = edge.displayBuckets.includes("kin") ? 600 : 0;
  const exchangeBonus = edge.displayBuckets.includes("literary-exchange") ? 160 : 0;
  const datedBonus = edge.years.startYear || edge.years.endYear ? 40 : 0;
  return (
    kinBonus +
    exchangeBonus +
    relationVariety +
    datedBonus +
    edge.evidenceCount * 4 +
    edge.titleSignalCount
  );
}

/**
 * A provenance-first relationship reader. It turns a selected graph node into
 * a navigable reading path, while keeping every statement tied to labels,
 * dates, and sources already carried by the graph payload.
 */
export function RelationshipStoryPanel({
  anchorId,
  anchorName,
  selectedPerson,
  peopleById,
  relationships,
  relationshipLabels,
  pilotStories = EMPTY_PILOT_STORIES,
  featuredStoryIds = EMPTY_FEATURED_STORY_IDS,
  requestedStoryId,
  relationshipDetailHref,
  evidenceSectionLabel = "原典试读",
  evidenceSectionNote = "已发布生平记录",
  pilotStoryLabel = "已发布生平线索",
  onClose,
}: RelationshipStoryPanelProps) {
  const storyLinks = useMemo(
    () => {
      const featuredOrder = new Map(
        featuredStoryIds.map((storyId, index) => [storyId, index]),
      );
      return [...relationships].sort((left, right) => {
        const leftFeaturedOrder = featuredOrder.get(left.id);
        const rightFeaturedOrder = featuredOrder.get(right.id);
        if (
          leftFeaturedOrder !== undefined ||
          rightFeaturedOrder !== undefined
        ) {
          return (
            (leftFeaturedOrder ?? Number.MAX_SAFE_INTEGER) -
            (rightFeaturedOrder ?? Number.MAX_SAFE_INTEGER)
          );
        }
        return (
          storyScore(right) - storyScore(left) ||
          right.evidenceCount - left.evidenceCount ||
          left.id.localeCompare(right.id)
        );
      });
    },
    [featuredStoryIds, relationships],
  );

  const anchorLink = useMemo(
    () => storyLinks.find((link) => isAnchorLink(link, anchorId)) ?? null,
    [anchorId, storyLinks],
  );
  const personDefaultStoryId =
    selectedPerson.id === anchorId
      ? storyLinks[0]?.id ?? ""
      : anchorLink?.id ?? storyLinks[0]?.id ?? "";
  const defaultStoryId = storyLinks.some(
    (link) => link.id === requestedStoryId,
  )
    ? requestedStoryId ?? ""
    : personDefaultStoryId;
  const activeStoryId = storyLinks.some((link) => link.id === requestedStoryId)
    ? requestedStoryId ?? ""
    : defaultStoryId;

  const activeStory =
    storyLinks.find((link) => link.id === activeStoryId) ??
    storyLinks[0] ??
    null;
  const pilotStory = useMemo(
    () =>
      activeStory
        ? pilotStories.find((story) => story.edgeId === activeStory.id) ?? null
        : null,
    [activeStory, pilotStories],
  );
  const firstPerson = activeStory
    ? peopleById.get(activeStory.source) ?? null
    : null;
  const secondPerson = activeStory
    ? peopleById.get(activeStory.target) ?? null
    : null;
  const relationNames = activeStory
    ? activeStory.displayBuckets.map(
        (bucket) => relationshipLabels[bucket] ?? bucket,
      )
    : [];
  const storyTitle =
    firstPerson && secondPerson
      ? `${firstPerson.name} × ${secondPerson.name}`
      : `${selectedPerson.name}的关系线索`;
  const readingCollection =
    firstPerson && secondPerson
      ? relationshipReadingCollection(firstPerson.id, secondPerson.id)
      : null;
  const detailHref = activeStory
    ? relationshipDetailHref?.(activeStory.id)
    : undefined;
  const hasSelectedPersonRelationship = Boolean(
    activeStory && selectedPerson.id !== anchorId && relationNames.length,
  );
  const storySynopsis = activeStory
    ? pilotStory
      ? `此处另收录 ${pilotStory.events.length} 则${pilotStoryLabel}，供阅读${storyTitle}时对照。图谱关系边本身仍保留候选预览状态。`
      : readingCollection
        ? readingCollection.readerSummary
        : `当前候选图谱将${storyTitle}归入“${relationNames.join("、")}”等展示分组。下方资料卡只呈示可定位的原典与文本线索，不补写资料未支持的具体交往情节。`
    : "当前筛选下没有可展开的关系线索。";
  return (
    <aside
      className="detail-panel social-panel relationship-story-panel"
      aria-label={`${selectedPerson.name}的人物关系阅读器`}
    >
      <header className="relationship-reader-header">
        <div className="relationship-reader-identity">
          <p className="relationship-reader-kicker">
            {selectedPerson.isAnchor
              ? `${anchorName} · 交游篇章`
              : `${anchorName}的关系节点`}
          </p>
          <h2>{selectedPerson.name}</h2>
          <p className="relationship-reader-lifespan">
            生卒 · {lifespansLabel(selectedPerson)}
          </p>
        </div>
        {hasSelectedPersonRelationship ? (
          <section
            className="relationship-reader-connection"
            aria-label={`${anchorName}与${selectedPerson.name}的关系概览`}
          >
            <p>关系线索</p>
            <strong>{relationNames.join(" · ")}</strong>
          </section>
        ) : null}
        <button
          type="button"
          className="relationship-reader-close"
          onClick={onClose}
          aria-label="关闭人物关系阅读器"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="relationship-reader-content">
        <section className="relationship-feature" aria-label="当前关系档案">
          <div className="relationship-feature-heading">
            <p>从一条关系读起</p>
          </div>
          <h3>{storyTitle}</h3>
          <p className="relationship-feature-summary">{storySynopsis}</p>

          {detailHref ? (
            <Link
              href={detailHref}
              className="relationship-reading-card"
              aria-label={`打开${storyTitle}的关系资料页`}
            >
              <div className="relationship-reading-card-copy">
                <div className="relationship-reading-card-meta">
                  <p>{readingCollection ? "原典与诗文资料" : "关系资料"}</p>
                  {readingCollection ? (
                    <span>
                      {readingCollection.storyReferences.length} 则原典 · {readingCollection.workReferences.length} 组作品
                    </span>
                  ) : null}
                </div>
                <h4>
                  {readingCollection ? "原典交集与诗文线索" : "查看关系资料"}
                </h4>
                <span className="relationship-reading-card-description">
                  {readingCollection
                    ? "保留原典定位、作品全文入口与审核范围。"
                    : "查看候选关系标签、来源定位及当前可用的阅读资料。"}
                </span>
              </div>
              <span className="relationship-reading-card-cta">
                <span>打开资料页</span>
                <ArrowIcon />
              </span>
            </Link>
          ) : null}

          {pilotStory ? (
            <section className="relationship-pilot-evidence" aria-label={evidenceSectionLabel}>
              <div className="relationship-pilot-evidence-heading">
                <p>{evidenceSectionLabel}</p>
                <span>{evidenceSectionNote}</span>
              </div>
              <ol>
                {pilotStory.events.map((event, index) => (
                  <li key={event.id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{event.title}</strong>
                      <p>{event.summary}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

        </section>
      </div>
    </aside>
  );
}
