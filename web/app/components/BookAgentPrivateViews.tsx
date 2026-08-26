"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMapInstance } from "leaflet";

import {
  ContextAtlasStage,
  JourneyStage,
  ReadingModuleHeader,
  SocialGraphStage,
} from "./ReadingModuleTemplate";
import { GraphZoomControls } from "./GraphZoomControls";
import { LocationStoryDirectory } from "./LocationStoryDirectory";
import { PoemWorldWorkCard, type PoemWorldWorkCardData } from "./PoemWorldWorkCard";
import { PoetOverviewPanel, type PoetOverviewEvent, type PoetOverviewProfile } from "./PoetOverviewPanel";
import {
  isLongWorkReading,
  WorkReadingTemplate,
  type WorkReadingEvent,
  type WorkReadingPlaceRelation,
} from "./WorkReadingTemplate";
import {
  RelationshipStoryPanel,
  type RelationshipStoryLink,
  type RelationshipStoryPerson,
  type RelationshipStoryPilot,
} from "./RelationshipStoryPanel";
import {
  arrangeKnowledgeGraph,
  knowledgeGraphCardSize,
  knowledgeGraphStraightLinkGeometry,
  type KnowledgeGraphCluster,
} from "../../lib/knowledge-graph-presentation";
import { addChineseVectorBasemap } from "../../lib/chineseVectorBasemap";
import { journeyRouteStops } from "../../lib/journey-route-animation";
import { poemWorldMarkerVisual } from "../../lib/poem-world-map-visual";
import type { MapTileStatus, ResilientTilesHandle } from "../../lib/mapTileLayers";
import type {
  BookAnalysisDraft,
  BookAnalysisResult,
  BookAgentReferenceJourneyEvent,
  BookAgentReferenceSocialConnection,
  BookAgentReferenceWork,
  JourneyItem,
  PoemWorldItem,
  SocialEdge,
} from "../../lib/book-agent";
import { PRIVATE_VIEW_LABELS, type PrivateViewKey } from "./private-view";
import styles from "../agent.module.css";

type PrivateViewsProps = {
  result: BookAnalysisResult;
  manifest: Record<string, unknown>;
  activeView: PrivateViewKey;
  onBackToReview: () => void;
  onReset: () => void;
  onDownload: () => void;
};

type PlaceEntity = BookAnalysisDraft["entities"]["places"][number];

const JOURNEY_PREDICATE_LABELS: Record<JourneyItem["predicate"], string> = {
  "born-at": "出生于",
  "died-at": "卒于",
  "resided-at": "居于",
  visited: "游历",
  "traveled-to": "行至",
  "held-office-at": "任职于",
  "exiled-to": "谪居",
  "studied-at": "从学于",
  "stayed-at": "寄居",
};

const POEM_RELATION_LABELS: Record<NonNullable<PoemWorldItem["relationType"]>, string> = {
  "composed-at": "作于",
  "inscribed-at": "题于",
  "describes-place": "题咏",
  "mentioned-place": "写到",
};

const SOCIAL_RELATION_LABELS: Record<SocialEdge["relationTypes"][number], string> = {
  kin: "亲属",
  "literary-exchange": "文学唱和",
  official: "同僚 / 官场",
  "teacher-student": "师生",
  friendship: "交游",
  other: "往来",
};

const SOCIAL_CLUSTER_FOR_RELATION: Record<string, KnowledgeGraphCluster> = {
  kin: "kin",
  "teacher-student": "learning",
  "literary-exchange": "literary",
  friendship: "reception",
  official: "other",
  other: "other",
};

function manifestIds(manifest: Record<string, unknown>, key: string): Set<string> {
  const value = manifest[key];
  return new Set(
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [],
  );
}

function excerptFor(result: BookAnalysisResult, evidenceIds: string[]): string {
  const evidence = result.draft.evidence.find((item) => evidenceIds.includes(item.id));
  if (!evidence) return "暂无可回读片段";
  return result.sourceText
    .slice(evidence.locator.startOffset, evidence.locator.endOffset)
    .replace(/\s+/g, " ")
    .slice(0, 220);
}

function evidenceLabel(result: BookAnalysisResult, evidenceIds: string[]): string {
  return result.draft.evidence.find((item) => evidenceIds.includes(item.id))?.locator.label ?? "未定位";
}

function storyFor(
  draft: BookAnalysisDraft,
  storyIds: string[],
  acceptedStoryIds?: ReadonlySet<string>,
) {
  return draft.storyCards.find(
    (story) =>
      storyIds.includes(story.id) &&
      (!acceptedStoryIds || acceptedStoryIds.has(story.id)),
  );
}

function hasCoordinates(
  place: PlaceEntity,
): place is PlaceEntity & { coordinate: { x: number; y: number; precision: "display-only" } } {
  return Boolean(
    place.coordinate &&
      Number.isFinite(place.coordinate.x) &&
      Number.isFinite(place.coordinate.y),
  );
}

type PrivateMapRecord = {
  id: string;
  placeId: string;
  order: number;
  label: string;
  linkedCount?: number;
};

type PrivateMapProps = {
  places: PlaceEntity[];
  records: PrivateMapRecord[];
  activePlaceId: string;
  ariaLabel: string;
  connectRoute?: boolean;
  markerMode?: "journey" | "poem";
  onPlaceSelect: (placeId: string) => void;
  onRouteRecordSelect?: (recordId: string) => void;
};

type PrivateJourneyStation = Readonly<{
  id: string;
  placeId: string;
  items: JourneyItem[];
}>;

/**
 * Keep the narrative sequence, but collapse adjacent candidates that point
 * to the same place into one visible station. This removes duplicate cards
 * created by multiple evidence relations without hiding a later revisit.
 */
function groupJourneyStations(items: readonly JourneyItem[]): PrivateJourneyStation[] {
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.sequence - right.item.sequence || left.index - right.index)
    .map(({ item }) => item);

  return ordered.reduce<PrivateJourneyStation[]>((stations, item) => {
    const previous = stations[stations.length - 1];
    if (previous?.placeId === item.placeId) {
      stations[stations.length - 1] = {
        ...previous,
        items: [...previous.items, item],
      };
      return stations;
    }
    stations.push({ id: item.id, placeId: item.placeId, items: [item] });
    return stations;
  }, []);
}

