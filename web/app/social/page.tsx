"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { PersonSwitcher } from "../components/PersonSwitcher";
import {
  PoetOverviewPanel,
  type PoetOverviewEvent,
  type PoetOverviewProfile,
} from "../components/PoetOverviewPanel";
import { ReadingModuleHeader } from "../components/ReadingModuleTemplate";
import { RelationshipStoryPanel } from "../components/RelationshipStoryPanel";
import { SiteNav } from "../components/SiteNav";
import {
  SocialGraphReader,
  type SocialGraphReaderEdge,
  type SocialGraphReaderNode,
} from "../components/SocialGraphReader";
import { loadJson } from "../../lib/loadJson";
import type { KnowledgeGraphCluster } from "../../lib/knowledge-graph-presentation";
import {
  DEFAULT_PUBLIC_MODULE_PERSON_ID,
  resolvePublicModulePerson,
} from "../../lib/public-module-person";
import { relationshipDetailHref } from "../../lib/relationship-reading";

type PersonNode = {
  id: string;
  name: string;
  cbdbPersonId: number | null;
  role: "target" | "related";
  birthYear: number | null;
  deathYear: number | null;
};

type GlobalSourceRef = {
  sourceId: string;
  locator?: Record<string, unknown>;
  purpose?: string;
};

type NetworkEdge = SocialGraphReaderEdge & {
  origin: "review" | "cbdb-network";
  sourceRefs?: GlobalSourceRef[];
};

type NetworkPayload = {
  schemaVersion: string;
  recordType: string;
  reviewState: string;
  person: { id: string; name: string };
  bucketLabels: Record<string, string>;
  bucketCounts: Record<string, number>;
  counts: {
    people: number;
    edges: number;
    secondaryEdges: number;
    suShiEdges?: number;
    directEdges?: number;
    targetEdges?: number;
    edgesWithYears: number;
    peopleWithYears: number;
  };
  people: PersonNode[];
  edges: NetworkEdge[];
  readerContent?: {
    releaseId: string;
    reviewState: string;
    notice?: string;
    overviewEvents: PoetOverviewEvent[];
    stories: Array<{
      id: string;
      edgeId: string;
      otherPersonId: string;
      otherName: string;
      reviewState: string;
      events: PoetOverviewEvent[];
    }>;
  };
};

type PoetIndexCounts = {
  people?: number;
  edges?: number;
  secondaryEdges?: number;
  directEdges?: number;
};

type PoetIndexEntry = {
  id: string;
  name: string;
  subtitle: string;
  counts: PoetIndexCounts;
  dynasty?: string;
};

type PublishedPerson = PoetOverviewProfile;
type PublishedSource = { id: string; title: string };

const CORE_DIRECT_LIMIT = 20;
const CORE_SECONDARY_LIMIT = 12;
const PRESENTATION_BUCKET_ORDER = [
  "kin",
  "teacher-student",
  "fellow-student",
  "friend",
  "patron",
  "opponent",
  "literary-exchange",
  "colleague",
  "admirer",
  "wrote-about",
  "undetermined",
  "other",
];

// This is an onboarding order for the Su Shi reader, not a historical ranking.
const SU_SHI_READER_STORY_ORDER = [
  "net-su-shi-cbdb-1493",
  "net-su-shi-huang-ting-jian",
  "net-su-shi-ou-yang-xiu",
  "net-su-shi-wang-an-shi",
  "net-su-shi-cbdb-7376",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readPoetIndex(payload: unknown): PoetIndexEntry[] {
  const source = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.poets)
      ? payload.poets
      : isRecord(payload) && Array.isArray(payload.entries)
        ? payload.entries
        : [];
  const seen = new Set<string>();

  return source.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = entry.id;
    const name = entry.name;
    if (
      typeof id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
      typeof name !== "string" ||
      !name.trim() ||
      seen.has(id)
    ) {
      return [];
    }
    seen.add(id);
    const counts = isRecord(entry.counts) ? entry.counts : {};
    return [
      {
        id,
        name: name.trim(),
        subtitle:
          typeof entry.subtitle === "string" ? entry.subtitle.trim() : "",
        counts: {
          people: numberOrUndefined(counts.people),
          edges: numberOrUndefined(counts.edges),
          secondaryEdges: numberOrUndefined(counts.secondaryEdges),
          directEdges: numberOrUndefined(counts.directEdges),
        },
      },
    ];
  });
}

