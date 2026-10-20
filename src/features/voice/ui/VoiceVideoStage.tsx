import type { VoiceMember } from "@/entities/voice-room";
import type { VoiceVideoTile } from "../lib/voiceSession";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { VideoTileView } from "./VoiceBits";

type Props = {
  tiles: VoiceVideoTile[];
  members: VoiceMember[];
};

function tileLabel(tile: VoiceVideoTile, members: VoiceMember[]): string {
  return (
    members.find((m) => m.userId === tile.identity)?.username || FALLBACK_USERNAME
  );
}

/**
 * Discord / Telemost-style stage: one adaptive grid.
 * Screen shares first so they land in the lead cells.
 */
export function VoiceVideoStage({ tiles, members }: Props) {
  const cams = tiles.filter((t) => t.source === "camera");
  const screens = tiles.filter((t) => t.source === "screen");
  const ordered = [...screens, ...cams];
  const count = ordered.length;

  if (count === 0) {
    return (
      <div
        className="voice-video-stage is-empty"
        role="region"
        aria-label="Video"
      >
        <p className="voice-video-empty">Turn on a camera or share your screen.</p>
      </div>
    );
  }

  return (
    <div
      className="voice-video-stage"
      data-count={Math.min(count, 9)}
      role="list"
      aria-label="Video"
    >
      {ordered.map((t) => (
        <VideoTileView
          key={`${t.identity}-${t.source}`}
          tile={t}
          label={tileLabel(t, members)}
        />
      ))}
    </div>
  );
}
