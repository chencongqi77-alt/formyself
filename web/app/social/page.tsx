"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { SiteNav } from "../components/SiteNav";
import { PersonSwitcher } from "../components/PersonSwitcher";
import { GraphZoomControls } from "../components/GraphZoomControls";
import {
  PoetOverviewPanel,
  type PoetOverviewEvent,
  type PoetOverviewProfile,
} from "../components/PoetOverviewPanel";
import { RelationshipStoryPanel } from "../components/RelationshipStoryPanel";
import {
  ReadingModuleHeader,
  SocialGraphStage,
} from "../components/ReadingModuleTemplate";
import { loadJson } from "../../lib/loadJson";
import {
  DEFAULT_PUBLIC_MODULE_PERSON_ID,
  resolvePublicModulePerson,
} from "../../lib/public-module-person";
import { relationshipDetailHref } from "../../lib/relationship-reading";
import {
  arrangeKnowledgeGraph,
  knowledgeGraphCardSize,
  knowledgeGraphStraightLinkGeometry,
  type KnowledgeGraphCluster,
} from "../../lib/knowledge-graph-presentation";
import { deriveRelationshipGraphFocus } from "../../lib/relationship-graph-focus";
import { visibleSocialGraphEdges } from "../../lib/social-graph-visibility";

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

type NetworkEdge = {
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

type PublishedSource = {
  id: string;
  title: string;
};

type SimNode = PersonNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  degree: number;
  isAnchor: boolean;
  pinned: boolean;
};

type SimLink = NetworkEdge & {
  sourceNode: SimNode;
  targetNode: SimNode;
};

type Sim = {
  nodes: SimNode[];
  links: SimLink[];
  byId: Map<string, SimNode>;
};

const bucketColors: Record<string, string> = {
  friend: "#176b69",
  "fellow-student": "#3d7a5f",
  "teacher-student": "#a33a2c",
  kin: "#b0793a",
  patron: "#8a7a2f",
  opponent: "#6e4a56",
  admirer: "#4d6f9e",
  "literary-exchange": "#2f6d77",
  "wrote-about": "#7a6a2f",
  colleague: "#58718a",
  undetermined: "#8a8a8a",
  other: "#9a9a9a",
};

// This is an onboarding order for the Su Shi reader, not a historical ranking.
// Each entry remains a candidate-preview relationship and keeps its own source
// locations in the reader.
const suShiReaderStoryOrder = [
  "net-su-shi-cbdb-1493",
  "net-su-shi-huang-ting-jian",
  "net-su-shi-ou-yang-xiu",
  "net-su-shi-wang-an-shi",
  "net-su-shi-cbdb-7376",
];

const VIEW_W = 1600;
const VIEW_H = 1000;
const CENTER_X = VIEW_W / 2;
const CENTER_Y = VIEW_H / 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

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
  edges: NetworkEdge[],
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

function buildSim(
  payload: NetworkPayload,
  edges: NetworkEdge[],
  anchorId: string,
  useKnowledgeLayout = false,
): Sim {
  const degree = new Map<string, number>();
  const includedIds = new Set<string>([anchorId]);
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    includedIds.add(edge.source);
    includedIds.add(edge.target);
  }

  const nodes: SimNode[] = payload.people
    .filter((person) => includedIds.has(person.id))
    .map((person) => {
      const d = degree.get(person.id) ?? 0;
      const isAnchor = person.id === anchorId;
      return {
        ...person,
        x: CENTER_X,
        y: CENTER_Y,
        vx: 0,
        vy: 0,
        r: useKnowledgeLayout
          ? isAnchor
            ? 52
            : 50
          : isAnchor
            ? 17
            : clamp(4.5 + d / 9, 4.5, 12),
        degree: d,
        isAnchor,
        pinned: isAnchor,
      };
    });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // The compact default intentionally has no force layout: it is a stable
  // evidence graph with readable relation labels rather than a starburst.
  const ordered = [...nodes]
    .filter((node) => node.id !== anchorId)
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name, "zh-CN"));
  if (useKnowledgeLayout) {
    arrangeKnowledgeGraph(nodes, {
      anchorId,
      width: VIEW_W,
      height: VIEW_H,
      clusterForNode: (node) => knowledgeClusterForNode(node.id, edges),
    });
  } else {
    ordered.forEach((node, index) => {
      const rank = index + 1;
      const angle = rank * GOLDEN_ANGLE;
      const radius = Math.min(430, 70 + 56 * Math.sqrt(rank));
      node.x = CENTER_X + radius * Math.cos(angle);
      node.y = CENTER_Y + radius * Math.sin(angle);
    });
  }

  const links: SimLink[] = edges.map((edge) => ({
    ...edge,
    sourceNode: byId.get(edge.source)!,
    targetNode: byId.get(edge.target)!,
  }));

  return { nodes, links, byId };
}

