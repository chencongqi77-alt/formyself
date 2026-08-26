import type { ReadingStoryCard } from "../../lib/reading-samples";

const kindLabels: Record<ReadingStoryCard["kind"], string> = {
  journey: "行迹故事",
  place: "地点故事",
  relationship: "交游故事",
};

const claimLabels: Record<ReadingStoryCard["claimType"], string> = {
  fact: "史料事实",
  tradition: "传统说法",
  interpretation: "阅读解释",
};

const reviewLabels: Record<ReadingStoryCard["reviewStatus"], string> = {
  published: "已发布",
  "candidate-preview": "候选样例",
};

export function StoryCard({
  story,
  compact = false,
}: {
  story: ReadingStoryCard;
  compact?: boolean;
}) {
  return (
    <article className={`shared-story-card${compact ? " shared-story-card--compact" : ""}`}>
      <header className="shared-story-card__header">
        <div>
          <p className="shared-story-card__kicker">
            {story.eyebrow ?? kindLabels[story.kind]}
          </p>
          <h3>{story.title}</h3>
        </div>
        <span className="shared-story-card__claim">
          {claimLabels[story.claimType]}
        </span>
      </header>
      <p className="shared-story-card__summary">{story.summary}</p>
      {!compact && story.paragraphs?.map((paragraph, index) => (
        <p className="shared-story-card__paragraph" key={`${story.id}-${index}`}>
          {paragraph}
        </p>
      ))}
      {story.disclaimer ? (
        <aside className="shared-story-card__disclaimer">
          <span>阅读边界</span>
          <p>{story.disclaimer}</p>
        </aside>
      ) : null}
      <footer className="shared-story-card__footer">
        <span>{kindLabels[story.kind]}</span>
        <span>{reviewLabels[story.reviewStatus]}</span>
        <span>{story.evidenceIds.length} 条证据</span>
      </footer>
    </article>
  );
}

