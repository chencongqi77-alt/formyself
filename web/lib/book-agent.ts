export type ReviewState =
  | "candidate-preview"
  | "needs-review"
  | "approved-private-preview"
  | "rejected";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface ValidationReport {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
}

export interface EvidenceLocator {
  kind: "text-span";
  startOffset: number;
  endOffset: number;
  label: string;
}

export interface Evidence {
  id: string;
  sourceFileId: string;
  locator: EvidenceLocator;
  support: "direct" | "context" | "contradicts";
  excerptSha256: string;
  createdByJobId: string;
}

export interface AnchorRef {
  type: "person" | "place" | "work";
  id: string;
}

export interface PersonEntity {
  id: string;
  name: string;
  aliases: string[];
  resolutionState: "resolved" | "candidate" | "ambiguous";
  evidenceIds: string[];
}

export interface PlaceEntity {
  id: string;
  label: string;
  historicalNames: string[];
  modernName?: string;
  resolutionState: "resolved" | "candidate" | "ambiguous" | "unresolved";
  mapKind: "point" | "region" | "none";
  coordinate?: { x: number; y: number; precision: "display-only" };
  evidenceIds: string[];
}

export interface WorkEntity {
  id: string;
  authorPersonId?: string;
  title: string;
  genre?: string;
  discoveryState: "matched" | "extracted-title" | "candidate";
  evidenceIds: string[];
}

export interface StoryCard {
  id: string;
  kind: "journey" | "place" | "relationship" | "tradition";
  title: string;
  summary: string;
  claimType: "fact" | "tradition" | "interpretation";
  anchorRefs: AnchorRef[];
  evidenceIds: string[];
  reviewState: ReviewState;
  disclaimerCode: "not-independent-historical-fact";
}

export interface TimeQualifier {
  precision: "year" | "range" | "sequence-only" | "unknown";
  label: string;
  startYear?: number;
  endYear?: number;
}

export interface JourneyItem {
  id: string;
  placeId: string;
  predicate:
    | "born-at"
    | "died-at"
    | "resided-at"
    | "visited"
    | "traveled-to"
    | "held-office-at"
    | "exiled-to"
    | "studied-at"
    | "stayed-at";
  sequence: number;
  time?: TimeQualifier;
  storyIds: string[];
  mapEligible: boolean;
  evidenceIds: string[];
  reviewState: ReviewState;
}

export interface PoemWorldItem {
  id: string;
  kind: "place-link" | "scene-note";
  workId: string;
  placeId?: string;
  relationType?:
    | "composed-at"
    | "inscribed-at"
    | "describes-place"
    | "mentioned-place";
  storyIds: string[];
  evidenceIds: string[];
  reviewState: ReviewState;
}

export interface PoemWorldSpotlight {
  placeId: string;
  storyIds: string[];
}

export interface SocialEdge {
  id: string;
  sourcePersonId: string;
  targetPersonId: string;
  relationTypes: Array<
    | "kin"
    | "literary-exchange"
    | "official"
    | "teacher-student"
    | "friendship"
    | "other"
  >;
  time?: TimeQualifier;
  placeIds: string[];
  workIds: string[];
  storyIds: string[];
  evidenceIds: string[];
  reviewState: ReviewState;
}

export interface BookAnalysisDraft {
  recordType: "private-poet-volume-bundle";
  schemaVersion: "2.0.0-prototype";
  bundleId: string;
  jobId: string;
  createdAt: string;
  access: {
    visibility: "private";
    publicationState: "not-submitted";
  };
  reviewState: ReviewState;
  source: {
    bookId: string;
    bookTitle: string;
    packageId: string;
    packageSha256: string;
    packageOwnerJobId: string;
  };
  poet: {
    id: string;
    name: string;
    identityState: "resolved" | "candidate" | "ambiguous";
  };
  evidence: Evidence[];
  entities: {
    people: PersonEntity[];
    places: PlaceEntity[];
    works: WorkEntity[];
  };
  storyCards: StoryCard[];
  volumes: {
    journey: {
      state: "ready" | "empty";
      routeSemantics: "narrative-sequence-not-exact-route";
      items: JourneyItem[];
      limitations: string[];
    };
    poemWorld: {
      state: "ready" | "empty";
      items: PoemWorldItem[];
      spotlights: PoemWorldSpotlight[];
      limitations: string[];
    };
    social: {
      state: "ready" | "empty";
      edges: SocialEdge[];
      limitations: string[];
    };
  };
  limitations: string[];
}

export interface BookAnalysisResult {
  draft: BookAnalysisDraft;
  validation: ValidationReport;
  sourceText: string;
  segmentCount: number;
  fileName: string;
  references: BookAnalysisReferences;
  model?: BookAgentModelMeta;
}

export interface BookAgentReferenceSource {
  id: "published-events" | "chinese-poetry" | "cbdb";
  label: string;
  available: boolean;
}

export interface BookAgentReferenceEvent {
  id: string;
  personId: string;
  placeId: string;
  startYear?: number;
  endYear?: number;
  timeLabel?: string;
  sequence?: number;
  lifeStage?: string;
  role?: string;
  title: string;
  summary: string;
  workIds?: string[];
  reviewStatus?: string;
  sourceRefs?: Array<{ sourceId?: string }>;
}

export interface BookAgentReferenceWorkLink {
  id: string;
  workId: string;
  personId: string;
  placeId: string;
  eventId?: string;
  relationType?: NonNullable<PoemWorldItem["relationType"]>;
  certainty?: string;
  timeLabel?: string;
  note?: string;
  reviewStatus?: string;
  sourceRefs?: Array<{ sourceId?: string }>;
}

export interface BookAgentReferenceCorpusWork {
  id: string;
  personId: string;
  title: string;
  genre?: string;
  text?: string[];
  sourceRecord?: { sourceId?: string };
}

export interface BookAgentReferenceSocialPerson {
  id: string;
  name: string;
  birthYear?: number | null;
  deathYear?: number | null;
}

export interface BookAgentReferenceSocialEdge {
  id: string;
  source: string;
  target: string;
  displayBuckets?: string[];
  confidence?: string;
  evidenceCount?: number;
  years?: { startYear?: number | null; endYear?: number | null };
  origin?: string;
  decisionState?: string;
  sourceRefs?: Array<{ sourceId?: string }>;
}

export interface BookAgentReferenceCatalogs {
  events?: BookAgentReferenceEvent[];
  workPlaceLinks?: BookAgentReferenceWorkLink[];
  corpusWorks?: BookAgentReferenceCorpusWork[];
  social?: {
    person?: BookAgentReferenceSocialPerson;
    people?: BookAgentReferenceSocialPerson[];
    edges?: BookAgentReferenceSocialEdge[];
  };
}

export interface BookAgentReferenceJourneyEvent {
  id: string;
  title: string;
  summary: string;
  startYear?: number;
  endYear?: number;
  timeLabel?: string;
  sequence?: number;
  lifeStage?: string;
  role?: string;
  workIds: string[];
  sourceIds: string[];
}

export interface BookAgentReferenceWork {
  id: string;
  title: string;
  genre?: string;
  text: string[];
  placeId?: string;
  eventId?: string;
  relationType: NonNullable<PoemWorldItem["relationType"]>;
  certainty?: "verified" | "probable";
  timeLabel?: string;
  note?: string;
  sourceIds: string[];
  origin: "published-work-place-link" | "chinese-poetry-match";
}

export interface BookAgentReferenceSocialConnection {
  id: string;
  sourcePersonId: string;
  targetPersonId: string;
  sourceName: string;
  targetName: string;
  relationTypes: SocialEdge["relationTypes"];
  relationLabels: string[];
  startYear?: number;
  endYear?: number;
  evidenceCount: number;
  sourceIds: string[];
}

export interface BookAnalysisReferences {
  status: "available" | "partial" | "unavailable";
  sources: BookAgentReferenceSource[];
  journeyByPlace: Record<string, BookAgentReferenceJourneyEvent[]>;
  worksByPlace: Record<string, BookAgentReferenceWork[]>;
  socialEdges: BookAgentReferenceSocialConnection[];
}

export interface BookAgentModelMeta {
  engine: "local-rules" | "llm-hybrid" | "local-fallback";
  provider?: string;
  model?: string;
  chunkCount?: number;
  candidateCount?: number;
  warning?: string;
}

export interface BookAnalysisSegment {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
  ordinal: number;
}

export interface BookAgentModelPersonCandidate {
  name: string;
  aliases: string[];
  segmentIds: string[];
  note: string;
}

export interface BookAgentModelPlaceCandidate {
  name: string;
  historicalNames: string[];
  segmentIds: string[];
  note: string;
}

export interface BookAgentModelWorkCandidate {
  title: string;
  authorName: string | null;
  segmentIds: string[];
  note: string;
}

export interface BookAgentModelJourneyCandidate {
  personName: string;
  placeName: string;
  predicate: JourneyItem["predicate"];
  timeLabel: string | null;
  segmentIds: string[];
  storyTitle: string;
  storySummary: string;
}

export interface BookAgentModelPoemWorldCandidate {
  workTitle: string;
  placeName: string;
  relationType: NonNullable<PoemWorldItem["relationType"]>;
  segmentIds: string[];
  storyTitle: string;
  storySummary: string;
}

export interface BookAgentModelSocialCandidate {
  sourcePersonName: string;
  targetPersonName: string;
  relationTypes: SocialEdge["relationTypes"];
  placeNames: string[];
  workTitles: string[];
  segmentIds: string[];
  storyTitle: string;
  storySummary: string;
}

export interface BookAgentModelOutput {
  people: BookAgentModelPersonCandidate[];
  places: BookAgentModelPlaceCandidate[];
  works: BookAgentModelWorkCandidate[];
  journey: BookAgentModelJourneyCandidate[];
  poemWorld: BookAgentModelPoemWorldCandidate[];
  social: BookAgentModelSocialCandidate[];
}

interface CatalogPerson {
  id: string;
  name: string;
  aliases?: string[];
}

interface CatalogPlace {
  id: string;
  name: string;
  historicalNames?: string[];
  modernName?: string;
  sourceCoordinates?: { x?: number; y?: number };
}

interface CatalogWork {
  id: string;
  personId?: string;
  title: string;
  genre?: string;
  text?: string[];
}

export interface BookAgentCatalogs {
  people: CatalogPerson[];
  places: CatalogPlace[];
  works: CatalogWork[];
  reference?: BookAgentReferenceCatalogs;
}

interface TextSpan {
  text: string;
  startOffset: number;
  endOffset: number;
  ordinal: number;
}

const ACTION_RULES: Array<{
  predicate: JourneyItem["predicate"];
  pattern: RegExp;
}> = [
  { predicate: "born-at", pattern: /(?:出生(?:于|在)|生于|生在|诞生(?:于|在))/ },
  { predicate: "died-at", pattern: /(?:逝世(?:于|在)|病逝(?:于|在)|卒于|死于)/ },
  { predicate: "exiled-to", pattern: /(?:贬(?:至|谪)|贬谪(?:至|于|在)?|谪(?:居|至|于|在)|流放(?:至|于|在))/ },
  { predicate: "held-office-at", pattern: /(?:出任|任职|担任|为官|授(?:任|官)|知(?:府|州|县)|守(?:府|州|县))/ },
  { predicate: "resided-at", pattern: /(?:寓居|旅居|定居|迁居|居住|居于|居在|住于|住在|卜居)/ },
  { predicate: "stayed-at", pattern: /(?:留居|停留|驻留|驻于|驻在|寄居)/ },
  { predicate: "visited", pattern: /(?:游历|游于|过访|拜访)/ },
  { predicate: "traveled-to", pattern: /(?:抵达|到达|前往|奔赴|赴任|赴京|行至|进入|入京)/ },
];

