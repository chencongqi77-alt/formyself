"use client";

type GraphZoomControlsProps = {
  onZoomIn: () => void;
  onZoomOut: () => void;
};

/** Shared zoom controls for every social-graph reader. */
export function GraphZoomControls({
  onZoomIn,
  onZoomOut,
}: GraphZoomControlsProps) {
  return (
    <div className="social-zoom" aria-label="图谱视图">
      <button type="button" aria-label="放大" onClick={onZoomIn}>
        ＋
      </button>
      <button type="button" aria-label="缩小" onClick={onZoomOut}>
        －
      </button>
    </div>
  );
}
