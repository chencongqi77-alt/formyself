"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMapInstance } from "leaflet";

import { SiteNav } from "../components/SiteNav";
import { PersonSwitcher } from "../components/PersonSwitcher";
import { ContextAtlasStage, ReadingModuleHeader } from "../components/ReadingModuleTemplate";
import { LocationStoryDirectory } from "../components/LocationStoryDirectory";
import { PoemWorldWorkCard } from "../components/PoemWorldWorkCard";
import { loadJson } from "../../lib/loadJson";
import { addChineseVectorBasemap } from "../../lib/chineseVectorBasemap";
import type { MapTileStatus, ResilientTilesHandle } from "../../lib/mapTileLayers";
import { poemWorldMarkerVisual } from "../../lib/poem-world-map-visual";
import { poemWorldDisplayExcerpt } from "../../lib/poem-world-display";
import {
  DEFAULT_POEM_WORLD_PLACE_ID,
  DEFAULT_POEM_WORLD_SPOTLIGHT_ZOOM,
  poemWorldSpotlightFor,
  selectPoemWorldDefaultPlaceId,
  type PoemWorldSpotlightWork,
} from "../../lib/poem-world-spotlight";

type PoemWorldPlace = {
  id: string;
  name: string;
  historicalNames: string[];
  modernName: string;
  placeCategory: string;
  mapPrecision: string;
  coordinate: { x: number; y: number; displayOnly: boolean } | null;
  intro: string;
  ambiguous: boolean;
};

type PoemWorldLink = {
  workId: string;
  workTitle: string;
  genre: string;
  personId: string;
  placeId: string;
  relationType: "describes-place" | "mentioned-place";
  matchedAlias: string | null;
  excerpt: string;
  openingLine?: string;
};

type Person = {
  id: string;
  name: string;
  dynasty?: string;
};

type LinksPayload = {
  pointLinks: PoemWorldLink[];
  regionLinks: PoemWorldLink[];
  counts: { point: number; region: number; flaggedStrictGate: number };
  ambiguousAliases: { alias: string; placeIds: string[] }[];
};

type PlacesPayload = {
  places: PoemWorldPlace[];
};

type PageData = {
  places: PoemWorldPlace[];
  links: LinksPayload;
  people: Person[];
  corpusIndex?: {
    people?: Record<string, { name?: string }>;
  };
};

const categoryLabels: Record<string, string> = {
  city: "城邑",
  prefecture: "州府",
  county: "县邑",
  mountain: "山岳",
  river: "江河",
  lake: "湖泽",
  building: "楼阁",
  pass: "关隘",
  temple: "寺观",
  gorge: "峡谷",
  region: "区域",
};

const relationLabels: Record<PoemWorldLink["relationType"], string> = {
  "describes-place": "题名提及",
  "mentioned-place": "正文提及",
};

const linkLimit = 20;
// The grouped overview is useful at country scale.  Switch to the lighter
// individual dots one zoom level sooner so manual zooming does not linger on
// a field of large count badges.
const poemWorldOverviewZoom = 5;
const poemWorldClusterCellSize = 58;

type MapPlaceCluster = {
  places: PoemWorldPlace[];
  center: [number, number];
  totalWorks: number;
};

function placeLatLng(place: PoemWorldPlace): [number, number] | null {
  if (!place.coordinate) return null;
  return [place.coordinate.y, place.coordinate.x];
}