const POEM_RELATION_RULES: Array<{
  relationType: NonNullable<PoemWorldItem["relationType"]>;
  pattern: RegExp;
}> = [
  { relationType: "composed-at", pattern: /(?:作于|写于|创作于|创作在|写成于|成于)/ },
  { relationType: "inscribed-at", pattern: /(?:题于|题写|题刻于|刻于)/ },
  { relationType: "describes-place", pattern: /(?:描写|描绘|题咏|吟咏|咏及|写到|写出|写)/ },
  { relationType: "mentioned-place", pattern: /(?:提到|提及|谈到|谈及|涉及|出现)/ },
];

const RELATIONSHIP_CUES = /(?:赠|寄|答|和诗|和作|和韵|同游|交游|师从|门下|为友|荐|书信|往来|会于|同僚|唱和|相识)/;
const NEGATION_PREFIX_PATTERN = /(?:(?:并非|并无|并不是|从未|未曾|不曾|没有|不是)[^，,；;。！？!?\n]{0,8}|(?:未|不|非|无)[^，,；;。！？!?\n]{0,2})$/;
const TEACHER_CUES = /(?:师从|门下|受业|弟子|师生|教授)/;
const LITERARY_CUES = /(?:诗|词|文|赋|赠|寄|答|和|唱和|书信)/;
const OFFICIAL_CUES = /(?:同僚|任职|为官|朝廷|政务|荐|幕府)/;
const FRIENDSHIP_CUES = /(?:交游|为友|同游|相识|友人|往来)/;
const YEAR_PATTERN = /公元\s*(-?\d{1,4})年/;
const ERA_PATTERN = /([\u3400-\u9fff]{1,8}(?:元年|[一二三四五六七八九十百千〇零]+年|年间))/;
const SENTENCE_PATTERN = /[^。！？!?；;\n]+[。！？!?；;]?/g;
const CLAUSE_BOUNDARY_PATTERN = /[，,；;。！？!?\n]/;
const TITLE_PATTERN = /《([^》]{1,60})》/g;
const MAX_SEGMENT_CHARS = 900;

function simpleHash(input: string): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 16777619);
    hashB ^= code + index;
    hashB = Math.imul(hashB, 2246822519);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, "0")}${(hashB >>> 0).toString(16).padStart(8, "0")}`;
}

export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return simpleHash(typeof value === "string" ? value : new TextDecoder().decode(value)).repeat(4);
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
}

function slugify(value: string, fallback: string): string {
  const ascii = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || fallback;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function splitSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const matches = Array.from(text.matchAll(SENTENCE_PATTERN));
  if (!matches.length && text) {
    return [{ text, startOffset: 0, endOffset: text.length, ordinal: 1 }];
  }
  let ordinal = 1;
  for (const match of matches) {
    const raw = match[0] ?? "";
    const startOffset = match.index ?? 0;
    const value = raw.trim();
    if (!value) continue;
    const leading = raw.length - raw.trimStart().length;
    const start = startOffset + leading;
    const end = start + value.length;
    if (value.length <= MAX_SEGMENT_CHARS) {
      spans.push({ text: value, startOffset: start, endOffset: end, ordinal });
      ordinal += 1;
      continue;
    }
    for (let offset = 0; offset < value.length; offset += MAX_SEGMENT_CHARS) {
      const part = value.slice(offset, offset + MAX_SEGMENT_CHARS);
      spans.push({
        text: part,
        startOffset: start + offset,
        endOffset: start + offset + part.length,
        ordinal,
      });
      ordinal += 1;
    }
  }
  return spans;
}

export function getBookAnalysisSegments(text: string): BookAnalysisSegment[] {
  return splitSpans(normalizeText(text)).map((span) => ({
    ...span,
    id: `seg-${span.ordinal}`,
  }));
}

function firstMention(
  text: string,
  names: string[],
  excludedRanges: Array<{ start: number; end: number }> = [],
): { start: number; end: number; value: string } | null {
  const ordered = unique(names.filter(Boolean)).sort((left, right) => right.length - left.length);
  let best: { start: number; end: number; value: string } | null = null;
  for (const value of ordered) {
    let fromIndex = 0;
    while (fromIndex < text.length) {
      const index = text.indexOf(value, fromIndex);
      if (index < 0) break;
      const end = index + value.length;
      const excluded = excludedRanges.some((range) => index < range.end && end > range.start);
      if (!excluded && (!best || index < best.start || (index === best.start && value.length > best.value.length))) {
        best = { start: index, end, value };
      }
      if (!excluded) break;
      fromIndex = end;
    }
  }
  return best;
}

function mentionsInSpan<T extends { id: string }>(
  span: TextSpan,
  records: Array<T & { names: string[] }>,
  excludedRanges: Array<{ start: number; end: number }> = [],
): Array<T & { matchedName: string; mentionStart: number; mentionEnd: number }> {
  const found: Array<T & { matchedName: string; mentionStart: number; mentionEnd: number }> = [];
  for (const record of records) {
    const mention = firstMention(span.text, record.names, excludedRanges);
    if (mention) {
      found.push({
        ...record,
        matchedName: mention.value,
        mentionStart: mention.start,
        mentionEnd: mention.end,
      });
    }
  }
  return found.sort((left, right) => left.mentionStart - right.mentionStart || right.matchedName.length - left.matchedName.length);
}

interface JourneyActionMention {
  predicate: JourneyItem["predicate"];
  start: number;
  end: number;
  ruleOrder: number;
}

interface PoemRelationMention {
  relationType: NonNullable<PoemWorldItem["relationType"]>;
  start: number;
  end: number;
  ruleOrder: number;
}

interface ClauseSpan {
  text: string;
  start: number;
  end: number;
}

function journeyActionMentions(text: string): JourneyActionMention[] {
  const mentions: JourneyActionMention[] = [];
  ACTION_RULES.forEach((rule, ruleOrder) => {
    const matcher = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace(/g/g, "")}g`);
    for (const match of text.matchAll(matcher)) {
      const start = match.index ?? -1;
      if (start < 0 || !match[0]) continue;
      if (cueIsNegated(text, start)) continue;
      mentions.push({ predicate: rule.predicate, start, end: start + match[0].length, ruleOrder });
    }
  });
  return mentions.sort((left, right) => left.start - right.start || left.ruleOrder - right.ruleOrder);
}

function poemRelationMentions(text: string): PoemRelationMention[] {
  const mentions: PoemRelationMention[] = [];
  POEM_RELATION_RULES.forEach((rule, ruleOrder) => {
    const matcher = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace(/g/g, "")}g`);
    for (const match of text.matchAll(matcher)) {
      const start = match.index ?? -1;
      if (start < 0 || !match[0]) continue;
      if (cueIsNegated(text, start)) continue;
      mentions.push({ relationType: rule.relationType, start, end: start + match[0].length, ruleOrder });
    }
  });
  return mentions.sort((left, right) => left.start - right.start || left.ruleOrder - right.ruleOrder);
}

function textClauses(text: string): ClauseSpan[] {
  const clauses: ClauseSpan[] = [];
  let rawStart = 0;
  const append = (rawEnd: number): void => {
    const raw = text.slice(rawStart, rawEnd);
    const leading = raw.length - raw.trimStart().length;
    const value = raw.trim();
    if (value) clauses.push({ text: value, start: rawStart + leading, end: rawStart + leading + value.length });
  };
  for (let index = 0; index < text.length; index += 1) {
    if (!CLAUSE_BOUNDARY_PATTERN.test(text[index] ?? "")) continue;
    append(index);
    rawStart = index + 1;
  }
  append(text.length);
  return clauses;
}

function clauseBounds(text: string, offset: number): { start: number; end: number } {
  let start = 0;
  let end = text.length;
  for (let index = Math.max(0, offset - 1); index >= 0; index -= 1) {
    if (!CLAUSE_BOUNDARY_PATTERN.test(text[index] ?? "")) continue;
    start = index + 1;
    break;
  }
  for (let index = Math.max(0, offset); index < text.length; index += 1) {
    if (!CLAUSE_BOUNDARY_PATTERN.test(text[index] ?? "")) continue;
    end = index;
    break;
  }
  return { start, end };
}

function cueIsNegated(text: string, cueStart: number): boolean {
  const bounds = clauseBounds(text, cueStart);
  return NEGATION_PREFIX_PATTERN.test(text.slice(Math.max(bounds.start, cueStart - 16), cueStart));
}

function hasAffirmedRelationshipCue(text: string): boolean {
  const matcher = new RegExp(RELATIONSHIP_CUES.source, "g");
  for (const match of text.matchAll(matcher)) {
    const start = match.index ?? -1;
    if (start >= 0 && match[0] && !cueIsNegated(text, start)) return true;
  }
  return false;
}

function hasNegatedRuleInClause(
  text: string,
  offset: number,
  rules: Array<{ pattern: RegExp }>,
): boolean {
  const bounds = clauseBounds(text, offset);
  for (const rule of rules) {
    const matcher = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace(/g/g, "")}g`);
    for (const match of text.matchAll(matcher)) {
      const start = match.index ?? -1;
      if (start < bounds.start || start >= bounds.end || !match[0]) continue;
      if (cueIsNegated(text, start)) return true;
    }
  }
  return false;
}

function distanceBetweenSpans(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): number {
  if (leftEnd <= rightStart) return rightStart - leftEnd;
  if (rightEnd <= leftStart) return leftStart - rightEnd;
  return 0;
}

function actionForPlaceMention(
  text: string,
  mentionStart: number,
  mentionEnd: number,
  actions = journeyActionMentions(text),
): JourneyActionMention | null {
  const bounds = clauseBounds(text, mentionStart);
  const candidates = actions.filter((action) => action.start >= bounds.start && action.end <= bounds.end);
  if (!candidates.length) return null;
  return candidates.sort((left, right) => {
    const leftDistance = distanceBetweenSpans(left.start, left.end, mentionStart, mentionEnd);
    const rightDistance = distanceBetweenSpans(right.start, right.end, mentionStart, mentionEnd);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    const leftDirection = left.start <= mentionStart ? 0 : 1;
    const rightDirection = right.start <= mentionStart ? 0 : 1;
    return leftDirection - rightDirection || left.ruleOrder - right.ruleOrder;
  })[0] ?? null;
}

function poemRelationForPlaceMention(
  text: string,
  mentionStart: number,
  mentionEnd: number,
  relations = poemRelationMentions(text),
): PoemRelationMention | null {
  const bounds = clauseBounds(text, mentionStart);
  const candidates = relations.filter((relation) => relation.start >= bounds.start && relation.end <= bounds.end);
  if (!candidates.length) return null;
  return candidates.sort((left, right) => {
    const leftDistance = distanceBetweenSpans(left.start, left.end, mentionStart, mentionEnd);
    const rightDistance = distanceBetweenSpans(right.start, right.end, mentionStart, mentionEnd);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    const leftDirection = left.start <= mentionStart ? 0 : 1;
    const rightDirection = right.start <= mentionStart ? 0 : 1;
    return leftDirection - rightDirection || left.ruleOrder - right.ruleOrder;
  })[0] ?? null;
}

function subjectForPlaceAction<T extends { id: string; mentionStart: number; mentionEnd: number }>(
  text: string,
  people: T[],
  placeStart: number,
  action: JourneyActionMention,
): T | null {
  const bounds = clauseBounds(text, placeStart);
  const inClause = people.filter((person) => person.mentionStart >= bounds.start && person.mentionEnd <= bounds.end);
  if (inClause.length === 1) return inClause[0] ?? null;
  if (inClause.length > 1) return null;
  const preceding = people.filter((person) => person.mentionEnd <= Math.min(bounds.start, action.start));
  const nearest = preceding.sort((left, right) => right.mentionEnd - left.mentionEnd)[0];
  if (!nearest) return null;
  const previousBounds = clauseBounds(text, nearest.mentionStart);
  const previousClausePeople = people.filter((person) => person.mentionStart >= previousBounds.start && person.mentionEnd <= previousBounds.end);
  return previousClausePeople.length === 1 ? nearest : null;
}