function isDirectRelationship(edge: NetworkEdge, targetId: string): boolean {
  return edge.source === targetId || edge.target === targetId;
}

function primaryBucketOfEdge(edge: NetworkEdge): string {
  return (
    PRESENTATION_BUCKET_ORDER.find((bucket) =>
      edge.displayBuckets.includes(bucket),
    ) ??
    edge.displayBuckets[0] ??
    "other"
  );
}

function relationshipScore(edge: NetworkEdge, targetId: string): number {
  return (
    (isDirectRelationship(edge, targetId) ? 10_000 : 0) +
    (edge.confidence === "probable" ? 200 : 0) +
    edge.evidenceCount * 8 +
    edge.titleSignalCount
  );
}

function compareEdgesByPriority(
  left: NetworkEdge,
  right: NetworkEdge,
  targetId: string,
): number {
  return (
    relationshipScore(right, targetId) - relationshipScore(left, targetId) ||
    right.evidenceCount - left.evidenceCount ||
    right.titleSignalCount - left.titleSignalCount ||
    left.id.localeCompare(right.id)
  );
}

function selectRepresentativeEdges(
  edges: NetworkEdge[],
  targetId: string,
  limit: number,
): NetworkEdge[] {
  const buckets = new Map<string, NetworkEdge[]>();
  for (const edge of [...edges].sort((left, right) =>
    compareEdgesByPriority(left, right, targetId),
  )) {
    const bucket = primaryBucketOfEdge(edge);
    const group = buckets.get(bucket);
    if (group) group.push(edge);
    else buckets.set(bucket, [edge]);
  }

  const selected: NetworkEdge[] = [];
  const bucketOrder = [
    ...PRESENTATION_BUCKET_ORDER,
    ...[...buckets.keys()].filter(
      (bucket) => !PRESENTATION_BUCKET_ORDER.includes(bucket),
    ),
  ];
  let hasRemaining = true;
  while (selected.length < limit && hasRemaining) {
    hasRemaining = false;
    for (const bucket of bucketOrder) {
      const next = buckets.get(bucket)?.shift();
      if (!next) continue;
      selected.push(next);
      hasRemaining = true;
      if (selected.length === limit) break;
    }
  }
  return selected;
}

function coreKnowledgeGraphEdges(payload: NetworkPayload): NetworkEdge[] {
  const directEdges = payload.edges.filter((edge) =>
    isDirectRelationship(edge, payload.person.id),
  );
  const directCore = selectRepresentativeEdges(
    directEdges,
    payload.person.id,
    CORE_DIRECT_LIMIT,
  );
  const corePersonIds = new Set<string>([payload.person.id]);
  for (const edge of directCore) {
    corePersonIds.add(
      edge.source === payload.person.id ? edge.target : edge.source,
    );
  }
  const bridgeEdges = payload.edges.filter(
    (edge) =>
      !isDirectRelationship(edge, payload.person.id) &&
      corePersonIds.has(edge.source) &&
      corePersonIds.has(edge.target),
  );
  const bridges = selectRepresentativeEdges(
    bridgeEdges,
    payload.person.id,
    CORE_SECONDARY_LIMIT,
  );
  return [...directCore, ...bridges];
}

function knowledgeClusterForNode(
  personId: string,
  edges: readonly NetworkEdge[],
): KnowledgeGraphCluster {
  const bucketCounts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.source !== personId && edge.target !== personId) continue;
    const bucket = primaryBucketOfEdge(edge);
    bucketCounts.set(
      bucket,
      (bucketCounts.get(bucket) ?? 0) + edge.evidenceCount + 1,
    );
  }
  const bucket = [...bucketCounts.entries()].sort(
    ([leftBucket, leftCount], [rightBucket, rightCount]) =>
      rightCount - leftCount ||
      PRESENTATION_BUCKET_ORDER.indexOf(leftBucket) -
        PRESENTATION_BUCKET_ORDER.indexOf(rightBucket),
  )[0]?.[0];
  if (bucket === "kin") return "kin";
  if (bucket === "teacher-student" || bucket === "fellow-student") {
    return "learning";
  }
  if (bucket === "wrote-about" || bucket === "admirer") return "reception";
  if (
    bucket === "friend" ||
    bucket === "literary-exchange" ||
    bucket === "colleague"
  ) {
    return "literary";
  }
  return "other";
}

