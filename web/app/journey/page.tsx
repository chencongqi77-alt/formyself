"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMapInstance } from "leaflet";

import { SiteNav } from "../components/SiteNav";
import { PersonSwitcher } from "../components/PersonSwitcher";
import { JourneyStage, ReadingModuleHeader } from "../components/ReadingModuleTemplate";
import { loadJson } from "../../lib/loadJson";
import { storyCardsForIds } from "../../lib/reading-samples";
import {
  DEFAULT_PUBLIC_MODULE_PERSON_ID,
  resolvePublicModulePerson,
} from "../../lib/public-module-person";
import { addChineseVectorBasemap } from "../../lib/chineseVectorBasemap";
import { journeyRouteStops } from "../../lib/journey-route-animation";
import type { MapTileStatus, ResilientTilesHandle } from "../../lib/mapTileLayers";

type ReviewStatus = "draft" | "needsReview" | "reviewed" | "verified" | "published";

type Person = {
  id: string;
  name: string;
  aliases: string[];
  dynasty: string;
  birthYear: number;
  deathYear: number;
  intro: string;
  reviewStatus: ReviewStatus;
};

type Place = {
  id: string;
  name: string;
  historicalNames: string[];
  modernName: string;
  sourceCoordinates: {
    x: number;
    y: number;
    source: string;
  };
  intro: string;
  reviewStatus: ReviewStatus;
};

type StoryEvent = {
  id: string;
  personId: string;
  placeId: string;
  startYear?: number;
  endYear?: number;
  timePrecision?: "year" | "range" | "era-only" | "era-and-month" | "sequence-only";
  timeLabel?: string;
  sequence?: number;
  lifeStage: string;
  role: string;
  title: string;
  summary: string;
  workIds: string[];
  storyIds?: string[];
  reviewNotes?: string[];
  reviewStatus: ReviewStatus;
};

type Work = {
  id: string;
  personId: string;
  placeIds?: string[];
  eventIds?: string[];
  title: string;
  genre: string;
  text: string[];
  plainExplanation?: string;
  reviewStatus?: ReviewStatus;
  libraryStatus?: "corpus";
};

type WorkPlaceLink = {
  id: string;
  workId: string;
  personId: string;
  placeId: string;
  eventId?: string;
  relationType: "composed-at" | "inscribed-at" | "describes-place" | "mentioned-place";
  certainty: "verified" | "probable";
  timeLabel?: string;
  note: string;
  storyIds?: string[];
  reviewStatus: ReviewStatus;
};

type CorpusPersonSummary = {
  name: string;
  total: number;
  poems: number;
  lyrics: number;
};

type CorpusIndex = {
  people: Record<string, CorpusPersonSummary>;
  total: number;
  notes: string[];
};

type PageData = {
  people: Person[];
  places: Place[];
  events: StoryEvent[];
  works: Work[];
  workPlaceLinks: WorkPlaceLink[];
  corpusIndex: CorpusIndex;
};

// Keep one library page comfortably inside the fixed desktop reading stage.
// Four slots leave room for the scope switcher and pagination without
// making individual works depend on their title length.
const worksPerPage = 4;
const relationTypeOrder: Record<WorkPlaceLink["relationType"], number> = {
  "composed-at": 0,
  "inscribed-at": 1,
  "describes-place": 2,
  "mentioned-place": 3,
};
const readingContexts: Record<string, { story: string; place: string }> = {
  "su-shi": {
    story: "与相邻站点对照，这段经历也呈现出仕宦、迁谪与写作在苏轼生命中的彼此牵连。",
    place: "结合前后行程，可以进一步观察此地如何连接他的地方任职、迁谪生活与文学创作。",
  },
  "du-fu": {
    story: "联系前后节点，这段经历更能显出战乱、漂泊和诗歌创作如何共同塑造杜甫的行旅。",
    place: "沿前后行程阅读，可以进一步理解此地在战乱迁徙、漂泊生活与诗歌写作中的位置。",
  },
  "li-bai": {
    story: "联系前后节点，可区分史传行旅、仕途转折与作品空间在李白生命叙事中的不同层次。",
    place: "沿前后行程阅读，可以进一步辨认此地在游历路径、仕途转折与作品空间中的位置。",
  },
  "xin-qiji": {
    story: "联系前后节点，可以看到地方治理、军政理想与词作空间如何在辛弃疾一生中交错展开。",
    place: "结合前后节点，可以进一步理解此地与他的地方治理、军政经历和词作空间之间的关系。",
  },
  "cao-cao": {
    story: "联系前后节点，可以看到仕宦、征伐与屯田经营如何在曹操一生中彼此衔接。",
    place: "沿前后行程阅读，可以进一步辨认此地在举兵、定都与四方征伐中的位置。",
  },
  "li-qingzhao": {
    story: "联系前后节点，可以看到汴京收藏、南渡失藏与词作空间如何在李清照生命中交错展开。",
    place: "结合前后行程，可以进一步理解此地与她的藏书生涯、南渡流寓及作品空间之间的关系。",
  },
  "lu-you": {
    story: "联系前后节点，可以看到朝官论议、蜀中军旅与晚年外任如何在陆游一生中彼此衔接。",
    place: "沿前后行程阅读，可以进一步辨认此地在入蜀、宦游与赋咏生活中的位置。",
  },
  "wang-an-shi": {
    story: "联系前后节点，可以看到地方治理、京师变法与晚居金陵如何在王安石一生中交错展开。",
    place: "结合前后行程，可以进一步理解此地与他的仕宦、变法及晚年居停之间的关系。",
  },
  "ou-yang-xiu": {
    story: "联系前后节点，可以看到交游、贬谪与馆阁仕途如何在欧阳修一生中彼此牵连。",
    place: "沿前后行程阅读，可以进一步辨认此地在交游、贬居与朝廷任职中的位置。",
  },
  "huang-ting-jian": {
    story: "联系前后节点，可以看到馆阁任职与接连贬逐如何在黄庭坚一生中交错展开。",
    place: "结合前后行程，可以进一步理解此地与他的仕宦、贬居及讲学生活之间的关系。",
  },
  "qin-guan": {
    story: "联系前后节点，可以看到受知苏轼、元祐馆阁与岭南贬逐如何在秦观一生中接连展开。",
    place: "沿前后行程阅读，可以进一步辨认此地在交游、任职与贬逐生涯中的位置。",
  },
  "yang-wan-li": {
    story: "联系前后节点，可以看到师承、地方仕宦与转运任地如何在杨万里一生中彼此衔接。",
    place: "结合前后行程，可以进一步理解此地与他的仕历、师承及晚年归宿之间的关系。",
  },
};