function workForPlaceMention<T extends { mentionStart: number; mentionEnd: number }>(
  text: string,
  works: T[],
  placeStart: number,
  placeEnd: number,
): T | null {
  if (!works.length) return null;
  const bounds = clauseBounds(text, placeStart);
  const inClause = works.filter((work) => work.mentionStart >= bounds.start && work.mentionEnd <= bounds.end);
  if (inClause.length) {
    return inClause.sort((left, right) => (
      distanceBetweenSpans(left.mentionStart, left.mentionEnd, placeStart, placeEnd)
      - distanceBetweenSpans(right.mentionStart, right.mentionEnd, placeStart, placeEnd)
    ))[0] ?? null;
  }
  const preceding = works.filter((work) => work.mentionEnd <= placeStart).sort((left, right) => right.mentionEnd - left.mentionEnd);
  if (preceding.length) return preceding[0] ?? null;
  return works.length === 1 ? works[0] ?? null : null;
}

function allTextMentions(text: string, names: string[]): Array<{ start: number; end: number; value: string }> {
  const candidates: Array<{ start: number; end: number; value: string }> = [];
  for (const value of unique(names.filter(Boolean)).sort((left, right) => right.length - left.length)) {
    let fromIndex = 0;
    while (fromIndex < text.length) {
      const start = text.indexOf(value, fromIndex);
      if (start < 0) break;
      candidates.push({ start, end: start + value.length, value });
      fromIndex = start + Math.max(1, value.length);
    }
  }
  const accepted: Array<{ start: number; end: number; value: string }> = [];
  for (const candidate of candidates.sort((left, right) => left.start - right.start || right.value.length - left.value.length)) {
    if (accepted.some((mention) => candidate.start >= mention.start && candidate.end <= mention.end)) continue;
    accepted.push(candidate);
  }
  return accepted;
}

function bookTitleMentions(text: string): Array<{ title: string; mentionStart: number; mentionEnd: number }> {
  const mentions: Array<{ title: string; mentionStart: number; mentionEnd: number }> = [];
  const matcher = new RegExp(TITLE_PATTERN.source, "g");
  for (const match of text.matchAll(matcher)) {
    const title = match[1]?.trim();
    const mentionStart = match.index ?? -1;
    if (!title || mentionStart < 0 || !match[0]) continue;
    mentions.push({ title, mentionStart, mentionEnd: mentionStart + match[0].length });
  }
  return mentions;
}

function outsideMentionRanges<T extends { start: number; end: number }>(
  mentions: T[],
  ranges: Array<{ mentionStart: number; mentionEnd: number }>,
): T[] {
  return mentions.filter((mention) => !ranges.some((range) => mention.start < range.mentionEnd && mention.end > range.mentionStart));
}

function evidenceId(jobId: string, kind: string, span: TextSpan, extra = ""): string {
  return `ev-${simpleHash(`${jobId}|${kind}|${span.startOffset}|${span.endOffset}|${extra}`)}`;
}

function contentId(prefix: string, jobId: string, ...parts: string[]): string {
  return `${prefix}-${simpleHash([jobId, ...parts].join("|"))}`;
}

function reviewStateFor(items: unknown[]): ReviewState {
  const reviewStates = items
    .map((item) => typeof item === "object" && item !== null && "reviewState" in item ? item.reviewState : undefined)
    .filter((state): state is ReviewState => typeof state === "string");
  if (reviewStates.some((state) => state === "rejected")) return "needs-review";
  if (reviewStates.some((state) => state !== "approved-private-preview")) return "needs-review";
  return "approved-private-preview";
}

function timeQualifier(text: string, sequence: number): TimeQualifier {
  const year = text.match(YEAR_PATTERN);
  if (year) {
    const parsed = Number(year[1]);
    return { precision: "year", label: year[0], startYear: parsed, endYear: parsed };
  }
  const era = text.match(ERA_PATTERN);
  if (era) return { precision: "unknown", label: era[1] };
  return { precision: "sequence-only", label: `文中第 ${sequence} 个候选` };
}

function relationTypes(text: string): SocialEdge["relationTypes"] {
  const values: SocialEdge["relationTypes"] = [];
  if (TEACHER_CUES.test(text)) values.push("teacher-student");
  if (LITERARY_CUES.test(text)) values.push("literary-exchange");
  if (OFFICIAL_CUES.test(text)) values.push("official");
  if (FRIENDSHIP_CUES.test(text)) values.push("friendship");
  return values.length ? values : ["other"];
}

function storySummary(kind: StoryCard["kind"], title: string): string {
  if (kind === "journey") return `${title}来自书内生平动作与地点的同句候选；它是自动整理的行迹线索，仍需人工回读原文。`;
  if (kind === "place") return `${title}来自书内作品与地点的并置或地点关系线索；作品空间不自动等同于人物到访。`;
  return `${title}来自书内人物同句往来线索；这是待审核的关系阅读卡，不独立构成历史事实。`;
}

function addAnchor(refs: AnchorRef[], type: AnchorRef["type"], id: string): void {
  if (!refs.some((ref) => ref.type === type && ref.id === id)) refs.push({ type, id });
}

function referenceSourceIds(sourceRefs: Array<{ sourceId?: string }> | undefined): string[] {
  return unique((sourceRefs ?? []).map((reference) => reference.sourceId?.trim() ?? "").filter(Boolean));
}

function referencePlaceNames(place: CatalogPlace | undefined): string[] {
  if (!place) return [];
  return unique([place.name, ...(place.historicalNames ?? [])].map((name) => name.trim()).filter((name) => name.length >= 2));
}

function referenceWorkText(work: { text?: string[] } | undefined): string[] {
  return (work?.text ?? []).map((line) => line.trim()).filter(Boolean);
}

function referenceWorkMentionsPlace(work: BookAgentReferenceCorpusWork, names: string[]): boolean {
  if (!names.length) return false;
  const haystack = `${work.title}\n${(work.text ?? []).join("\n")}`;
  return names.some((name) => haystack.includes(name));
}

const CBDB_RELATION_TYPE: Record<string, SocialEdge["relationTypes"][number]> = {
  kin: "kin",
  friend: "friendship",
  friendship: "friendship",
  "literary-exchange": "literary-exchange",
  "teacher-student": "teacher-student",
  official: "official",
  patron: "other",
  opponent: "other",
};

const CBDB_RELATION_LABEL: Record<string, string> = {
  kin: "亲属",
  friend: "友人",
  friendship: "交游",
  "literary-exchange": "文学往来",
  "teacher-student": "师生",
  official: "同僚 / 官场",
  patron: "荐举 / 知遇",
  opponent: "政见关系",
};

function socialPairKey(sourcePersonId: string, targetPersonId: string): string {
  return sourcePersonId < targetPersonId
    ? `${sourcePersonId}|${targetPersonId}`
    : `${targetPersonId}|${sourcePersonId}`;
}

function lifespansOverlap(
  primary: BookAgentReferenceSocialPerson | undefined,
  other: BookAgentReferenceSocialPerson | undefined,
): boolean {
  if (!primary || !other) return true;
  if (typeof primary.birthYear === "number" && typeof other.deathYear === "number" && other.deathYear < primary.birthYear) return false;
  if (typeof primary.deathYear === "number" && typeof other.birthYear === "number" && other.birthYear > primary.deathYear) return false;
  return true;
}

function emptyBookAnalysisReferences(): BookAnalysisReferences {
  return {
    status: "unavailable",
    sources: [
      { id: "published-events", label: "站内已发布生平资料", available: false },
      { id: "chinese-poetry", label: "chinese-poetry 作品语料", available: false },
      { id: "cbdb", label: "CBDB 关系资料", available: false },
    ],
    journeyByPlace: {},
    worksByPlace: {},
    socialEdges: [],
  };
}

