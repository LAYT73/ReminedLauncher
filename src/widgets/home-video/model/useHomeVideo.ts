import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

/** Whether the wallpaper has buffered enough to fade in. */
export const useHomeVideoReady = create<{
  ready: boolean;
  setReady: (ready: boolean) => void;
}>((set) => ({ ready: false, setReady: (ready) => set({ ready }) }));

/**
 * One persistent <video> for the home wallpaper. It is "parked" (paused, but
 * kept mounted) when the user leaves Home so returning doesn't re-decode it.
 */
export function useHomeVideo(live: boolean) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [kept, setKept] = useState(false);

  useEffect(() => {
    if (live) setKept(true);
  }, [live]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (live) {
      // WebKit sometimes stalls at end after pause — force loop restart
      if (el.ended || el.paused) {
        try {
          el.currentTime = el.ended ? 0 : el.currentTime;
        } catch {
          /* ignore seek errors while not ready */
        }
      }
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [live, kept]);

  return { ref, kept };
}
