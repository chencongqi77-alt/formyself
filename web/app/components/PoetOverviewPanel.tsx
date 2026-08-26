"use client";

export type PoetOverviewSource = {
  sourceId: string;
  locator?: Record<string, unknown>;
};

export type PoetOverviewProfile = {
  id: string;
  name: string;
  dynasty?: string;
  aliases?: string[];
  birthYear?: number | null;
  deathYear?: number | null;
  intro?: string;
  sourceRefs?: PoetOverviewSource[];
  reviewStatus?: string;
};

export type PoetOverviewEvent = {
  id: string;
  title: string;
  summary: string;
  sourceRefs: PoetOverviewSource[];
  reviewStatus: string;
};

type PoetOverviewPanelProps = {
  fallbackName: string;
  profile?: PoetOverviewProfile | null;
  events?: readonly PoetOverviewEvent[];
  sourceTitles?: Readonly<Record<string, string>>;
  statusLabel?: string;
  onClose: () => void;
};

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.75 6.75 17.25 17.25M6.75 17.25 17.25 6.75" />
    </svg>
  );
}

function lifespanLabel(profile: PoetOverviewProfile | null | undefined): string {
  if (!profile) return "生卒年待补";
  if (profile.birthYear && profile.deathYear) {
    return `${profile.birthYear}—${profile.deathYear}`;
  }
  if (profile.birthYear) return `${profile.birthYear} 年生`;
  if (profile.deathYear) return `${profile.deathYear} 年卒`;
  return "生卒年待考";
}

function sourceLocatorLabel(
  source: PoetOverviewSource,
  sourceTitles: Readonly<Record<string, string>>,
): string {
  const title = sourceTitles[source.sourceId] ?? source.sourceId;
  const locator = source.locator;
  if (!locator) return title;
  const path = typeof locator.path === "string" ? locator.path : "";
  const startLine = typeof locator.startLine === "number" ? locator.startLine : null;
  const endLine = typeof locator.endLine === "number" ? locator.endLine : null;
  const recordId = typeof locator.recordId === "string" ? locator.recordId : "";
  const lineLabel =
    startLine && endLine
      ? `第 ${startLine}${startLine === endLine ? "" : `–${endLine}`} 行`
      : "";
  return [title, path, lineLabel || recordId].filter(Boolean).join(" · ");
}

function sourceList(
  sources: readonly PoetOverviewSource[] | undefined,
  sourceTitles: Readonly<Record<string, string>>,
) {
  if (!sources?.length) return null;
  return (
    <ul>
      {sources.map((source, index) => (
        <li key={`${source.sourceId}-${index}`}>
          {sourceLocatorLabel(source, sourceTitles)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The quiet first state of the social reader. It only uses published person
 * data and published event records; relation material appears after an
 * explicit node or edge selection.
 */
export function PoetOverviewPanel({
  fallbackName,
  profile,
  events = [],
  sourceTitles = {},
  statusLabel,
  onClose,
}: PoetOverviewPanelProps) {
  const displayName = profile?.name ?? fallbackName;
  const status = statusLabel ?? (profile?.reviewStatus === "published" ? "已发布资料" : "资料待补");
  const hasPublishedProfile = profile?.reviewStatus === "published";

  return (
    <aside
      className="detail-panel social-panel poet-overview-panel"
      aria-label={`${displayName}的人物档案`}
    >
      <header className="relationship-reader-header poet-overview-header">
        <p className="relationship-reader-kicker">人物档案 · {status}</p>
        <h2>{displayName}</h2>
        <p className="relationship-reader-lifespan">
          {[profile?.dynasty, lifespanLabel(profile)].filter(Boolean).join(" · ")}
        </p>
        {profile?.aliases?.length ? (
          <p className="poet-overview-aliases">{profile.aliases.join(" · ")}</p>
        ) : null}
        <button
          type="button"
          className="relationship-reader-close"
          onClick={onClose}
          aria-label="关闭人物档案"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="relationship-reader-content poet-overview-content">
        {hasPublishedProfile && profile?.intro ? (
          <p className="poet-overview-intro">{profile.intro}</p>
        ) : (
          <p className="poet-overview-intro poet-overview-intro--empty">
            此人物的已发布简介尚待补充。可先从图中选择人物或关系线，查看已保留的关系资料。
          </p>
        )}

        {events.length ? (
          <section className="poet-overview-events" aria-label="已发布生平线索">
            <div className="poet-overview-section-heading">
              <h3>已发布生平线索</h3>
              <span>{events.length} 则</span>
            </div>
            <ol>
              {events.map((event, index) => (
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

        {profile?.sourceRefs?.length ? (
          <details className="poet-overview-sources">
            <summary>人物资料来源 · {profile.sourceRefs.length}</summary>
            {sourceList(profile.sourceRefs, sourceTitles)}
          </details>
        ) : null}
      </div>
    </aside>
  );
}