export function buildBookAnalysisReferences(
  draft: BookAnalysisDraft,
  catalogs: BookAgentCatalogs,
): BookAnalysisReferences {
  const reference = catalogs.reference;
  if (!reference) return emptyBookAnalysisReferences();

  const selectedPlaceIds = new Set([
    ...draft.volumes.journey.items.map((item) => item.placeId),
    ...draft.volumes.poemWorld.items.flatMap((item) => item.placeId ? [item.placeId] : []),
  ]);
  const sourceEvents = reference.events ?? [];
  const sourceLinks = reference.workPlaceLinks ?? [];
  const corpusWorks = reference.corpusWorks ?? [];
  const socialPeople = new Map<string, BookAgentReferenceSocialPerson>();
  for (const person of reference.social?.people ?? []) socialPeople.set(person.id, person);
  if (reference.social?.person) socialPeople.set(reference.social.person.id, reference.social.person);

  const references = emptyBookAnalysisReferences();
  references.sources = [
    { id: "published-events", label: "站内已发布生平资料", available: sourceEvents.length > 0 },
    { id: "chinese-poetry", label: "chinese-poetry 作品语料", available: sourceLinks.length > 0 || corpusWorks.length > 0 },
    { id: "cbdb", label: "CBDB 关系资料", available: (reference.social?.edges ?? []).length > 0 },
  ];
  const availableCount = references.sources.filter((source) => source.available).length;
  references.status = availableCount === references.sources.length ? "available" : availableCount ? "partial" : "unavailable";

  for (const placeId of selectedPlaceIds) {
    const events = sourceEvents
      .filter((event) => event.personId === draft.poet.id && event.placeId === placeId && event.reviewStatus !== "rejected")
      .sort((left, right) => (left.startYear ?? Number.MAX_SAFE_INTEGER) - (right.startYear ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 3)
      .map((event) => ({
        id: event.id,
        title: event.title,
        summary: event.summary,
        startYear: event.startYear,
        endYear: event.endYear,
        timeLabel: event.timeLabel,
        sequence: event.sequence,
        lifeStage: event.lifeStage,
        role: event.role,
        workIds: event.workIds ?? [],
        sourceIds: referenceSourceIds(event.sourceRefs),
      }));
    if (events.length) references.journeyByPlace[placeId] = events;
  }

  const corpusById = new Map(corpusWorks.map((work) => [work.id, work]));
  const catalogWorkById = new Map(catalogs.works.map((work) => [work.id, work]));
  const placeById = new Map(catalogs.places.map((place) => [place.id, place]));
  for (const placeId of selectedPlaceIds) {
    const works: BookAgentReferenceWork[] = [];
    const seenWorkIds = new Set<string>();
    const addWork = (work: BookAgentReferenceWork): void => {
      if (seenWorkIds.has(work.id) || works.length >= 7) return;
      seenWorkIds.add(work.id);
      works.push(work);
    };
    for (const link of sourceLinks) {
      if (link.personId !== draft.poet.id || link.placeId !== placeId || (link.reviewStatus && link.reviewStatus !== "published")) continue;
      const corpus = corpusById.get(link.workId);
      const catalog = catalogWorkById.get(link.workId);
      addWork({
        id: link.workId,
        title: corpus?.title ?? catalog?.title ?? link.workId,
        genre: corpus?.genre ?? catalog?.genre,
        text: referenceWorkText(corpus ?? catalog),
        placeId,
        eventId: link.eventId,
        relationType: link.relationType ?? "mentioned-place",
        certainty: link.certainty === "verified" ? "verified" : "probable",
        timeLabel: link.timeLabel,
        note: link.note,
        sourceIds: referenceSourceIds(link.sourceRefs),
        origin: "published-work-place-link",
      });
    }
    const placeNames = referencePlaceNames(placeById.get(placeId));
    for (const corpus of corpusWorks) {
      if (corpus.personId !== draft.poet.id || !referenceWorkMentionsPlace(corpus, placeNames)) continue;
      addWork({
        id: corpus.id,
        title: corpus.title,
        genre: corpus.genre,
        text: referenceWorkText(corpus),
        placeId,
        relationType: "mentioned-place",
        certainty: "probable",
        note: "诗题或正文出现该地点；仅作为语料关联，不据此推定创作地或人物到访。",
        sourceIds: corpus.sourceRecord?.sourceId ? [corpus.sourceRecord.sourceId] : ["chinese-poetry"],
        origin: "chinese-poetry-match",
      });
    }
    if (works.length) references.worksByPlace[placeId] = works;
  }

  const primarySocialPerson = socialPeople.get(draft.poet.id) ?? reference.social?.person;
  // CBDB is a comparison layer, never a source of private social candidates.
  // A reference connection is retained only after the uploaded text has already
  // produced the same person pair as a book-backed social edge.
  const textBackedSocialPairs = new Set(
    draft.volumes.social.edges
      .filter(
        (edge) =>
          edge.sourcePersonId === draft.poet.id ||
          edge.targetPersonId === draft.poet.id,
      )
      .map((edge) => socialPairKey(edge.sourcePersonId, edge.targetPersonId)),
  );
  const socialCandidates = (reference.social?.edges ?? []).flatMap((edge) => {
    if (edge.source !== draft.poet.id && edge.target !== draft.poet.id) return [];
    const otherId = edge.source === draft.poet.id ? edge.target : edge.source;
    if (!textBackedSocialPairs.has(socialPairKey(draft.poet.id, otherId))) {
      return [];
    }
    const other = socialPeople.get(otherId);
    if (!other?.name) return [];
    const buckets = unique((edge.displayBuckets ?? []).map((bucket) => bucket.trim()).filter(Boolean));
    const mappedTypes = unique(buckets.map((bucket) => CBDB_RELATION_TYPE[bucket]).filter(Boolean)) as SocialEdge["relationTypes"];
    const directBuckets = buckets.filter((bucket) => CBDB_RELATION_TYPE[bucket]);
    if (!directBuckets.length || !lifespansOverlap(primarySocialPerson, other)) return [];
    const relationLabels = directBuckets.map((bucket) => CBDB_RELATION_LABEL[bucket] ?? bucket);
    const connection: BookAgentReferenceSocialConnection = {
      id: edge.id,
      sourcePersonId: draft.poet.id,
      targetPersonId: other.id,
      sourceName: draft.poet.name,
      targetName: other.name,
      relationTypes: mappedTypes.length ? mappedTypes : ["other"],
      relationLabels,
      startYear: edge.years?.startYear ?? undefined,
      endYear: edge.years?.endYear ?? undefined,
      evidenceCount: Number.isFinite(edge.evidenceCount) ? edge.evidenceCount as number : 0,
      sourceIds: referenceSourceIds(edge.sourceRefs).length ? referenceSourceIds(edge.sourceRefs) : ["cbdb-20260718"],
    };
    const datedScore = typeof connection.startYear === "number" ? 200 : 0;
    return [{ connection, score: datedScore + connection.evidenceCount }];
  });
  const bestReferenceByPair = new Map<string, { connection: BookAgentReferenceSocialConnection; score: number }>();
  for (const candidate of socialCandidates) {
    const key = socialPairKey(
      candidate.connection.sourcePersonId,
      candidate.connection.targetPersonId,
    );
    const current = bestReferenceByPair.get(key);
    if (!current || candidate.score > current.score) {
      bestReferenceByPair.set(key, candidate);
    }
  }
  references.socialEdges = [...bestReferenceByPair.values()]
    .sort((left, right) => right.score - left.score || left.connection.targetName.localeCompare(right.connection.targetName, "zh-CN"))
    .map(({ connection }) => connection);

  return references;
}

export function enrichBookAnalysisReferences(
  result: BookAnalysisResult,
  catalogs: BookAgentCatalogs,
): BookAnalysisResult {
  return { ...result, references: buildBookAnalysisReferences(result.draft, catalogs) };
}

async function loadOptionalBookAgentCatalog<T>(path: string): Promise<T | undefined> {
  try {
    const response = await fetch(path);
    return response.ok ? await response.json() as T : undefined;
  } catch {
    return undefined;
  }
}

export async function loadBookAgentCatalogs(selectedPoetName = ""): Promise<BookAgentCatalogs> {
  const paths = ["/data/people.json", "/data/places.json", "/data/works.json"];
  const responses = await Promise.all(paths.map((path) => fetch(path)));
  if (responses.some((response) => !response.ok)) {
    throw new Error("现有 canonical 目录暂时无法加载，请稍后重试。");
  }
  const [people, places, works] = await Promise.all(responses.map((response) => response.json()));
  const catalogs: BookAgentCatalogs = {
    people: people as CatalogPerson[],
    places: places as CatalogPlace[],
    works: works as CatalogWork[],
  };
  const normalizedPoet = selectedPoetName.trim();
  const poet = catalogs.people.find((person) => [person.name, ...(person.aliases ?? [])].includes(normalizedPoet));
  if (!poet) return catalogs;
  const [events, workPlaceLinks, corpusWorks, social] = await Promise.all([
    loadOptionalBookAgentCatalog<BookAgentReferenceEvent[]>("/data/events.json"),
    loadOptionalBookAgentCatalog<BookAgentReferenceWorkLink[]>("/data/work-place-links.json"),
    loadOptionalBookAgentCatalog<BookAgentReferenceCorpusWork[]>(`/data/corpus/${encodeURIComponent(poet.id)}.json`),
    loadOptionalBookAgentCatalog<BookAgentReferenceCatalogs["social"]>(`/data/poet-social/${encodeURIComponent(poet.id)}.json`),
  ]);
  catalogs.reference = { events, workPlaceLinks, corpusWorks, social };
  return catalogs;
}

export async function analyzeBook(input: {
  text: string;
  fileName: string;
  bookTitle: string;
  poetName: string;
  fileSha256: string;
  catalogs: BookAgentCatalogs;
}): Promise<BookAnalysisResult> {
  const text = normalizeText(input.text);
  const catalogPeople = input.catalogs.people;
  const catalogPlaces = input.catalogs.places;
  const catalogWorks = input.catalogs.works;
  const spans = splitSpans(text);
  const jobId = `pmj-book-${input.fileSha256.slice(0, 12)}`;
  const bookId = slugify(input.bookTitle, `book-${input.fileSha256.slice(0, 12)}`);
  const packageId = `bpm-${bookId}-${input.fileSha256.slice(0, 8)}`.slice(0, 80);
  const bundleId = `ppvb-${bookId}-${input.fileSha256.slice(0, 8)}`.slice(0, 90);
  const sourceFileId = `book-file-${input.fileSha256.slice(0, 16)}`;
  const requestedPoetName = input.poetName.trim();
  const primaryPerson = catalogPeople.find((person) => [person.name, ...(person.aliases ?? [])].includes(requestedPoetName));
  const poetName = primaryPerson?.name ?? requestedPoetName;
  const poetId = primaryPerson?.id ?? slugify(requestedPoetName, `poet-${input.fileSha256.slice(0, 8)}`);

  const evidenceSpecs = new Map<string, { kind: string; span: TextSpan; support: Evidence["support"]; extra: string }>();
  const ensureEvidence = (kind: string, span: TextSpan, support: Evidence["support"] = "direct", extra = ""): string => {
    const id = evidenceId(jobId, kind, span, extra);
    if (!evidenceSpecs.has(id)) evidenceSpecs.set(id, { kind, span, support, extra });
    return id;
  };

  const referencedPeople = [
    ...(input.catalogs.reference?.social?.people ?? []),
    ...(input.catalogs.reference?.social?.person ? [input.catalogs.reference.social.person] : []),
  ]
    .filter((person) => person.name.length >= 2 && text.includes(person.name))
    .map((person) => ({ id: person.id, name: person.name, aliases: [] as string[] }));
  const people = Array.from(
    new Map([...catalogPeople, ...referencedPeople].map((person) => [person.id, person])).values(),
  ).map((person) => ({ ...person, names: unique([person.name, ...(person.aliases ?? [])]) }));
  const places = catalogPlaces.map((place) => ({ ...place, names: unique([place.name, ...(place.historicalNames ?? [])]) }));
  const works = catalogWorks.map((work) => ({ ...work, names: [work.title] }));
  const personEntities = new Map<string, PersonEntity>();
  const placeEntities = new Map<string, PlaceEntity>();
  const workEntities = new Map<string, WorkEntity>();
  const firstSpan = spans[0] ?? { text, startOffset: 0, endOffset: text.length, ordinal: 1 };

  const poetMention = firstMention(text, unique([requestedPoetName, poetName, ...(primaryPerson?.aliases ?? [])]));
  const poetEvidence = ensureEvidence("poet-identity", poetMention ? { ...firstSpan, startOffset: poetMention.start, endOffset: poetMention.end, text: poetMention.value, ordinal: firstSpan.ordinal } : firstSpan, poetMention ? "direct" : "context", poetId);
  personEntities.set(poetId, {
    id: poetId,
    name: poetName,
    aliases: primaryPerson?.aliases ?? [],
    resolutionState: primaryPerson ? "resolved" : "candidate",
    evidenceIds: [poetEvidence],
  });

  const storyCards: StoryCard[] = [];
  const journeyItems: JourneyItem[] = [];
  const poemWorldItems: PoemWorldItem[] = [];
  const socialEdges: SocialEdge[] = [];
  const spotlights = new Map<string, Set<string>>();

  for (const span of spans) {
    const mentionedPeople = mentionsInSpan(span, people);
    for (const person of mentionedPeople) {
      const id = person.id;
      if (!personEntities.has(id)) {
        personEntities.set(id, {
          id,
          name: person.name,
          aliases: person.aliases ?? [],
          resolutionState: "resolved",
          evidenceIds: [ensureEvidence("person-mention", span, "direct", id)],
        });
      }
    }

    const titleMentions = bookTitleMentions(span.text);
    const mentionedPlaces = mentionsInSpan(
      span,
      places,
      titleMentions.map((title) => ({ start: title.mentionStart, end: title.mentionEnd })),
    );
    for (const place of mentionedPlaces) {
      if (!placeEntities.has(place.id)) {
        const coordinate = place.sourceCoordinates;
        const hasCoordinate = typeof coordinate?.x === "number" && typeof coordinate?.y === "number";
        placeEntities.set(place.id, {
          id: place.id,
          label: place.name,
          historicalNames: place.historicalNames ?? [],
          modernName: place.modernName,
          resolutionState: "resolved",
          mapKind: hasCoordinate ? "point" : "region",
          coordinate: hasCoordinate ? { x: coordinate.x as number, y: coordinate.y as number, precision: "display-only" } : undefined,
          evidenceIds: [ensureEvidence("place-mention", span, "direct", place.id)],
        });
      }
    }

    const matchedWorks = mentionsInSpan(span, works);
    for (const work of matchedWorks) {
      if (work.personId && !personEntities.has(work.personId)) {
        const author = catalogPeople.find((person) => person.id === work.personId);
        if (author) {
          personEntities.set(work.personId, {
            id: author.id,
            name: author.name,
            aliases: author.aliases ?? [],
            resolutionState: "resolved",
            evidenceIds: [ensureEvidence("work-author-context", span, "context", work.personId)],
          });
        }
      }
      if (!workEntities.has(work.id)) {
        workEntities.set(work.id, {
          id: work.id,
          authorPersonId: work.personId,
          title: work.title,
          genre: work.genre,
          discoveryState: "matched",
          evidenceIds: [ensureEvidence("work-mention", span, "direct", work.id)],
        });
      }
    }

    for (const titleMatch of span.text.matchAll(TITLE_PATTERN)) {
      const title = titleMatch[1]?.trim();
      if (!title || catalogWorks.some((work) => work.title === title)) continue;
      const extractedId = contentId("work", jobId, title);
      if (!workEntities.has(extractedId)) {
        workEntities.set(extractedId, {
          id: extractedId,
          title,
          discoveryState: "extracted-title",
          evidenceIds: [ensureEvidence("extracted-work-title", span, "direct", title)],
        });
      }
    }

    const journeyActions = journeyActionMentions(span.text);
    for (const place of mentionedPlaces) {
      const action = actionForPlaceMention(span.text, place.mentionStart, place.mentionEnd, journeyActions);
      if (!action) continue;
      const subject = subjectForPlaceAction(span.text, mentionedPeople, place.mentionStart, action);
      if (mentionedPeople.length && subject?.id !== poetId) continue;
      const placeEntity = placeEntities.get(place.id);
      if (!placeEntity) continue;
      const itemEvidence = ensureEvidence("journey-candidate", span, "direct", `${place.id}|${action.predicate}`);
      const itemId = contentId("journey", jobId, span.startOffset.toString(), place.id, action.predicate);
      if (journeyItems.some((item) => item.id === itemId)) continue;
      const storyId = contentId("story", jobId, "journey", itemId);
      const story: StoryCard = {
        id: storyId,
        kind: "journey",
        title: `${placeEntity.label} · ${action.predicate}`,
        summary: storySummary("journey", `${poetName}与${placeEntity.label}`),
        claimType: "fact",
        anchorRefs: [
          { type: "person", id: poetId },
          { type: "place", id: placeEntity.id },
        ],
        evidenceIds: [itemEvidence],
        reviewState: "needs-review",
        disclaimerCode: "not-independent-historical-fact",
      };
      storyCards.push(story);
      journeyItems.push({
        id: itemId,
        placeId: placeEntity.id,
        predicate: action.predicate,
        sequence: journeyItems.length + 1,
        time: timeQualifier(span.text, journeyItems.length + 1),
        storyIds: [storyId],
        mapEligible: placeEntity.resolutionState === "resolved" && placeEntity.mapKind !== "none",
        evidenceIds: [itemEvidence],
        reviewState: "needs-review",
      });
    }

    const poemRelations = poemRelationMentions(span.text);
    for (const place of mentionedPlaces) {
      const work = workForPlaceMention(span.text, matchedWorks, place.mentionStart, place.mentionEnd);
      if (!work || work.personId !== poetId) continue;
      const relation = poemRelationForPlaceMention(span.text, place.mentionStart, place.mentionEnd, poemRelations);
      if (!relation && hasNegatedRuleInClause(span.text, place.mentionStart, POEM_RELATION_RULES)) continue;
      const relationType: NonNullable<PoemWorldItem["relationType"]> = relation?.relationType ?? "mentioned-place";
      const itemEvidence = ensureEvidence("poem-world-candidate", span, "direct", `${work.id}|${place.id}|${relationType}`);
      const itemId = contentId("poem", jobId, span.startOffset.toString(), work.id, place.id, relationType);
      if (poemWorldItems.some((item) => item.id === itemId)) continue;
      const storyId = contentId("story", jobId, "place", itemId);
      const workEntity = workEntities.get(work.id);
      const story: StoryCard = {
        id: storyId,
        kind: "place",
        title: `${workEntity?.title ?? work.title} · ${place.name}`,
        summary: storySummary("place", `《${workEntity?.title ?? work.title}》与${place.name}`),
        claimType: "interpretation",
        anchorRefs: [],
        evidenceIds: [itemEvidence],
        reviewState: "needs-review",
        disclaimerCode: "not-independent-historical-fact",
      };
      addAnchor(story.anchorRefs, "place", place.id);
      addAnchor(story.anchorRefs, "work", work.id);
      addAnchor(story.anchorRefs, "person", poetId);
      storyCards.push(story);
      poemWorldItems.push({
        id: itemId,
        kind: "place-link",
        workId: work.id,
        placeId: place.id,
        relationType,
        storyIds: [storyId],
        evidenceIds: [itemEvidence],
        reviewState: "needs-review",
      });
      if (!spotlights.has(place.id)) spotlights.set(place.id, new Set());
      spotlights.get(place.id)?.add(storyId);
    }

    const clauses = textClauses(span.text);
    for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
      const clause = clauses[clauseIndex];
      if (!clause) continue;
      const clausePeople = Array.from(new Map(
        mentionedPeople
          .filter((person) => person.mentionStart >= clause.start && person.mentionEnd <= clause.end)
          .map((person) => [person.id, person]),
      ).values());
      if (clausePeople.length !== 2 || !clausePeople.some((person) => person.id === poetId)) continue;

      let contextEnd = clause.end;
      for (let nextIndex = clauseIndex + 1; nextIndex < clauses.length; nextIndex += 1) {
        const nextClause = clauses[nextIndex];
        if (!nextClause) continue;
        const nextHasNamedPerson = mentionedPeople.some((person) => person.mentionStart >= nextClause.start && person.mentionEnd <= nextClause.end);
        if (nextHasNamedPerson) break;
        contextEnd = nextClause.end;
      }
      const contextText = span.text.slice(clause.start, contextEnd);
      if (!hasAffirmedRelationshipCue(contextText)) continue;

      const target = clausePeople.find((person) => person.id !== poetId);
      if (!target) continue;
      const sourcePersonId = poetId;
      const targetPersonId = target.id;
      const evidenceSpan: TextSpan = {
        text: contextText,
        startOffset: span.startOffset + clause.start,
        endOffset: span.startOffset + contextEnd,
        ordinal: span.ordinal,
      };
      const edgeEvidence = ensureEvidence("social-candidate", evidenceSpan, "direct", `${sourcePersonId}|${targetPersonId}`);
      const edgeId = contentId("edge", jobId, evidenceSpan.startOffset.toString(), sourcePersonId, targetPersonId);
      if (socialEdges.some((edge) => edge.id === edgeId)) continue;
      const placeIds = mentionedPlaces
        .filter((place) => place.mentionStart >= clause.start && place.mentionEnd <= contextEnd)
        .map((place) => place.id);
      const workIds = matchedWorks
        .filter((work) => work.mentionStart >= clause.start && work.mentionEnd <= contextEnd)
        .map((work) => work.id);
      const storyId = contentId("story", jobId, "relationship", edgeId);
      const sourceName = personEntities.get(sourcePersonId)?.name ?? poetName;
      const story: StoryCard = {
        id: storyId,
        kind: "relationship",
        title: `${sourceName}与${target.name} · 往来线索`,
        summary: storySummary("relationship", `${sourceName}与${target.name}`),
        claimType: "fact",
        anchorRefs: [
          { type: "person", id: sourcePersonId },
          { type: "person", id: targetPersonId },
        ],
        evidenceIds: [edgeEvidence],
        reviewState: "needs-review",
        disclaimerCode: "not-independent-historical-fact",
      };
      for (const placeId of placeIds) addAnchor(story.anchorRefs, "place", placeId);
      for (const workId of workIds) addAnchor(story.anchorRefs, "work", workId);
      storyCards.push(story);
      socialEdges.push({
        id: edgeId,
        sourcePersonId,
        targetPersonId,
        relationTypes: relationTypes(contextText),
        time: timeQualifier(contextText, socialEdges.length + 1),
        placeIds,
        workIds,
        storyIds: [storyId],
        evidenceIds: [edgeEvidence],
        reviewState: "needs-review",
      });
    }
  }

  const evidence = await Promise.all(
    Array.from(evidenceSpecs.entries()).map(async ([id, spec]) => ({
      id,
      sourceFileId,
      locator: {
        kind: "text-span" as const,
        startOffset: spec.span.startOffset,
        endOffset: spec.span.endOffset,
        label: `第 ${spec.span.ordinal} 个文本片段`,
      },
      support: spec.support,
      excerptSha256: await sha256Hex(spec.span.text),
      createdByJobId: jobId,
    })),
  );

  const limitations = [
    "这是离线候选抽取：只使用现有 canonical 人物、地点、作品目录和规则，不调用外部模型或搜索。",
    "所有候选默认需要人工回读；作品—地点关系不自动推出人物到访，关系卡不独立构成历史事实。",
    "未识别的同名人物、历史地名和未进入目录的作品会留在原文中，不会被猜测补齐。",
  ];
  if (!journeyItems.length) limitations.push("没有发现满足“地点 + 明确生平动作”的行迹候选。");
  if (!poemWorldItems.length) limitations.push("没有发现同时包含目录作品和地点的诗境候选。");
  if (!socialEdges.length) limitations.push("没有发现同时包含两位目录人物和明确往来触发词的关系候选。");

  const draft: BookAnalysisDraft = {
    recordType: "private-poet-volume-bundle",
    schemaVersion: "2.0.0-prototype",
    bundleId,
    jobId,
    createdAt: new Date().toISOString(),
    access: { visibility: "private", publicationState: "not-submitted" },
    reviewState: "needs-review",
    source: {
      bookId,
      bookTitle: input.bookTitle.trim(),
      packageId,
      packageSha256: input.fileSha256,
      packageOwnerJobId: jobId,
    },
    poet: {
      id: poetId,
      name: poetName,
      identityState: primaryPerson ? "resolved" : "candidate",
    },
    evidence,
    entities: {
      people: Array.from(personEntities.values()),
      places: Array.from(placeEntities.values()),
      works: Array.from(workEntities.values()),
    },
    storyCards,
    volumes: {
      journey: {
        state: journeyItems.length ? "ready" : "empty",
        routeSemantics: "narrative-sequence-not-exact-route",
        items: journeyItems,
        limitations: ["只纳入同句出现明确生平动作的地点；诗题和诗句地点不会反推行迹。"],
      },
      poemWorld: {
        state: poemWorldItems.length ? "ready" : "empty",
        items: poemWorldItems,
        spotlights: Array.from(spotlights.entries()).map(([placeId, storyIds]) => ({ placeId, storyIds: Array.from(storyIds) })),
        limitations: ["作品—地点连接表示作品空间语义，不自动等同于创作地或人物到访。"],
      },
      social: {
        state: socialEdges.length ? "ready" : "empty",
        edges: socialEdges,
        limitations: ["只有同一文本片段出现两位目录人物和往来触发词时才生成关系候选。"],
      },
    },
    limitations,
  };

  const validation = validateBookDraft(draft);
  return {
    draft,
    validation,
    sourceText: text,
    segmentCount: spans.length,
    fileName: input.fileName,
    references: buildBookAnalysisReferences(draft, input.catalogs),
  };
}