function journeyStationSummary(station: PrivateJourneyStation): string {
  const times = [...new Set(
    station.items
      .map((item) => item.time?.label?.trim())
      .filter((label): label is string => Boolean(label)),
  )];
  const predicates = [...new Set(station.items.map((item) => JOURNEY_PREDICATE_LABELS[item.predicate]))];
  return [
    times.join(" / ") || "时间未定",
    predicates.join(" / "),
    station.items.length > 1 ? `${station.items.length} 条关联` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

type PrivateRoutePreviewPhase = "waiting" | "moving" | "arrived" | "unavailable";

type PrivateRoutePreviewState = Readonly<{
  phase: PrivateRoutePreviewPhase;
  fromName: string;
  toName: string;
  currentStation: number;
  totalStations: number;
}>;

const privateRoutePreviewMinLegDuration = 900;
const privateRoutePreviewMaxLegDuration = 2200;
const privateRoutePreviewMillisecondsPerPixel = 6;

function PrivateLeafletMap({
  places,
  records,
  activePlaceId,
  ariaLabel,
  connectRoute = true,
  markerMode = "journey",
  onPlaceSelect,
  onRouteRecordSelect,
}: PrivateMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const layerGroupRef = useRef<LayerGroup | null>(null);
  const animationLayerGroupRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const tilesRef = useRef<ResilientTilesHandle | null>(null);
  const fittedSignatureRef = useRef("");
  const [mapReady, setMapReady] = useState(false);
  const [mapZoom, setMapZoom] = useState(4);
  const [mapStatus, setMapStatus] = useState<MapTileStatus | null>(null);
  const [routePreview, setRoutePreview] = useState<PrivateRoutePreviewState>({
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
      if (initialInvalidateFrame !== null) window.cancelAnimationFrame(initialInvalidateFrame);
      if (zoomListener) initializedMap?.off("zoomend", zoomListener);
      initializedTiles?.destroy();
      if (tilesRef.current === initializedTiles) tilesRef.current = null;
      initializedMap?.remove();
      if (mapRef.current === initializedMap) {
        mapRef.current = null;
        layerGroupRef.current = null;
        animationLayerGroupRef.current = null;
        leafletRef.current = null;
        fittedSignatureRef.current = "";
      }
    };
  }, []);

  const retryTiles = useCallback(() => tilesRef.current?.retry(), []);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!mapReady || !leaflet || !map || !layerGroup) return;

    const mappablePlaces = places.filter(hasCoordinates);
    const placesById = new Map(mappablePlaces.map((place) => [place.id, place]));
    const firstRecordByPlace = new Map<string, PrivateMapRecord>();
    for (const record of records) {
      if (!firstRecordByPlace.has(record.placeId)) firstRecordByPlace.set(record.placeId, record);
    }
    const routePoints = records.flatMap((record) => {
      const place = placesById.get(record.placeId);
      return place ? [[place.coordinate.y, place.coordinate.x] as [number, number]] : [];
    });
    const maxLinkedCount = Math.max(
      1,
      ...mappablePlaces.map(
        (place) => records.filter((record) => record.placeId === place.id).length,
      ),
    );

    layerGroup.clearLayers();

    if (connectRoute && routePoints.length > 1) {
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
        .bindTooltip("候选内容顺序（不是精确地理路线）", {
          className: "journey-map-tooltip route-tooltip",
          sticky: true,
        })
        .addTo(layerGroup);
    }

    for (const place of mappablePlaces) {
      const active = place.id === activePlaceId;
      const record = firstRecordByPlace.get(place.id);
      const linkedCount = records
        .filter((item) => item.placeId === place.id)
        .reduce((count, item) => count + (item.linkedCount ?? 1), 0);
      const poemMarkerVisual = poemWorldMarkerVisual(linkedCount, maxLinkedCount);

      if (active) {
        leaflet
          .circleMarker([place.coordinate.y, place.coordinate.x], {
            className: markerMode === "poem" ? "poem-place-halo poem-place-halo--active" : "journey-place-halo",
            color: markerMode === "poem" ? "#78b996" : "#d8a13e",
            fillColor: markerMode === "poem" ? "#dff3e6" : "#d8a13e",
            fillOpacity: 0.18,
            opacity: markerMode === "poem" ? 0.5 : 0.72,
            radius: markerMode === "poem" ? poemMarkerVisual.radius + 5.2 : 19,
            weight: markerMode === "poem" ? 1 : 1.5,
            interactive: false,
          })
          .addTo(layerGroup);
      }

      const marker = leaflet.circleMarker([place.coordinate.y, place.coordinate.x], {
        className: active
          ? markerMode === "poem"
            ? "poem-place-marker is-active"
            : "journey-place-marker is-active"
          : markerMode === "poem"
            ? "poem-place-marker"
            : "journey-place-marker",
        color: markerMode === "poem"
          ? active ? "#438d69" : poemMarkerVisual.borderColor
          : active ? "#fff7e8" : "#286f68",
        fillColor: markerMode === "poem"
          ? active ? "#e0f3e7" : poemMarkerVisual.fillColor
          : active ? "#c14b36" : "#f8e6bf",
        fillOpacity: markerMode === "poem" ? active ? 0.56 : 0.9 : 0.98,
        opacity: markerMode === "poem" ? active ? 0.76 : 1 : 1,
        radius: markerMode === "poem"
          ? poemMarkerVisual.radius + (active ? 1.25 : 0)
          : active ? 10.5 : mappablePlaces.length > 24 ? 6.5 : 8.5,
        weight: markerMode === "poem" ? active ? 1.65 : 1.45 : active ? 3.2 : 2.3,
      });

      marker.bindTooltip(
        (record ? `${record.order}. ` : "") +
          place.label +
          (linkedCount > 1 ? ` · ${linkedCount} 条关联` : ""),
        {
          className: active ? "journey-map-tooltip is-active" : "journey-map-tooltip",
          direction: "top",
          offset: [0, -10],
          permanent: active || mapZoom >= 6,
        },
      );
      marker.on("click", () => onPlaceSelect(place.id));
      marker.on("add", () => {
        const element = marker.getElement();
        if (!element) return;
        element.setAttribute("tabindex", "0");
        element.setAttribute("role", "button");
        element.setAttribute("aria-label", `查看${place.label}的私有候选内容`);
        element.addEventListener("keydown", (event) => {
          if (event instanceof KeyboardEvent && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onPlaceSelect(place.id);
          }
        });
      });
      marker.addTo(layerGroup);
    }

    const signature = `${markerMode}:${activePlaceId}:${records.map((record) => record.id).join("|")}:${mappablePlaces.map((place) => `${place.id}:${place.coordinate.x},${place.coordinate.y}`).join("|")}`;
    if (fittedSignatureRef.current !== signature && mappablePlaces.length) {
      const boundsPoints = routePoints.length ? routePoints : mappablePlaces.map((place) => [place.coordinate.y, place.coordinate.x] as [number, number]);
      if (boundsPoints.length === 1) map.setView(boundsPoints[0], 5, { animate: false });
      else map.fitBounds(leaflet.latLngBounds(boundsPoints), { animate: false, maxZoom: 6, padding: [48, 64] });
      fittedSignatureRef.current = signature;
    }
  }, [activePlaceId, connectRoute, mapReady, mapZoom, markerMode, onPlaceSelect, places, records]);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const animationLayer = animationLayerGroupRef.current;
    if (!mapReady || !leaflet || !map || !animationLayer) return;

    animationLayer.clearLayers();

    if (!connectRoute) {
      const unavailableFrame = window.requestAnimationFrame(() => {
        setRoutePreview({
          phase: "unavailable",
          fromName: "第 1 站",
          toName: "第 2 站",
          currentStation: 0,
          totalStations: 0,
        });
      });
      return () => window.cancelAnimationFrame(unavailableFrame);
    }

    const routeStops = journeyRouteStops(
      records,
      places.filter(hasCoordinates).map((place) => ({
        id: place.id,
        name: place.label,
        latitude: place.coordinate.y,
        longitude: place.coordinate.x,
      })),
    );

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
    let activeLegDuration = privateRoutePreviewMinLegDuration;
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
      onRouteRecordSelect?.(routeStops[routeStops.length - 1].eventId);
    };

    const durationForLeg = (legIndex: number) => {
      const fromPoint = map.latLngToLayerPoint(routeLatLngs[legIndex]);
      const toPoint = map.latLngToLayerPoint(routeLatLngs[legIndex + 1]);
      const distance = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
      return Math.min(
        privateRoutePreviewMaxLegDuration,
        Math.max(
          privateRoutePreviewMinLegDuration,
          distance * privateRoutePreviewMillisecondsPerPixel,
        ),
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
        onRouteRecordSelect?.(routeStops[0].eventId);
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

        onRouteRecordSelect?.(routeStops[arrivedStationIndex].eventId);
        activeLegIndex = arrivedStationIndex;
        legStartedAt = now;
        activeLegDuration = durationForLeg(activeLegIndex);
        setMovingPreview(activeLegIndex);
        animationFrame = window.requestAnimationFrame(animate);
      };

      animationFrame = window.requestAnimationFrame((now) => {
        setMovingPreview(0);
        onRouteRecordSelect?.(routeStops[0].eventId);
        legStartedAt = now;
        activeLegDuration = durationForLeg(0);
        animate(now);
      });
    }

    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationLayer.clearLayers();
    };
  }, [connectRoute, mapReady, onRouteRecordSelect, places, records, routePreviewReplayKey]);

  return (
    <div ref={mapContainerRef} className="real-map" role="region" aria-label={ariaLabel}>
      {mapStatus && mapStatus.state !== "ready" ? (
        <div className="map-status-pill" role="status" aria-live="polite">
          {mapStatus.state === "offline" ? (
            <>
              <span>地图底图暂时不可用（{mapStatus.provider}）</span>
              <button type="button" onClick={retryTiles}>重试</button>
            </>
          ) : (
            <span>{mapStatus.state === "switching" ? "底图切换中…" : "正在加载地图底图…"}</span>
          )}
        </div>
      ) : null}
      {connectRoute ? (
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
      ) : null}
      {!places.some(hasCoordinates) ? (
        <div className={styles.privateMapEmpty}>当前候选没有可定位坐标，保留文字阅读视图。</div>
      ) : null}
      <p className="map-caption">坐标仅作现代展示近似</p>
    </div>
  );
}

function PrivateEvidenceNote({ result, evidenceIds }: { result: BookAnalysisResult; evidenceIds: string[] }) {
  return (
    <aside className="story-place-note">
      <span>原文证据 · {evidenceLabel(result, evidenceIds)}</span>
      <p>“{excerptFor(result, evidenceIds)}”</p>
    </aside>
  );
}

