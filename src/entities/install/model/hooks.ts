import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { EVENT } from "@/shared/config/events";
import { TIMING } from "@/shared/config/timings";
import { useGameStore } from "@/entities/game";
import { useInstallStore } from "./store";
import type { ProgressEvent } from "./types";

/** Whether the playbar should show the progress bar (install or launch prep). */
export function useShowProgress(): boolean {
  const installing = useInstallStore((s) => s.installing);
  const launching = useGameStore((s) => s.phase === "launching");
  return installing || launching;
}

/** Feeds the store from the backend's `remined-progress` event. */
export function useProgressListener(): void {
  const show = useShowProgress();
  useEffect(() => {
    if (!show) return;
    let unlisten: (() => void) | undefined;
    void listen<ProgressEvent>(EVENT.progress, (ev) =>
      useInstallStore.getState().applyProgress(ev.payload),
    ).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [show]);
}

/**
 * "ok" / "error" statuses clear themselves so things like "Pack deleted" never
 * stay stuck; they are held while progress is shown.
 */
export function useTransientStatus(): void {
  const hold = useShowProgress();
  const status = useInstallStore((s) => s.status);
  const kind = useInstallStore((s) => s.statusKind);
  useEffect(() => {
    if (!status || hold || kind === "idle") return;
    const delay =
      kind === "error" ? TIMING.statusErrorTtl : TIMING.statusOkTtl;
    const id = window.setTimeout(
      () => useInstallStore.getState().setStatus(""),
      delay,
    );
    return () => window.clearTimeout(id);
  }, [status, kind, hold]);
}