function yearsLabel(person: PersonNode): string {
  if (person.birthYear && person.deathYear) {
    return `约 ${person.birthYear}–${person.deathYear}`;
  }
  if (person.birthYear) return `约 ${person.birthYear} 年生`;
  if (person.deathYear) return `约 ${person.deathYear} 年卒`;
  return "生卒年未记录";
}

function compactGraphConnectionPoint(
  node: SimNode,
  towardX: number,
  towardY: number,
): { x: number; y: number } {
  const dx = towardX - node.x;
  const dy = towardY - node.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const radius = node.r + 2;
  return {
    x: node.x + (dx / distance) * radius,
    y: node.y + (dy / distance) * radius,
  };
}

function compactGraphLinkGeometry(link: SimLink) {
  const source = compactGraphConnectionPoint(
    link.sourceNode,
    link.targetNode.x,
    link.targetNode.y,
  );
  const target = compactGraphConnectionPoint(
    link.targetNode,
    link.sourceNode.x,
    link.sourceNode.y,
  );
  return {
    path: `M ${source.x} ${source.y} L ${target.x} ${target.y}`,
    labelX: (source.x + target.x) / 2,
    labelY: (source.y + target.y) / 2,
  };
}

function relationshipLabel(
  edge: NetworkEdge,
  bucketLabels: Record<string, string>,
): string {
  const primaryBucket = primaryBucketOfEdge(edge);
  const label = bucketLabels[primaryBucket] ?? primaryBucket;
  const remaining = Math.max(0, edge.displayBuckets.length - 1);
  const value = remaining > 0 ? `${label} +${remaining}` : label;
  return value;
}

