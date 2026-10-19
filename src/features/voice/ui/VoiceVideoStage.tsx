import type { VoiceMember } from "@/entities/voice-room";
import type { VoiceVideoTile } from "../lib/voiceSession";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { VideoTileView } from "./VoiceBits";

type Props = {
  tiles: VoiceVideoTile[];
  members: VoiceMember[];
};

/** Discord-style video strip above room content (camera + screen share). */
export function VoiceVideoStage({ tiles, members }: Props) {
  if (tiles.length === 0) return null;
  return (
    <div className="voice-video-stage" role="region" aria-label="Video">
      {tiles.map((t) => (
        <VideoTileView
          key={`${t.identity}-${t.source}`}
          tile={t}
          label={
            members.find((m) => m.userId === t.identity)?.username ||
            FALLBACK_USERNAME
          }
        />
      ))}
    </div>
  );
}
