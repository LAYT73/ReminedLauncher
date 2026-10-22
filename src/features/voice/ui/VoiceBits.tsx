import { useEffect, useRef } from "react";
import {
  PixelFullscreenIcon,
  PixelHeadphonesIcon,
  PixelHeadphonesOffIcon,
  PixelInviteIcon,
  PixelLeaveIcon,
  PixelMicIcon,
  PixelMicOffIcon,
  PixelScreenIcon,
  PixelScreenOffIcon,
  PixelVideoIcon,
  PixelVideoOffIcon,
} from "@/shared/ui/PixelIcons";
import { tIn, useT, type TKey, LOCALES } from "@/shared/i18n";
import type { VoiceVideoTile } from "../lib/voiceSession";

export function statusTone(
  status: string,
): "ok" | "warn" | "bad" | "idle" {
  const s = status.toLowerCase();
  // Match against every locale's keywords so the tone survives a language switch.
  const has = (key: TKey) =>
    LOCALES.some(({ id }) => tIn(id, key).split("|").some((k) => s.includes(k)));
  if (has("voice.tone.ok")) return "ok";
  if (has("voice.tone.bad")) return "bad";
  if (has("voice.tone.warn")) return "warn";
  return "idle";
}

type SlashProps = { slashed?: boolean };
const VI = "voice-icon-svg";

export function MicIcon({ slashed }: SlashProps) {
  return slashed ? <PixelMicOffIcon className={VI} /> : <PixelMicIcon className={VI} />;
}

export function HearIcon({ slashed }: SlashProps) {
  return slashed ? (
    <PixelHeadphonesOffIcon className={VI} />
  ) : (
    <PixelHeadphonesIcon className={VI} />
  );
}

export function CamIcon({ slashed }: SlashProps) {
  return slashed ? <PixelVideoOffIcon className={VI} /> : <PixelVideoIcon className={VI} />;
}

export function ScreenIcon({ slashed }: SlashProps) {
  return slashed ? <PixelScreenOffIcon className={VI} /> : <PixelScreenIcon className={VI} />;
}

/** Person + plus — invite friend. */
export function InviteIcon() {
  return <PixelInviteIcon className={VI} />;
}

/** Door + arrow — leave room. */
export function LeaveIcon() {
  return <PixelLeaveIcon className={VI} />;
}

export function VideoTileView({ tile, label }: { tile: VoiceVideoTile; label: string }) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const media = tile.track.mediaStreamTrack;
    if (!media || media.readyState !== "live") return;
    tile.track.attach(el);
    const kickPlay = () => {
      void el.play().catch(() => undefined);
    };
    kickPlay();
    const clear = () => {
      try {
        tile.track.detach(el);
      } catch {
        /* ignore */
      }
      el.pause();
      el.removeAttribute("src");
      el.srcObject = null;
      el.load();
    };
    const onEnded = () => clear();
    // Remotes often land muted until the first frame — play again on unmute.
    media.addEventListener("ended", onEnded);
    media.addEventListener("unmute", kickPlay);
    return () => {
      media.removeEventListener("ended", onEnded);
      media.removeEventListener("unmute", kickPlay);
      clear();
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
        {tile.source === "screen" ? t("voice.stage.screenSuffix") : ""}
      </span>
      <button
        type="button"
        className="voice-video-fs"
        title={t("voice.stage.fullscreen")}
        aria-label={t("voice.stage.fullscreen")}
        onClick={() => void toggleFullscreen()}
      >
        <PixelFullscreenIcon className={VI} />
      </button>
    </div>
  );
}

export function StateBadge({ kind }: { kind: "muted" | "deafened" }) {
  const t = useT();
  const label =
    kind === "muted" ? t("voice.members.micOff") : t("voice.members.deafened");
  return (
    <span
      className={`voice-tile-badge is-${kind}`}
      title={label}
      aria-label={label}
    >
      {kind === "muted" ? <MicIcon slashed /> : <HearIcon slashed />}
    </span>
  );
}
