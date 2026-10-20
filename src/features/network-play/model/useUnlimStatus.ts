import { useCallback, useEffect, useState } from "react";
import {
  openUnlimDownload,
  unlimCheck,
  unlimGetPath,
  unlimSetPath,
  unlimStatus,
  type UnlimCheckResult,
  type UnlimStatus,
} from "@/shared/api/unlim";

/** Unlim install/path status for Network settings (voice tunnel). */
export function useUnlimStatus(onToast: (message: string) => void) {
  const [status, setStatus] = useState<UnlimStatus | null>(null);
  const [check, setCheck] = useState<UnlimCheckResult | null>(null);
  const [pathDraft, setPathDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [st, custom] = await Promise.all([unlimStatus(), unlimGetPath()]);
      setStatus(st);
      // Only put a custom override in the input — auto path stays in the status line.
      setPathDraft(custom ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runCheck() {
    if (busy || checking) return;
    setChecking(true);
    setError("");
    try {
      const result = await unlimCheck();
      setCheck(result);
      await refresh();
      onToast(result.ok ? "Unlim check passed" : "Unlim check failed");
    } catch (err) {
      setCheck(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  async function openDownload() {
    if (busy) return;
    setBusy(true);
    try {
      await openUnlimDownload();
      onToast("Opening unlim.cc");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePath(path: string | null) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await unlimSetPath(path);
      setCheck(null);
      await refresh();
      onToast(path ? "Unlim path saved" : "Using auto-detect");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return {
    status,
    check,
    pathDraft,
    setPathDraft,
    busy,
    checking,
    error,
    refresh,
    runCheck,
    openDownload,
    savePath,
  };
}
