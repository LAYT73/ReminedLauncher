import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Tauri file drag & drop over the window. Returns true while files hover.
 * No-op outside Tauri (plain browser).
 */
export function useFileDrop(onDrop: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const cb = useRef(onDrop);
  cb.current = onDrop;

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    try {
      void getCurrentWebview()
        .onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === "enter") setDragging(true);
          else if (p.type === "leave") setDragging(false);
          else if (p.type === "drop") {
            setDragging(false);
            if (p.paths.length > 0) cb.current(p.paths);
          }
        })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => undefined);
    } catch {
      /* not running inside Tauri */
    }
    return () => {
      cancelled = true;
      unlisten?.();
      setDragging(false);
    };
  }, []);

  return dragging;
}
