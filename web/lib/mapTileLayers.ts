import type { Map as LeafletMapInstance, TileLayer } from "leaflet";

export type MapTileStatus = {
  state: "loading" | "ready" | "switching" | "offline";
  provider: string;
};

export type TileProvider = {
  id: string;
  name: string;
  url: string;
  attribution: string;
  options: Record<string, unknown>;
};

// Primary provider first; later providers are automatic fallbacks when the
// current source is slow, rate-limited, or unreachable from the visitor's
// network. Every raster fallback keeps the provider's place and water labels
// visible, so a temporary vector-map failure never leaves a wordless map.
export const TILE_PROVIDERS: TileProvider[] = [
  {
    id: "carto",
    name: "CARTO",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    options: { maxZoom: 19, subdomains: "abcd" },
  },
  {
    id: "osm",
    name: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    options: { maxZoom: 19 },
  },
  {
    id: "geoq",
    name: "GeoQ 智图",
    url: "https://map.geoq.cn/ArcGIS/rest/services/ChinaOnlineCommunity/MapServer/tile/{z}/{y}/{x}",
    attribution: '&copy; <a href="https://www.geoq.cn">GeoQ 智图</a>',
    options: { maxZoom: 18 },
  },
];

export type ResilientTilesHandle = {
  destroy: () => void;
  retry: () => void;
};

// Number of failed tile requests that trigger a provider switch. Kept above
// 1 so zooming/panning cancellations do not cause a false fallback.
const errorSwitchThreshold = 4;
// If no tile succeeds within this window, assume the provider is blocked and
// move to the next one instead of leaving a blank map forever.
const loadingWatchdogMs = 10000;

export function addResilientTiles(
  map: LeafletMapInstance,
  leaflet: typeof import("leaflet"),
  onStatus: (status: MapTileStatus) => void,
): ResilientTilesHandle {
  let currentIndex = 0;
  let tileLayer: TileLayer | null = null;
  let successCount = 0;
  let errorCount = 0;
  let watchdog: number | null = null;
  let destroyed = false;

  const clearWatchdog = () => {
    if (watchdog !== null) {
      window.clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const emit = (state: MapTileStatus["state"]) => {
    onStatus({ state, provider: TILE_PROVIDERS[currentIndex].name });
  };

  const activate = (index: number, initialStatus: MapTileStatus["state"]) => {
    if (destroyed) return;
    clearWatchdog();

    if (tileLayer) {
      tileLayer.off("tileerror");
      tileLayer.off("tileload");
      tileLayer.remove();
      tileLayer = null;
    }

    currentIndex = index;
    successCount = 0;
    errorCount = 0;

    const provider = TILE_PROVIDERS[currentIndex];
    tileLayer = leaflet.tileLayer(provider.url, {
      attribution: provider.attribution,
      ...provider.options,
    });
    tileLayer.on("tileerror", () => {
      errorCount += 1;
      if (errorCount < errorSwitchThreshold) return;
      if (currentIndex < TILE_PROVIDERS.length - 1) {
        activate(currentIndex + 1, "switching");
      } else {
        emit("offline");
      }
    });
    tileLayer.on("tileload", () => {
      successCount += 1;
      errorCount = 0;
      if (successCount >= 2) {
        emit("ready");
        clearWatchdog();
      }
    });
    tileLayer.addTo(map);
    emit(initialStatus);

    watchdog = window.setTimeout(() => {
      if (successCount > 0) return;
      if (currentIndex < TILE_PROVIDERS.length - 1) {
        activate(currentIndex + 1, "switching");
      } else {
        emit("offline");
      }
    }, loadingWatchdogMs);
  };

  activate(0, "loading");

  return {
    destroy() {
      destroyed = true;
      clearWatchdog();
      tileLayer?.off("tileerror");
      tileLayer?.off("tileload");
      tileLayer?.remove();
      tileLayer = null;
    },
    // Manual retry restarts from the preferred provider so a recovered
    // primary source is used again instead of staying on the last fallback.
    retry() {
      if (destroyed) return;
      activate(0, "loading");
    },
  };
}