function relatedWorksFor(result: BookAnalysisResult, placeId: string): BookAgentReferenceWork[] {
  return result.references.worksByPlace[placeId] ?? [];
}

const JOURNEY_WORKS_PER_PAGE = 4;
const POEM_WORLD_LINK_LIMIT = 20;

type PrivateWorkReaderData = {
  id: string;
  title: string;
  genre?: string;
  contextLabel: string;
  text?: string[];
  placeId?: string;
  eventId?: string;
  relationType?: NonNullable<PoemWorldItem["relationType"]>;
  certainty?: "verified" | "probable";
  timeLabel?: string;
  note?: string;
  evidenceIds?: string[];
  storySummary?: string;
  isPrivateCandidate?: boolean;
};

type PrivateJourneyWork = {
  id: string;
  title: string;
  genre?: string;
  preview?: string;
  sourceLabel: string;
  scopeClass: "station" | "curated";
  reader?: PrivateWorkReaderData;
};

type PrivatePoemDisplayWork = PoemWorldWorkCardData & {
  itemId?: string;
  reader?: PrivateWorkReaderData;
};

function referenceEventTimeLabel(event: BookAgentReferenceJourneyEvent): string {
  if (event.startYear && event.endYear && event.startYear !== event.endYear) {
    return `${event.startYear}—${event.endYear}`;
  }
  if (event.startYear) return String(event.startYear);
  if (event.endYear) return String(event.endYear);
  return "时间待考";
}

function referenceEventFor(
  item: JourneyItem,
  events: BookAgentReferenceJourneyEvent[],
): BookAgentReferenceJourneyEvent | undefined {
  if (!events.length || item.time?.startYear === undefined) return events[0];
  const itemStart = item.time.startYear;
  const itemEnd = item.time.endYear ?? itemStart;
  const rangeDistance = (event: BookAgentReferenceJourneyEvent) => {
    const eventStart = event.startYear ?? event.endYear;
    const eventEnd = event.endYear ?? event.startYear;
    if (eventStart === undefined || eventEnd === undefined) return Number.MAX_SAFE_INTEGER;
    if (eventStart <= itemEnd && eventEnd >= itemStart) return 0;
    return Math.min(Math.abs(eventStart - itemEnd), Math.abs(itemStart - eventEnd));
  };
  return [...events].sort((left, right) => rangeDistance(left) - rangeDistance(right))[0];
}

function privateJourneyBookWorks(
  result: BookAnalysisResult,
  items: PoemWorldItem[],
  placeId: string,
): PrivateJourneyWork[] {
  return items
    .filter((item) => item.placeId === placeId)
    .map((item) => {
      const work = result.draft.entities.works.find((record) => record.id === item.workId);
      return {
        id: item.id,
        title: work?.title ?? item.workId,
        genre: work?.genre,
        preview: excerptFor(result, item.evidenceIds),
        sourceLabel: "书内候选",
        scopeClass: "curated" as const,
        reader: {
          id: item.id,
          title: work?.title ?? item.workId,
          genre: work?.genre,
          contextLabel: item.relationType
            ? `作品—地点候选 · ${POEM_RELATION_LABELS[item.relationType]}`
            : "作品—地点候选",
          placeId,
          relationType: item.relationType ?? "mentioned-place",
          certainty: "probable",
          evidenceIds: item.evidenceIds,
          isPrivateCandidate: true,
        },
      };
    });
}

function privateJourneyReferenceWorks(
  works: BookAgentReferenceWork[],
  placeId: string,
): PrivateJourneyWork[] {
  return works.map((work) => ({
    id: work.id,
    title: work.title,
    genre: work.genre,
    preview: work.text[0] ?? work.note,
    sourceLabel: work.origin === "chinese-poetry-match" ? "chinese-poetry" : "地点关联",
    scopeClass: "station",
    reader: {
      id: `reference-${work.id}`,
      title: work.title,
      genre: work.genre,
      contextLabel: `${work.origin === "chinese-poetry-match" ? "chinese-poetry" : "地点关联"} · ${POEM_RELATION_LABELS[work.relationType]}`,
      text: work.text,
      placeId: work.placeId ?? placeId,
      eventId: work.eventId,
      relationType: work.relationType,
      certainty: work.certainty ?? "probable",
      timeLabel: work.timeLabel,
      note: work.note,
    },
  }));
}

function PrivateJourneyWorkEntry({
  work,
  onOpenReader,
}: {
  work: PrivateJourneyWork;
  onOpenReader: (reader: PrivateWorkReaderData) => void;
}) {
  const content = (
    <>
      <span className="work-entry-main">
        <span className="work-entry-meta">
          <span className="work-genre">{work.genre ?? "诗"}</span>
          <span className={`work-scope work-scope--${work.scopeClass}`}>{work.sourceLabel}</span>
        </span>
        <strong className="work-title" title={work.title}>{work.title}</strong>
        {work.preview ? <span className="work-preview" title={work.preview}>{work.preview}</span> : null}
      </span>
      <span className="work-entry-action" aria-hidden="true">阅读 <span>→</span></span>
    </>
  );

  if (work.reader) {
    return (
      <button
        type="button"
        className="work-entry private-work-entry-button"
        onClick={() => onOpenReader(work.reader!)}
        aria-label={`阅读《${work.title}》`}
      >
        {content}
      </button>
    );
  }

  return null;
}

function PrivateWorkReader({
  result,
  work,
  onClose,
  backLabel = "返回作品列表",
}: {
  result: BookAnalysisResult;
  work: PrivateWorkReaderData;
  onClose: () => void;
  backLabel?: string;
}) {
  const evidence = (work.evidenceIds ?? []).flatMap((evidenceId) => {
    const item = result.draft.evidence.find((record) => record.id === evidenceId);
    if (!item) return [];
    const text = result.sourceText
      .slice(item.locator.startOffset, item.locator.endOffset)
      .trim();
    return text ? [{ id: item.id, label: item.locator.label, text }] : [];
  });
  const isPrivateCandidate = work.isPrivateCandidate || Boolean(work.evidenceIds?.length);
  const readingText = work.text?.length ? work.text : evidence.map((item) => item.text);
  const place = work.placeId
    ? result.draft.entities.places.find((item) => item.id === work.placeId)
    : undefined;
  const referenceEvents = work.placeId
    ? result.references.journeyByPlace[work.placeId] ?? []
    : [];
  const relatedEvents: WorkReadingEvent[] = referenceEvents
    .filter((event) => !work.eventId || event.id === work.eventId)
    .map((event) => ({
      id: event.id,
      title: event.title,
      summary: event.summary,
      lifeStage: event.lifeStage,
      timeLabel: event.timeLabel,
      startYear: event.startYear,
      endYear: event.endYear,
      sequence: event.sequence,
    }));
  const relatedPlaces: WorkReadingPlaceRelation[] = place ? [{
    id: `${work.id}-${place.id}`,
    relationType: work.relationType ?? "mentioned-place",
    certainty: work.certainty ?? "probable",
    timeLabel: work.timeLabel,
    note: work.note,
    placeName: place.label,
    modernName: place.modernName,
  }] : [];
  const hasCreationPlace = work.relationType === "composed-at" || work.relationType === "inscribed-at";
  const personName = result.draft.poet.name;
  const lede = isPrivateCandidate
    ? "这篇内容来自本次书籍分析的私有候选；正文只回读上传原文，不会被视作已发布作品全文。"
    : place
      ? hasCreationPlace
        ? `这篇作品与${place.label}关联为创作或题写关系。`
        : `这篇作品明确题咏或提及${place.label}；地点关联不自动等同于创作地点。`
      : `在${personName}的 Agent 私有预览中阅读这篇作品。`;
  const contextSupplement = isPrivateCandidate || work.storySummary || evidence.length ? (
    <section className="private-work-reading-supplement" aria-label="本次私有预览说明">
      <p className="work-reading-label">本次私有预览</p>
      {isPrivateCandidate ? (
        <p>候选仍保留在当前 Agent 审核上下文中；只有定位到的上传原文会作为正文显示。</p>
      ) : null}
      {work.storySummary ? <p>{work.storySummary}</p> : null}
      {evidence.length ? (
        <details className="private-work-reading-evidence">
          <summary>原文证据 · {evidence.length} 处</summary>
          {evidence.map((item) => (
            <article key={item.id}>
              <p>{item.label}</p>
              <blockquote>{item.text}</blockquote>
            </article>
          ))}
        </details>
      ) : null}
    </section>
  ) : null;
  const readingShellClassName =
    "work-reading-shell private-work-reading-shell" +
    (isLongWorkReading(readingText) ? " work-reading-shell--long" : "");

  return (
    <section className={readingShellClassName} aria-label={`《${work.title}》的 Agent 内阅读器`}>
      <WorkReadingTemplate
        work={{
          id: work.id,
          title: work.title,
          genre: work.genre,
          text: readingText,
        }}
        personName={personName}
        lede={lede}
        relatedEvents={relatedEvents}
        relatedPlaces={relatedPlaces}
        backLabel={backLabel}
        onBack={onClose}
        emptyEventMessage={
          isPrivateCandidate
            ? "这是一条书内候选；尚未把它写入公开人生事件。"
            : "这篇作品暂未关联具体人生事件，避免将地点关联扩写为未核实的行迹。"
        }
        emptyPlaceMessage={
          isPrivateCandidate
            ? "这条候选尚未关联可展示地点；系统不会根据题名自动猜测。"
            : "暂无可展示的作品—地点关系。"
        }
        contextSupplement={contextSupplement}
      />
    </section>
  );
}

