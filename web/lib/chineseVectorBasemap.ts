import type { Map as LeafletMapInstance, Layer as LeafletLayer } from "leaflet";
import type { Map as MaplibreMap, StyleSpecification } from "maplibre-gl";

import {
  addResilientTiles,
  type MapTileStatus,
  type ResilientTilesHandle,
} from "./mapTileLayers";

const openFreeMapBrightStyleUrl = "https://tiles.openfreemap.org/styles/bright";
const vectorLoadTimeoutMs = 10000;

const transportSourceLayers = new Set(["transportation", "transportation_name"]);
const ChineseLabelSourceLayers = new Set([
  "aerodrome_label",
  "place",
  "poi",
  "water_name",
  "waterway",
]);

const ChineseNameExpression = [
  "coalesce",
  ["get", "name:zh-Hans"],
  ["get", "name:zh"],
  ["get", "name:zh-Hant"],
  ["get", "name"],
];

type MutableStyleLayer = {
  type?: string;
  layout?: Record<string, unknown>;
  [key: string]: unknown;
};

type MutableStyle = Omit<StyleSpecification, "layers"> & {
  layers: MutableStyleLayer[];
};

type MaplibreMapWithLeafletCanvas = MaplibreMap & {
  _actualCanvas?: HTMLCanvasElement | null;
};

type MaplibreLeafletLayer = LeafletLayer & {
  _glMap?: MaplibreMapWithLeafletCanvas | null;
  _map?: LeafletMapInstance | null;
  _resizeContainer?: () => void;
  _transitionEnd?: () => void;
  _zoomEnd?: () => void;
  getMaplibreMap(): MaplibreMap;
  onRemove?: (map: LeafletMapInstance) => unknown;
};

/**
 * Guard an upstream lifecycle race in @maplibre/maplibre-gl-leaflet 0.1.4.
 *
 * Its _transitionEnd queues a frame that later accesses `this._map` without
 * checking whether Leaflet has already removed the layer. That happens during
 * a resize, retry, or React route cleanup and produces `getZoom` on null.
 * Install this before addTo(), because Leaflet captures these handlers when
 * the layer is attached.
 */
function guardMaplibreLayerLifecycle(
  layer: MaplibreLeafletLayer,
  leaflet: typeof import("leaflet"),
) {
  let removed = false;
  let transitionFrame: number | null = null;
  const originalOnRemove = layer.onRemove;
  const originalZoomEnd = layer._zoomEnd;

  const cancelTransitionFrame = () => {
    if (transitionFrame === null) return;
    leaflet.Util.cancelAnimFrame(transitionFrame);
    transitionFrame = null;
  };

  layer._zoomEnd = () => {
    if (removed || !layer._map || !layer._glMap) return;
    originalZoomEnd?.call(layer);
  };

  layer._transitionEnd = () => {
    cancelTransitionFrame();

    const attachedMap = layer._map;
    const glMap = layer._glMap;
    if (removed || !attachedMap || !glMap) return;

    transitionFrame = leaflet.Util.requestAnimFrame(() => {
      transitionFrame = null;
      if (removed || layer._map !== attachedMap || layer._glMap !== glMap) return;

      const canvas = glMap._actualCanvas;
      if (!canvas) return;

      const zoom = attachedMap.getZoom();
      const center = attachedMap.getCenter();
      const offset = attachedMap.latLngToContainerPoint(
        attachedMap.getBounds().getNorthWest(),
      );
      layer._resizeContainer?.();
      leaflet.DomUtil.setTransform(canvas, offset, 1);
      glMap.once("moveend", () => {
        if (removed || layer._map !== attachedMap || layer._glMap !== glMap) return;
        layer._zoomEnd?.();
      });
      glMap.jumpTo({ center, zoom: zoom - 1 });
    }, layer);
  };

  layer.onRemove = (mapToRemove) => {
    removed = true;
    cancelTransitionFrame();
    return originalOnRemove?.call(layer, mapToRemove);
  };

  return () => {
    removed = true;
    cancelTransitionFrame();
  };
}