function yearsLabel(person: PersonNode): string {
  if (person.birthYear && person.deathYear) {
    return `约 ${person.birthYear}–${person.deathYear}`;
  }
  if (person.birthYear) return `约 ${person.birthYear} 年生`;
  if (person.deathYear) return `约 ${person.deathYear} 年卒`;
  return "生卒年未记录";
}

export default function SocialPage() {
  const [data, setData] = useState<NetworkPayload | null>(null);
  const [error, setError] = useState("");
  const [poets, setPoets] = useState<PoetIndexEntry[]>([]);
  const [publishedPeople, setPublishedPeople] = useState<PublishedPerson[]>([]);
  const [sourceTitles, setSourceTitles] = useState<Record<string, string>>({});
  const [selectedPoetId, setSelectedPoetId] = useState(
    DEFAULT_PUBLIC_MODULE_PERSON_ID,
  );
  const [poetIndexStatus, setPoetIndexStatus] = useState<
    "loading" | "available" | "legacy"
  >("loading");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadJson<unknown>("/data/poet-social-index.json"),
      loadJson<PublishedPerson[]>("/data/people.json").catch(
        () => [] as PublishedPerson[],
      ),
      loadJson<PublishedSource[]>("/data/sources.json").catch(
        () => [] as PublishedSource[],
      ),
    ])
      .then(([payload, people, sources]) => {
        const peopleById = new Map(people.map((person) => [person.id, person]));
        const peopleOrderById = new Map(
          people.map((person, index) => [person.id, index]),
        );
        const entries = readPoetIndex(payload)
          .map((entry) => {
            const person = peopleById.get(entry.id);
            return {
              ...entry,
              name: person?.name ?? entry.name,
              dynasty: person?.dynasty,
            };
          })
          .sort(
            (left, right) =>
              (peopleOrderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                (peopleOrderById.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
              left.name.localeCompare(right.name, "zh-CN"),
          );
        if (!entries.length) throw new Error("poet social index is empty");
        if (cancelled) return;
        const selectedPoet = resolvePublicModulePerson(entries);
        setPoets(entries);
        setPublishedPeople(people);
        setSourceTitles(
          Object.fromEntries(
            sources
              .filter(
                (source): source is PublishedSource =>
                  Boolean(source?.id) && Boolean(source?.title),
              )
              .map((source) => [source.id, source.title]),
          ),
        );
        setSelectedPoetId(
          selectedPoet?.id ?? DEFAULT_PUBLIC_MODULE_PERSON_ID,
        );
        setPoetIndexStatus("available");
      })
      .catch(() => {
        if (!cancelled) {
          setPoetIndexStatus("legacy");
          setSelectedPoetId("su-shi");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (poetIndexStatus === "loading") return;
    const poetId = poetIndexStatus === "legacy" ? "su-shi" : selectedPoetId;
    if (!poetId) return;
    let cancelled = false;
    const path =
      poetIndexStatus === "available"
        ? `/data/poet-social/${encodeURIComponent(poetId)}.json`
        : "/data/poet-social-network.json";

    const loadNetwork = async () => {
      try {
        let payload: NetworkPayload;
        try {
          payload = await loadJson<NetworkPayload>(path);
        } catch (initialError) {
          if (poetIndexStatus !== "available" || poetId !== "su-shi") {
            throw initialError;
          }
          payload = await loadJson<NetworkPayload>(
            "/data/poet-social-network.json",
          );
        }
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) {
          setError("交游数据暂时无法加载。请刷新页面后再试。");
        }
      }
    };
    void loadNetwork();
    return () => {
      cancelled = true;
    };
  }, [poetIndexStatus, selectedPoetId]);

  const activePoetEntry = useMemo(
    () => poets.find((entry) => entry.id === selectedPoetId) ?? null,
    [poets, selectedPoetId],
  );
  const graphEdges = useMemo(
    () => (data ? coreKnowledgeGraphEdges(data) : []),
    [data],
  );
  const graphNodes = useMemo<SocialGraphReaderNode[]>(() => {
    if (!data) return [];
    const includedIds = new Set<string>([data.person.id]);
    const degrees = new Map<string, number>();
    for (const edge of graphEdges) {
      includedIds.add(edge.source);
      includedIds.add(edge.target);
      degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
    }
    return data.people
      .filter((person) => includedIds.has(person.id))
      .map((person) => ({
        id: person.id,
        name: person.name,
        birthYear: person.birthYear,
        deathYear: person.deathYear,
        degree: degrees.get(person.id) ?? 0,
        isAnchor: person.id === data.person.id,
        cluster: knowledgeClusterForNode(person.id, graphEdges),
        searchDescription: yearsLabel(person),
      }));
  }, [data, graphEdges]);

  const anchorProfile = useMemo(
    () =>
      data
        ? publishedPeople.find((person) => person.id === data.person.id) ?? null
        : null,
    [data, publishedPeople],
  );

  const changePoet = useCallback(
    (poetId: string) => {
      if (poetId === selectedPoetId) return;
      setSelectedPoetId(poetId);
      setData(null);
      setError("");
    },
    [selectedPoetId],
  );

  if (!data) {
    return (
      <main className="loading-page">
        <a className="skip-link" href="#main-content">
          跳到正文
        </a>
        <SiteNav current="social" />
        <section id="main-content" className="loading-card" aria-live="polite">
          <p className="eyebrow">诗人与谁往来</p>
          <h1>正在整理交游录</h1>
          <p>
            {error ||
              (activePoetEntry
                ? `正在载入${activePoetEntry.name}的人际关系……`
                : "正在载入人物关系……")}
          </p>
        </section>
      </main>
    );
  }

  const directGraphEdgeCount = graphEdges.filter((edge) =>
    isDirectRelationship(edge, data.person.id),
  ).length;
  const bridgeGraphEdgeCount = graphEdges.length - directGraphEdgeCount;
  const socialPersonSummary = `${data.person.name}代表交游图 · ${graphNodes.length} 位人物 · ${directGraphEdgeCount} 条直接往来${bridgeGraphEdgeCount ? ` · ${bridgeGraphEdgeCount} 条圈内关联` : ""}`;
  const graphKey = `${data.person.id}:${data.schemaVersion}:${graphEdges
    .map((edge) => edge.id)
    .join("|")}`;

  return (
    <main className="site-shell social-page">
      <a className="skip-link" href="#main-content">
        跳到正文
      </a>
      <SiteNav current="social" />

      <ReadingModuleHeader
        title="交游录"
        subtitle={`：${activePoetEntry?.subtitle || "浏览诗人的交游网络"}`}
        className="social-page-header"
        controls={
          <div className="social-header-meta">
            {poets.length > 1 ? (
              <PersonSwitcher
                id="social-person-select"
                value={selectedPoetId}
                options={poets}
                onChange={changePoet}
                summary={socialPersonSummary}
              />
            ) : (
              <p className="social-header-summary">{socialPersonSummary}</p>
            )}
          </div>
        }
      />

      <SocialGraphReader
        key={graphKey}
        anchorId={data.person.id}
        anchorName={data.person.name}
        nodes={graphNodes}
        edges={graphEdges}
        bucketLabels={data.bucketLabels}
        bucketOrder={PRESENTATION_BUCKET_ORDER}
        provenance="关系来自 CBDB 人物关系记录及作品题名赠答信号；圈内人物之间的往来来自同一 CBDB 快照中的关系与亲属记录。关系类型仅作展示分组，不自动断定“友好”或“敌对”。"
        renderInspector={({
          selectedPerson,
          selectedEdgeId,
          relationships,
          peopleById,
          close,
        }) => {
          if (!selectedPerson) return null;
          const isAnchorOverview =
            selectedPerson.id === data.person.id && !selectedEdgeId;
          return isAnchorOverview ? (
            <PoetOverviewPanel
              fallbackName={data.person.name}
              profile={anchorProfile}
              events={data.readerContent?.overviewEvents ?? []}
              sourceTitles={sourceTitles}
              onClose={close}
            />
          ) : (
            <RelationshipStoryPanel
              key={`${selectedPerson.id}:${selectedEdgeId}`}
              anchorId={data.person.id}
              anchorName={data.person.name}
              selectedPerson={selectedPerson}
              peopleById={peopleById}
              relationships={relationships}
              relationshipLabels={data.bucketLabels}
              pilotStories={data.readerContent?.stories ?? []}
              featuredStoryIds={
                data.person.id === "su-shi"
                  ? SU_SHI_READER_STORY_ORDER
                  : undefined
              }
              requestedStoryId={selectedEdgeId}
              relationshipDetailHref={(edgeId) =>
                relationshipDetailHref(data.person.id, edgeId)
              }
              onClose={close}
            />
          );
        }}
      />
    </main>
  );
}