export default function SocialPage() {
  const [data, setData] = useState<NetworkPayload | null>(null);
  const [error, setError] = useState("");
  const [poets, setPoets] = useState<PoetIndexEntry[]>([]);
  const [publishedPeople, setPublishedPeople] = useState<PublishedPerson[]>([]);
  const [sourceTitles, setSourceTitles] = useState<Record<string, string>>({});
  const [selectedPoetId, setSelectedPoetId] = useState(DEFAULT_PUBLIC_MODULE_PERSON_ID);
  const [poetIndexStatus, setPoetIndexStatus] = useState<
    "loading" | "available" | "legacy"
  >("loading");
  const [sim, setSim] = useState<Sim | null>(null);
  const [layoutDone, setLayoutDone] = useState(false);
  const [hoverId, setHoverId] = useState("");
  const [hoveredEdgeId, setHoveredEdgeId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [query, setQuery] = useState("");

  const svgWrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<SVGGElement>(null);
  const viewState = useRef({ x: 0, y: 0, k: 1 });
  const panRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const clickSuppressRef = useRef(false);
  const simRef = useRef<Sim | null>(null);
  const autoOpenedPoetRef = useRef("");

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
            (a, b) =>
              (peopleOrderById.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
                (peopleOrderById.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
              a.name.localeCompare(b.name, "zh-CN"),
          );
        if (entries.length === 0) {
          throw new Error("poet social index is empty");
        }
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
          // Older preview releases contain only the Su Shi payload. Keep the
          // route useful while new index-based releases roll out.
          setPoetIndexStatus("legacy");
          setSelectedPoetId("su-shi");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (poetIndexStatus === "loading") {
      return;
    }
    const poetId =
      poetIndexStatus === "legacy" ? "su-shi" : selectedPoetId;
    if (!poetId) return;

    let cancelled = false;

    const path =
      poetIndexStatus === "available"
        ? "/data/poet-social/" + encodeURIComponent(poetId) + ".json"
        : "/data/poet-social-network.json";

    const loadNetwork = async () => {
      try {
        let payload: NetworkPayload;
        try {
          payload = await loadJson<NetworkPayload>(path);
        } catch (initialError) {
          // A partially migrated release may provide an index before the
          // Su Shi graph has moved. Preserve the existing public preview.
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
  const graphEdges = useMemo(() => {
    if (!data) return [];
    return coreKnowledgeGraphEdges(data);
  }, [data]);

  const graphAnchorId = data?.person.id ?? "";

  const presentationEdges = useMemo(() => {
    return bucketFilter
      ? graphEdges.filter((edge) => edge.displayBuckets.includes(bucketFilter))
      : graphEdges;
  }, [bucketFilter, graphEdges]);

  const graphBucketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const edge of graphEdges) {
      for (const bucket of edge.displayBuckets) {
        counts[bucket] = (counts[bucket] ?? 0) + 1;
      }
    }
    return counts;
  }, [graphEdges]);

  const rawDegrees = useMemo(() => {
    const degrees = new Map<string, number>();
    for (const edge of graphEdges) {
      degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
    }
    return degrees;
  }, [graphEdges]);

  const applyView = useCallback(() => {
    const group = viewRef.current;
    if (!group) return;
    const vs = viewState.current;
    group.setAttribute(
      "transform",
      "translate(" + vs.x + " " + vs.y + ") scale(" + vs.k + ")",
    );
  }, []);

  const screenToUser = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!svg || !rect) return { x: clientX, y: clientY, scale: 1 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const user = point.matrixTransform(ctm.inverse());
      return { x: user.x, y: user.y, scale: ctm.a };
    }
    return {
      x: ((clientX - rect.left) / rect.width) * VIEW_W,
      y: ((clientY - rect.top) / rect.height) * VIEW_H,
      scale: rect.width / VIEW_W,
    };
  }, []);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const vs = viewState.current;
      const k = clamp(vs.k * factor, 0.2, 7);
      const user = screenToUser(clientX, clientY);
      const graphX = (user.x - vs.x) / vs.k;
      const graphY = (user.y - vs.y) / vs.k;
      vs.k = k;
      vs.x = user.x - graphX * k;
      vs.y = user.y - graphY * k;
      applyView();
    },
    [applyView, screenToUser],
  );

  const fitGraph = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    const nodes = sim.nodes;
    if (nodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x - node.r);
      minY = Math.min(minY, node.y - node.r);
      maxX = Math.max(maxX, node.x + node.r);
      maxY = Math.max(maxY, node.y + node.r);
    }
    const pad = 70;
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;
    const k = clamp(
      Math.min(VIEW_W / width, VIEW_H / height),
      0.2,
      2,
    );
    viewState.current.k = k;
    viewState.current.x = CENTER_X - ((minX + maxX) / 2) * k;
    viewState.current.y = CENTER_Y - ((minY + maxY) / 2) * k;
    applyView();
  }, [applyView]);

  // The public view is a single bounded knowledge layout: representative
  // direct relations plus source-backed links among those people.
  useEffect(() => {
    if (!data) return;
    const next = buildSim(data, presentationEdges, graphAnchorId, true);
    simRef.current = next;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      setSim(next);
      fitGraph();
      setLayoutDone(true);
    });
    return () => {
      cancelAnimationFrame(raf);
      cancelled = true;
    };
  }, [data, fitGraph, graphAnchorId, presentationEdges]);

  // The reader should have a useful first chapter on arrival, but closing it
  // remains a deliberate user choice rather than a state that immediately
  // reopens on every render.
  useEffect(() => {
    if (!data || !sim || autoOpenedPoetRef.current === data.person.id) return;
    autoOpenedPoetRef.current = data.person.id;
    setSelectedId(data.person.id);
    setSelectedEdgeId("");
  }, [data, sim]);

  // Auto-fit once the layout settles.
  useEffect(() => {
    if (layoutDone && data) {
      fitGraph();
    }
  }, [layoutDone, data, fitGraph]);

  // Wheel zoom with a non-passive listener so the page does not scroll.
  useEffect(() => {
    const wrap = svgWrapRef.current;
    if (!wrap) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
      zoomAt(event.clientX, event.clientY, factor);
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const visibleEdges = useMemo(() => {
    if (!sim) return [];
    return visibleSocialGraphEdges(sim.links, {
      anchorId: graphAnchorId,
      // A selected node is deliberate and therefore takes precedence over a
      // transient hover. Either reveals only its own circle-to-circle ties.
      revealNodeId: selectedId || hoverId,
    });
  }, [graphAnchorId, hoverId, selectedId, sim]);

  const visibleIds = useMemo(() => {
    if (!sim) return new Set<string>();
    return new Set(sim.nodes.map((node) => node.id));
  }, [sim]);

  const searchMatches = useMemo(() => {
    if (!data || !query.trim()) return [];
    const needle = query.trim();
    return data.people
      .filter(
        (person) => visibleIds.has(person.id) && person.name.includes(needle),
      )
      .sort(
        (a, b) =>
          (rawDegrees.get(b.id) ?? 0) - (rawDegrees.get(a.id) ?? 0),
      )
      .slice(0, 8);
  }, [data, query, rawDegrees, visibleIds]);

  const selectedAvailableEdgeId = useMemo(
    () =>
      selectedEdgeId &&
      presentationEdges.some((edge) => edge.id === selectedEdgeId)
        ? selectedEdgeId
        : "",
    [presentationEdges, selectedEdgeId],
  );

  // A hover previews relation labels while
  // a click keeps the selected person focused after the pointer leaves.
  const relationshipFocus = useMemo(
    () =>
      deriveRelationshipGraphFocus({
        edges: visibleEdges,
        hoverNodeId: hoverId,
        hoverEdgeId: hoveredEdgeId || selectedAvailableEdgeId,
        selectedNodeId: selectedId,
      }),
    [
      hoverId,
      hoveredEdgeId,
      selectedAvailableEdgeId,
      selectedId,
      visibleEdges,
    ],
  );
  const focusId = relationshipFocus.focusNodeId;
  // On a dense card graph, labels are useful for inspecting one relation but
  // obstruct the map when a node hover opens all of its incident labels.
  const relationLabelIds = useMemo(
    () =>
      hoveredEdgeId || selectedAvailableEdgeId
        ? new Set([hoveredEdgeId || selectedAvailableEdgeId])
        : new Set<string>(),
    [hoveredEdgeId, selectedAvailableEdgeId],
  );

  const selectedPerson = useMemo(() => {
    if (!sim || !selectedId) return null;
    return sim.byId.get(selectedId) ?? null;
  }, [selectedId, sim]);

  const anchorProfile = useMemo(
    () =>
      data
        ? publishedPeople.find((person) => person.id === data.person.id) ?? null
        : null,
    [data, publishedPeople],
  );

  // The graph deliberately opens on its center poet. A relationship story is
  // only opened after the reader chooses a different node or a concrete edge.
  const isAnchorOverview = Boolean(
    selectedPerson &&
      selectedPerson.id === graphAnchorId &&
      !selectedAvailableEdgeId,
  );

  const selectedLinks = useMemo(() => {
    if (!sim || !selectedId) return [];
    return sim.links
      .filter(
        (link) =>
          link.source === selectedId ||
          link.target === selectedId,
      )
      .sort(
        (a, b) =>
          b.evidenceCount - a.evidenceCount ||
          b.displayBuckets[0].localeCompare(a.displayBuckets[0]),
      );
  }, [selectedId, sim]);

  const centerOnNode = useCallback(
    (id: string) => {
      const sim = simRef.current;
      const node = sim?.byId.get(id);
      if (!sim || !node) return;
      const vs = viewState.current;
      vs.k = Math.max(vs.k, 1.4);
      vs.x = CENTER_X - node.x * vs.k;
      vs.y = CENTER_Y - node.y * vs.k;
      applyView();
    },
    [applyView],
  );

  const changePoet = useCallback(
    (poetId: string) => {
      if (poetId === selectedPoetId) return;
      setSelectedPoetId(poetId);
      setData(null);
      setError("");
      setSim(null);
      simRef.current = null;
      setLayoutDone(false);
      setHoverId("");
      setHoveredEdgeId("");
      setSelectedId("");
      setSelectedEdgeId("");
      autoOpenedPoetRef.current = "";
      setBucketFilter("");
      setQuery("");
    },
    [selectedPoetId],
  );

  const handleNodeSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSelectedEdgeId("");
    },
    [],
  );

  const handleNodeClick = useCallback(
    (id: string) => {
      if (clickSuppressRef.current) {
        clickSuppressRef.current = false;
        return;
      }
      handleNodeSelect(id);
    },
    [handleNodeSelect],
  );

  const handleEdgeSelect = useCallback(
    (link: NetworkEdge) => {
      const readingNodeId =
        link.source === graphAnchorId || link.target !== graphAnchorId
          ? link.source
          : link.target;
      setSelectedId(readingNodeId);
      setSelectedEdgeId(link.id);
    },
    [graphAnchorId],
  );

  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent, id: string) => {
      event.stopPropagation();
      const sim = simRef.current;
      const node = sim?.byId.get(id);
      if (!sim || !node) return;
      dragRef.current = {
        id,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      node.pinned = true;
    },
    [],
  );

  const handleSvgPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (drag) {
        const sim = simRef.current;
        const node = sim?.byId.get(drag.id);
        const vs = viewState.current;
        if (!sim || !node) return;
        if (
          Math.abs(event.clientX - drag.startX) > 3 ||
          Math.abs(event.clientY - drag.startY) > 3
        ) {
          drag.moved = true;
        }
        const user = screenToUser(event.clientX, event.clientY);
        node.x = clamp((user.x - vs.x) / vs.k, 0, VIEW_W);
        node.y = clamp((user.y - vs.y) / vs.k, 0, VIEW_H);
        if (simRef.current) setSim({ ...simRef.current });
        return;
      }
      const pan = panRef.current;
      if (!pan) return;
      const vs = viewState.current;
      const scale = screenToUser(event.clientX, event.clientY).scale;
      vs.x = pan.ox + (event.clientX - pan.startX) / scale;
      vs.y = pan.oy + (event.clientY - pan.startY) / scale;
      applyView();
    },
    [applyView, screenToUser],
  );

  const handleSvgPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (dragRef.current) return;
      panRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        ox: viewState.current.x,
        oy: viewState.current.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const endPointer = useCallback(() => {
    if (dragRef.current) {
      const sim = simRef.current;
      const node = sim?.byId.get(dragRef.current.id);
      if (node) node.pinned = false;
      clickSuppressRef.current = dragRef.current.moved;
      dragRef.current = null;
    }
    panRef.current = null;
  }, []);

  const zoomCenter = useCallback(
    (factor: number) => {
      const wrap = svgWrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      zoomAt(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        factor,
      );
    },
    [zoomAt],
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
                ? "正在载入" + activePoetEntry.name + "的人际关系……"
                : "正在载入人物关系……")}
          </p>
        </section>
      </main>
    );
  }

  const shownEdges = visibleEdges;
  const shownPeople = visibleIds;
  const panelLinks = selectedLinks;
  const useKnowledgeCards = true;
  const graphPersonCount = new Set([
    data.person.id,
    ...presentationEdges.flatMap((edge) => [edge.source, edge.target]),
  ]).size;
  const directGraphEdgeCount = graphEdges.filter((edge) =>
    isDirectRelationship(edge, data.person.id),
  ).length;
  const bridgeGraphEdgeCount = graphEdges.length - directGraphEdgeCount;
  const socialPersonSummary = `${data.person.name}代表交游图 · ${graphPersonCount} 位人物 · ${directGraphEdgeCount} 条直接往来${bridgeGraphEdgeCount ? ` · ${bridgeGraphEdgeCount} 条圈内关联` : ""}`;
  const focusLinks = focusId
    ? relationshipFocus.highlightedEdgeIds
    : null;

  return (
    <main className="site-shell social-page">
      <a className="skip-link" href="#main-content">
        跳到正文
      </a>
      <SiteNav current="social" />

      <ReadingModuleHeader
        title="交游录"
        subtitle={"：" + (activePoetEntry?.subtitle || "浏览诗人的交游网络")}
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
            <p className="social-header-summary">
              {socialPersonSummary}
            </p>
          )}
          </div>
        }
      />

      <SocialGraphStage>
        <section
          className="social-graph"
          ref={svgWrapRef}
          aria-label={data.person.name + "交游圈知识图谱"}
        >
          <div className="social-graph-tools">
            <label className="social-search">
              <span className="sr-only">搜索人物</span>
              <input
                type="search"
                value={query}
                placeholder="搜索人物姓名…"
                onChange={(event) => setQuery(event.target.value)}
                aria-label="搜索人物姓名"
              />
              {searchMatches.length > 0 && (
                <ul className="social-search-results">
                  {searchMatches.map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setBucketFilter("");
                          setQuery("");
                          handleNodeSelect(person.id);
                          centerOnNode(person.id);
                        }}
                      >
                        <strong>{person.name}</strong>
                        <span>{yearsLabel(person)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <label className="social-bucket-filter">
              <span className="sr-only">关系类型</span>
              <select
                value={bucketFilter}
                aria-label="按关系类型筛选"
                onChange={(event) => {
                  setBucketFilter(event.target.value);
                  setSelectedId("");
                }}
              >
                <option value="">全部关系 · {graphEdges.length} 条</option>
                {Object.entries(data.bucketCounts)
                  .filter(([bucket]) => graphBucketCounts[bucket] > 0)
                  .map(([bucket]) => (
                    <option key={bucket} value={bucket}>
                      {data.bucketLabels[bucket] ?? bucket} · {graphBucketCounts[bucket]}
                    </option>
                  ))}
              </select>
            </label>
            <div
              className="social-graph-line-key"
              aria-label="实线表示与中心人物直接往来；选择或悬停人物后，虚线显示该人物与圈内人物之间的往来"
            >
              <span>
                <i aria-hidden="true" />与{data.person.name}直接往来 · {directGraphEdgeCount}
              </span>
              <span>
                <i className="is-bridge" aria-hidden="true" />
                选择人物后显示圈内往来 · {bridgeGraphEdgeCount}
              </span>
            </div>
          </div>

          {!layoutDone && (
            <p className="social-layout-hint" aria-live="polite">
              正在计算布局…
            </p>
          )}

          <section
            className="social-mobile-directory"
            aria-label="交游人物列表"
          >
            <div className="social-mobile-directory-heading">
              <strong>人物索引</strong>
              <span>点击人物查看关系与证据</span>
            </div>
            <ul>
              {sim &&
                [...sim.nodes]
                  .filter((node) => shownPeople.has(node.id))
                  .sort(
                    (a, b) =>
                      Number(b.isAnchor) - Number(a.isAnchor) ||
                      b.degree - a.degree ||
                      a.name.localeCompare(b.name, "zh-CN"),
                  )
                  .map((node) => {
                    const bucket = node.isAnchor
                      ? "target"
                      : dominantBucketOf(sim, node.id);
                    return (
                      <li key={node.id}>
                        <button
                          type="button"
                          className={selectedId === node.id ? "is-active" : ""}
                          aria-pressed={selectedId === node.id}
                          onClick={() => handleNodeSelect(node.id)}
                        >
                          <strong>{node.name}</strong>
                          <span>
                            {node.isAnchor
                              ? "中心人物"
                              : data.bucketLabels[bucket] ?? "圈内人物"}
                          </span>
                          <small>{node.degree} 对关系</small>
                        </button>
                      </li>
                    );
                  })}
            </ul>
          </section>

          <svg
            ref={svgRef}
            className="social-svg"
            viewBox={"0 0 " + VIEW_W + " " + VIEW_H}
            preserveAspectRatio="xMidYMid meet"
            role="application"
            aria-label={
              data.person.name +
              "交游圈知识图谱：" +
              shownPeople.size +
              " 位人物、" +
              shownEdges.length +
              " 对关系"
            }
            onPointerDown={handleSvgPointerDown}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedId("");
                setSelectedEdgeId("");
                setHoverId("");
                setHoveredEdgeId("");
              }
            }}
          >
            <g ref={viewRef} transform="translate(0 0) scale(1)">
              {sim &&
                shownEdges.map((link) => {
                  const a = link.sourceNode;
                  const b = link.targetNode;
                  const visible =
                    shownPeople.has(a.id) && shownPeople.has(b.id);
                  if (!visible) return null;
                  const primaryBucket = primaryBucketOfEdge(link);
                  const color = bucketColors[primaryBucket] ?? "#9a9a9a";
                  const focused = Boolean(focusLinks?.has(link.id));
                  const geometry = useKnowledgeCards
                    ? knowledgeGraphStraightLinkGeometry(
                        link.sourceNode,
                        link.targetNode,
                      )
                    : compactGraphLinkGeometry(link);
                  const isBridge = !isDirectRelationship(
                    link,
                    data.person.id,
                  );
                  const label = relationshipLabel(link, data.bucketLabels);
                  const showRelationLabel = relationLabelIds.has(link.id);
                  const labelWidth = Math.max(58, label.length * 15 + 20);
                  return (
                    <g
                      key={link.id}
                      className="kg-edge-interactive"
                      role="button"
                      tabIndex={0}
                      aria-label={`打开${a.name}与${b.name}的关系档案`}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleEdgeSelect(link);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleEdgeSelect(link);
                        }
                      }}
                      onPointerEnter={() => setHoveredEdgeId(link.id)}
                      onPointerLeave={() =>
                        setHoveredEdgeId((current) =>
                          current === link.id ? "" : current,
                        )
                      }
                    >
                      <path
                        className="kg-edge-hit-area"
                        d={geometry.path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={useKnowledgeCards ? 24 : 20}
                        pointerEvents="stroke"
                      />
                      <path
                        className={
                          "kg-edge" +
                          (useKnowledgeCards ? " is-knowledge-edge" : "") +
                          (isBridge ? " is-bridge" : "") +
                          (focused ? " is-focused" : "")
                        }
                        d={geometry.path}
                        stroke={useKnowledgeCards ? "#343b3d" : color}
                        strokeWidth={
                          useKnowledgeCards
                            ? focused
                              ? 2.2
                              : 1.5
                            : Math.min(
                                3,
                                0.7 + Math.log2(link.evidenceCount + 1) * 0.45,
                              )
                        }
                        strokeOpacity={
                          focusLinks
                            ? focused
                              ? useKnowledgeCards
                                ? isBridge
                                  ? 0.76
                                  : 0.86
                                : 0.8
                              : 0.07
                            : useKnowledgeCards
                              ? isBridge
                                ? 0.42
                                : 0.68
                              : 0.8
                        }
                      >
                        <title>
                          {a.name +
                            " ↔ " +
                            b.name +
                            " · " +
                            link.displayBuckets
                              .map(
                                (bucket) =>
                                  data.bucketLabels[bucket] ?? bucket,
                              )
                              .join("、") +
                            " · 证据 " +
                            link.evidenceCount +
                            " 条"}
                        </title>
                      </path>
                      {showRelationLabel && (
                        <g
                          className="kg-edge-label"
                          transform={
                            "translate(" +
                            geometry.labelX +
                            " " +
                            geometry.labelY +
                            ")"
                          }
                          pointerEvents="none"
                        >
                          <rect
                            x={-labelWidth / 2}
                            y={-14}
                            width={labelWidth}
                            height={28}
                            rx={5}
                            fill="rgb(255 253 248 / 96%)"
                            stroke={color}
                            strokeWidth={1}
                          />
                          <text textAnchor="middle" y={5} fill={color}>
                            {label}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

              {sim &&
                sim.nodes.map((node) => {
                  if (!shownPeople.has(node.id)) return null;
                  const isFocus = focusId === node.id;
                  const isNeighbor =
                    focusLinks &&
                    sim.links.some(
                      (link) =>
                        (link.source === focusId &&
                          link.target === node.id) ||
                        (link.target === focusId &&
                          link.source === node.id),
                    );
                  const dimmed = focusLinks && !isFocus && !isNeighbor;
                  const primaryBucket =
                    node.isAnchor
                      ? "target"
                      : dominantBucketOf(sim, node.id);
                  const color =
                    node.isAnchor
                      ? "#a33a2c"
                      : bucketColors[primaryBucket] ?? "#8a8a8a";
                  const isSelected = selectedId === node.id;
                  const card = knowledgeGraphCardSize(node.name);
                  const showCompactLabel =
                    !useKnowledgeCards &&
                    (isFocus ||
                      (isNeighbor &&
                        focusId !== graphAnchorId &&
                        sim.nodes.length <= 180));
                  return (
                    <g
                      key={node.id}
                      className={
                        "kg-node" +
                        (useKnowledgeCards ? " kg-node-card" : "") +
                        (isFocus ? " is-focus" : "") +
                        (dimmed ? " is-dimmed" : "") +
                        (node.isAnchor ? " is-target" : "")
                      }
                      transform={"translate(" + node.x + " " + node.y + ")"}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        node.name +
                        "，" +
                        (node.isAnchor
                          ? "中心人物"
                          : "圈内人物") +
                        "，" +
                        node.degree +
                        " 对关系"
                      }
                      onPointerDown={(event) =>
                        handleNodePointerDown(event, node.id)
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        handleNodeClick(node.id);
                      }}
                      onPointerEnter={() => setHoverId(node.id)}
                      onPointerLeave={() =>
                        setHoverId((current) =>
                          current === node.id ? "" : current,
                        )
                      }
                      onFocus={() => setHoverId(node.id)}
                      onBlur={() =>
                        setHoverId((current) =>
                          current === node.id ? "" : current,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleNodeSelect(node.id);
                        }
                      }}
                    >
                      {useKnowledgeCards ? (
                        <>
                          {node.isAnchor ? (
                            <circle
                              className="kg-node-card-shape"
                              r={isFocus ? 52 : 48}
                              fill={isSelected ? "#f6e6ab" : "#d9b7dc"}
                              stroke="#343b3d"
                              strokeWidth={isFocus ? 3 : 2}
                            />
                          ) : (
                            <rect
                              className="kg-node-card-shape"
                              x={-card.width / 2}
                              y={-card.height / 2}
                              width={card.width}
                              height={card.height}
                              rx={8}
                              fill={isSelected ? "#f6e6ab" : "#c7e6e7"}
                              stroke="#343b3d"
                              strokeWidth={isFocus ? 3 : 2}
                            />
                          )}
                          {isSelected &&
                            (node.isAnchor ? (
                              <circle
                                r={57}
                                fill="none"
                                stroke="#a33a2c"
                                strokeWidth={1.6}
                                strokeDasharray="4 4"
                              />
                            ) : (
                              <rect
                                x={-card.width / 2 - 5}
                                y={-card.height / 2 - 5}
                                width={card.width + 10}
                                height={card.height + 10}
                                rx={11}
                                fill="none"
                                stroke="#a33a2c"
                                strokeWidth={1.5}
                                strokeDasharray="4 4"
                              />
                            ))}
                          <text
                            className="kg-node-card-label"
                            textAnchor="middle"
                            y={node.isAnchor ? 7 : 5}
                          >
                            {node.name}
                          </text>
                        </>
                      ) : (
                        <>
                          <circle
                            r={isFocus ? node.r + 3 : node.r}
                            fill={
                              node.isAnchor
                                ? "#a33a2c"
                                : "rgb(255 253 248 / 92%)"
                            }
                            stroke={color}
                            strokeWidth={
                              isFocus ? 2.6 : node.isAnchor ? 2 : 1.3
                            }
                          />
                          {isSelected && (
                            <circle
                              r={node.r + 6}
                              fill="none"
                              stroke="#a33a2c"
                              strokeWidth={1.4}
                              strokeDasharray="3 3"
                            />
                          )}
                          {showCompactLabel && (
                            <text
                              className="kg-label"
                              y={node.r + 15}
                              textAnchor="middle"
                            >
                              {node.name}
                            </text>
                          )}
                        </>
                      )}
                    </g>
                  );
                })}
            </g>
          </svg>

          <GraphZoomControls
            onZoomIn={() => zoomCenter(1.3)}
            onZoomOut={() => zoomCenter(1 / 1.3)}
          />

          <details className="social-provenance">
            <summary>数据说明</summary>
            <p>
              关系来自 CBDB 人物关系记录及作品题名赠答信号；圈内人物之间的往来来自同一
              CBDB 快照中的关系与亲属记录。关系类型仅作展示分组，不自动断定“友好”或“敌对”。
            </p>
          </details>
        </section>

        {selectedPerson &&
          (isAnchorOverview ? (
            <PoetOverviewPanel
              fallbackName={data.person.name}
              profile={anchorProfile}
              events={data.readerContent?.overviewEvents ?? []}
              sourceTitles={sourceTitles}
              onClose={() => {
                setSelectedId("");
                setSelectedEdgeId("");
              }}
            />
          ) : (
            <RelationshipStoryPanel
              key={`${selectedPerson.id}:${selectedAvailableEdgeId}`}
              anchorId={graphAnchorId}
              anchorName={data.person.name}
              selectedPerson={selectedPerson}
              peopleById={sim?.byId ?? new Map<string, SimNode>()}
              relationships={panelLinks}
              relationshipLabels={data.bucketLabels}
              pilotStories={data.readerContent?.stories ?? []}
              featuredStoryIds={
                data.person.id === "su-shi" ? suShiReaderStoryOrder : undefined
              }
              requestedStoryId={selectedAvailableEdgeId}
              relationshipDetailHref={(edgeId) => relationshipDetailHref(data.person.id, edgeId)}
              onClose={() => {
                setSelectedId("");
                setSelectedEdgeId("");
              }}
            />
          ))}
      </SocialGraphStage>

    </main>
  );
}

function dominantBucketOf(sim: Sim, personId: string): string {
  const counts = new Map<string, number>();
  for (const link of sim.links) {
    if (link.source !== personId && link.target !== personId) continue;
    for (const bucket of link.displayBuckets) {
      const value = link.bucketCounts[bucket] ?? 1;
      counts.set(bucket, (counts.get(bucket) ?? 0) + value);
    }
  }
  let best = "";
  let bestCount = 0;
  for (const [bucket, count] of counts) {
    if (count > bestCount) {
      best = bucket;
      bestCount = count;
    }
  }
  return best || "other";
}