function cleanModelLabel(value: string): string {
  return value.trim().replace(/^[「『“\"\s]+|[」』”\"\s，。！？；：,.;:]+$/g, "");
}

function boundedModelText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function appendUniqueValues(target: string[], values: string[]): void {
  for (const value of values) if (value && !target.includes(value)) target.push(value);
}

function modelTimeQualifier(label: string | null, sequence: number): TimeQualifier | undefined {
  const clean = label ? boundedModelText(label, 200) : "";
  if (!clean) return undefined;
  const year = clean.match(/公元\s*(-?\d{1,4})年/);
  if (year) {
    const parsed = Number(year[1]);
    return { precision: "year", label: clean, startYear: parsed, endYear: parsed };
  }
  return { precision: "unknown", label: clean || `文中第 ${sequence} 个候选` };
}

function modelStoryTitle(value: string, fallback: string): string {
  return boundedModelText(value, 200) || fallback;
}

function modelStorySummary(value: string, fallback: string): string {
  return boundedModelText(value, 800) || fallback;
}

function firstEvidenceStart(draft: BookAnalysisDraft, ids: string[]): number | null {
  const evidence = draft.evidence.find((item) => ids.includes(item.id));
  return evidence?.locator.startOffset ?? null;
}

function hasSameSegment(draft: BookAnalysisDraft, ids: string[], existingIds: string[]): boolean {
  const start = firstEvidenceStart(draft, ids);
  return start !== null && firstEvidenceStart(draft, existingIds) === start;
}

export async function mergeBookAgentModelResult(
  result: BookAnalysisResult,
  modelOutput: BookAgentModelOutput,
  catalogs: BookAgentCatalogs,
): Promise<BookAnalysisResult> {
  const next = structuredClone(result) as BookAnalysisResult;
  const segments = getBookAnalysisSegments(next.sourceText);
  const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));
  const evidenceById = new Map(next.draft.evidence.map((item) => [item.id, item]));
  const sourceFileId = next.draft.evidence[0]?.sourceFileId ?? `book-file-${next.draft.source.packageSha256.slice(0, 16)}`;
  const evidenceCache = new Map<string, string>();

  const ensureModelEvidence = async (kind: string, segmentIds: string[], extra: string): Promise<string[]> => {
    const ids: string[] = [];
    for (const segmentId of unique(segmentIds)) {
      const segment = segmentsById.get(segmentId);
      if (!segment) continue;
      const cacheKey = `${kind}|${segmentId}|${extra}`;
      let id = evidenceCache.get(cacheKey);
      if (!id) {
        id = evidenceId(next.draft.jobId, `llm-${kind}`, segment, extra);
        evidenceCache.set(cacheKey, id);
      }
      if (!evidenceById.has(id)) {
        const evidence: Evidence = {
          id,
          sourceFileId,
          locator: {
            kind: "text-span",
            startOffset: segment.startOffset,
            endOffset: segment.endOffset,
            label: `模型回读：第 ${segment.ordinal} 个文本片段`,
          },
          support: "direct",
          excerptSha256: await sha256Hex(segment.text),
          createdByJobId: next.draft.jobId,
        };
        next.draft.evidence.push(evidence);
        evidenceById.set(id, evidence);
      }
      ids.push(id);
    }
    return unique(ids);
  };

  const findCatalogPerson = (name: string): CatalogPerson | undefined => {
    const clean = cleanModelLabel(name);
    const canonical = catalogs.people.find((person) => [person.name, ...(person.aliases ?? [])].some((value) => value === clean));
    if (canonical) return canonical;
    const referencePerson = [
      ...(catalogs.reference?.social?.people ?? []),
      ...(catalogs.reference?.social?.person ? [catalogs.reference.social.person] : []),
    ].find((person) => person.name === clean);
    return referencePerson ? { id: referencePerson.id, name: referencePerson.name, aliases: [] } : undefined;
  };
  const findCatalogPlace = (name: string): CatalogPlace | undefined => {
    const clean = cleanModelLabel(name);
    return catalogs.places.find((place) => [place.name, ...(place.historicalNames ?? [])].some((value) => value === clean));
  };
  const findCatalogWork = (title: string): CatalogWork | undefined => {
    const clean = cleanModelLabel(title).replace(/^《|》$/g, "");
    return catalogs.works.find((work) => work.title === clean);
  };

  const primaryCatalogPerson = catalogs.people.find((person) => person.id === next.draft.poet.id)
    ?? findCatalogPerson(next.draft.poet.name);
  const primaryPersonNames = unique([
    next.draft.poet.name,
    primaryCatalogPerson?.name ?? "",
    ...(primaryCatalogPerson?.aliases ?? []),
  ]).filter(Boolean);
  const personEvidenceNames = (name: string): string[] => {
    const clean = cleanModelLabel(name);
    const catalog = findCatalogPerson(clean);
    return unique([clean, catalog?.name ?? "", ...(catalog?.aliases ?? [])]).filter(Boolean);
  };
  const isPrimaryPersonName = (name: string): boolean => {
    const clean = cleanModelLabel(name);
    const catalog = findCatalogPerson(clean);
    if (catalog) return catalog.id === next.draft.poet.id;
    return primaryPersonNames.includes(clean);
  };

  const ensurePerson = async (name: string, segmentIds: string[], extra: string): Promise<string | null> => {
    const clean = cleanModelLabel(name);
    if (!clean) return null;
    const catalog = findCatalogPerson(clean);
    const existing = next.draft.entities.people.find((person) => person.id === catalog?.id || person.name === clean);
    const evidenceIds = await ensureModelEvidence(`person-${extra}`, segmentIds, clean);
    if (!evidenceIds.length) return existing?.id ?? null;
    if (existing) {
      appendUniqueValues(existing.evidenceIds, evidenceIds);
      if (catalog) appendUniqueValues(existing.aliases, catalog.aliases ?? []);
      return existing.id;
    }
    const id = catalog?.id ?? contentId("llm-person", next.draft.jobId, clean);
    next.draft.entities.people.push({
      id,
      name: catalog?.name ?? clean,
      aliases: catalog?.aliases ?? [],
      resolutionState: catalog ? "resolved" : "candidate",
      evidenceIds,
    });
    return id;
  };

  const ensurePlace = async (name: string, segmentIds: string[], extra: string): Promise<string | null> => {
    const clean = cleanModelLabel(name);
    if (!clean) return null;
    const catalog = findCatalogPlace(clean);
    const existing = next.draft.entities.places.find((place) => place.id === catalog?.id || place.label === clean);
    const evidenceIds = await ensureModelEvidence(`place-${extra}`, segmentIds, clean);
    if (!evidenceIds.length) return existing?.id ?? null;
    if (existing) {
      appendUniqueValues(existing.evidenceIds, evidenceIds);
      return existing.id;
    }
    const coordinate = catalog?.sourceCoordinates;
    const hasCoordinate = typeof coordinate?.x === "number" && typeof coordinate?.y === "number";
    const id = catalog?.id ?? contentId("llm-place", next.draft.jobId, clean);
    next.draft.entities.places.push({
      id,
      label: catalog?.name ?? clean,
      historicalNames: catalog?.historicalNames ?? [],
      modernName: catalog?.modernName,
      resolutionState: catalog ? "resolved" : "candidate",
      mapKind: hasCoordinate ? "point" : catalog ? "region" : "none",
      coordinate: hasCoordinate ? { x: coordinate?.x as number, y: coordinate?.y as number, precision: "display-only" } : undefined,
      evidenceIds,
    });
    return id;
  };

  const ensureWork = async (title: string, authorName: string | null, segmentIds: string[], extra: string): Promise<string | null> => {
    const clean = cleanModelLabel(title).replace(/^《|》$/g, "");
    if (!clean) return null;
    const catalog = findCatalogWork(clean);
    const existing = next.draft.entities.works.find((work) => work.id === catalog?.id || work.title === clean);
    const evidenceIds = await ensureModelEvidence(`work-${extra}`, segmentIds, clean);
    if (!evidenceIds.length) return existing?.id ?? null;
    if (existing) {
      appendUniqueValues(existing.evidenceIds, evidenceIds);
      if (!existing.authorPersonId && authorName) {
        existing.authorPersonId = (await ensurePerson(authorName, segmentIds, "work-author")) ?? undefined;
      }
      return existing.id;
    }
    let authorPersonId = catalog?.personId;
    if (authorPersonId && !next.draft.entities.people.some((person) => person.id === authorPersonId)) {
      const author = catalogs.people.find((person) => person.id === authorPersonId);
      authorPersonId = (await ensurePerson(author?.name ?? authorPersonId, segmentIds, "work-author")) ?? undefined;
    }
    if (!authorPersonId && authorName) authorPersonId = (await ensurePerson(authorName, segmentIds, "work-author")) ?? undefined;
    const id = catalog?.id ?? contentId("llm-work", next.draft.jobId, clean);
    next.draft.entities.works.push({
      id,
      authorPersonId: authorPersonId ?? undefined,
      title: catalog?.title ?? clean,
      genre: catalog?.genre,
      discoveryState: catalog ? "matched" : "candidate",
      evidenceIds,
    });
    return id;
  };

  for (const candidate of modelOutput.people) {
    await ensurePerson(candidate.name, candidate.segmentIds, "mention");
  }
  for (const candidate of modelOutput.places) {
    const id = await ensurePlace(candidate.name, candidate.segmentIds, "mention");
    const entity = id ? next.draft.entities.places.find((place) => place.id === id) : undefined;
    if (entity) appendUniqueValues(entity.historicalNames, candidate.historicalNames.map(cleanModelLabel).filter(Boolean));
  }
  for (const candidate of modelOutput.works) {
    await ensureWork(candidate.title, candidate.authorName, candidate.segmentIds, "mention");
  }

  const addStory = (story: StoryCard): void => {
    if (!next.draft.storyCards.some((item) => item.id === story.id)) next.draft.storyCards.push(story);
  };

  const modelJourneyCandidateMatchesEvidence = (candidate: BookAgentModelJourneyCandidate): boolean => {
    const cleanPlaceName = cleanModelLabel(candidate.placeName);
    const catalogPlace = findCatalogPlace(cleanPlaceName);
    const placeNames = unique([
      cleanPlaceName,
      catalogPlace?.name ?? "",
      ...(catalogPlace?.historicalNames ?? []),
    ]).filter(Boolean);
    let placeMentioned = false;
    let recognizedActionInPlaceSegment = false;
    let negatedActionInEvidence = false;
    const supportedPredicates = new Set<JourneyItem["predicate"]>();

    for (const segmentId of unique(candidate.segmentIds)) {
      const segment = segmentsById.get(segmentId);
      if (!segment) continue;
      const titleMentions = bookTitleMentions(segment.text);
      const placeMentions = outsideMentionRanges(allTextMentions(segment.text, placeNames), titleMentions);
      if (!placeMentions.length) continue;
      placeMentioned = true;
      const actions = journeyActionMentions(segment.text);
      if (actions.length) recognizedActionInPlaceSegment = true;
      for (const mention of placeMentions) {
        if (hasNegatedRuleInClause(segment.text, mention.start, ACTION_RULES)) negatedActionInEvidence = true;
        const action = actionForPlaceMention(segment.text, mention.start, mention.end, actions);
        if (action) supportedPredicates.add(action.predicate);
      }
    }

    if (!placeMentioned) return false;
    if (negatedActionInEvidence) return false;
    if (supportedPredicates.size) return supportedPredicates.has(candidate.predicate);
    return !recognizedActionInPlaceSegment;
  };

  const modelWorkBelongsToPrimary = (title: string, segmentIds: string[]): boolean => {
    const cleanTitle = cleanModelLabel(title).replace(/^《|》$/g, "");
    const catalogWork = findCatalogWork(cleanTitle);
    if (catalogWork?.personId) return catalogWork.personId === next.draft.poet.id;
    const existingWork = next.draft.entities.works.find((work) => work.id === catalogWork?.id || work.title === cleanTitle);
    if (existingWork?.authorPersonId) return existingWork.authorPersonId === next.draft.poet.id;
    const modelWork = modelOutput.works.find((work) => cleanModelLabel(work.title).replace(/^《|》$/g, "") === cleanTitle);
    if (modelWork?.authorName && !isPrimaryPersonName(modelWork.authorName)) return false;
    if (modelWork?.authorName && isPrimaryPersonName(modelWork.authorName)) return true;
    return unique(segmentIds).some((segmentId) => {
      const segment = segmentsById.get(segmentId);
      return Boolean(
        segment
        && allTextMentions(segment.text, [cleanTitle]).length
        && allTextMentions(segment.text, primaryPersonNames).length
      );
    });
  };

  const modelPoemCandidateMatchesEvidence = (candidate: BookAgentModelPoemWorldCandidate): boolean => {
    if (!modelWorkBelongsToPrimary(candidate.workTitle, candidate.segmentIds)) return false;
    const cleanTitle = cleanModelLabel(candidate.workTitle).replace(/^《|》$/g, "");
    const catalogWork = findCatalogWork(cleanTitle);
    const workNames = unique([cleanTitle, catalogWork?.title ?? ""]).filter(Boolean);
    const cleanPlaceName = cleanModelLabel(candidate.placeName);
    const catalogPlace = findCatalogPlace(cleanPlaceName);
    const placeNames = unique([cleanPlaceName, catalogPlace?.name ?? "", ...(catalogPlace?.historicalNames ?? [])]).filter(Boolean);
    let workAndPlaceMentioned = false;
    let recognizedRelationInEvidence = false;
    let negatedRelationInEvidence = false;
    const supportedRelations = new Set<NonNullable<PoemWorldItem["relationType"]>>();

    for (const segmentId of unique(candidate.segmentIds)) {
      const segment = segmentsById.get(segmentId);
      if (!segment || !allTextMentions(segment.text, workNames).length) continue;
      const explicitTitles = bookTitleMentions(segment.text);
      const placeMentions = outsideMentionRanges(allTextMentions(segment.text, placeNames), explicitTitles);
      if (!placeMentions.length) continue;
      const relations = poemRelationMentions(segment.text);
      for (const mention of placeMentions) {
        if (explicitTitles.length) {
          const activeTitle = workForPlaceMention(segment.text, explicitTitles, mention.start, mention.end);
          if (!activeTitle || cleanModelLabel(activeTitle.title).replace(/^《|》$/g, "") !== cleanTitle) continue;
        }
        if (hasNegatedRuleInClause(segment.text, mention.start, POEM_RELATION_RULES)) {
          negatedRelationInEvidence = true;
          continue;
        }
        workAndPlaceMentioned = true;
        if (relations.length) recognizedRelationInEvidence = true;
        const relation = poemRelationForPlaceMention(segment.text, mention.start, mention.end, relations);
        if (relation) supportedRelations.add(relation.relationType);
      }
    }

    if (!workAndPlaceMentioned) return false;
    if (negatedRelationInEvidence) return false;
    if (supportedRelations.size) return supportedRelations.has(candidate.relationType);
    return !recognizedRelationInEvidence;
  };

  const modelSocialCandidateMatchesEvidence = (candidate: BookAgentModelSocialCandidate): boolean => {
    if (!isPrimaryPersonName(candidate.sourcePersonName) && !isPrimaryPersonName(candidate.targetPersonName)) return false;
    const sourceNames = personEvidenceNames(candidate.sourcePersonName);
    const targetNames = personEvidenceNames(candidate.targetPersonName);
    return unique(candidate.segmentIds).some((segmentId) => {
      const segment = segmentsById.get(segmentId);
      if (!segment) return false;
      const sourceMentions = allTextMentions(segment.text, sourceNames);
      const targetMentions = allTextMentions(segment.text, targetNames);
      return sourceMentions.some((sourceMention) => {
        const bounds = clauseBounds(segment.text, sourceMention.start);
        const targetInClause = targetMentions.some((targetMention) => targetMention.start >= bounds.start && targetMention.end <= bounds.end);
        return targetInClause && hasAffirmedRelationshipCue(segment.text.slice(bounds.start, bounds.end));
      });
    });
  };

  for (const candidate of modelOutput.journey) {
    if (!isPrimaryPersonName(candidate.personName)) continue;
    if (!modelJourneyCandidateMatchesEvidence(candidate)) continue;
    const evidenceIds = await ensureModelEvidence("journey", candidate.segmentIds, `${candidate.placeName}|${candidate.predicate}`);
    if (!evidenceIds.length) continue;
    const personId = await ensurePerson(candidate.personName, candidate.segmentIds, "journey");
    const placeId = await ensurePlace(candidate.placeName, candidate.segmentIds, "journey");
    if (!personId || !placeId || personId !== next.draft.poet.id) continue;
    const existing = next.draft.volumes.journey.items.find((item) => item.placeId === placeId && item.predicate === candidate.predicate && hasSameSegment(next.draft, evidenceIds, item.evidenceIds));
    if (existing) {
      appendUniqueValues(existing.evidenceIds, evidenceIds);
      existing.storyIds.forEach((storyId) => {
        const story = next.draft.storyCards.find((item) => item.id === storyId);
        if (story) appendUniqueValues(story.evidenceIds, evidenceIds);
      });
      continue;
    }
    const itemId = contentId("llm-journey", next.draft.jobId, candidate.personName, candidate.placeName, candidate.predicate, String(firstEvidenceStart(next.draft, evidenceIds)));
    const storyId = contentId("story", next.draft.jobId, "llm-journey", itemId);
    const place = next.draft.entities.places.find((item) => item.id === placeId);
    const fallbackTitle = `${place?.label ?? candidate.placeName} · ${candidate.predicate}`;
    const story: StoryCard = {
      id: storyId,
      kind: "journey",
      title: modelStoryTitle(candidate.storyTitle, fallbackTitle),
      summary: modelStorySummary(candidate.storySummary, storySummary("journey", `${candidate.personName}与${candidate.placeName}`)),
      claimType: "fact",
      anchorRefs: [{ type: "person", id: personId }, { type: "place", id: placeId }],
      evidenceIds,
      reviewState: "needs-review",
      disclaimerCode: "not-independent-historical-fact",
    };
    addStory(story);
    next.draft.volumes.journey.items.push({
      id: itemId,
      placeId,
      predicate: candidate.predicate,
      sequence: next.draft.volumes.journey.items.length + 1,
      time: modelTimeQualifier(candidate.timeLabel, next.draft.volumes.journey.items.length + 1),
      storyIds: [storyId],
      mapEligible: place?.resolutionState === "resolved" && place.mapKind !== "none",
      evidenceIds,
      reviewState: "needs-review",
    });
  }

  for (const candidate of modelOutput.poemWorld) {
    if (!modelPoemCandidateMatchesEvidence(candidate)) continue;
    const evidenceIds = await ensureModelEvidence("poem-world", candidate.segmentIds, `${candidate.workTitle}|${candidate.placeName}`);
    if (!evidenceIds.length) continue;
    const workId = await ensureWork(candidate.workTitle, next.draft.poet.name, candidate.segmentIds, "poem-world");
    const placeId = await ensurePlace(candidate.placeName, candidate.segmentIds, "poem-world");
    if (!workId || !placeId) continue;
    const existing = next.draft.volumes.poemWorld.items.find((item) => item.workId === workId && item.placeId === placeId && item.relationType === candidate.relationType && hasSameSegment(next.draft, evidenceIds, item.evidenceIds));
    if (existing) {
      appendUniqueValues(existing.evidenceIds, evidenceIds);
      existing.storyIds.forEach((storyId) => {
        const story = next.draft.storyCards.find((item) => item.id === storyId);
        if (story) appendUniqueValues(story.evidenceIds, evidenceIds);
      });
      continue;
    }
    const work = next.draft.entities.works.find((item) => item.id === workId);
    const place = next.draft.entities.places.find((item) => item.id === placeId);
    const itemId = contentId("llm-poem", next.draft.jobId, candidate.workTitle, candidate.placeName, candidate.relationType, String(firstEvidenceStart(next.draft, evidenceIds)));
    const storyId = contentId("story", next.draft.jobId, "llm-poem", itemId);
    const story: StoryCard = {
      id: storyId,
      kind: "place",
      title: modelStoryTitle(candidate.storyTitle, `${work?.title ?? candidate.workTitle} · ${place?.label ?? candidate.placeName}`),
      summary: modelStorySummary(candidate.storySummary, storySummary("place", `《${work?.title ?? candidate.workTitle}》与${place?.label ?? candidate.placeName}`)),
      claimType: "interpretation",
      anchorRefs: [{ type: "work", id: workId }, { type: "place", id: placeId }],
      evidenceIds,
      reviewState: "needs-review",
      disclaimerCode: "not-independent-historical-fact",
    };
    if (work?.authorPersonId) addAnchor(story.anchorRefs, "person", work.authorPersonId);
    addStory(story);
    next.draft.volumes.poemWorld.items.push({
      id: itemId,
      kind: "place-link",
      workId,
      placeId,
      relationType: candidate.relationType,
      storyIds: [storyId],
      evidenceIds,
      reviewState: "needs-review",
    });
    const spotlight = next.draft.volumes.poemWorld.spotlights.find((item) => item.placeId === placeId);
    if (spotlight) appendUniqueValues(spotlight.storyIds, [storyId]);
    else next.draft.volumes.poemWorld.spotlights.push({ placeId, storyIds: [storyId] });
  }

  for (const candidate of modelOutput.social) {
    if (!modelSocialCandidateMatchesEvidence(candidate)) continue;
    const evidenceIds = await ensureModelEvidence("social", candidate.segmentIds, `${candidate.sourcePersonName}|${candidate.targetPersonName}`);
    if (!evidenceIds.length) continue;
    const sourcePersonId = await ensurePerson(candidate.sourcePersonName, candidate.segmentIds, "social");
    const targetPersonId = await ensurePerson(candidate.targetPersonName, candidate.segmentIds, "social");
    if (!sourcePersonId || !targetPersonId || sourcePersonId === targetPersonId) continue;
    if (sourcePersonId !== next.draft.poet.id && targetPersonId !== next.draft.poet.id) continue;
    const placeIds: string[] = [];
    for (const name of candidate.placeNames) {
      const id = await ensurePlace(name, candidate.segmentIds, "social-context");
      if (id) appendUniqueValues(placeIds, [id]);
    }
    const workIds: string[] = [];
    for (const title of candidate.workTitles) {
      const id = await ensureWork(title, null, candidate.segmentIds, "social-context");
      if (id) appendUniqueValues(workIds, [id]);
    }
    const existing = next.draft.volumes.social.edges.find((edge) => {
      const samePair = edge.sourcePersonId === sourcePersonId && edge.targetPersonId === targetPersonId
        || edge.sourcePersonId === targetPersonId && edge.targetPersonId === sourcePersonId;
      return samePair && hasSameSegment(next.draft, evidenceIds, edge.evidenceIds);
    });
    if (existing) {
      appendUniqueValues(existing.evidenceIds, evidenceIds);
      appendUniqueValues(existing.placeIds, placeIds);
      appendUniqueValues(existing.workIds, workIds);
      existing.storyIds.forEach((storyId) => {
        const story = next.draft.storyCards.find((item) => item.id === storyId);
        if (story) appendUniqueValues(story.evidenceIds, evidenceIds);
      });
      continue;
    }
    const relationTypes: SocialEdge["relationTypes"] = candidate.relationTypes.length ? candidate.relationTypes : ["other"];
    const itemId = contentId("llm-social", next.draft.jobId, sourcePersonId, targetPersonId, String(firstEvidenceStart(next.draft, evidenceIds)));
    const storyId = contentId("story", next.draft.jobId, "llm-social", itemId);
    const source = next.draft.entities.people.find((item) => item.id === sourcePersonId);
    const target = next.draft.entities.people.find((item) => item.id === targetPersonId);
    const story: StoryCard = {
      id: storyId,
      kind: "relationship",
      title: modelStoryTitle(candidate.storyTitle, `${source?.name ?? candidate.sourcePersonName}与${target?.name ?? candidate.targetPersonName} · 往来线索`),
      summary: modelStorySummary(candidate.storySummary, storySummary("relationship", `${candidate.sourcePersonName}与${candidate.targetPersonName}`)),
      claimType: "fact",
      anchorRefs: [{ type: "person", id: sourcePersonId }, { type: "person", id: targetPersonId }],
      evidenceIds,
      reviewState: "needs-review",
      disclaimerCode: "not-independent-historical-fact",
    };
    for (const placeId of placeIds) addAnchor(story.anchorRefs, "place", placeId);
    for (const workId of workIds) addAnchor(story.anchorRefs, "work", workId);
    addStory(story);
    next.draft.volumes.social.edges.push({
      id: itemId,
      sourcePersonId,
      targetPersonId,
      relationTypes,
      placeIds,
      workIds,
      storyIds: [storyId],
      evidenceIds,
      reviewState: "needs-review",
    });
  }

  next.draft.volumes.journey.state = next.draft.volumes.journey.items.length ? "ready" : "empty";
  next.draft.volumes.poemWorld.state = next.draft.volumes.poemWorld.items.length ? "ready" : "empty";
  next.draft.volumes.social.state = next.draft.volumes.social.edges.length ? "ready" : "empty";
  const modelLimit = "大模型只负责发现和改写候选，不直接提升为公开事实；每个新增候选必须回到模型标注的原文片段，并继续经过人工审核。";
  if (!next.draft.limitations.includes(modelLimit)) next.draft.limitations.push(modelLimit);
  next.validation = validateBookDraft(next.draft);
  return enrichBookAnalysisReferences(next, catalogs);
}

