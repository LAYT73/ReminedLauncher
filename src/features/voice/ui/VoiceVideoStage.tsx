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

/** Cameras on top (horizontal scroll), screen shares below (same). */
export function VoiceVideoStage({ tiles, members }: Props) {
  const cams = tiles.filter((t) => t.source === "camera");
  const screens = tiles.filter((t) => t.source === "screen");
  if (cams.length === 0 && screens.length === 0) return null;

  return (
    <div className="voice-video-stage" role="region" aria-label="Video">
      {cams.length > 0 ? (
        <div
          className="voice-video-strip"
          role="list"
          aria-label="Cameras"
        >
          {cams.map((t) => (
            <VideoTileView
              key={`${t.identity}-${t.source}`}
              tile={t}
              label={tileLabel(t, members)}
            />
          ))}
        </div>
      ) : null}
      {screens.length > 0 ? (
        <div
          className="voice-video-strip is-screens"
          role="list"
          aria-label="Screen shares"
        >
          {screens.map((t) => (
            <VideoTileView
              key={`${t.identity}-${t.source}`}
              tile={t}
              label={tileLabel(t, members)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
