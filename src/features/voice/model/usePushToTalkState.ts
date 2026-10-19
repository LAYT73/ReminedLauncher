import { useEffect, useRef, useState, type RefObject } from "react";
import type { VoiceSession } from "../lib/voiceSession";
import { bindPushToTalk, loadPttConfig, savePttConfig } from "../lib/pushToTalk";
import { errorMessage, type ToastFn } from "./types";

/** Push-to-talk config + held state; drives the session's effective mute. */
export function usePushToTalkState(
  inRoom: boolean,
  muted: boolean,
  sessionRef: RefObject<VoiceSession | null>,
  onToast: ToastFn,
) {
  const [ptt, setPtt] = useState(loadPttConfig);
  const [pttDown, setPttDown] = useState(false);
  const toastRef = useRef(onToast);
  toastRef.current = onToast;

  // Effective mic = manual mute OR (PTT on and key not held).
  useEffect(() => {
    if (!inRoom) return;
    void sessionRef.current?.setMuted(muted || (ptt.enabled && !pttDown));
  }, [inRoom, muted, ptt.enabled, pttDown, sessionRef]);

  // Global hotkey (works while Minecraft is focused).
  useEffect(() => {
    if (!inRoom || !ptt.enabled) {
      setPttDown(false);
      return;
    }
    let unbind: (() => Promise<void>) | null = null;
    let cancelled = false;
    void bindPushToTalk(ptt.key, setPttDown)
      .then((fn) => {
        if (cancelled) void fn();
        else unbind = fn;
      })
      .catch((err) => {
        toastRef.current(
          `Push-to-talk key ${ptt.key} unavailable: ${errorMessage(err)}`,
          "err",
        );
        setPtt((p) => ({ ...p, enabled: false }));
      });
    return () => {
      cancelled = true;
      void unbind?.();
    };
  }, [inRoom, ptt.enabled, ptt.key]);

  useEffect(() => {
    savePttConfig(ptt);
  }, [ptt]);

  return { ptt, setPtt, pttDown };
}