function privatePoemBookWorks(
  result: BookAnalysisResult,
  items: PoemWorldItem[],
  acceptedStoryIds: ReadonlySet<string>,
): PrivatePoemDisplayWork[] {
  return items.map((item) => {
    const work = result.draft.entities.works.find((record) => record.id === item.workId);
    const story = storyFor(result.draft, item.storyIds, acceptedStoryIds);
    return {
      id: item.id,
      itemId: item.id,
      title: work?.title ?? item.workId,
      genre: work?.genre,
      contextLabel: `书内候选 · ${item.relationType ? POEM_RELATION_LABELS[item.relationType] : "场景说明"}`,
      excerpt: story?.summary ?? excerptFor(result, item.evidenceIds),
      reader: {
        id: item.id,
        title: work?.title ?? item.workId,
        genre: work?.genre,
        contextLabel: item.relationType
          ? `作品—地点候选 · ${POEM_RELATION_LABELS[item.relationType]}`
          : "作品—地点候选",
        placeId: item.placeId,
        relationType: item.relationType ?? "mentioned-place",
        certainty: "probable",
        evidenceIds: item.evidenceIds,
        storySummary: story?.summary,
        isPrivateCandidate: true,
      },
    };
  });
}

function privatePoemReferenceWorks(
  works: BookAgentReferenceWork[],
  placeId: string,
): PrivatePoemDisplayWork[] {
  return works.map((work) => ({
    id: `reference-${work.id}`,
    title: work.title,
    genre: work.genre,
    contextLabel: `${work.origin === "chinese-poetry-match" ? "chinese-poetry" : "站内诗词"} · ${POEM_RELATION_LABELS[work.relationType]}`,
    lines: work.text.slice(0, 2),
    excerpt: work.note,
    reader: {
      id: `reference-${work.id}`,
      title: work.title,
      genre: work.genre,
      contextLabel: `${work.origin === "chinese-poetry-match" ? "chinese-poetry" : "站内诗词"} · ${POEM_RELATION_LABELS[work.relationType]}`,
      text: work.text,
      placeId: work.placeId ?? placeId,
      eventId: work.eventId,
      relationType: work.relationType,
      certainty: work.certainty ?? "probable",
      timeLabel: work.timeLabel,
      note: work.note,
    },
  }));
}