function localizeAndQuietStyle(rawStyle: unknown): StyleSpecification {
  if (
    !rawStyle ||
    typeof rawStyle !== "object" ||
    !Array.isArray((rawStyle as { layers?: unknown }).layers)
  ) {
    throw new Error("OpenFreeMap returned an invalid map style.");
  }

  // The hosted style stays the source of cartographic truth. We clone its
  // JSON only to choose Chinese name fields and hide the transportation data
  // layer, leaving land, boundaries, water and place labels intact.
  const style = JSON.parse(JSON.stringify(rawStyle)) as MutableStyle;
  for (const layer of style.layers) {
    const sourceLayer =
      typeof layer["source-layer"] === "string" ? layer["source-layer"] : "";

    if (transportSourceLayers.has(sourceLayer)) {
      layer.layout = { ...layer.layout, visibility: "none" };
      continue;
    }

    if (
      layer.type === "symbol" &&
      ChineseLabelSourceLayers.has(sourceLayer) &&
      layer.layout?.["text-field"] !== undefined
    ) {
      layer.layout = {
        ...layer.layout,
        "text-field": ChineseNameExpression,
      };
    }
  }

  return style as StyleSpecification;
}

/**
 * Uses a Chinese-labelled vector base map while keeping the existing Leaflet
 * overlays and their interactions. If WebGL or the vector host is unavailable,
 * the established raster fallback still keeps the map usable.
 */
export function addChineseVectorBasemap(
  map: LeafletMapInstance,
  leaflet: typeof import("leaflet"),
  onStatus: (status: MapTileStatus) => void,
): ResilientTilesHandle {
  let destroyed = false;
  let generation = 0;
  let watchdog: number | null = null;
  let styleRequest: AbortController | null = null;
  let fallback: ResilientTilesHandle | null = null;
  let vectorLayer: import("leaflet").Layer | null = null;
  let stopVectorLifecycleGuard: (() => void) | null = null;

  const clearWatchdog = () => {
    if (watchdog === null) return;
    window.clearTimeout(watchdog);
    watchdog = null;
  };

  const removeVectorLayer = () => {
    stopVectorLifecycleGuard?.();
    stopVectorLifecycleGuard = null;
    vectorLayer?.remove();
    vectorLayer = null;
  };

  const activateRasterFallback = (attempt: number) => {
    if (destroyed || attempt !== generation || fallback) return;
    clearWatchdog();
    removeVectorLayer();
    fallback = addResilientTiles(map, leaflet, onStatus);
  };

  const activate = () => {
    const attempt = ++generation;
    clearWatchdog();
    styleRequest?.abort();
    styleRequest = new AbortController();
    fallback?.destroy();
    fallback = null;
    removeVectorLayer();
    onStatus({ state: "loading", provider: "OpenFreeMap（中文）" });

    void Promise.all([
      import("@maplibre/maplibre-gl-leaflet"),
      fetch(openFreeMapBrightStyleUrl, { signal: styleRequest.signal }),
    ])
      .then(async ([{ maplibreGL }, response]) => {
        if (!response.ok) {
          throw new Error(`OpenFreeMap style request failed: ${response.status}`);
        }

        const rawStyle = (await response.json()) as unknown;
        if (destroyed || attempt !== generation) return;

        const layer = maplibreGL({
          style: localizeAndQuietStyle(rawStyle),
        }) as MaplibreLeafletLayer;
        const stopLifecycleGuard = guardMaplibreLayerLifecycle(layer, leaflet);

        try {
          layer.addTo(map);
        } catch (error) {
          stopLifecycleGuard();
          throw error;
        }

        vectorLayer = layer;
        stopVectorLifecycleGuard = stopLifecycleGuard;

        layer.getMaplibreMap().once("load", () => {
          if (destroyed || attempt !== generation) return;
          clearWatchdog();
          onStatus({ state: "ready", provider: "OpenFreeMap（中文）" });
        });

        watchdog = window.setTimeout(
          () => activateRasterFallback(attempt),
          vectorLoadTimeoutMs,
        );
      })
      .catch((error: unknown) => {
        if (styleRequest?.signal.aborted || destroyed || attempt !== generation) return;
        console.warn("Chinese vector basemap unavailable; using raster fallback.", error);
        activateRasterFallback(attempt);
      });
  };

  activate();

  return {
    destroy() {
      destroyed = true;
      generation += 1;
      clearWatchdog();
      styleRequest?.abort();
      styleRequest = null;
      fallback?.destroy();
      fallback = null;
      removeVectorLayer();
    },
    retry() {
      if (destroyed) return;
      activate();
    },
  };
}