// At a country-level view, a geographic grid is not enough: nearby places in
// eastern China can still land on the same few screen pixels. Group by the
// projected screen grid so each overview marker has a clear, readable target.
function clusterPlacesForOverview(
  map: LeafletMapInstance,
  places: PoemWorldPlace[],
  placeWorkCounts: Map<string, number>,
): MapPlaceCluster[] {
  const buckets = new Map<string, PoemWorldPlace[]>();

  for (const place of places) {
    const latLng = placeLatLng(place);
    if (!latLng) continue;
    const point = map.project(latLng, map.getZoom());
    const key =
      Math.floor(point.x / poemWorldClusterCellSize) +
      ":" +
      Math.floor(point.y / poemWorldClusterCellSize);
    const bucket = buckets.get(key) ?? [];
    bucket.push(place);
    buckets.set(key, bucket);
  }

  return [...buckets.values()].map((placesInCluster) => {
    let latitude = 0;
    let longitude = 0;
    let totalWorks = 0;

    for (const place of placesInCluster) {
      const latLng = placeLatLng(place);
      if (latLng) {
        latitude += latLng[0];
        longitude += latLng[1];
      }
      totalWorks += placeWorkCounts.get(place.id) ?? 0;
    }

    return {
      places: placesInCluster,
      center: [
        latitude / placesInCluster.length,
        longitude / placesInCluster.length,
      ],
      totalWorks,
    };
  });
}

function SpotlightWorkCard({
  work,
  href,
}: {
  work: PoemWorldSpotlightWork;
  href?: string;
}) {
  return (
    <PoemWorldWorkCard
      work={{
        id: work.id,
        title: work.title,
        genre: work.genre,
        contextLabel: `${work.personName} · ${work.contextLabel}`,
        lines: work.lines,
      }}
      href={href}
    />
  );
}

function PoemWorldLinkCard({
  link,
  personName,
  relationLabel,
  href,
}: {
  link: PoemWorldLink;
  personName: string;
  relationLabel: string;
  href: string;
}) {
  const displayExcerpt = poemWorldDisplayExcerpt(link);

  return (
    <PoemWorldWorkCard
      work={{
        id: link.workId,
        title: link.workTitle,
        genre: link.genre,
        contextLabel: `${personName} · ${relationLabel}${link.matchedAlias ? `（${link.matchedAlias}）` : ""}`,
        excerpt: displayExcerpt,
      }}
      href={href}
    />
  );
}