function PrivateJourneyView({
  result,
  items,
  poemWorldItems,
  acceptedStoryIds,
}: {
  result: BookAnalysisResult;
  items: JourneyItem[];
  poemWorldItems: PoemWorldItem[];
  acceptedStoryIds: ReadonlySet<string>;
}) {
  const { draft } = result;
  const stations = useMemo(() => groupJourneyStations(items), [items]);
  const [activeItemId, setActiveItemId] = useState(items[0]?.id ?? "");
  const [detailPage, setDetailPage] = useState(0);
  const [workScope, setWorkScope] = useState<"place" | "book">("place");
  const [activeReaderId, setActiveReaderId] = useState("");
  const effectiveActiveItemId = items.some((item) => item.id === activeItemId) ? activeItemId : items[0]?.id ?? "";
  const activeIndex = Math.max(0, stations.findIndex((station) => station.items.some((item) => item.id === effectiveActiveItemId)));
  const activeStation = stations[activeIndex] ?? null;
  const activeItem = activeStation?.items.find((item) => item.id === effectiveActiveItemId) ?? activeStation?.items[0] ?? null;
  const places = useMemo(() => {
    const seen = new Set<string>();
    return stations.flatMap((station) => {
      if (seen.has(station.placeId)) return [];
      const place = draft.entities.places.find((record) => record.id === station.placeId);
      if (!place) return [];
      seen.add(station.placeId);
      return [place];
    });
  }, [draft.entities.places, stations]);
  const placeById = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const mapRecords = useMemo(
    () => stations.map((station, index) => ({
      id: station.id,
      placeId: station.placeId,
      order: index + 1,
      label: placeById.get(station.placeId)?.label ?? station.placeId,
      linkedCount: station.items.length,
    })),
    [placeById, stations],
  );
  const chooseItem = useCallback((itemId: string) => {
    setActiveItemId(itemId);
    setDetailPage(0);
    setActiveReaderId("");
  }, []);
  const choosePlace = useCallback((placeId: string) => {
    const station = stations.find((record) => record.placeId === placeId);
    if (station) chooseItem(station.items[0].id);
  }, [chooseItem, stations]);
  const previous = stations[activeIndex - 1];
  const next = stations[activeIndex + 1];
  const activePlace = activeItem ? placeById.get(activeItem.placeId) : null;
  const activeStory = activeItem
    ? storyFor(draft, activeItem.storyIds, acceptedStoryIds)
    : null;
  const activeReferenceEvent = activeItem
    ? referenceEventFor(activeItem, result.references.journeyByPlace[activeItem.placeId] ?? [])
    : undefined;
  const activeReferenceWorks = activeItem
    ? privateJourneyReferenceWorks(relatedWorksFor(result, activeItem.placeId), activeItem.placeId)
    : [];
  const activeBookWorks = activeItem ? privateJourneyBookWorks(result, poemWorldItems, activeItem.placeId) : [];
  const activeReader = [...activeReferenceWorks, ...activeBookWorks]
    .find((work) => work.reader?.id === activeReaderId)?.reader;
  const visibleWorks = workScope === "place" ? activeReferenceWorks : activeBookWorks;
  const worksPageCount = Math.max(1, Math.ceil(visibleWorks.length / JOURNEY_WORKS_PER_PAGE));
  const currentWorkPage = Math.min(Math.max(detailPage, 1), worksPageCount);
  const displayedWorks = visibleWorks.slice(
    (currentWorkPage - 1) * JOURNEY_WORKS_PER_PAGE,
    currentWorkPage * JOURNEY_WORKS_PER_PAGE,
  );
  const isOverviewPage = detailPage === 0;
  const changeDetailPage = (page: number) => setDetailPage(Math.min(Math.max(page, 0), worksPageCount));
  const displayEventTitle = activeReferenceEvent?.title ?? `${JOURNEY_PREDICATE_LABELS[activeItem?.predicate ?? "visited"]}${activePlace?.label ?? "此地"}`;
  const displayEventTime = activeReferenceEvent ? referenceEventTimeLabel(activeReferenceEvent) : activeItem?.time?.label ?? "时间未定";
  const displayEventStage = activeReferenceEvent?.lifeStage ?? "书内候选";
  const displayEventRole = activeReferenceEvent?.role ?? "私有暂存";
  const displayEventSummary = activeReferenceEvent?.summary ?? activeStory?.summary ?? "这是一条来自书内证据的行迹候选，等待后续独立发布审核。";

  if (activeReader) {
    return (
      <PrivateWorkReader
        result={result}
        work={activeReader}
        onClose={() => setActiveReaderId("")}
        backLabel="返回地点诗词"
      />
    );
  }

  return (
      <JourneyStage
        ariaLabel={`${draft.poet.name}的私有行迹地图`}
        visual={
          <div className="map-stage map-stage--real">
            <PrivateLeafletMap
              places={places}
              records={mapRecords}
              activePlaceId={activeItem?.placeId ?? ""}
              ariaLabel={`${draft.poet.name}私有行迹地图`}
              onRouteRecordSelect={chooseItem}
              onPlaceSelect={choosePlace}
            />
          </div>
        }
        rail={
          <nav className="route-event-list" aria-label="私有路线事件目录">
            <div className="route-event-list-heading">
              <p>人生行程</p>
              <span>横向浏览 · {stations.length} 站{items.length > stations.length ? ` · ${items.length} 条关联` : ""}</span>
            </div>
            {stations.length ? (
              <ol>
                {stations.map((station, index) => {
                  const place = placeById.get(station.placeId);
                  const isActive = station.items.some((item) => item.id === effectiveActiveItemId);
                  return (
                    <li key={station.id}>
                      <button
                        type="button"
                        className={isActive ? "is-active" : ""}
                        aria-current={isActive ? "step" : undefined}
                        onClick={() => chooseItem(station.items[0].id)}
                      >
                        <span className="route-event-order">{index + 1}</span>
                        <span className="route-event-copy">
                          <strong>{place?.label ?? "地点待补充"}</strong>
                          <span>{journeyStationSummary(station)}</span>
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
          <aside className="detail-panel" aria-live="polite" aria-label="当前私有行迹节点">
            {stations.length > 1 ? (
              <nav className="route-step-controls" aria-label="前后浏览私有路线节点">
                <button type="button" onClick={() => previous && chooseItem(previous.items[0].id)} disabled={!previous}>
                  <span className="route-step-arrow" aria-hidden="true">←</span>
                  <span className="route-step-copy"><small>上一站</small><strong>{previous ? placeById.get(previous.placeId)?.label : "旅程起点"}</strong></span>
                </button>
                <div className="route-progress"><span>人生行程</span><strong>{String(activeIndex + 1).padStart(2, "0")}<i>/</i>{String(stations.length).padStart(2, "0")}</strong></div>
                <button type="button" onClick={() => next && chooseItem(next.items[0].id)} disabled={!next}>
                  <span className="route-step-copy"><small>下一站</small><strong>{next ? placeById.get(next.placeId)?.label : "旅程终点"}</strong></span>
                  <span className="route-step-arrow" aria-hidden="true">→</span>
                </button>
              </nav>
            ) : null}
            <div className={`detail-page-content${isOverviewPage ? "" : " detail-page-content--works"}`}>
              {isOverviewPage ? (
                activeItem ? (
                  <article className="story-card">
                    <header className="story-card-header">
                      <div>
                        <p className="story-card-kicker">第 {activeIndex + 1} 站 · {activePlace?.label ?? "地点待补充"}</p>
                        <h3>{displayEventTitle}</h3>
                      </div>
                      <span className="review-badge review-badge--draft">私有暂存</span>
                    </header>
                    <div className="story-meta">
                      <span>{displayEventTime}</span>
                      <span>{displayEventStage}</span>
                      <span>{displayEventRole}</span>
                    </div>
                    <p className="story-summary">{displayEventSummary}</p>
                    {activeStation && activeStation.items.length > 1 ? (
                      <section className="private-journey-related" aria-label="同一地点的关联候选">
                        <div className="private-journey-related__heading">
                          <span>同一地点的关联候选</span>
                          <strong>{activeStation.items.length}</strong>
                        </div>
                        <ul>
                          {activeStation.items.map((item, index) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                className={item.id === effectiveActiveItemId ? "is-active" : ""}
                                aria-current={item.id === effectiveActiveItemId ? "true" : undefined}
                                onClick={() => chooseItem(item.id)}
                              >
                                <span>{index + 1}</span>
                                <span>
                                  <strong>{item.time?.label ?? "时间未定"}</strong>
                                  <small>{JOURNEY_PREDICATE_LABELS[item.predicate]}</small>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                    <PrivateEvidenceNote result={result} evidenceIds={activeItem.evidenceIds} />
                  </article>
                ) : (
                  <article className="story-card empty-story"><h3>暂无已通过的行迹节点</h3><p>请先审核至少一条行迹候选。</p></article>
                )
              ) : (
                <section className="works-section works-section--page" aria-labelledby="private-works-heading">
                  <div className="section-heading compact-heading">
                    <div><h3 id="private-works-heading">{workScope === "place" ? `${activePlace?.label ?? "此地"} · 地点诗词` : `${draft.poet.name} · 书内作品`}</h3></div>
                    <span className="work-count">{workScope === "place" ? `此地 ${activeReferenceWorks.length} 篇` : `书内 ${activeBookWorks.length} 篇`}</span>
                  </div>
                  <div className="work-scope-switch" role="group" aria-label="私有作品浏览范围">
                    <button type="button" className={workScope === "place" ? "is-active" : ""} aria-pressed={workScope === "place"} onClick={() => { setWorkScope("place"); setDetailPage(1); }}>此地诗词 <span>{activeReferenceWorks.length}</span></button>
                    <button type="button" className={workScope === "book" ? "is-active" : ""} aria-pressed={workScope === "book"} onClick={() => { setWorkScope("book"); setDetailPage(1); }}>书内作品 <span>{activeBookWorks.length}</span></button>
                  </div>
                  <div className="work-library-results">
                    {!visibleWorks.length ? <p className="work-library-status">当前范围暂无可显示的作品资料。</p> : null}
                    <div className="work-list work-list--fixed">
                      {displayedWorks.map((work) => (
                        <PrivateJourneyWorkEntry
                          key={work.id}
                          work={work}
                          onOpenReader={(reader) => setActiveReaderId(reader.id)}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </div>
            {isOverviewPage ? (
              <button
                type="button"
                className={`open-works-button${!activeReferenceWorks.length && !activeBookWorks.length ? " open-works-button--empty" : ""}`}
                onClick={() => {
                  setWorkScope(activeReferenceWorks.length ? "place" : "book");
                  setDetailPage(1);
                }}
              >
                <span><small>作品与地点</small><strong>{activePlace?.label ?? "此地"}诗词</strong></span>
                <span className="open-works-summary">{activeReferenceWorks.length || activeBookWorks.length} 篇<i aria-hidden="true">→</i></span>
              </button>
            ) : (
              <nav className="detail-pagination" aria-label="私有作品分页">
                <button type="button" onClick={() => changeDetailPage(detailPage - 1)}>{detailPage === 1 ? "← 返回故事" : "← 上一组"}</button>
                <span>作品 {currentWorkPage} / {worksPageCount}</span>
                <button type="button" onClick={() => changeDetailPage(detailPage + 1)} disabled={currentWorkPage === worksPageCount}>下一组 →</button>
              </nav>
            )}
          </aside>
        }
      />
  );
}

function PrivatePoemWorldView({
  result,
  items,
  acceptedStoryIds,
}: {
  result: BookAnalysisResult;
  items: PoemWorldItem[];
  acceptedStoryIds: ReadonlySet<string>;
}) {
  const { draft } = result;
  const referencePlaceIds = Object.keys(result.references.worksByPlace);
  const initialPlaceId = items[0]?.placeId ?? referencePlaceIds[0] ?? "";
  const [activePlaceId, setActivePlaceId] = useState(initialPlaceId);
  const [activeBookItemId, setActiveBookItemId] = useState(items[0]?.id ?? "");
  const [activeReaderId, setActiveReaderId] = useState("");
  const [showAllWorks, setShowAllWorks] = useState(false);

  const places = useMemo(() => {
    const placeIds = new Set([...items.flatMap((item) => item.placeId ? [item.placeId] : []), ...referencePlaceIds]);
    return draft.entities.places.filter((place) => placeIds.has(place.id));
  }, [draft.entities.places, items, referencePlaceIds]);
  const placeById = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const mapRecords = useMemo(
    () => [
      ...items.flatMap((item, index) => item.placeId ? [{
        id: item.id,
        placeId: item.placeId,
        order: index + 1,
        label: draft.entities.works.find((work) => work.id === item.workId)?.title ?? item.workId,
        linkedCount: 1,
      }] : []),
      ...referencePlaceIds.flatMap((placeId, placeIndex) => relatedWorksFor(result, placeId).map((work, workIndex) => ({
        id: `reference-${placeId}-${work.id}`,
        placeId,
        order: items.length + placeIndex + workIndex + 1,
        label: work.title,
        linkedCount: 1,
      }))),
    ],
    [draft.entities.works, items, referencePlaceIds, result],
  );
  const effectiveActivePlaceId = places.some((place) => place.id === activePlaceId) ? activePlaceId : places[0]?.id ?? "";
  const activePlace = effectiveActivePlaceId ? placeById.get(effectiveActivePlaceId) : null;
  const activeItems = items.filter((item) => item.placeId === effectiveActivePlaceId);
  const activeItem = activeItems.find((item) => item.id === activeBookItemId) ?? activeItems[0] ?? null;
  const activePlaceStory = storyFor(
    draft,
    activeItems.flatMap((item) => item.storyIds),
    acceptedStoryIds,
  );
  const bookWorks = privatePoemBookWorks(result, activeItems, acceptedStoryIds);
  const referenceWorks = effectiveActivePlaceId
    ? privatePoemReferenceWorks(relatedWorksFor(result, effectiveActivePlaceId), effectiveActivePlaceId)
    : [];
  const displayWorks = [...bookWorks, ...referenceWorks];
  const visibleWorks = showAllWorks ? displayWorks : displayWorks.slice(0, POEM_WORLD_LINK_LIMIT);
  const activeReader = displayWorks.find((work) => work.reader?.id === activeReaderId)?.reader;

  const choosePlace = useCallback((placeId: string) => {
    const item = items.find((record) => record.placeId === placeId);
    setActivePlaceId(placeId);
    setActiveBookItemId(item?.id ?? "");
    setActiveReaderId("");
    setShowAllWorks(false);
  }, [items]);

  if (activeReader) {
    return (
      <PrivateWorkReader
        result={result}
        work={activeReader}
        onClose={() => setActiveReaderId("")}
        backLabel="返回地点作品"
      />
    );
  }

  return (
      <ContextAtlasStage
        ariaLabel="私有诗境地点地图"
        visual={
          <div className="poem-map-wrap poem-world-map-stage">
            <PrivateLeafletMap
              places={places}
              records={mapRecords}
              activePlaceId={effectiveActivePlaceId}
              ariaLabel="私有诗境地点地图（圆点代表已审核作品—地点候选）"
              connectRoute={false}
              markerMode="poem"
              onPlaceSelect={choosePlace}
            />
          </div>
        }
        context={
          <LocationStoryDirectory
            title="区域注解"
            note="圆点同时汇集书内候选、站内已核定作品—地点关系与 chinese-poetry 匹配；作品空间不自动等同于人物到访。"
            ariaLabel="私有诗境区域注解"
            locations={places.map((place) => ({
              id: place.id,
              label: place.label,
              storyCount: items.filter((item) => item.placeId === place.id).length + relatedWorksFor(result, place.id).length,
              detail: "篇",
            }))}
            activeLocationId={effectiveActivePlaceId}
            onSelect={choosePlace}
          />
        }
        inspector={
          <aside className="detail-panel poem-world-panel" aria-live="polite" aria-label="当前私有诗境地点">
            <div className="detail-page-content poem-world-detail-scroller">
              {activePlace ? (
                <>
                  <p className="eyebrow">{activePlace.mapKind === "region" ? "区域" : "地点"}</p>
                  <h2>{activePlace.label}</h2>
                  {activePlace.modernName ? <p className="place-modern-name">今：{activePlace.modernName}</p> : null}
                  <p className="place-intro">{activePlaceStory?.summary ?? "这里将书内候选与可核对的作品—地点资料放在同一阅读序列中。"}</p>
                  <p className="evidence-note">书内候选 {bookWorks.length} 篇；站内已核定或 chinese-poetry 关联 {referenceWorks.length} 篇。作品空间不自动等同于人物到访或精确创作地；坐标仅作现代展示近似。</p>
                  <h3>写到这里的作品</h3>
                  <ul className="poem-link-list">
                    {visibleWorks.map((work) => (
                      <PoemWorldWorkCard
                        key={work.id}
                        work={work}
                        onSelect={
                          work.reader
                            ? () => {
                              if (work.itemId) setActiveBookItemId(work.itemId);
                              setActiveReaderId(work.reader?.id ?? "");
                            }
                            : undefined
                        }
                        selected={work.reader?.id === activeReaderId || work.itemId === activeItem?.id}
                      />
                    ))}
                  </ul>
                  {displayWorks.length > POEM_WORLD_LINK_LIMIT ? <button type="button" className="link-expand" onClick={() => setShowAllWorks((current) => !current)}>{showAllWorks ? "收起列表" : `显示全部 ${displayWorks.length} 篇`}</button> : null}
                </>
              ) : (
                <div className="panel-hint"><p className="eyebrow">诗境图</p><h2>从地图开始</h2><p>点击地图地点或下方地点索引，查看私有作品空间。</p></div>
              )}
            </div>
          </aside>
        }
      />
  );
}

type PrivateGraphNode = {
  id: string;
  name: string;
  degree: number;
  x: number;
  y: number;
  isAnchor: boolean;
};

type PrivateBookGraphLink = SocialEdge & {
  sourceKind: "book";
  sourceNode: PrivateGraphNode;
  targetNode: PrivateGraphNode;
};

type PrivateGraphLink = PrivateBookGraphLink;

function relationLabels(edge: Pick<SocialEdge, "relationTypes">): string {
  return edge.relationTypes.map((type) => SOCIAL_RELATION_LABELS[type]).join(" · ");
}

function peoplePairKey(
  edge: Pick<SocialEdge, "sourcePersonId" | "targetPersonId">,
): string {
  return edge.sourcePersonId < edge.targetPersonId
    ? `${edge.sourcePersonId}|${edge.targetPersonId}`
    : `${edge.targetPersonId}|${edge.sourcePersonId}`;
}

function samePeopleConnection(
  left: Pick<SocialEdge, "sourcePersonId" | "targetPersonId">,
  right: Pick<BookAgentReferenceSocialConnection, "sourcePersonId" | "targetPersonId">,
): boolean {
  return peoplePairKey(left) === peoplePairKey(right);
}

function PrivateSocialView({
  result,
  edges,
  referenceEdges,
  acceptedStoryIds,
}: {
  result: BookAnalysisResult;
  edges: SocialEdge[];
  referenceEdges: BookAgentReferenceSocialConnection[];
  acceptedStoryIds: ReadonlySet<string>;
}) {
  const { draft } = result;
  const [selectedId, setSelectedId] = useState(draft.poet.id);
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [hoveredEdgeId, setHoveredEdgeId] = useState("");
  const [query, setQuery] = useState("");
  const [bucketFilter, setBucketFilter] = useState("");
  const [zoom, setZoom] = useState(1);

  const graph = useMemo(() => {
    const peopleById = new Map(draft.entities.people.map((person) => [person.id, person]));
    // The graph is text-first: only approved, book-backed edges can create a
    // node or a line. Matching CBDB records remain detail-panel comparisons.
    const nodeIds = new Set<string>([draft.poet.id]);
    for (const edge of edges) {
      nodeIds.add(edge.sourcePersonId);
      nodeIds.add(edge.targetPersonId);
    }
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.sourcePersonId, (degree.get(edge.sourcePersonId) ?? 0) + 1);
      degree.set(edge.targetPersonId, (degree.get(edge.targetPersonId) ?? 0) + 1);
    }
    const nodes: PrivateGraphNode[] = [...nodeIds].map((id) => ({
      id,
      name: peopleById.get(id)?.name ?? id,
      degree: degree.get(id) ?? 0,
      x: 0,
      y: 0,
      isAnchor: id === draft.poet.id,
    }));
    arrangeKnowledgeGraph(nodes, {
      anchorId: draft.poet.id,
      width: 1600,
      height: 1000,
      clusterForNode: (node) => {
        const related = edges
          .filter((edge) => edge.sourcePersonId === node.id || edge.targetPersonId === node.id)
          .flatMap((edge) => edge.relationTypes);
        return related.map((type) => SOCIAL_CLUSTER_FOR_RELATION[type] ?? "other").find((cluster) => cluster !== "other") ?? "other";
      },
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const bookLinks = edges.flatMap((edge) => {
      const sourceNode = byId.get(edge.sourcePersonId);
      const targetNode = byId.get(edge.targetPersonId);
      return sourceNode && targetNode ? [{ ...edge, sourceKind: "book" as const, sourceNode, targetNode }] : [];
    });
    return { nodes, links: bookLinks, byId };
  }, [draft.entities.people, draft.poet.id, edges]);

  const relationBuckets = useMemo(
    () => [...new Set(graph.links.flatMap((edge) => edge.relationTypes))],
    [graph.links],
  );
  const presentationEdges = useMemo(
    () => bucketFilter ? graph.links.filter((edge) => edge.relationTypes.includes(bucketFilter as SocialEdge["relationTypes"][number])) : graph.links,
    [bucketFilter, graph.links],
  );
  const selectedPerson = graph.byId.get(selectedId) ?? null;
  const selectedPersonEdges = useMemo(
    () => selectedId
      ? graph.links.filter((edge) => edge.sourcePersonId === selectedId || edge.targetPersonId === selectedId)
      : [],
    [graph.links, selectedId],
  );
  const queryMatches = query.trim() ? graph.nodes.filter((node) => node.name.includes(query.trim())).slice(0, 8) : [];
  const connectedToSelected = new Set(selectedPersonEdges.map((edge) => edge.id));
  const focusedEdgeIds = selectedEdgeId ? new Set([selectedEdgeId]) : connectedToSelected;
  const directEdgeCount = graph.links.filter((edge) => edge.sourcePersonId === draft.poet.id || edge.targetPersonId === draft.poet.id).length;
  const bridgeEdgeCount = graph.links.length - directEdgeCount;
  const isAnchorOverview = Boolean(selectedPerson?.isAnchor && !selectedEdgeId);
  const readerPeopleById = useMemo<ReadonlyMap<string, RelationshipStoryPerson>>(
    () => new Map(graph.nodes.map((node) => [node.id, {
      id: node.id,
      name: node.name,
      birthYear: null,
      deathYear: null,
      degree: node.degree,
      isAnchor: node.isAnchor,
    }])),
    [graph.nodes],
  );
  const readerLinks = useMemo<RelationshipStoryLink[]>(
    () => selectedPersonEdges.map((edge) => ({
      id: edge.id,
      source: edge.sourcePersonId,
      target: edge.targetPersonId,
      displayBuckets: edge.relationTypes,
      bucketCounts: Object.fromEntries(edge.relationTypes.map((relationType) => [relationType, 1])),
      confidence: "possible",
      evidenceCount: edge.evidenceIds.length,
      titleSignalCount: 0,
      years: {
        startYear: edge.time?.startYear ?? null,
        endYear: edge.time?.endYear ?? null,
        precision: edge.time?.precision ?? "unknown",
      },
    })),
    [selectedPersonEdges],
  );
  const referenceEdgesByPair = useMemo(
    () => new Map(referenceEdges.map((edge) => [peoplePairKey(edge), edge])),
    [referenceEdges],
  );
  const readerPilots = useMemo<RelationshipStoryPilot[]>(
    () => graph.links.map((edge) => {
      const otherPersonId = edge.sourcePersonId === draft.poet.id ? edge.targetPersonId : edge.sourcePersonId;
      const storyEvents = edge.storyIds.flatMap((storyId) => {
        const story = storyFor(draft, [storyId], acceptedStoryIds);
        return story ? [{
          id: story.id,
          title: story.title,
          summary: story.summary,
          sourceRefs: [],
          reviewStatus: "approved-private-preview",
        }] : [];
      });
      const sourceEvent = {
        id: `${edge.id}-source`,
        title: `书内原文 · ${evidenceLabel(result, edge.evidenceIds)}`,
        summary: `“${excerptFor(result, edge.evidenceIds)}”`,
        sourceRefs: [],
        reviewStatus: "approved-private-preview" as const,
      };
      const bookReference = referenceEdgesByPair.get(peoplePairKey(edge));
      const comparisonEvent = bookReference ? [{
        id: `${edge.id}-comparison`,
        title: "CBDB 对照",
        summary: `${bookReference.evidenceCount} 条关联记录 · ${bookReference.sourceIds.join("、") || "CBDB"}`,
        sourceRefs: bookReference.sourceIds.map((sourceId) => ({ sourceId })),
        reviewStatus: "reference",
      }] : [];
      return {
        id: `private-reader-${edge.id}`,
        edgeId: edge.id,
        otherPersonId,
        otherName: graph.byId.get(otherPersonId)?.name ?? otherPersonId,
        reviewState: "approved-private-preview",
        events: [...storyEvents, sourceEvent, ...comparisonEvent],
      };
    }),
    [acceptedStoryIds, draft, graph.byId, graph.links, referenceEdgesByPair, result],
  );
  const overviewProfile = useMemo<PoetOverviewProfile>(() => {
    const person = draft.entities.people.find((record) => record.id === draft.poet.id);
    return {
      id: draft.poet.id,
      name: draft.poet.name,
      aliases: person?.aliases,
      intro: "本页只保留上传书籍中经审核通过、可回读原文的关系候选；已核定生平资料与 CBDB 仅作为对应关系的对照，不会自行生成关系边。",
      sourceRefs: result.references.sources.filter((source) => source.available).map((source) => ({ sourceId: source.id })),
      reviewStatus: "published",
    };
  }, [draft.entities.people, draft.poet.id, draft.poet.name, result.references.sources]);
  const overviewEvents = useMemo<PoetOverviewEvent[]>(
    () => Object.values(result.references.journeyByPlace).flat().slice(0, 6).map((event) => ({
      id: event.id,
      title: event.title,
      summary: event.summary,
      sourceRefs: event.sourceIds.map((sourceId) => ({ sourceId })),
      reviewStatus: "published",
    })),
    [result.references.journeyByPlace],
  );

  const zoomIn = useCallback(() => setZoom((current) => Math.min(2.4, current * 1.18)), []);
  const zoomOut = useCallback(() => setZoom((current) => Math.max(0.55, current / 1.18)), []);
  const chooseNode = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedEdgeId("");
  }, []);
  const chooseEdge = useCallback((edge: PrivateGraphLink) => {
    setSelectedEdgeId(edge.id);
    setSelectedId(edge.sourcePersonId === draft.poet.id ? edge.targetPersonId : edge.sourcePersonId);
  }, [draft.poet.id]);

  return (
      <SocialGraphStage>
        <section className="social-graph" aria-label={`${draft.poet.name}私有交游圈知识图谱`}>
          <div className="social-graph-tools">
            <label className="social-search">
              <span className="sr-only">搜索人物</span>
              <input type="search" value={query} placeholder="搜索人物姓名…" onChange={(event) => setQuery(event.target.value)} aria-label="搜索私有人物姓名" />
              {queryMatches.length ? <ul className="social-search-results">{queryMatches.map((node) => <li key={node.id}><button type="button" onClick={() => { chooseNode(node.id); setQuery(""); }}><strong>{node.name}</strong><span>{node.degree} 对关系</span></button></li>)}</ul> : null}
            </label>
            <label className="social-bucket-filter">
              <span className="sr-only">关系类型</span>
              <select value={bucketFilter} aria-label="按私有关系类型筛选" onChange={(event) => { setBucketFilter(event.target.value); setSelectedEdgeId(""); }}>
                <option value="">全部关系 · {graph.links.length} 条</option>
                {relationBuckets.map((bucket) => <option key={bucket} value={bucket}>{SOCIAL_RELATION_LABELS[bucket]} · {graph.links.filter((edge) => edge.relationTypes.includes(bucket)).length}</option>)}
              </select>
            </label>
            <div className="social-graph-line-key" aria-label="关系图说明">
              <span><i aria-hidden="true" />与{draft.poet.name}直接往来 · {directEdgeCount}</span>
              <span><i className="is-bridge" aria-hidden="true" />选择人物后显示圈内往来 · {bridgeEdgeCount}</span>
            </div>
          </div>

          <section className="social-mobile-directory" aria-label="私有交游人物列表">
            <div className="social-mobile-directory-heading">
              <strong>人物索引</strong>
              <span>点击人物查看关系与证据</span>
            </div>
            <ul>
              {graph.nodes
                .slice()
                .sort((left, right) => Number(right.isAnchor) - Number(left.isAnchor) || right.degree - left.degree || left.name.localeCompare(right.name, "zh-CN"))
                .map((node) => (
                  <li key={node.id}>
                    <button type="button" className={selectedId === node.id ? "is-active" : ""} aria-pressed={selectedId === node.id} onClick={() => chooseNode(node.id)}>
                      <strong>{node.name}</strong>
                      <span>{node.isAnchor ? "中心人物" : "圈内人物"}</span>
                      <small>{node.degree} 对关系</small>
                    </button>
                  </li>
                ))}
            </ul>
          </section>

          <svg className="social-svg" viewBox="0 0 1600 1000" role="application" aria-label={`私有交游圈知识图谱：${graph.nodes.length} 位人物、${presentationEdges.length} 对关系`}>
            <g transform={`translate(${800 * (1 - zoom)} ${500 * (1 - zoom)}) scale(${zoom})`}>
              {presentationEdges.map((edge) => {
                const geometry = knowledgeGraphStraightLinkGeometry(edge.sourceNode, edge.targetNode);
                const bridge = !edge.sourceNode.isAnchor && !edge.targetNode.isAnchor;
                const focused = focusedEdgeIds.has(edge.id);
                const showLabel = selectedEdgeId === edge.id || hoveredEdgeId === edge.id;
                const label = relationLabels(edge);
                const labelWidth = Math.max(58, label.length * 14 + 16);
                return (
                  <g key={edge.id} className="kg-edge-interactive" role="button" tabIndex={0} aria-label={`打开${edge.sourceNode.name}与${edge.targetNode.name}的书内关系`} onClick={() => chooseEdge(edge)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseEdge(edge); } }} onPointerEnter={() => setHoveredEdgeId(edge.id)} onPointerLeave={() => setHoveredEdgeId((current) => current === edge.id ? "" : current)}>
                    <path className="kg-edge-hit-area" d={geometry.path} fill="none" stroke="transparent" strokeWidth="24" pointerEvents="stroke" />
                    <path className={`kg-edge${bridge ? " is-bridge" : ""}${focused ? " is-focused" : ""}`} d={geometry.path} stroke="#343b3d" strokeWidth={focused ? 2.2 : 1.5} strokeOpacity={focused ? 0.86 : bridge ? 0.42 : 0.68} />
                    {showLabel ? <g className="kg-edge-label"><rect x={geometry.labelX - labelWidth / 2} y={geometry.labelY - 13} width={labelWidth} height="24" rx="4" /><text x={geometry.labelX} y={geometry.labelY + 5} textAnchor="middle">{label}</text></g> : null}
                  </g>
                );
              })}
              {graph.nodes.map((node) => {
                const size = knowledgeGraphCardSize(node.name);
                const queryDimmed = Boolean(query.trim() && !node.name.includes(query.trim()));
                const focusDimmed = Boolean(selectedId && selectedId !== node.id && !selectedPersonEdges.some((edge) => edge.sourcePersonId === node.id || edge.targetPersonId === node.id));
                const isSelected = selectedId === node.id;
                return (
                  <g key={node.id} className={`kg-node kg-node-card${node.isAnchor ? " is-target" : ""}${queryDimmed || focusDimmed ? " is-dimmed" : ""}`} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} aria-label={`选择${node.name}`} onClick={(event) => { event.stopPropagation(); chooseNode(node.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseNode(node.id); } }}>
                    {node.isAnchor ? (
                      <circle className="kg-node-card-shape" r={isSelected ? 52 : 48} fill={isSelected ? "#f6e6ab" : "#d9b7dc"} stroke="#343b3d" strokeWidth={isSelected ? 3 : 2} />
                    ) : (
                      <rect className="kg-node-card-shape" x={-size.width / 2} y={-size.height / 2} width={size.width} height={size.height} rx="8" fill={isSelected ? "#f6e6ab" : "#c7e6e7"} stroke="#343b3d" strokeWidth={isSelected ? 3 : 2} />
                    )}
                    {isSelected ? (node.isAnchor ? <circle r="57" fill="none" stroke="#a33a2c" strokeWidth="1.6" strokeDasharray="4 4" /> : <rect x={-size.width / 2 - 5} y={-size.height / 2 - 5} width={size.width + 10} height={size.height + 10} rx="11" fill="none" stroke="#a33a2c" strokeWidth="1.5" strokeDasharray="4 4" />) : null}
                    <text className="kg-node-card-label" textAnchor="middle" y={node.isAnchor ? 7 : 5}>{node.name}</text>
                  </g>
                );
              })}
            </g>
          </svg>
          <GraphZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} />
          <details className="social-provenance">
            <summary>数据说明</summary>
            <p>关系边仅来自上传书籍中可回读的原文候选；CBDB 只在同一人物对已有书内关系时提供对照，不会单独上图。</p>
          </details>
        </section>
        {selectedPerson && (isAnchorOverview ? (
          <PoetOverviewPanel
            fallbackName={draft.poet.name}
            profile={overviewProfile}
            events={overviewEvents}
            sourceTitles={{ "published-events": "站内生平资料", "chinese-poetry": "chinese-poetry 作品语料", cbdb: "CBDB 关系资料" }}
            statusLabel="私有暂存"
            onClose={() => { setSelectedEdgeId(""); setSelectedId(""); }}
          />
        ) : (
          <RelationshipStoryPanel
            key={`${selectedPerson.id}:${selectedEdgeId}`}
            anchorId={draft.poet.id}
            anchorName={draft.poet.name}
            selectedPerson={readerPeopleById.get(selectedPerson.id) ?? {
              id: selectedPerson.id,
              name: selectedPerson.name,
              birthYear: null,
              deathYear: null,
              degree: selectedPerson.degree,
              isAnchor: selectedPerson.isAnchor,
            }}
            peopleById={readerPeopleById}
            relationships={readerLinks}
            relationshipLabels={SOCIAL_RELATION_LABELS}
            pilotStories={readerPilots}
            requestedStoryId={selectedEdgeId}
            evidenceSectionLabel="书内候选证据"
            evidenceSectionNote="原文与 CBDB 对照"
            pilotStoryLabel="可回读的书内候选证据与 CBDB 对照"
            onClose={() => { setSelectedEdgeId(""); setSelectedId(""); }}
          />
        ))}
      </SocialGraphStage>
  );
}

export function BookAgentPrivateViews({
  result,
  manifest,
  activeView,
  onBackToReview,
  onReset,
  onDownload,
}: PrivateViewsProps) {
  const acceptedConnectionIds = manifestIds(manifest, "acceptedConnectionIds");
  const acceptedStoryIds = manifestIds(manifest, "acceptedStoryIds");
  const journeyItems = result.draft.volumes.journey.items.filter((item) => acceptedConnectionIds.has(item.id));
  const poemWorldItems = result.draft.volumes.poemWorld.items.filter((item) => acceptedConnectionIds.has(item.id));
  const socialEdges = result.draft.volumes.social.edges.filter((item) => acceptedConnectionIds.has(item.id));
  const socialPairs = new Set(socialEdges.map(peoplePairKey));
  const socialReferenceEdges = result.references.socialEdges.filter((reference) =>
    socialPairs.has(peoplePairKey(reference)),
  );
  const { draft } = result;
  const header = PRIVATE_VIEW_LABELS[activeView];
  const headerSubtitle = activeView === "journey"
    ? `按时间与地点读${draft.poet.name}的一生`
    : header.subtitle;
  const journeyStations = activeView === "journey"
    ? groupJourneyStations(journeyItems)
    : [];
  const summary = activeView === "journey"
    ? `${journeyStations.length} 个路径站点 · ${journeyItems.length} 条关联 · ${new Set(journeyItems.map((item) => item.placeId)).size} 处地点`
    : activeView === "poemWorld"
      ? `${poemWorldItems.length} 条诗—地关联 · ${new Set(poemWorldItems.map((item) => item.placeId)).size} 处地点`
      : `${new Set([draft.poet.id, ...socialEdges.flatMap((edge) => [edge.sourcePersonId, edge.targetPersonId])]).size} 位人物 · ${socialEdges.length} 条书内关系`;

  return (
    <>
      <ReadingModuleHeader
        title={header.label}
        subtitle={`：${headerSubtitle}`}
        className={activeView === "social" ? "social-page-header" : undefined}
        controls={
          <div className={styles.privatePreviewControls}>
            <p>
              <strong>{draft.poet.name}</strong>
              <span>{summary} · 私有预览</span>
            </p>
            <div>
              <button type="button" onClick={onBackToReview}>返回审核</button>
              <button type="button" onClick={onReset}>重新上传</button>
              <button type="button" onClick={onDownload}>下载 JSON</button>
            </div>
          </div>
        }
      />
      <div id={`private-${activeView}-panel`} className={styles.privatePreviewStage} role="tabpanel" aria-label={header.label}>
        {activeView === "journey" ? <PrivateJourneyView result={result} items={journeyItems} poemWorldItems={poemWorldItems} acceptedStoryIds={acceptedStoryIds} /> : null}
        {activeView === "poemWorld" ? <PrivatePoemWorldView result={result} items={poemWorldItems} acceptedStoryIds={acceptedStoryIds} /> : null}
        {activeView === "social" ? <PrivateSocialView result={result} edges={socialEdges} referenceEdges={socialReferenceEdges} acceptedStoryIds={acceptedStoryIds} /> : null}
      </div>
    </>
  );
}
