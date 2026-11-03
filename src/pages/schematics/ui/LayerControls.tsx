import { useRef } from "react";
import { useT } from "@/shared/i18n";
import { PixelCheckIcon, PixelChevronLeftIcon, PixelChevronRightIcon } from "@/shared/ui/PixelIcons";
import { useSchematicsStore } from "../model/store";

/** Bottom-center stepper + vertical slider (top = highest layer). */
export function LayerControls({ built }: { built: number[] }) {
  const t = useT();
  const layer = useSchematicsStore((s) => s.layer);
  const counts = useSchematicsStore((s) => s.layerCounts);
  const setLayer = useSchematicsStore((s) => s.setLayer);
  const stepLayer = useSchematicsStore((s) => s.stepLayer);
  const toggleBuilt = useSchematicsStore((s) => s.toggleBuilt);
  const trackRef = useRef<HTMLDivElement>(null);
  const n = counts.length;
  if (n === 0) return null;
  const isBuilt = built.includes(layer);
  const frac = n > 1 ? layer / (n - 1) : 0;

  function fromPointer(clientY: number) {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.height <= 0) return;
    const f = Math.min(1, Math.max(0, (r.bottom - clientY) / r.height));
    setLayer(Math.round(f * (n - 1)));
  }

  return (
    <>
      <div className="schem-stepper">
        <button
          type="button"
          className="schem-step-btn"
          aria-label={t("schematics.layers.prev")}
          title={t("schematics.layers.prev")}
          disabled={layer <= 0}
          onClick={() => stepLayer(-1)}
        >
          <PixelChevronLeftIcon />
        </button>
        <div className="schem-step-label" aria-live="polite">
          <strong>{t("schematics.layers.stepper", { n: layer + 1, total: n })}</strong>
          <span>
            {counts[layer] > 0
              ? t("schematics.layers.blocks", { count: counts[layer] })
              : t("schematics.layers.empty")}
          </span>
        </div>
        <button
          type="button"
          className="schem-step-btn"
          aria-label={t("schematics.layers.next")}
          title={t("schematics.layers.next")}
          disabled={layer >= n - 1}
          onClick={() => stepLayer(1)}
        >
          <PixelChevronRightIcon />
        </button>
        <button
          type="button"
          className={`schem-step-built ${isBuilt ? "is-on" : ""}`}
          aria-pressed={isBuilt}
          title={t("schematics.layers.built")}
          onClick={() => void toggleBuilt(layer)}
        >
          <PixelCheckIcon />
        </button>
      </div>
      <div
        className="schem-slider"
        role="slider"
        aria-orientation="vertical"
        aria-label={t("schematics.layers.slider")}
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={layer + 1}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e.clientY);
        }}
      >
        <div className="schem-slider-track" ref={trackRef}>
          {n <= 80
            ? counts.map((c, y) => (
                <span
                  key={y}
                  className={`schem-tick ${built.includes(y) ? "is-built" : ""} ${c === 0 ? "is-empty" : ""}`}
                  style={{ bottom: `${n > 1 ? (y / (n - 1)) * 100 : 0}%` }}
                />
              ))
            : null}
          <span className="schem-slider-thumb" style={{ bottom: `${frac * 100}%` }}>
            {layer + 1}
          </span>
        </div>
      </div>
    </>
  );
}