export default function PoemWorldPage() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const layerGroupRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const tilesRef = useRef<ResilientTilesHandle | null>(null);
  const fittedSignatureRef = useRef("");

  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapStatus, setMapStatus] = useState<MapTileStatus | null>(null);
  const [mapZoom, setMapZoom] = useState(4);
  const [activePlaceId, setActivePlaceId] = useState("");
  const [activeRegionId, setActiveRegionId] = useState("");
  const [personId, setPersonId] = useState("");
  const [showAllWorks, setShowAllWorks] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadJson<PoemWorldPlace[] | PlacesPayload>(
        "/data/poem-world-places.json",
      ).then((payload) =>
        Array.isArray(payload) ? payload : payload.places,
      ),
      loadJson<LinksPayload>("/data/poem-world-links.json"),
      loadJson<Person[]>("/data/people.json"),
      loadJson<PageData["corpusIndex"]>("/data/corpus/index.json").catch(
        () => undefined,
      ),
    ])
      .then(([places, links, people, corpusIndex]) => {
        if (cancelled) return;
        setData({ places, links, people, corpusIndex });
      })
      .catch(() => {
        if (!cancelled) {
          setError("诗境数据暂时无法加载。请刷新页面后再试。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // The map container is rendered only after the data request resolves. Run
    // this effect again at that point so Leaflet never initializes against a
    // missing element on the loading render.
    if (!data) return;

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
        minZoom: 3,
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
        leafletRef.current = null;
        fittedSignatureRef.current = "";
      }
    };
  }, [data]);

  const handleRetryTiles = useCallback(() => {
    tilesRef.current?.retry();
  }, []);

  const personNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const person of data?.people ?? []) {
      names.set(person.id, person.name);
    }
    for (const [id, entry] of Object.entries(data?.corpusIndex?.people ?? {})) {
      if (!names.has(id) && entry?.name) {
        names.set(id, entry.name);
      }
    }
    return names;
  }, [data]);
  const personById = useMemo(
    () => new Map((data?.people ?? []).map((person) => [person.id, person])),
    [data],
  );

  const personOrderById = useMemo(
    () =>
      new Map(
        (data?.people ?? []).map((person, index) => [person.id, index]),
      ),
    [data],
  );

  const personOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of data?.links.pointLinks ?? []) {
      counts.set(link.personId, (counts.get(link.personId) ?? 0) + 1);
    }
    for (const link of data?.links.regionLinks ?? []) {
      counts.set(link.personId, (counts.get(link.personId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({
        id,
        name: personNameById.get(id) ?? id,
        dynasty: personById.get(id)?.dynasty,
        count,
      }))
      .sort(
        (a, b) =>
          (personOrderById.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (personOrderById.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
          a.name.localeCompare(b.name, "zh-CN"),
      );
  }, [data, personById, personNameById, personOrderById]);

  const placeWorkCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of data?.links.pointLinks ?? []) {
      if (personId && link.personId !== personId) continue;
      counts.set(link.placeId, (counts.get(link.placeId) ?? 0) + 1);
    }
    return counts;
  }, [data, personId]);

  const regionWorkCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of data?.links.regionLinks ?? []) {
      if (personId && link.personId !== personId) continue;
      counts.set(link.placeId, (counts.get(link.placeId) ?? 0) + 1);
    }
    return counts;
  }, [data, personId]);

  const mappablePlaces = useMemo(
    () =>
      (data?.places ?? []).filter(
        (place) => place.coordinate && !place.ambiguous,
      ),
    [data],
  );

  const regionPlaces = useMemo(
    () =>
      (data?.places ?? []).filter(
        (place) => place.placeCategory === "region",
      ),
    [data],
  );

  const defaultPlaceId = useMemo(
    () => selectPoemWorldDefaultPlaceId(mappablePlaces, placeWorkCounts, personId),
    [mappablePlaces, personId, placeWorkCounts],
  );
  const effectiveActivePlaceId =
    activePlaceId || (!activeRegionId ? defaultPlaceId : "");

  const visiblePointCount = useMemo(() => {
    if (!personId) return data?.links.counts.point ?? 0;
    return [...placeWorkCounts.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
  }, [data, personId, placeWorkCounts]);

  const activePlace = useMemo(
    () => data?.places.find((place) => place.id === effectiveActivePlaceId),
    [data, effectiveActivePlaceId],
  );

  const activeSpotlight = useMemo(
    () => poemWorldSpotlightFor(activePlace?.id ?? "", personId),
    [activePlace?.id, personId],
  );

  const spotlightWorkIds = useMemo(
    () =>
      new Set(
        (activeSpotlight?.works ?? []).flatMap((work) =>
          work.workId ? [work.workId] : [],
        ),
      ),
    [activeSpotlight],
  );

  const activeRegion = useMemo(
    () => regionPlaces.find((place) => place.id === activeRegionId),
    [activeRegionId, regionPlaces],
  );

  const activePlaceLinks = useMemo(() => {
    if (!activePlace || activePlace.placeCategory === "region") return [];
    return (data?.links.pointLinks ?? [])
      .filter(
        (link) =>
          link.placeId === activePlace.id &&
          (!personId || link.personId === personId),
      )
      .sort(
        (a, b) =>
          (personNameById.get(a.personId) ?? "").localeCompare(
            personNameById.get(b.personId) ?? "",
            "zh-CN",
          ) ||
          a.workTitle.localeCompare(b.workTitle, "zh-CN"),
      );
  }, [activePlace, data, personId, personNameById]);

  const activePlaceLinksForReading = useMemo(
    () => activePlaceLinks.filter((link) => !spotlightWorkIds.has(link.workId)),
    [activePlaceLinks, spotlightWorkIds],
  );

  const activeRegionLinks = useMemo(() => {
    if (!activeRegion) return [];
    return (data?.links.regionLinks ?? [])
      .filter(
        (link) =>
          link.placeId === activeRegion.id &&
          (!personId || link.personId === personId),
      )
      .sort(
        (a, b) =>
          (personNameById.get(a.personId) ?? "").localeCompare(
            personNameById.get(b.personId) ?? "",
            "zh-CN",
          ) ||
          a.workTitle.localeCompare(b.workTitle, "zh-CN"),
      );
  }, [activeRegion, data, personId, personNameById]);

  const choosePlace = useCallback((placeId: string) => {
    setActivePlaceId(placeId);
    setActiveRegionId("");
    setShowAllWorks(false);
  }, []);

  const chooseRegion = useCallback((placeId: string) => {
    setActiveRegionId(placeId);
    setActivePlaceId("");
    setShowAllWorks(false);
  }, []);

  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const layerGroup = layerGroupRef.current;
    if (!mapReady || !leaflet || !map || !layerGroup) return;

    const visiblePlaces = mappablePlaces.filter(
      (place) => (placeWorkCounts.get(place.id) ?? 0) > 0,
    );
    layerGroup.clearLayers();

    if (visiblePlaces.length === 0) {
      fittedSignatureRef.current = "";
      return;
    }

    const latLngs = visiblePlaces.map(
      (place) =>
        [place.coordinate?.y ?? 0, place.coordinate?.x ?? 0] as [number, number],
    );
    const showPlaceLabels = mapZoom >= 8 && visiblePlaces.length <= 18;
    const isOverview = mapZoom <= poemWorldOverviewZoom;
    const activePlaceInView = visiblePlaces.find(
      (place) => place.id === effectiveActivePlaceId,
    );
    const placesForOverviewClusters = visiblePlaces.filter(
      (place) => place.id !== effectiveActivePlaceId,
    );
    const overviewClusters = isOverview
      ? clusterPlacesForOverview(map, placesForOverviewClusters, placeWorkCounts)
      : [];
    const maxPlaceWorkCount = visiblePlaces.reduce(
      (maximum, place) => Math.max(maximum, placeWorkCounts.get(place.id) ?? 0),
      1,
    );
    const maxClusterWorkCount = overviewClusters.reduce(
      (maximum, cluster) => Math.max(maximum, cluster.totalWorks),
      1,
    );

    const addPlaceMarker = (place: PoemWorldPlace) => {
      const latLng = placeLatLng(place);
      if (!latLng) return;
      const count = placeWorkCounts.get(place.id) ?? 0;
      const isActive = place.id === effectiveActivePlaceId;
      const visual = poemWorldMarkerVisual(count, maxPlaceWorkCount);
      const markerRadius = visual.radius + (isActive ? 1.25 : 0);

      if (isActive) {
        leaflet
          .circleMarker(latLng, {
            className: "poem-place-halo poem-place-halo--active",
            color: "#78b996",
            fillColor: "#dff3e6",
            fillOpacity: 0.18,
            opacity: 0.5,
            radius: markerRadius + 5.2,
            weight: 1,
            interactive: false,
          })
          .addTo(layerGroup);
      }

      const marker = leaflet.circleMarker(
        latLng,
        {
          className: "poem-place-marker" + (isActive ? " is-active" : ""),
          color: isActive ? "#438d69" : visual.borderColor,
          fillColor: isActive ? "#e0f3e7" : visual.fillColor,
          fillOpacity: isActive ? 0.56 : 0.9,
          opacity: isActive ? 0.76 : 1,
          radius: markerRadius,
          weight: isActive ? 1.65 : 1.45,
        },
      );
      marker.bindTooltip(
        place.name + " · " + count + " 篇",
        {
          className: isActive
            ? "journey-map-tooltip poem-map-tooltip is-active"
            : "journey-map-tooltip poem-map-tooltip",
          direction: "top",
          offset: [0, -(markerRadius + 6)],
          // Keep context in Chinese once individual places have enough room;
          // overview clusters stay compact instead of becoming a label cloud.
          permanent: isActive || showPlaceLabels,
        },
      );
      marker.on("click", () => choosePlace(place.id));
      marker.on("add", () => {
        const element = marker.getElement();
        if (!element) return;
        element.setAttribute("tabindex", "0");
        element.setAttribute("role", "button");
        element.setAttribute(
          "aria-label",
          "查看" + place.name + "，已关联 " + count + " 篇作品",
        );
        element.addEventListener("keydown", (event) => {
          if (
            event instanceof KeyboardEvent &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            choosePlace(place.id);
          }
        });
      });
      marker.addTo(layerGroup);
    };

    if (!isOverview) {
      visiblePlaces.forEach(addPlaceMarker);
    } else {
      // The selected place is kept out of these clusters so its individual
      // halo remains a precise, readable target in the grouped overview.
      overviewClusters.forEach(
        (cluster) => {
          if (cluster.places.length === 1) {
            addPlaceMarker(cluster.places[0]);
            return;
          }

          const clusterLatLngs = cluster.places.flatMap((place) => {
            const latLng = placeLatLng(place);
            return latLng ? [latLng] : [];
          });
          const expandCluster = () => {
            if (clusterLatLngs.length === 0) return;
            const [firstLatLng] = clusterLatLngs;
            const sharesCoordinates = clusterLatLngs.every(
              ([latitude, longitude]) =>
                latitude === firstLatLng[0] && longitude === firstLatLng[1],
            );

            if (sharesCoordinates) {
              map.setView(firstLatLng, Math.min(map.getZoom() + 2, 8), {
                animate: false,
              });
              return;
            }

            map.fitBounds(leaflet.latLngBounds(clusterLatLngs), {
              animate: false,
              maxZoom: 8,
              padding: [48, 48],
            });
          };

          const visual = poemWorldMarkerVisual(
            cluster.totalWorks,
            maxClusterWorkCount,
            "cluster",
          );
          const clusterSize = Math.round(visual.diameter);
          const clusterStyle = [
            `--poem-work-marker-fill:${visual.fillColor}`,
            `--poem-work-marker-border:${visual.borderColor}`,
            `--poem-work-marker-label:${visual.labelColor}`,
          ].join(";");
          const marker = leaflet.marker(cluster.center, {
            icon: leaflet.divIcon({
              className: "poem-place-cluster-icon",
              html: `<span class="poem-place-cluster-bubble" style="${clusterStyle}">${cluster.places.length}</span>`,
              iconSize: [clusterSize, clusterSize],
              iconAnchor: [clusterSize / 2, clusterSize / 2],
              tooltipAnchor: [0, -clusterSize / 2],
            }),
          });
          marker.bindTooltip(
            cluster.places.length +
              " 处地点 · " +
              cluster.totalWorks +
              " 篇关联 · 点击放大展开",
            {
              className: "journey-map-tooltip",
              direction: "top",
              offset: [0, -10],
            },
          );
          marker.on("click", expandCluster);
          marker.on("add", () => {
            const element = marker.getElement();
            if (!element) return;
            element.setAttribute("tabindex", "0");
            element.setAttribute("role", "button");
            element.setAttribute(
              "aria-label",
              "放大查看附近 " +
                cluster.places.length +
                " 处地点，共 " +
                cluster.totalWorks +
                " 篇作品关联",
            );
            element.addEventListener("keydown", (event) => {
              if (
                event instanceof KeyboardEvent &&
                (event.key === "Enter" || event.key === " ")
              ) {
                event.preventDefault();
                expandCluster();
              }
            });
          });
          marker.addTo(layerGroup);
        },
      );
      if (activePlaceInView) addPlaceMarker(activePlaceInView);
    }

    const signature =
      personId +
      ":" +
      visiblePlaces.map((place) => place.id).join("|");
    if (fittedSignatureRef.current !== signature) {
      const shouldFocusDefaultSpotlight =
        !personId &&
        !activePlaceId &&
        !activeRegionId &&
        effectiveActivePlaceId === DEFAULT_POEM_WORLD_PLACE_ID;
      const spotlightLatLng = activePlaceInView
        ? placeLatLng(activePlaceInView)
        : null;

      if (shouldFocusDefaultSpotlight && spotlightLatLng) {
        map.setView(spotlightLatLng, DEFAULT_POEM_WORLD_SPOTLIGHT_ZOOM, {
          animate: false,
        });
      } else if (visiblePlaces.length === 1) {
        map.setView(latLngs[0], 6, { animate: false });
      } else {
        map.fitBounds(leaflet.latLngBounds(latLngs), {
          animate: false,
          maxZoom: visiblePlaces.length > 12 ? 5 : 6,
          padding: [48, 48],
        });
      }
      fittedSignatureRef.current = signature;
    }
  }, [
    activePlaceId,
    activeRegionId,
    effectiveActivePlaceId,
    choosePlace,
    mappablePlaces,
    mapReady,
    mapZoom,
    personId,
    placeWorkCounts,
  ]);

  if (!data) {
    return (
      <main className="loading-page">
        <a className="skip-link" href="#main-content">
          跳到正文
        </a>
        <SiteNav current="poem-world" />
        <section id="main-content" className="loading-card" aria-live="polite">
          <p className="eyebrow">诗里写到的山河</p>
          <h1>正在整理诗境图</h1>
          <p>{error || "正在载入地点与诗—地关联……"}</p>
        </section>
      </main>
    );
  }

  const panelLinks = activePlace
    ? activePlaceLinksForReading
    : activeRegionLinks;
  const spotlightWorkCount = activeSpotlight?.works.length ?? 0;
  const visibleWorks = panelLinks.slice(
    0,
    showAllWorks ? undefined : Math.max(0, linkLimit - spotlightWorkCount),
  );
  const totalWorks = panelLinks.length;
  const totalDisplayedWorks = totalWorks + spotlightWorkCount;

  return (
    <main className="site-shell">
      <a className="skip-link" href="#main-content">
        跳到正文
      </a>
      <SiteNav current="poem-world" />

      <ReadingModuleHeader
        title="诗境图"
        subtitle="：把诗句里的山河放回地图"
        controls={
          <PersonSwitcher
          id="poem-world-person"
          value={personId}
          options={personOptions}
          allOption={{ value: "", label: "全部诗人" }}
          onChange={(nextPersonId) => {
            setPersonId(nextPersonId);
            setActivePlaceId("");
            setActiveRegionId("");
            setShowAllWorks(false);
          }}
          summary={
            personId
              ? "已选人物 · " + visiblePointCount + " 条诗—地关联"
              : data.links.counts.point + " 条点图层关联 · " +
                data.links.counts.region +
                " 条区域注解"
          }
          />
        }
      />

      <ContextAtlasStage
        ariaLabel="诗境地点地图"
        visual={
          <div className="poem-map-wrap poem-world-map-stage">
            <div
              ref={mapContainerRef}
              className="real-map"
              role="region"
              aria-label="诗境地点地图（坐标为现代展示近似；圆点越大、绿色越深，表示关联诗作越多）"
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
            </div>
          </div>
        }
        context={
          <LocationStoryDirectory
            title="区域注解"
            note="圆点越大、绿色越深，表示当前筛选下关联诗作越多；江南、潇湘等泛指地名不落点，仅按文本注解聚合。"
            ariaLabel="区域注解"
            locations={regionPlaces.map((place) => ({
              id: place.id,
              label: place.name,
              storyCount: regionWorkCounts.get(place.id) ?? 0,
              detail: "篇",
            }))}
            activeLocationId={activeRegionId}
            onSelect={chooseRegion}
          />
        }
        inspector={
        <aside
          className="detail-panel poem-world-panel"
          aria-live="polite"
          aria-label="当前地点详情"
        >
          <div className="detail-page-content poem-world-detail-scroller">
          {activePlace ? (
            <>
              <p className="eyebrow">{categoryLabels[activePlace.placeCategory] ?? "地点"}</p>
              <h2>{activePlace.name}</h2>
              {activePlace.modernName && (
                <p className="place-modern-name">今：{activePlace.modernName}</p>
              )}
              {activeSpotlight ? (
                <>
                  <p className="place-intro">{activeSpotlight.introduction}</p>
                  <p className="evidence-note">
                    坐标仅作现代展示近似，不表示精确历史位置。{activeSpotlight.traditionNotice}
                  </p>
                  <h3>写到这里的作品</h3>
                  <ul className="poem-link-list">
                    {activeSpotlight.works.map((work) => (
                      <SpotlightWorkCard
                        key={work.id}
                        work={work}
                        href={
                          work.workId
                            ? "/works/" + encodeURIComponent(work.workId)
                            : undefined
                        }
                      />
                    ))}
                    {visibleWorks.map((link) => (
                      <PoemWorldLinkCard
                        key={link.workId}
                        link={link}
                        personName={personNameById.get(link.personId) ?? link.personId}
                        relationLabel={relationLabels[link.relationType]}
                        href={"/works/" + encodeURIComponent(link.workId)}
                      />
                    ))}
                  </ul>
                  {totalDisplayedWorks > linkLimit && (
                    <button
                      type="button"
                      className="link-expand"
                      onClick={() => setShowAllWorks((current) => !current)}
                    >
                      {showAllWorks
                        ? "收起列表"
                        : "显示全部 " + totalDisplayedWorks + " 篇"}
                    </button>
                  )}
                </>
              ) : (
                <>
                  {activePlace.intro && (
                    <p className="place-intro">{activePlace.intro}</p>
                  )}
                  <p className="evidence-note">
                    坐标仅作现代展示近似，不表示精确历史位置。
                  </p>
                  {activePlaceLinks.length > 0 ? (
                    <>
                      <h3>写到这里的作品</h3>
                      <ul className="poem-link-list">
                        {visibleWorks.map((link) => (
                          <PoemWorldLinkCard
                            key={link.workId}
                            link={link}
                            personName={personNameById.get(link.personId) ?? link.personId}
                            relationLabel={relationLabels[link.relationType]}
                            href={"/works/" + encodeURIComponent(link.workId)}
                          />
                        ))}
                      </ul>
                      {totalWorks > linkLimit && (
                        <button
                          type="button"
                          className="link-expand"
                          onClick={() => setShowAllWorks((current) => !current)}
                        >
                          {showAllWorks
                            ? "收起列表"
                            : "显示全部 " + totalWorks + " 篇"}
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="empty-note">
                      {activePlace.ambiguous
                        ? "该名称为歧义地名，未自动指派作品。"
                        : "当前筛选下暂无作品关联。"}
                    </p>
                  )}
                </>
              )}
            </>
          ) : activeRegion ? (
            <>
              <p className="eyebrow">区域注解</p>
              <h2>{activeRegion.name}</h2>
              {activeRegion.intro && (
                <p className="place-intro">{activeRegion.intro}</p>
              )}
              <p className="evidence-note">
                区域为泛指（江南、潇湘等），不落点图，仅作注解。
              </p>
              {activeRegionLinks.length > 0 ? (
                <>
                  <h3>相关作品</h3>
                  <ul className="poem-link-list">
                    {visibleWorks.map((link) => (
                      <PoemWorldLinkCard
                        key={link.workId}
                        link={link}
                        personName={personNameById.get(link.personId) ?? link.personId}
                        relationLabel="泛称提及"
                        href={"/works/" + encodeURIComponent(link.workId)}
                      />
                    ))}
                  </ul>
                  {totalWorks > linkLimit && (
                    <button
                      type="button"
                      className="link-expand"
                      onClick={() => setShowAllWorks((current) => !current)}
                    >
                      {showAllWorks
                        ? "收起列表"
                        : "显示全部 " + totalWorks + " 篇"}
                    </button>
                  )}
                </>
              ) : (
                <p className="empty-note">当前筛选下暂无作品关联。</p>
              )}
            </>
          ) : (
            <div className="panel-hint">
              <p className="eyebrow">诗境图</p>
              <h2>从地图开始</h2>
              <p>圆点越大、绿色越深，表示关联诗作越多；点击地点查看相关诗作，概览圆可放大展开。地点为文本提及，不等同于创作地。</p>
            </div>
          )}
          </div>
        </aside>
        }
      />

    </main>
  );
}
