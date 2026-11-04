import { useEffect, type RefObject } from "react";
import { groupRecipes } from "@/entities/recipe";
import { useRecipesStore } from "./store";

const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable=false])";
const INTERACTIVE = `${TYPING}, button, [role=listbox], [role=option]`;
const closest = (el: EventTarget | null, sel: string) => el instanceof Element && el.closest(sel) !== null;

/** JEI-style hotkeys: Ctrl/Cmd+F, R/U on hovered item, Backspace/Esc back, arrows page/tab. */
export function useRecipeKeys(searchRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useRecipesStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (closest(e.target, TYPING)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      // Buttons, listboxes and an open McSelect menu own their keys.
      if (closest(e.target, INTERACTIVE) || document.querySelector(".pack-select.is-open")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if ((k === "r" || k === "u") && s.tip) {
        e.preventDefault();
        s.open(s.tip.id, k === "r" ? "recipes" : "uses");
      } else if ((e.key === "Backspace" || e.key === "Escape") && (s.history.length > 0 || s.view)) {
        e.preventDefault();
        s.back();
      } else if (s.view && s.lookup && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        const { lookup, view } = s;
        const list = (view.mode === "recipes" ? lookup.recipesByOutput : lookup.recipesByInput).get(view.itemId) ?? [];
        const groups = groupRecipes(list);
        if (groups.length === 0) return;
        e.preventDefault();
        const gi = Math.max(0, groups.findIndex((g) => g.key === view.tab));
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const n = groups[gi].recipes.length;
          const d = e.key === "ArrowRight" ? 1 : -1;
          s.setPage((((view.page + d) % n) + n) % n);
        } else {
          const d = e.key === "ArrowDown" ? 1 : -1;
          s.setTab(groups[(gi + d + groups.length) % groups.length].key);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchRef]);
}
