import { useEffect, useRef } from "react";
import { useSchematicsStore } from "./store";

/** Keys act only when focus is on body or inside the viewport (not on controls or panels). */
function isBlocked(el: EventTarget | null): boolean {
  // The catalog gallery replaces the viewport: its keys must stay silent.
  if (useSchematicsStore.getState().source === "catalog") return true;
  if (!(el instanceof HTMLElement)) return false;
  if (el === document.body || el === document.documentElement) return false;
  if (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.tagName === "BUTTON" ||
    el.closest("[role=tab], [role=button], .schem-side, .schem-library") !== null
  ) {
    return true;
  }
  return el.closest(".schem-viewport") === null;
}

/** Layer navigation keys for the Schematics page (layer mode, model ready). */
export function useLayerKeys(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isBlocked(e.target)) return;
      const s = useSchematicsStore.getState();
      if (s.mode !== "layers" || s.layerCounts.length === 0) return;
      switch (e.key) {
        case "ArrowUp":
        case "PageUp":
          s.stepLayer(1);
          break;
        case "ArrowDown":
        case "PageDown":
          s.stepLayer(-1);
          break;
        case "Home":
          s.setLayer(0);
          break;
        case "End":
          s.setLayer(s.layerCounts.length - 1);
          break;
        case " ":
          if (e.repeat) {
            e.preventDefault();
            return;
          }
          void s.completeLayer();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}

/** `[` / `]` toggle the library / right panel (right = drawer on narrow windows). */
export function usePanelKeys(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key !== "[" && e.key !== "]") return;
      if (useSchematicsStore.getState().source === "catalog") return;
      const el = e.target;
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")
      ) {
        return;
      }
      const s = useSchematicsStore.getState();
      if (e.key === "[") s.setLeftCollapsed(!s.leftCollapsed);
      else if (window.matchMedia("(max-width: 1099px)").matches) s.setDrawerOpen(!s.drawerOpen);
      else s.setRightCollapsed(!s.rightCollapsed);
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}

/**
 * Measuring tape keys: `M` toggles the tool; `Esc` first cancels the measurement in
 * progress (`onCancel` returns true when it did), a second `Esc` leaves the tool.
 */
export function useTapeKeys(active: boolean, onCancel: () => boolean) {
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isBlocked(e.target)) return;
      const s = useSchematicsStore.getState();
      if (e.code === "KeyM" || e.key === "m" || e.key === "M") {
        if (e.repeat) return;
        s.setTape(!s.tape);
      } else if (e.key === "Escape" && s.tape) {
        if (!cancelRef.current()) s.setTape(false);
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}

const MOVE_CODES = ["KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE"] as const;

/**
 * WASD / QE fly keys (physical keys via `event.code`, so they work on any layout). `apply` gets
 * forward / right / up in -1..1 and the Shift (3x speed) flag; it is called only while a key is held
 * and once with zeros on keyup / blur / unmount.
 */
export function useMoveKeys(
  active: boolean,
  apply: (f: number, r: number, u: number, fast: boolean) => void,
) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!active) return;
    const held = new Set<string>();
    const push = (fast: boolean) => {
      const f = (held.has("KeyW") ? 1 : 0) - (held.has("KeyS") ? 1 : 0);
      const r = (held.has("KeyD") ? 1 : 0) - (held.has("KeyA") ? 1 : 0);
      const u = (held.has("KeyE") ? 1 : 0) - (held.has("KeyQ") ? 1 : 0);
      applyRef.current(f, r, u, fast);
    };
    const stop = () => {
      if (held.size === 0) return;
      held.clear();
      applyRef.current(0, 0, 0, false);
    };
    const onDown = (e: KeyboardEvent) => {
      if (held.size > 0 && e.key === "Shift") push(true);
      if (e.ctrlKey || e.metaKey || e.altKey || !(MOVE_CODES as readonly string[]).includes(e.code)) return;
      if (isBlocked(e.target)) return;
      held.add(e.code);
      push(e.shiftKey);
      e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      if (held.size === 0) return;
      held.delete(e.code);
      push(e.shiftKey);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", stop);
      stop();
    };
  }, [active]);
}
