import { useEffect, useRef } from "react";
import { useT } from "@/shared/i18n";
import { useRecipesStore } from "../model/store";
import { ItemIcon } from "./ItemIcon";

/** Icon + name + mod (+ tag) following the pointer. Positioned imperatively: no re-render per move. */
export function ItemTooltip() {
  const t = useT();
  const tip = useRecipesStore((s) => s.tip);
  const lookup = useRecipesStore((s) => s.lookup);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tip) return;
    const place = (x: number, y: number) => {
      const el = ref.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = x + 16 + w > window.innerWidth ? x - 12 - w : x + 16;
      const top = y + 18 + h > window.innerHeight ? y - 10 - h : y + 18;
      el.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`;
    };
    const move = (e: MouseEvent) => place(e.clientX, e.clientY);
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, [tip]);

  if (!tip || !lookup) return null;
  const item = lookup.itemsById.get(tip.id);
  if (!item) return null;
  const mod = lookup.modsById.get(item.mod);
  return (
    <div className="rcp-tooltip" ref={ref} style={{ transform: "translate(-999px,-999px)" }}>
      <ItemIcon id={item.id} size={32} hot />
      <div className="rcp-tooltip-copy">
        <strong>{item.name}</strong>
        <span>{mod?.name ?? item.mod}</span>
        {tip.tag ? <span className="rcp-tooltip-tag">{t("recipes.view.tag", { tag: tip.tag })}</span> : null}
      </div>
    </div>
  );
}