function addIssue(issues: ValidationIssue[], severity: ValidationSeverity, code: string, message: string, path?: string): void {
  issues.push({ severity, code, message, path });
}

export function validateBookDraft(draft: BookAnalysisDraft): ValidationReport {
  const issues: ValidationIssue[] = [];
  if (draft.recordType !== "private-poet-volume-bundle") addIssue(issues, "error", "record-type", "recordType 不符合私有三卷候选包。", "recordType");
  if (draft.schemaVersion !== "2.0.0-prototype") addIssue(issues, "error", "schema-version", "当前原型只接受 2.0.0-prototype。", "schemaVersion");
  if (draft.access.visibility !== "private" || draft.access.publicationState !== "not-submitted") addIssue(issues, "error", "publication-boundary", "草稿必须保持 private / not-submitted。", "access");
  const evidence = new Map(draft.evidence.map((item) => [item.id, item]));
  const people = new Map(draft.entities.people.map((item) => [item.id, item]));
  const places = new Map(draft.entities.places.map((item) => [item.id, item]));
  const works = new Map(draft.entities.works.map((item) => [item.id, item]));
  const storyCards = new Map(draft.storyCards.map((item) => [item.id, item]));
  const validateEvidenceIds = (ids: string[], path: string, requireDirect = false): void => {
    if (!ids.length) addIssue(issues, "error", "missing-evidence", "可见候选必须至少绑定一个 evidenceId。", path);
    for (const id of ids) {
      const record = evidence.get(id);
      if (!record) addIssue(issues, "error", "evidence-ref-missing", `找不到证据 ${id}。`, path);
      else if (requireDirect && record.support !== "direct") addIssue(issues, "error", "evidence-not-direct", "连接和故事卡必须至少绑定 direct 证据。", path);
    }
  };
  for (const person of draft.entities.people) validateEvidenceIds(person.evidenceIds, `entities.people.${person.id}.evidenceIds`);
  for (const place of draft.entities.places) validateEvidenceIds(place.evidenceIds, `entities.places.${place.id}.evidenceIds`);
  for (const work of draft.entities.works) validateEvidenceIds(work.evidenceIds, `entities.works.${work.id}.evidenceIds`);
  for (const item of draft.volumes.journey.items) {
    if (!places.has(item.placeId)) addIssue(issues, "error", "journey-place-missing", `行迹引用了不存在的地点 ${item.placeId}。`, item.id);
    if (item.mapEligible && (places.get(item.placeId)?.resolutionState !== "resolved" || places.get(item.placeId)?.mapKind === "none")) addIssue(issues, "error", "journey-map-place", "只有已解析且可定位的地点才能上图。", item.id);
    validateEvidenceIds(item.evidenceIds, `${item.id}.evidenceIds`, true);
    for (const storyId of item.storyIds) {
      const story = storyCards.get(storyId);
      if (!story) addIssue(issues, "error", "journey-story-missing", `找不到故事卡 ${storyId}。`, item.id);
      else if (!story.anchorRefs.some((ref) => ref.type === "person" && ref.id === draft.poet.id)) {
        addIssue(issues, "error", "journey-out-of-scope", "行迹故事必须锚定当前选定诗人。", item.id);
      }
    }
  }
  for (const item of draft.volumes.poemWorld.items) {
    if (!works.has(item.workId)) addIssue(issues, "error", "poem-work-missing", `诗境引用了不存在的作品 ${item.workId}。`, item.id);
    const work = works.get(item.workId);
    if (work && work.authorPersonId !== draft.poet.id) addIssue(issues, "error", "poem-out-of-scope", "诗境作品必须明确归属于当前选定诗人。", item.id);
    if (item.kind === "place-link" && (!item.placeId || !places.has(item.placeId))) addIssue(issues, "error", "poem-place-missing", "place-link 必须引用已识别地点。", item.id);
    validateEvidenceIds(item.evidenceIds, `${item.id}.evidenceIds`, true);
    for (const storyId of item.storyIds) if (!storyCards.has(storyId)) addIssue(issues, "error", "poem-story-missing", `找不到故事卡 ${storyId}。`, item.id);
  }
  for (const edge of draft.volumes.social.edges) {
    if (!people.has(edge.sourcePersonId) || !people.has(edge.targetPersonId)) addIssue(issues, "error", "social-person-missing", "关系边两端必须是已识别人物。", edge.id);
    if (edge.sourcePersonId === edge.targetPersonId) addIssue(issues, "error", "social-self-edge", "关系边不能连接同一人物。", edge.id);
    if (edge.sourcePersonId !== draft.poet.id && edge.targetPersonId !== draft.poet.id) addIssue(issues, "error", "social-out-of-scope", "交游关系必须至少有一端是当前选定诗人。", edge.id);
    validateEvidenceIds(edge.evidenceIds, `${edge.id}.evidenceIds`, true);
    for (const placeId of edge.placeIds) if (!places.has(placeId)) addIssue(issues, "error", "social-place-missing", `找不到关系地点 ${placeId}。`, edge.id);
    for (const workId of edge.workIds) if (!works.has(workId)) addIssue(issues, "error", "social-work-missing", `找不到关系作品 ${workId}。`, edge.id);
    for (const storyId of edge.storyIds) if (!storyCards.has(storyId)) addIssue(issues, "error", "social-story-missing", `找不到关系故事卡 ${storyId}。`, edge.id);
  }
  for (const card of draft.storyCards) {
    validateEvidenceIds(card.evidenceIds, `${card.id}.evidenceIds`, true);
    for (const ref of card.anchorRefs) {
      const exists = ref.type === "person" ? people.has(ref.id) : ref.type === "place" ? places.has(ref.id) : works.has(ref.id);
      if (!exists) addIssue(issues, "error", "anchor-ref-missing", `故事卡锚点 ${ref.type}:${ref.id} 不存在。`, card.id);
    }
    if (card.disclaimerCode !== "not-independent-historical-fact") addIssue(issues, "error", "story-disclaimer", "故事卡必须明确不是独立历史事实。", card.id);
  }
  if (!draft.evidence.length) addIssue(issues, "warning", "no-evidence", "当前草稿没有生成证据。", "evidence");
  if (draft.entities.people.some((person) => person.resolutionState !== "resolved")) addIssue(issues, "warning", "candidate-person", "存在尚未完成身份消歧的人物候选。", "entities.people");
  if (draft.entities.works.some((work) => work.discoveryState !== "matched")) addIssue(issues, "warning", "candidate-work", "存在只从书名号抽取、尚未与作品目录匹配的作品候选。", "entities.works");
  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    issues,
  };
}