const defaultReadingContext = {
  story: "联系前后节点阅读，可以更清楚地理解这段经历在人物生命行旅中的位置。",
  place: "结合前后行程阅读，可以进一步理解此地与人物经历及作品之间的联系。",
};

function normalizeWorkText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[《》〈〉「」『』【】（）()·・，。！？；：、“”‘’\s]/g, "");
}

function mergeWorkLibrary(stationWorks: Work[], curatedWorks: Work[], corpusWorks: Work[]) {
  const merged: Work[] = [];
  const seenIds = new Set<string>();
  const curatedTitles = new Set(curatedWorks.map((work) => normalizeWorkText(work.title)));

  for (const work of [...stationWorks, ...curatedWorks]) {
    if (seenIds.has(work.id)) continue;
    seenIds.add(work.id);
    merged.push(work);
  }

  for (const work of corpusWorks) {
    if (seenIds.has(work.id) || curatedTitles.has(normalizeWorkText(work.title))) continue;
    seenIds.add(work.id);
    merged.push(work);
  }

  return merged;
}

function relationLabel(link: WorkPlaceLink, placeName: string) {
  switch (link.relationType) {
    case "composed-at":
      return `作于${placeName}`;
    case "inscribed-at":
      return `题于${placeName}`;
    case "describes-place":
      return `题咏${placeName}`;
    case "mentioned-place":
      return `写到${placeName}`;
  }
}

function placeOrder(placeId: string | undefined, orders: Map<string, number>) {
  return placeId ? orders.get(placeId) ?? 0 : 0;
}

function hasCoordinates(place: Place) {
  return Number.isFinite(place.sourceCoordinates.x) && Number.isFinite(place.sourceCoordinates.y);
}

function hasYearRange(
  event: StoryEvent,
): event is StoryEvent & { startYear: number; endYear: number } {
  return Number.isFinite(event.startYear) && Number.isFinite(event.endYear);
}

function hasSequence(event: StoryEvent): event is StoryEvent & { sequence: number } {
  return Number.isFinite(event.sequence);
}

function sortEvents(events: StoryEvent[]) {
  const useSequence = events.length > 0 && events.every(hasSequence);

  return [...events].sort((a, b) => {
    if (useSequence) return (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id);

    const aHasYearRange = hasYearRange(a);
    const bHasYearRange = hasYearRange(b);
    if (aHasYearRange && bHasYearRange) {
      return (
        a.startYear - b.startYear ||
        a.endYear - b.endYear ||
        (hasSequence(a) ? a.sequence : Number.MAX_SAFE_INTEGER) -
          (hasSequence(b) ? b.sequence : Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id)
      );
    }
    if (aHasYearRange) return -1;
    if (bHasYearRange) return 1;
    return (
      (hasSequence(a) ? a.sequence : Number.MAX_SAFE_INTEGER) -
        (hasSequence(b) ? b.sequence : Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id)
    );
  });
}

function eventTimeLabel(event: StoryEvent) {
  if (event.timeLabel?.trim()) return event.timeLabel.trim();
  if (!hasYearRange(event)) return "仅知史料顺序";
  return event.startYear === event.endYear
    ? String(event.startYear)
    : String(event.startYear) + "—" + String(event.endYear);
}

function routeSequenceNumber(event: StoryEvent, fallbackIndex: number) {
  return hasSequence(event) ? event.sequence : fallbackIndex + 1;
}

const reviewStatusLabels: Record<ReviewStatus, string> = {
  draft: "草稿",
  needsReview: "待复核",
  reviewed: "已人工复核",
  verified: "已核验",
  published: "已发布",
};

function ReviewBadge({ status }: { status: ReviewStatus | undefined }) {
  if (!status) return null;
  return (
    <span className={"review-badge review-badge--" + status}>
      {reviewStatusLabels[status]}
    </span>
  );
}

