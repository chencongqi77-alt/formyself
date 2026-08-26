export type PoemWorldDisplayLink = {
  workTitle: string;
  openingLine?: string;
  excerpt: string;
};

function comparableText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, "").replace(/…+$/, "");
}

/**
 * Link evidence may be a title match. Keep that evidence in the data, but do
 * not render it as if it were a line of verse under the same title.
 */
export function poemWorldDisplayExcerpt(link: PoemWorldDisplayLink): string {
  const openingLine = link.openingLine?.trim() ?? "";
  if (
    openingLine &&
    comparableText(openingLine) !== comparableText(link.workTitle)
  ) {
    return openingLine;
  }

  const evidenceExcerpt = link.excerpt.trim();
  const title = comparableText(link.workTitle);
  const excerpt = comparableText(evidenceExcerpt);
  if (
    !excerpt ||
    excerpt === title ||
    title.startsWith(excerpt) ||
    excerpt.startsWith(title)
  ) {
    return "";
  }
  return evidenceExcerpt;
}
