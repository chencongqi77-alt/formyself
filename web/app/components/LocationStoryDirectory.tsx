"use client";

export type LocationStoryOption = {
  id: string;
  label: string;
  storyCount: number;
  detail?: string;
  disabled?: boolean;
};

type LocationStoryDirectoryProps = {
  title: string;
  note: string;
  locations: LocationStoryOption[];
  activeLocationId: string;
  onSelect: (locationId: string) => void;
  ariaLabel?: string;
};

/**
 * The shared location-to-story selector used by both geographic poetry maps
 * and other poet-map views. The canvas may differ by evidence model,
 * but choosing a location always opens the stories grouped at that location.
 */
export function LocationStoryDirectory({
  title,
  note,
  locations,
  activeLocationId,
  onSelect,
  ariaLabel,
}: LocationStoryDirectoryProps) {
  return (
    <section
      className="region-layer poem-world-region-panel"
      aria-label={ariaLabel ?? title}
    >
      <h2>{title}</h2>
      <p className="region-layer-note">{note}</p>
      <div className="region-chips">
        {locations.map((location) => {
          const isActive = location.id === activeLocationId;
          return (
            <button
              key={location.id}
              type="button"
              className={isActive ? "region-chip is-active" : "region-chip"}
              aria-pressed={isActive}
              disabled={location.disabled}
              onClick={() => onSelect(location.id)}
            >
              {location.label} · {location.storyCount} {location.detail ?? "则"}
            </button>
          );
        })}
      </div>
    </section>
  );
}
