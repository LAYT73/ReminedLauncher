import type { VoiceMember } from "@/entities/voice-room";
import type { VoiceVideoTile } from "../lib/voiceSession";
import { useT } from "@/shared/i18n";
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
  const t = useT();
  const cams = tiles.filter((x) => x.source === "camera");
  const screens = tiles.filter((x) => x.source === "screen");
  const ordered = [...screens, ...cams];
  const count = ordered.length;

  if (count === 0) {
    return (
      <div
        className="voice-video-stage is-empty"
        role="region"
        aria-label={t("voice.stage.video")}
      >
        <p className="voice-video-empty">{t("voice.stage.empty")}</p>
      </div>
    );
  }

  return (
    <div
      className="voice-video-stage"
      data-count={Math.min(count, 9)}
      role="list"
      aria-label={t("voice.stage.video")}
    >
      {ordered.map((tile) => (
        <VideoTileView
          key={`${tile.identity}-${tile.source}`}
          tile={tile}
          label={tileLabel(tile, members)}
        />
      ))}
    </div>
  );
}