export function updateDraftReviewState(draft: BookAnalysisDraft, targetId: string, nextState: ReviewState): BookAnalysisDraft {
  const next = structuredClone(draft) as BookAnalysisDraft;
  const update = (record: { id: string; reviewState: ReviewState }): void => {
    if (record.id === targetId) record.reviewState = nextState;
  };
  next.volumes.journey.items.forEach((record) => update(record));
  next.volumes.poemWorld.items.forEach((record) => update(record));
  next.volumes.social.edges.forEach((record) => {
    update(record);
    if (record.id === targetId) record.storyIds.forEach((storyId) => {
      const card = next.storyCards.find((item) => item.id === storyId);
      if (card) card.reviewState = nextState;
    });
  });
  next.storyCards.forEach((record) => update(record));
  const reviewables = [
    ...next.entities.people,
    ...next.entities.places,
    ...next.entities.works,
    ...next.volumes.journey.items,
    ...next.volumes.poemWorld.items,
    ...next.volumes.social.edges,
    ...next.storyCards,
  ];
  next.reviewState = reviewStateFor(reviewables);
  return next;
}

export function approveDraft(draft: BookAnalysisDraft): BookAnalysisDraft {
  const next = structuredClone(draft) as BookAnalysisDraft;
  const approve = (record: { reviewState: ReviewState }): void => {
    if (record.reviewState !== "rejected") record.reviewState = "approved-private-preview";
  };
  next.volumes.journey.items.forEach(approve);
  next.volumes.poemWorld.items.forEach(approve);
  next.volumes.social.edges.forEach(approve);
  next.storyCards.forEach(approve);
  next.reviewState = reviewStateFor([
    ...next.entities.people,
    ...next.entities.places,
    ...next.entities.works,
    ...next.volumes.journey.items,
    ...next.volumes.poemWorld.items,
    ...next.volumes.social.edges,
    ...next.storyCards,
  ]);
  return next;
}

