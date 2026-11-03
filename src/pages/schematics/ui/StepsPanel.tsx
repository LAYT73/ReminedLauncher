import { useEffect, useRef } from "react";
import { useT } from "@/shared/i18n";
import { useSchematicsStore } from "../model/store";

export function StepsPanel({ built }: { built: number[] }) {
  const t = useT();
  const counts = useSchematicsStore((s) => s.layerCounts);
  const layer = useSchematicsStore((s) => s.layer);
  const skipEmpty = useSchematicsStore((s) => s.skipEmpty);
  const setSkipEmpty = useSchematicsStore((s) => s.setSkipEmpty);
  const setLayer = useSchematicsStore((s) => s.setLayer);
  const toggleBuilt = useSchematicsStore((s) => s.toggleBuilt);
  const completeLayer = useSchematicsStore((s) => s.completeLayer);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  const total = counts.length;
  const done = built.filter((y) => y < total).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done === total;

  useEffect(() => {
    rowRefs.current[layer]?.scrollIntoView({ block: "nearest" });
  }, [layer]);

  return (
    <div className="schem-steps">
      <div className="schem-steps-progress">
        <strong>{t("schematics.steps.progress", { done, total })}</strong>
        <div className="schem-progress">
          <div className="schem-progress-bar">
            <span style={{ width: `${pct}%` }} className={allDone ? "is-full" : ""} />
          </div>
          <span className="schem-progress-pct">{pct}%</span>
        </div>
      </div>
      <button
        type="button"
        className="btn-mc ok schem-next-btn"
        disabled={allDone && built.includes(layer)}
        onClick={() => void completeLayer()}
      >
        {allDone ? t("schematics.steps.done") : t("schematics.steps.next")}
      </button>
      <label className="schem-check-row">
        <input type="checkbox" checked={skipEmpty} onChange={(e) => setSkipEmpty(e.target.checked)} />
        <span>{t("schematics.steps.skipEmpty")}</span>
      </label>
      <ul className="schem-step-list">
        {counts.map((c, y) => {
          const isBuilt = built.includes(y);
          return (
            <li
              key={y}
              ref={(el) => {
                rowRefs.current[y] = el;
              }}
              className={`schem-step ${y === layer ? "is-current" : ""} ${isBuilt ? "is-built" : ""} ${c === 0 ? "is-empty" : ""}`}
              onClick={() => setLayer(y)}
            >
              <span className="schem-step-name">{t("schematics.steps.layer", { n: y + 1 })}</span>
              <span className="schem-step-count">
                {c === 0
                  ? t("schematics.steps.empty")
                  : t("schematics.layers.blocks", { count: c })}
              </span>
              <label
                className="schem-mat-check"
                title={t("schematics.steps.built")}
                onClick={(e) => e.stopPropagation()}
              >
                <input type="checkbox" checked={isBuilt} onChange={() => void toggleBuilt(y)} />
                <span aria-hidden />
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
