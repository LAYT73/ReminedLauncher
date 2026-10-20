import { useEffect, useRef } from "react";
import type { VoiceVideoTile } from "../lib/voiceSession";

export function statusTone(
  status: string,
): "ok" | "warn" | "bad" | "idle" {
  const s = status.toLowerCase();
  if (s.includes("in voice")) return "ok";
  if (s.includes("disconnect") || s.includes("fail")) return "bad";
  if (
    s.includes("connect") ||
    s.includes("start") ||
    s.includes("prepar") ||
    s.includes("opening")
  ) {
    return "warn";
  }
  return "idle";
}

export function MicIcon({ slashed }: { slashed?: boolean }) {
  return (
    <svg className="voice-icon-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0z"
      />
      {slashed ? (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          d="M5 5l14 14"
        />
      ) : null}
    </svg>
  );
}

export function HearIcon({ slashed }: { slashed?: boolean }) {
  return (
    <svg className="voice-icon-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 3a7 7 0 0 0-7 7v3.2c0 .7-.3 1.4-.8 1.9L3 16.3A1.5 1.5 0 0 0 4.1 19h2.4A2.5 2.5 0 0 0 9 16.5V12H7v-2a5 5 0 0 1 10 0v2h-2v4.5A2.5 2.5 0 0 0 17.5 19h2.4A1.5 1.5 0 0 0 21 16.3l-1.2-1.2c-.5-.5-.8-1.2-.8-1.9V10a7 7 0 0 0-7-7z"
      />
      {slashed ? (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          d="M5 5l14 14"
        />
      ) : null}
    </svg>
  );
}

export function CamIcon({ slashed }: { slashed?: boolean }) {
  return (
    <svg className="voice-icon-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M4 7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.4l4.2 2.5A1 1 0 0 0 22 17V9a1 1 0 0 0-1.8-.6L16 10.9V9a2 2 0 0 0-2-2H4z"
      />
      {slashed ? (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          d="M5 5l14 14"
        />
      ) : null}
    </svg>
  );
}

export function ScreenIcon({ slashed }: { slashed?: boolean }) {
  return (
    <svg className="voice-icon-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5v2h2a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h2v-2H5a2 2 0 0 1-2-2V5zm2 0v10h14V5H5z"
      />
      {slashed ? (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          d="M5 5l14 14"
        />
      ) : null}
    </svg>
  );
}

/** Person + plus — invite friend. */
export function InviteIcon() {
  return (
    <svg className="voice-icon-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M9 11a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 9 11zm-6.5 9a5.5 5.5 0 0 1 11 0 1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"
      />
      <path
        fill="currentColor"
        d="M18.5 7.5h-1.25V6.25a.75.75 0 1 0-1.5 0V7.5H14.5a.75.75 0 1 0 0 1.5h1.25v1.25a.75.75 0 1 0 1.5 0V9H18.5a.75.75 0 1 0 0-1.5z"
      />
    </svg>
  );
}

/** Door / leave room. */
export function LeaveIcon() {
  return (
    <svg className="voice-icon-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M10 3a1 1 0 0 0-1 1v7H5.41l1.3-1.29a1 1 0 0 0-1.42-1.42l-3 3a1 1 0 0 0 0 1.42l3 3a1 1 0 0 0 1.42-1.42L5.41 13H9v7a1 1 0 0 0 1 1h9a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-9zm2 2h7v14h-7v-5h2a1 1 0 1 0 0-2h-2V5z"
      />
    </svg>
  );
}

export function VideoTileView({ tile, label }: { tile: VoiceVideoTile; label: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const media = tile.track.mediaStreamTrack;
    if (!media || media.readyState !== "live") return;
    tile.track.attach(el);
    return () => {
      tile.track.detach(el);
      el.srcObject = null;
    };
  }, [tile.track]);

  async function toggleFullscreen() {
    const node = wrapRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement === node) {
        await document.exitFullscreen();
      } else {
        await node.requestFullscreen();
      }
    } catch {
      /* fullscreen may be blocked */
    }
  }

  return (
    <div
      ref={wrapRef}
      className={`voice-video-tile ${tile.source === "screen" ? "is-screen" : ""}`}
    >
      <video ref={ref} autoPlay playsInline muted={tile.local} />
      <span className="voice-video-label">
        {label}
        {tile.source === "screen" ? " — screen" : ""}
      </span>
      <button
        type="button"
        className="voice-video-fs"
        title="Fullscreen"
        aria-label="Fullscreen"
        onClick={() => void toggleFullscreen()}
      >
        <svg viewBox="0 0 24 24" aria-hidden className="voice-icon-svg">
          <path
            fill="currentColor"
            d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z"
          />
        </svg>
      </button>
    </div>
  );
}

export function StateBadge({ kind }: { kind: "muted" | "deafened" }) {
  return (
    <span
      className={`voice-tile-badge is-${kind}`}
      title={kind === "muted" ? "Microphone off" : "Deafened"}
      aria-label={kind === "muted" ? "Microphone off" : "Deafened"}
    >
      {kind === "muted" ? <MicIcon slashed /> : <HearIcon slashed />}
    </span>
  );
}