export function buildReleaseManifest(draft: BookAnalysisDraft): Record<string, unknown> {
  const acceptedJourney = draft.volumes.journey.items.filter((item) => item.reviewState === "approved-private-preview");
  const acceptedPoemWorld = draft.volumes.poemWorld.items.filter((item) => item.reviewState === "approved-private-preview");
  const acceptedSocial = draft.volumes.social.edges.filter((item) => item.reviewState === "approved-private-preview");
  const linkedStoryIds = new Set([
    ...acceptedJourney.flatMap((item) => item.storyIds),
    ...acceptedPoemWorld.flatMap((item) => item.storyIds),
    ...acceptedSocial.flatMap((item) => item.storyIds),
  ]);
  const acceptedStories = draft.storyCards.filter((item) => item.reviewState === "approved-private-preview" && linkedStoryIds.has(item.id));
  const personIds = new Set<string>([draft.poet.id]);
  const placeIds = new Set<string>();
  const workIds = new Set<string>();
  for (const item of acceptedJourney) placeIds.add(item.placeId);
  for (const item of acceptedPoemWorld) {
    workIds.add(item.workId);
    if (item.placeId) placeIds.add(item.placeId);
  }
  for (const edge of acceptedSocial) {
    personIds.add(edge.sourcePersonId);
    personIds.add(edge.targetPersonId);
    edge.placeIds.forEach((id) => placeIds.add(id));
    edge.workIds.forEach((id) => workIds.add(id));
  }
  for (const story of acceptedStories) {
    for (const ref of story.anchorRefs) {
      if (ref.type === "person") personIds.add(ref.id);
      else if (ref.type === "place") placeIds.add(ref.id);
      else workIds.add(ref.id);
    }
  }
  for (const work of draft.entities.works) {
    if (workIds.has(work.id) && work.authorPersonId) personIds.add(work.authorPersonId);
  }

  return {
    recordType: "private-book-release-manifest",
    schemaVersion: "0.1.0",
    releaseId: `release-${draft.bundleId}`,
    bundleId: draft.bundleId,
    jobId: draft.jobId,
    source: draft.source,
    reviewState: draft.reviewState,
    publicationState: "approved-for-curation",
    acceptedEntityIds: [
      ...draft.entities.people.filter((item) => personIds.has(item.id) && item.resolutionState === "resolved").map((item) => item.id),
      ...draft.entities.places.filter((item) => placeIds.has(item.id) && item.resolutionState === "resolved").map((item) => item.id),
      ...draft.entities.works.filter((item) => workIds.has(item.id) && item.discoveryState === "matched").map((item) => item.id),
    ],
    acceptedConnectionIds: [
      ...acceptedJourney.map((item) => item.id),
      ...acceptedPoemWorld.map((item) => item.id),
      ...acceptedSocial.map((item) => item.id),
    ],
    acceptedStoryIds: acceptedStories.map((item) => item.id),
    boundary: "This manifest is still private and requires an explicit records/release exporter before public data changes.",
  };
}
