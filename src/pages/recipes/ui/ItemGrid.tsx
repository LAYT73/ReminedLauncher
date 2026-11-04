import { memo, useEffect, useRef, useState } from "react";
import type { RecipeItem } from "@/entities/recipe";
import { useRecipesStore } from "../model/store";
import { ItemIcon } from "./ItemIcon";

const CELL = 44;
const OVERSCAN = 3;

const Cell = memo(function Cell({ item }: { item: RecipeItem }) {
  const open = useRecipesStore.getState().open;
  const setTip = useRecipesStore.getState().setTip;
  return (
    <div
      className="rcp-cell"
      role="button"
      aria-label={item.name}
      onMouseEnter={() => setTip({ id: item.id })}
      onMouseLeave={() => setTip(null)}
      onClick={() => open(item.id, "recipes")}
      onContextMenu={(e) => {
        e.preventDefault();
        open(item.id, "uses");
      }}
    >
      <ItemIcon id={item.id} />
    </div>
  );
});

/** Hand-virtualized grid: fixed cell size, only visible rows are mounted. */
export function ItemGrid({ items }: { items: RecipeItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [top, setTop] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // New result set: back to the top.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setTop(0);
  }, [items]);

  const cols = Math.max(1, Math.floor(box.w / CELL));
  const rows = Math.ceil(items.length / cols);
  const first = Math.max(0, Math.floor(top / CELL) - OVERSCAN);
  const last = Math.min(rows, Math.ceil((top + box.h) / CELL) + OVERSCAN);
  const slice = items.slice(first * cols, last * cols);

  return (
    <div
      className="rcp-grid-scroll"
      ref={ref}
      onScroll={(e) => {
        const y = e.currentTarget.scrollTop;
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() => setTop(y));
      }}
    >
      <div className="rcp-grid-inner" style={{ height: rows * CELL }}>
        <div
          className="rcp-grid"
          style={{ top: first * CELL, gridTemplateColumns: `repeat(${cols}, ${CELL}px)` }}
        >
          {slice.map((it) => (
            <Cell key={it.id} item={it} />
          ))}
        </div>
      </div>
    </div>
  );
}
