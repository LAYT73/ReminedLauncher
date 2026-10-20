import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SkinHead } from "@/entities/skin";
import { applyTheme, DEFAULT_THEME, normalizeThemeId } from "@/entities/theme";
import {
  takeFriendToast,
  type FriendToastPayload,
} from "@/shared/lib/friendToast";

const HOLD_MS = 4200;
const FADE_MS = 380;

/** Standalone desktop overlay — Remined panel UI, active theme. */
export function FriendToastWindow() {
  const [payload, setPayload] = useState<FriendToastPayload | null>(null);
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    document.documentElement.classList.add("friend-toast-window");
    document.body.classList.add("friend-toast-window");
    return () => {
      document.documentElement.classList.remove("friend-toast-window");
      document.body.classList.remove("friend-toast-window");
    };
  }, []);

  useEffect(() => {
    const next = takeFriendToast();
    if (!next) {
      void getCurrentWindow().close().catch(() => undefined);
      return;
    }
    applyTheme(
      normalizeThemeId(next.themeId ?? DEFAULT_THEME),
      next.themeCustom ?? null,
    );
    setPayload(next);
    setPhase("in");

    const hold = window.setTimeout(() => setPhase("out"), HOLD_MS);
    const done = window.setTimeout(() => {
      void getCurrentWindow().close().catch(() => undefined);
    }, HOLD_MS + FADE_MS);

    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(done);
    };
  }, []);

  if (!payload) return null;

  return (
    <div className={`friend-desktop-toast is-${phase}`} role="status">
      <div className="friend-desktop-toast-accent" aria-hidden />
      <SkinHead
        skinUrl={payload.skinUrl ?? null}
        className="friend-desktop-toast-skin"
        size={40}
      />
      <div className="friend-desktop-toast-copy">
        <strong className="friend-desktop-toast-title">{payload.title}</strong>
        <span className="friend-desktop-toast-badge">
          <span className="friend-desktop-toast-kind">{payload.kind}</span>
          {payload.detail ? (
            <span className="friend-desktop-toast-detail">{payload.detail}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
