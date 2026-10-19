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

export function VideoTileView({ tile, label }: { tile: VoiceVideoTile; label: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    tile.track.attach(el);
    return () => {
      tile.track.detach(el);
    };
  }, [tile.track]);
  return (
    <div className={`voice-video-tile ${tile.source === "screen" ? "is-screen" : ""}`}>
      <video ref={ref} autoPlay playsInline muted={tile.local} />
      <span className="voice-video-label">
        {label}
        {tile.source === "screen" ? " - screen" : ""}
      </span>
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
