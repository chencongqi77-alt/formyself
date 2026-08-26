import Link from "next/link";

export type PoemWorldWorkCardData = {
  id: string;
  title: string;
  genre?: string;
  contextLabel: string;
  excerpt?: string;
  lines?: string[];
};

type PoemWorldWorkCardProps = {
  work: PoemWorldWorkCardData;
  href?: string;
  onSelect?: () => void;
  selected?: boolean;
};

/**
 * The shared reading card used by both the public poem map and a book's
 * private preview.  Callers only adapt their data; the reading hierarchy and
 * visual vocabulary stay identical.
 */
export function PoemWorldWorkCard({
  work,
  href,
  onSelect,
  selected = false,
}: PoemWorldWorkCardProps) {
  const body = (
    <>
      <span className="poem-link-meta">
        <span className="work-genre">{work.genre || "诗"}</span>
        <span>{work.contextLabel}</span>
      </span>
      <strong className="work-title" title={work.title}>{work.title}</strong>
      {work.lines?.length ? (
        <span className="poem-excerpt poem-excerpt--multiline">
          {work.lines.map((line, index) => <span key={`${work.id}-${index}`}>{line}</span>)}
        </span>
      ) : work.excerpt ? (
        <span className="poem-excerpt">{work.excerpt}</span>
      ) : null}
    </>
  );

  return (
    <li>
      {href ? (
        <Link href={href}>{body}</Link>
      ) : onSelect ? (
        <button type="button" className="poem-link-button" onClick={onSelect} aria-pressed={selected}>
          {body}
        </button>
      ) : (
        <article className="poem-featured-work">{body}</article>
      )}
    </li>
  );
}