function WorkEntry({
  work,
  scope,
  relation,
  placeName,
}: {
  work: Work;
  scope: "station" | "curated" | "corpus";
  relation?: WorkPlaceLink;
  placeName?: string;
}) {
  const baseScopeLabel = relation
    ? relationLabel(relation, placeName ?? "此地")
    : scope === "curated"
      ? "人物精选"
      : "全集索引";
  const scopeLabel = baseScopeLabel;
  const scopeClass = relation ? `relation-${relation.relationType}` : scope;

  return (
    <Link
      className="work-entry"
      href={"/works/" + encodeURIComponent(work.id)}
      aria-label={`阅读《${work.title}》`}
    >
      <span className="work-entry-main">
        <span className="work-entry-meta">
          <span className="work-genre">{work.genre}</span>
          <span className={"work-scope work-scope--" + scopeClass}>{scopeLabel}</span>
        </span>
        <strong className="work-title" title={work.title}>
          {work.title}
        </strong>
        {work.text[0] && (
          <span className="work-preview" title={work.text[0]}>
            {work.text[0]}
          </span>
        )}
      </span>
      <span className="work-entry-action" aria-hidden="true">
        阅读 <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}

type RealMapProps = {
  places: Place[];
  events: StoryEvent[];
  placeOrders: Map<string, number>;
  placeRouteNumbers: Map<string, number[]>;
  placeWorkCounts: Map<string, number>;
  activePlaceId: string;
  personName: string;
  onPlaceSelect: (placeId: string) => void;
  onEventSelect: (eventId: string) => void;
};

type RoutePreviewPhase = "waiting" | "moving" | "arrived" | "unavailable";

type RoutePreviewState = Readonly<{
  phase: RoutePreviewPhase;
  fromName: string;
  toName: string;
  currentStation: number;
  totalStations: number;
}>;

const routePreviewMinLegDuration = 900;
const routePreviewMaxLegDuration = 2200;
const routePreviewMillisecondsPerPixel = 6;

function RealMap({
  places,
  events,
  placeOrders,
  placeRouteNumbers,
  placeWorkCounts,
  activePlaceId,
  personName,
  onPlaceSelect,
  onEventSelect,
}: RealMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const layerGroupRef = useRef<LayerGroup | null>(null);
  const animationLayerGroupRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const tilesRef = useRef<ResilientTilesHandle | null>(null);
  const fittedPlaceSignatureRef = useRef("");
  const [mapReady, setMapReady] = useState(false);
  const [mapStatus, setMapStatus] = useState<MapTileStatus | null>(null);
  const [mapZoom, setMapZoom] = useState(4);
  const [routePreview, setRoutePreview] = useState<RoutePreviewState>({
    phase: "waiting",
    fromName: "第 1 站",
    toName: "第 2 站",
    currentStation: 0,
    totalStations: 0,
  });
  const [routePreviewReplayKey, setRoutePreviewReplayKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let initializedMap: LeafletMapInstance | null = null;
    let initializedTiles: ResilientTilesHandle | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let zoomListener: (() => void) | null = null;
    let initialInvalidateFrame: number | null = null;

    void import("leaflet").then(({ default: leaflet }) => {
      if (cancelled || !mapContainerRef.current || mapRef.current) return;

      const map = leaflet.map(mapContainerRef.current, {
        attributionControl: true,
        zoomControl: true,
        scrollWheelZoom: true,
        minZoom: 4,
        maxZoom: 10,
      });

      map.setView([35, 105], 4);
      initializedTiles = addChineseVectorBasemap(map, leaflet, setMapStatus);
      tilesRef.current = initializedTiles;
      zoomListener = () => setMapZoom(map.getZoom());
      map.on("zoomend", zoomListener);
      zoomListener();

      mapRef.current = map;
      layerGroupRef.current = leaflet.layerGroup().addTo(map);
      animationLayerGroupRef.current = leaflet.layerGroup().addTo(map);
      leafletRef.current = leaflet;
      initializedMap = map;
      setMapReady(true);
      resizeObserver = new ResizeObserver(() => {
        if (cancelled || mapRef.current !== map) return;
        map.invalidateSize({ animate: false });
      });
      resizeObserver.observe(mapContainerRef.current);
      initialInvalidateFrame = window.requestAnimationFrame(() => {
        if (cancelled || mapRef.current !== map) return;
        map.invalidateSize({ animate: false });
      });
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (initialInvalidateFrame !== null) {
        window.cancelAnimationFrame(initialInvalidateFrame);
      }
      if (zoomListener) initializedMap?.off("zoomend", zoomListener);
      initializedTiles?.destroy();
      if (tilesRef.current === initializedTiles) {
        tilesRef.current = null;
      }
      initializedMap?.remove();
      if (mapRef.current === initializedMap) {
        mapRef.current = null;
        layerGroupRef.current = null;
        animationLayerGroupRef.current = null;
        leafletRef.current = null;
        fittedPlaceSignatureRef.current = "";
      }
    };
  }, []);

  const handleRetryTiles = useCallback(() => {
    tilesRef.current?.retry();
  }, []);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!mapReady || !leaflet || !map || !layerGroup) return;

    const mappablePlaces = places
      .filter(hasCoordinates)
      .sort(
        (a, b) =>
          placeOrder(a.id, placeOrders) - placeOrder(b.id, placeOrders) ||
          a.name.localeCompare(b.name, "zh-CN"),
    );

    layerGroup.clearLayers();
    if (mappablePlaces.length === 0) return;

    const mappablePlacesById = new Map(mappablePlaces.map((place) => [place.id, place]));
    const routePoints = events.flatMap((event) => {
      const place = mappablePlacesById.get(event.placeId);
      return place
        ? [[place.sourceCoordinates.y, place.sourceCoordinates.x] as [number, number]]
        : [];
    });

    if (routePoints.length > 1) {
      leaflet
        .polyline(routePoints, {
          className: "journey-route-underlay",
          color: "#fff1cf",
          opacity: 0.5,
          weight: 4.2,
          lineCap: "round",
          lineJoin: "round",
          interactive: false,
        })
        .addTo(layerGroup);

      leaflet
        .polyline(routePoints, {
          className: "journey-route-line",
          color: "#ad6a2b",
          opacity: 0.68,
          weight: 2.05,
          lineCap: "round",
          lineJoin: "round",
        })
        .bindTooltip("人生故事顺序（不是精确行旅路线）", {
          className: "journey-map-tooltip route-tooltip",
          sticky: true,
        })
        .addTo(layerGroup);
    }

    mappablePlaces.forEach((place) => {
      const isActive = place.id === activePlaceId;
      const order = placeOrder(place.id, placeOrders);
      const routeNumbers = placeRouteNumbers.get(place.id) ?? [order];
      const routeNumberLabel = routeNumbers.join("、");
      const linkedWorkCount = placeWorkCounts.get(place.id) ?? 0;

      if (isActive) {
        leaflet
          .circleMarker([place.sourceCoordinates.y, place.sourceCoordinates.x], {
            className: "journey-place-halo",
            color: "#d8a13e",
            fillColor: "#d8a13e",
            fillOpacity: 0.18,
            opacity: 0.72,
            radius: 19,
            weight: 1.5,
            interactive: false,
          })
          .addTo(layerGroup);
      }

      const marker = leaflet.circleMarker(
        [place.sourceCoordinates.y, place.sourceCoordinates.x],
        {
          className: isActive ? "journey-place-marker is-active" : "journey-place-marker",
          color: isActive ? "#fff7e8" : "#286f68",
          fillColor: isActive ? "#c14b36" : "#f8e6bf",
          fillOpacity: 0.98,
          radius: isActive ? 10.5 : mappablePlaces.length > 24 ? 6.5 : 8.5,
          weight: isActive ? 3.2 : 2.3,
        },
      );

      marker.bindTooltip(
        routeNumberLabel +
          ". " +
          place.name +
          (linkedWorkCount > 0 ? " · " + linkedWorkCount + "篇" : ""),
        {
        className: isActive ? "journey-map-tooltip is-active" : "journey-map-tooltip",
        direction: "top",
        offset: [0, -10],
        // The base map intentionally carries no baked-in foreign-language
        // labels. At close zoom the route's own Chinese place names provide
        // the readable geographic context without crowding the overview.
        permanent: isActive || mapZoom >= 6,
        },
      );

      marker.on("click", () => onPlaceSelect(place.id));
      marker.on("add", () => {
        const element = marker.getElement();
        if (!element) return;
        element.setAttribute("tabindex", "0");
        element.setAttribute("role", "button");
        element.setAttribute(
          "aria-label",
          "查看第 " +
            routeNumberLabel +
            " 站：" +
            place.name +
            (linkedWorkCount > 0 ? "，已关联 " + linkedWorkCount + " 篇作品" : ""),
        );
       element.addEventListener("keydown", (event) => {
          if (event instanceof KeyboardEvent && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onPlaceSelect(place.id);
          }
        });
      });

      marker.addTo(layerGroup);
    });

    const placeSignature =
      events.map((event) => event.id).join("|") +
      ":" +
      mappablePlaces
        .map(
          (place) =>
            place.id +
            ":" +
            String(place.sourceCoordinates.x) +
            "," +
            String(place.sourceCoordinates.y),
        )
        .join("|");
    if (fittedPlaceSignatureRef.current !== placeSignature) {
      if (routePoints.length === 1) {
        map.setView(routePoints[0], 5, { animate: false });
      } else {
        map.fitBounds(leaflet.latLngBounds(routePoints), {
          animate: false,
          maxZoom: 6,
          padding: [48, 64],
        });
      }
      fittedPlaceSignatureRef.current = placeSignature;
    }
  }, [
    activePlaceId,
    events,
    mapReady,
    mapZoom,
    onPlaceSelect,
    placeOrders,
    placeRouteNumbers,
    placeWorkCounts,
    places,
  ]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const animationLayer = animationLayerGroupRef.current;
    if (!mapReady || !leaflet || !map || !animationLayer) return;

    const routeStops = journeyRouteStops(
      events,
      places.map((place) => ({
        id: place.id,
        name: place.name,
        latitude: place.sourceCoordinates.y,
        longitude: place.sourceCoordinates.x,
      })),
    );

    animationLayer.clearLayers();

    if (routeStops.length < 2) {
      const unavailableFrame = window.requestAnimationFrame(() => {
        setRoutePreview({
          phase: "unavailable",
          fromName: "第 1 站",
          toName: "第 2 站",
          currentStation: routeStops.length,
          totalStations: routeStops.length,
        });
      });
      return () => window.cancelAnimationFrame(unavailableFrame);
    }

    const routeLatLngs = routeStops.map((stop) =>
      leaflet.latLng(stop.latitude, stop.longitude),
    );
    const start = routeLatLngs[0];
    const end = routeLatLngs[routeLatLngs.length - 1];
    const travelerIcon = leaflet.divIcon({
      className: "journey-traveler-icon",
      html: `
        <span class="journey-traveler">
          <span class="journey-traveler__ground"></span>
          <span class="journey-traveler__body"></span>
          <span class="journey-traveler__head"></span>
        </span>
      `,
      iconAnchor: [20, 47],
      iconSize: [40, 48],
    });
    const traveledRoute = leaflet
      .polyline([start, start], {
        className: "journey-route-traveled",
        color: "#c14b36",
        opacity: 0.96,
        weight: 4.1,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      })
      .addTo(animationLayer);
    const travelerMarker = leaflet
      .marker(start, {
        icon: travelerIcon,
        interactive: false,
        keyboard: false,
        zIndexOffset: 900,
      })
      .addTo(animationLayer);

    travelerMarker.getElement()?.setAttribute("aria-hidden", "true");
    travelerMarker.on("add", () => {
      travelerMarker.getElement()?.setAttribute("aria-hidden", "true");
    });

    let animationFrame: number | null = null;
    let finished = false;
    let activeLegIndex = 0;
    let legStartedAt = 0;
    let activeLegDuration = routePreviewMinLegDuration;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const finishPreview = () => {
      if (finished) return;
      finished = true;
      travelerMarker.setLatLng(end);
      traveledRoute.setLatLngs(routeLatLngs);
      setRoutePreview({
        phase: "arrived",
        fromName: routeStops[0].name,
        toName: routeStops[routeStops.length - 1].name,
        currentStation: routeStops.length,
        totalStations: routeStops.length,
      });
      onEventSelect(routeStops[routeStops.length - 1].eventId);
    };

    const durationForLeg = (legIndex: number) => {
      const fromPoint = map.latLngToLayerPoint(routeLatLngs[legIndex]);
      const toPoint = map.latLngToLayerPoint(routeLatLngs[legIndex + 1]);
      const distance = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
      return Math.min(
        routePreviewMaxLegDuration,
        Math.max(routePreviewMinLegDuration, distance * routePreviewMillisecondsPerPixel),
      );
    };

    const setMovingPreview = (legIndex: number) => {
      setRoutePreview({
        phase: "moving",
        fromName: routeStops[legIndex].name,
        toName: routeStops[legIndex + 1].name,
        currentStation: legIndex + 2,
        totalStations: routeStops.length,
      });
    };

    if (prefersReducedMotion) {
      animationFrame = window.requestAnimationFrame(() => {
        setMovingPreview(0);
        onEventSelect(routeStops[0].eventId);
        finishPreview();
      });
    } else {
      const animate = (now: number) => {
        const legStart = routeLatLngs[activeLegIndex];
        const legEnd = routeLatLngs[activeLegIndex + 1];
        const progress = Math.min(1, (now - legStartedAt) / activeLegDuration);
        const startPoint = map.latLngToLayerPoint(legStart);
        const endPoint = map.latLngToLayerPoint(legEnd);
        const currentPoint = leaflet.point(
          startPoint.x + (endPoint.x - startPoint.x) * progress,
          startPoint.y + (endPoint.y - startPoint.y) * progress,
        );
        const currentLatLng = map.layerPointToLatLng(currentPoint);

        travelerMarker.setLatLng(currentLatLng);
        traveledRoute.setLatLngs([
          ...routeLatLngs.slice(0, activeLegIndex + 1),
          currentLatLng,
        ]);

        if (progress < 1) {
          animationFrame = window.requestAnimationFrame(animate);
          return;
        }

        const arrivedStationIndex = activeLegIndex + 1;
        if (arrivedStationIndex === routeStops.length - 1) {
          finishPreview();
          return;
        }

        onEventSelect(routeStops[arrivedStationIndex].eventId);
        activeLegIndex = arrivedStationIndex;
        legStartedAt = now;
        activeLegDuration = durationForLeg(activeLegIndex);
        setMovingPreview(activeLegIndex);
        animationFrame = window.requestAnimationFrame(animate);
      };

      animationFrame = window.requestAnimationFrame((now) => {
        setMovingPreview(0);
        onEventSelect(routeStops[0].eventId);
        legStartedAt = now;
        activeLegDuration = durationForLeg(0);
        animate(now);
      });
    }

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationLayer.clearLayers();
    };
  }, [
    events,
    mapReady,
    onEventSelect,
    places,
    routePreviewReplayKey,
  ]);

  return (
    <div
      ref={mapContainerRef}
      className="real-map"
      role="region"
      aria-label={personName + "人生地点地图（按真实地理位置标注）"}
    >
      {mapStatus && mapStatus.state !== "ready" && (
        <div className="map-status-pill" role="status" aria-live="polite">
          {mapStatus.state === "offline" ? (
            <>
              <span>地图底图暂时不可用（{mapStatus.provider}），请重试</span>
              <button type="button" onClick={handleRetryTiles}>
                重试
              </button>
            </>
          ) : (
            <span>
              {mapStatus.state === "switching"
                ? "底图切换中，正在尝试备用地图…"
                : "正在加载地图底图…"}
            </span>
          )}
        </div>
      )}
      <div
        className={"journey-preview-control is-" + routePreview.phase}
        aria-live="polite"
      >
        <span className="journey-preview-control__mark" aria-hidden="true" />
        <span className="journey-preview-control__copy">
          <small>
            {routePreview.totalStations > 1
              ? routePreview.phase === "moving"
                ? "完整路线 · " +
                  String(routePreview.currentStation - 1) +
                  " → " +
                  String(routePreview.currentStation) +
                  " / " +
                  String(routePreview.totalStations)
                : "完整路线 · 1 → " + String(routePreview.totalStations)
              : "完整路线"}
          </small>
          <strong>
            {routePreview.phase === "waiting"
              ? "正在准备路线"
              : routePreview.phase === "unavailable"
                ? "需要至少两个可定位地点"
                : routePreview.phase === "moving"
                  ? routePreview.fromName + " → " + routePreview.toName
                  : "已完成 " +
                    String(routePreview.totalStations) +
                    " 站 · " +
                    routePreview.toName}
          </strong>
        </span>
        <button
          type="button"
          onClick={() => setRoutePreviewReplayKey((key) => key + 1)}
          disabled={
            routePreview.phase === "waiting" || routePreview.phase === "unavailable"
          }
          aria-label={
            routePreview.phase === "moving" ? "重新开始完整路线" : "重放完整路线"
          }
        >
          {routePreview.phase === "moving" ? "重新开始" : "重放"}
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<PageData | null>(null);
  const [activePersonId, setActivePersonId] = useState(DEFAULT_PUBLIC_MODULE_PERSON_ID);
  const [activePlaceId, setActivePlaceId] = useState("");
  const [activeEventId, setActiveEventId] = useState("");
  const [detailPage, setDetailPage] = useState(0);
  const [workScope, setWorkScope] = useState<"place" | "all">("place");
  const [corpusWorksByPerson, setCorpusWorksByPerson] = useState<Record<string, Work[]>>({});
  const [corpusError, setCorpusError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      loadJson<Person[]>("/data/people.json"),
      loadJson<Place[]>("/data/places.json"),
      loadJson<StoryEvent[]>("/data/events.json"),
      loadJson<Work[]>("/data/works.json"),
      loadJson<WorkPlaceLink[]>("/data/work-place-links.json"),
      loadJson<CorpusIndex>("/data/corpus/index.json"),
    ])
      .then(([people, places, events, works, workPlaceLinks, corpusIndex]) => {
        if (cancelled) return;
        const selectedPerson = resolvePublicModulePerson(people);
        const firstEvent = sortEvents(events.filter((event) => event.personId === selectedPerson?.id))[0];

        setData({ people, places, events, works, workPlaceLinks, corpusIndex });
        setActivePersonId(selectedPerson?.id ?? "");
        setActivePlaceId(firstEvent?.placeId ?? "");
        setActiveEventId(firstEvent?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setError("内容暂时无法加载。请刷新页面后再试。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      detailPage === 0 ||
      !activePersonId ||
      Object.prototype.hasOwnProperty.call(corpusWorksByPerson, activePersonId)
    ) {
      return;
    }

    let cancelled = false;

    const corpusPath = "/data/corpus/" + activePersonId + ".json";

    void loadJson<Work[]>(corpusPath)
      .then((works) => {
        if (cancelled) return;
        setCorpusWorksByPerson((current) => ({ ...current, [activePersonId]: works }));
      })
      .catch(() => {
        if (cancelled) return;
        setCorpusWorksByPerson((current) => ({ ...current, [activePersonId]: [] }));
        setCorpusError("全集索引暂时没有加载成功，请稍后重试。");
      });

    return () => {
      cancelled = true;
    };
  }, [activePersonId, corpusWorksByPerson, detailPage]);

  const activePerson = useMemo(
    () => data?.people.find((person) => person.id === activePersonId),
    [activePersonId, data],
  );
  const personEvents = useMemo(
    () => (data ? sortEvents(data.events.filter((event) => event.personId === activePersonId)) : []),
    [activePersonId, data],
  );

  const visibleEvents = personEvents;

  const placeOrders = useMemo(() => {
    const orders = new Map<string, number>();
    personEvents.forEach((event) => {
      if (!orders.has(event.placeId)) {
        orders.set(event.placeId, orders.size + 1);
      }
    });
    return orders;
  }, [personEvents]);

  const placeRouteNumbers = useMemo(() => {
    const routeNumbers = new Map<string, number[]>();
    visibleEvents.forEach((event, index) => {
      const numbers = routeNumbers.get(event.placeId) ?? [];
      numbers.push(routeSequenceNumber(event, index));
      routeNumbers.set(event.placeId, numbers);
    });
    return routeNumbers;
  }, [visibleEvents]);

  const visiblePlaceIds = useMemo(
    () => new Set(visibleEvents.map((event) => event.placeId)),
    [visibleEvents],
  );

  const placeWorkCounts = useMemo(() => {
    const workIdsByPlace = new Map<string, Set<string>>();
    for (const link of data?.workPlaceLinks ?? []) {
      if (link.reviewStatus !== "published" || link.personId !== activePersonId) continue;
      const workIds = workIdsByPlace.get(link.placeId) ?? new Set<string>();
      workIds.add(link.workId);
      workIdsByPlace.set(link.placeId, workIds);
    }
    return new Map(
      [...workIdsByPlace].map(([placeId, workIds]) => [placeId, workIds.size]),
    );
  }, [activePersonId, data]);

  const mapPlaces = useMemo(() => {
    if (!data) return [];
    return data.places
      .filter((place) => visiblePlaceIds.has(place.id))
      .sort(
        (a, b) =>
          placeOrder(a.id, placeOrders) - placeOrder(b.id, placeOrders) ||
          a.name.localeCompare(b.name, "zh-CN"),
      );
  }, [data, placeOrders, visiblePlaceIds]);

  const placeById = useMemo(
    () => new Map<string, Place>((data?.places ?? []).map((place) => [place.id, place])),
    [data],
  );

  const activePlace = placeById.get(activePlaceId);

  const placeEvents = useMemo(
    () => visibleEvents.filter((event) => event.placeId === activePlaceId),
    [activePlaceId, visibleEvents],
  );

  const activeEvent = placeEvents.find((event) => event.id === activeEventId) ?? placeEvents[0];
  const activeEventStoryCards = storyCardsForIds(activeEvent?.storyIds ?? []);

  const activeRouteEventIndex = activeEvent
    ? visibleEvents.findIndex((event) => event.id === activeEvent.id)
    : -1;
  const previousRouteEvent =
    activeRouteEventIndex > 0 ? visibleEvents[activeRouteEventIndex - 1] : undefined;
  const nextRouteEvent =
    activeRouteEventIndex >= 0 && activeRouteEventIndex < visibleEvents.length - 1
      ? visibleEvents[activeRouteEventIndex + 1]
      : undefined;

  const activePlaceLinks = useMemo(() => {
    if (!data) return [];
    return data.workPlaceLinks
      .filter(
        (link) =>
          link.reviewStatus === "published" &&
          link.personId === activePersonId &&
          link.placeId === activePlaceId,
      )
      .sort(
        (a, b) =>
          Number(b.eventId === activeEvent?.id) - Number(a.eventId === activeEvent?.id) ||
          relationTypeOrder[a.relationType] - relationTypeOrder[b.relationType] ||
          Number(b.certainty === "verified") - Number(a.certainty === "verified") ||
          a.workId.localeCompare(b.workId),
      );
  }, [activeEvent?.id, activePersonId, activePlaceId, data]);

  const activePlaceLinkByWorkId = useMemo(() => {
    const links = new Map<string, WorkPlaceLink>();
    for (const link of activePlaceLinks) {
      if (!links.has(link.workId)) links.set(link.workId, link);
    }
    return links;
  }, [activePlaceLinks]);

  const availableWorksById = useMemo(() => {
    const works = [
      ...(data?.works ?? []),
      ...(corpusWorksByPerson[activePersonId] ?? []),
    ];
    return new Map(works.map((work) => [work.id, work]));
  }, [activePersonId, corpusWorksByPerson, data]);

  const stationWorks = useMemo(
    () =>
      [...activePlaceLinkByWorkId.keys()].flatMap((workId) => {
        const work = availableWorksById.get(workId);
        return work ? [work] : [];
      }),
    [activePlaceLinkByWorkId, availableWorksById],
  );

  const stationWorkCount = activePlaceLinkByWorkId.size;

  const curatedPersonWorks = useMemo(
    () => (data?.works ?? []).filter((work) => work.personId === activePersonId),
    [activePersonId, data],
  );

  const personLibraryWorks = useMemo(
    () =>
      mergeWorkLibrary(
        stationWorks,
        curatedPersonWorks,
        corpusWorksByPerson[activePersonId] ?? [],
      ),
    [activePersonId, corpusWorksByPerson, curatedPersonWorks, stationWorks],
  );

  const scopedLibraryWorks = workScope === "place" ? stationWorks : personLibraryWorks;
  const libraryWorks = scopedLibraryWorks;

  const stationWorkIds = useMemo(
    () => new Set(activePlaceLinkByWorkId.keys()),
    [activePlaceLinkByWorkId],
  );
  const curatedWorkIds = useMemo(
    () => new Set(curatedPersonWorks.map((work) => work.id)),
    [curatedPersonWorks],
  );

  const corpusSummary = data?.corpusIndex.people[activePersonId];
  const isCorpusLoading =
    detailPage > 0 &&
    Boolean(activePersonId) &&
    !Object.prototype.hasOwnProperty.call(corpusWorksByPerson, activePersonId);
  const worksPageCount = Math.max(1, Math.ceil(libraryWorks.length / worksPerPage));
  const detailPageCount = 1 + worksPageCount;
  const currentDetailPage = Math.min(detailPage, detailPageCount - 1);
  const isOverviewPage = currentDetailPage === 0;
  const visibleWorks = isOverviewPage
    ? []
    : libraryWorks.slice(
        (currentDetailPage - 1) * worksPerPage,
        currentDetailPage * worksPerPage,
      );

  const chooseRouteEvent = useCallback((event: StoryEvent) => {
    setDetailPage(0);
    setWorkScope("place");
    setActivePlaceId(event.placeId);
    setActiveEventId(event.id);
  }, []);

  const chooseRouteEventById = useCallback((eventId: string) => {
    const event = visibleEvents.find((candidate) => candidate.id === eventId);
    if (event) chooseRouteEvent(event);
  }, [chooseRouteEvent, visibleEvents]);

  const choosePerson = useCallback((personId: string) => {
    if (!data) return;
    const firstEvent = sortEvents(data.events.filter((event) => event.personId === personId))[0];
    setDetailPage(0);
    setWorkScope("place");
    setCorpusError("");
    setActivePersonId(personId);
    setActivePlaceId(firstEvent?.placeId ?? "");
    setActiveEventId(firstEvent?.id ?? "");
  }, [data]);

  const choosePlace = useCallback((placeId: string) => {
    setDetailPage(0);
    setWorkScope("place");
    setActivePlaceId(placeId);
    const firstEvent = visibleEvents.find((event) => event.placeId === placeId);
    setActiveEventId(firstEvent?.id ?? "");
  }, [visibleEvents]);

  function changeDetailPage(nextPage: number) {
    setDetailPage(Math.max(0, Math.min(nextPage, detailPageCount - 1)));
  }

  if (!data) {
    return (
      <main className="loading-page">
        <a className="skip-link" href="#main-content">
          跳到正文
        </a>
        <SiteNav current="journey" />
        <section id="main-content" className="loading-card" aria-live="polite">
          <p className="eyebrow">人生行迹</p>
          <h1>正在整理行迹卷</h1>
          <p>{error || "正在载入地点、故事和作品……"}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="site-shell">
      <a className="skip-link" href="#main-content">
        跳到正文
      </a>
      <SiteNav current="journey" />

      <ReadingModuleHeader
        title="行迹卷"
        subtitle={"：按时间与地点读" + (activePerson?.name ?? "诗人") + "的一生"}
        controls={
          <PersonSwitcher
            id="person-select"
            value={activePersonId}
            options={data.people}
            onChange={choosePerson}
            summary={personEvents.length + " 个经历节点 · " + placeOrders.size + " 处地点"}
          />
        }
      />

      <JourneyStage
        ariaLabel={(activePerson?.name ?? "人物") + "的行迹地图"}
        visual={
          <div className="map-stage map-stage--real">
            <RealMap
              places={mapPlaces}
              events={visibleEvents}
              placeOrders={placeOrders}
              placeRouteNumbers={placeRouteNumbers}
              placeWorkCounts={placeWorkCounts}
              activePlaceId={activePlaceId}
              personName={activePerson?.name ?? "人物"}
              onPlaceSelect={choosePlace}
              onEventSelect={chooseRouteEventById}
            />
          </div>
        }
        rail={
          <nav className="route-event-list" aria-label="路线事件目录">
            <div className="route-event-list-heading">
              <p>人生行程</p>
              <span>横向浏览 · {visibleEvents.length} 条</span>
            </div>
            {visibleEvents.length > 0 ? (
              <ol>
                {visibleEvents.map((event, index) => {
                  const place = placeById.get(event.placeId);
                  const isActive = event.id === activeEvent?.id;
                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        className={isActive ? "is-active" : ""}
                        aria-current={isActive ? "step" : undefined}
                        onClick={() => chooseRouteEvent(event)}
                      >
                        <span className="route-event-order">
                          {routeSequenceNumber(event, index)}
                        </span>
                        <span className="route-event-copy">
                          <strong>{place?.name ?? "地点待补充"}</strong>
                          <span>
                            {eventTimeLabel(event)} · {event.lifeStage} · {event.title}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </nav>
        }
        inspector={
          <aside
            className="detail-panel"
            aria-live="polite"
            aria-label="当前地点故事详情"
          >
            {visibleEvents.length > 1 && (
              <nav className="route-step-controls" aria-label="前后浏览路线节点">
                <button
                  type="button"
                  onClick={() => previousRouteEvent && chooseRouteEvent(previousRouteEvent)}
                  disabled={!previousRouteEvent}
                >
                  <span className="route-step-arrow" aria-hidden="true">←</span>
                  <span className="route-step-copy">
                    <small>上一站</small>
                    <strong>
                      {previousRouteEvent
                        ? placeById.get(previousRouteEvent.placeId)?.name ?? "上一站"
                        : "旅程起点"}
                    </strong>
                  </span>
                </button>
                <div className="route-progress" aria-label="当前人生行程进度">
                  <span>人生行程</span>
                  <strong>
                    {String(Math.max(0, activeRouteEventIndex) + 1).padStart(2, "0")}
                    <i>/</i>
                    {String(visibleEvents.length).padStart(2, "0")}
                  </strong>
                </div>
                <button
                  type="button"
                  onClick={() => nextRouteEvent && chooseRouteEvent(nextRouteEvent)}
                  disabled={!nextRouteEvent}
                >
                  <span className="route-step-copy">
                    <small>下一站</small>
                    <strong>
                      {nextRouteEvent
                        ? placeById.get(nextRouteEvent.placeId)?.name ?? "下一站"
                        : "旅程终点"}
                    </strong>
                  </span>
                  <span className="route-step-arrow" aria-hidden="true">→</span>
                </button>
              </nav>
            )}
            <div
              className={
                "detail-page-content" + (isOverviewPage ? "" : " detail-page-content--works")
              }
            >
              {isOverviewPage ? (
                <>
                  {activeEvent ? (
                    <article className="story-card">
                      <header className="story-card-header">
                        <div>
                          <p className="story-card-kicker">
                            第 {routeSequenceNumber(activeEvent, activeRouteEventIndex)} 站
                            {" · "}
                            {activePlace?.name ?? "地点待补充"}
                          </p>
                          <h3>{activeEvent.title}</h3>
                        </div>
                        <ReviewBadge status={activeEvent.reviewStatus} />
                      </header>
                      <div className="story-meta">
                        <span>{eventTimeLabel(activeEvent)}</span>
                        <span>{activeEvent.lifeStage}</span>
                        <span>{activeEvent.role}</span>
                      </div>
                      <p className="story-summary">{activeEvent.summary}</p>
                      {!activeEventStoryCards.length ? (
                        <p className="story-summary story-summary--context">
                          {readingContexts[activeEvent.personId]?.story ?? defaultReadingContext.story}
                        </p>
                      ) : null}
                      {activePlace?.intro ? (
                        <aside className="story-place-note">
                          <span>地点小记</span>
                          <p>
                            {activePlace.intro}
                            {!activeEventStoryCards.length
                              ? readingContexts[activeEvent.personId]?.place ?? defaultReadingContext.place
                              : null}
                          </p>
                        </aside>
                      ) : null}
                    </article>
                  ) : (
                    <article className="story-card empty-story">
                      <h3>这一站正在补充故事</h3>
                      <p>先从地点介绍开始，后续可以继续添加人物经历和作品。</p>
                    </article>
                  )}
                </>
              ) : (
                <section className="works-section works-section--page" aria-labelledby="works-heading">
                  <div className="section-heading compact-heading">
                    <div>
                      <h3 id="works-heading">
                        {workScope === "place"
                          ? `${activePlace?.name ?? "此地"} · 地点诗词`
                          : `${activePerson?.name ?? "诗人"}作品全集`}
                      </h3>
                    </div>
                    <span className="work-count">
                      {workScope === "place"
                        ? `此地 ${stationWorkCount} 篇`
                        : `全集 ${corpusSummary?.total ?? 0} 篇`}
                    </span>
                  </div>

                  <div className="work-scope-switch" role="group" aria-label="作品浏览范围">
                    <button
                      type="button"
                      className={workScope === "place" ? "is-active" : ""}
                      aria-pressed={workScope === "place"}
                      onClick={() => {
                        setWorkScope("place");
                        setDetailPage(1);
                      }}
                    >
                      此地诗词 <span>{stationWorkCount}</span>
                    </button>
                    <button
                      type="button"
                      className={workScope === "all" ? "is-active" : ""}
                      aria-pressed={workScope === "all"}
                      onClick={() => {
                        setWorkScope("all");
                        setDetailPage(1);
                      }}
                    >
                      诗人全集 <span>{corpusSummary?.total ?? 0}</span>
                    </button>
                  </div>

                  <div className="work-library-results">
                    {isCorpusLoading && (
                      <p className="work-library-status">正在载入全集索引…</p>
                    )}
                    {corpusError && <p className="work-library-status is-error">{corpusError}</p>}
                    {!corpusError && !isCorpusLoading && visibleWorks.length === 0 && (
                      <p className="work-library-status">
                        {workScope === "place"
                          ? "此地暂时没有已核对的作品关系；可以切换到诗人全集继续查看。"
                          : "暂时没有可显示的作品。"}
                      </p>
                    )}

                    <div className="work-list work-list--fixed">
                      {visibleWorks.map((work) => (
                        <WorkEntry
                          key={work.id}
                          work={work}
                          relation={activePlaceLinkByWorkId.get(work.id)}
                          placeName={activePlace?.name}
                          scope={
                            stationWorkIds.has(work.id)
                              ? "station"
                              : curatedWorkIds.has(work.id)
                                ? "curated"
                                : "corpus"
                          }
                        />
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </div>

            {isOverviewPage && (
              <button
                type="button"
                className="open-works-button"
                onClick={() => {
                  setWorkScope("place");
                  changeDetailPage(1);
                }}
              >
                <span>
                  <small>作品与地点</small>
                  <strong>{activePlace?.name ?? "此地"}诗词</strong>
                </span>
                <span className="open-works-summary">
                  {stationWorkCount} 篇
                  <i aria-hidden="true">→</i>
                </span>
              </button>
            )}

            {!isOverviewPage && (
              <nav className="detail-pagination" aria-label="诗人作品库分页">
                <button
                  type="button"
                  onClick={() => changeDetailPage(currentDetailPage - 1)}
                >
                  {currentDetailPage === 1 ? "← 返回故事" : "← 上一组"}
                </button>
                <span>
                  作品 {currentDetailPage} / {worksPageCount}
                </span>
                <button
                  type="button"
                  onClick={() => changeDetailPage(currentDetailPage + 1)}
                  disabled={currentDetailPage === detailPageCount - 1}
                >
                  下一组 →
                </button>
              </nav>
            )}
          </aside>
        }
      />
    </main>
  );
}
