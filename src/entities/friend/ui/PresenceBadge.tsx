import { useT } from "@/shared/i18n";
import { PixelMicIcon } from "@/shared/ui/PixelIcons";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import type { FriendRow } from "../api/friends";
import { presenceBadge } from "../lib/presenceLabel";

/** Live presence badge for a friend row (short activity, voice icon). Full text is the tooltip. */
export function PresenceBadge({ row }: { row: FriendRow }) {
  const t = useT();
  const p = presenceBadge(row);
  return (
    <StatusBadge tone={p.status} title={p.title}>
      <span className="friend-status-kind">{p.label}</span>
      {p.detail ? <span className="friend-status-detail">{p.detail}</span> : null}
      {p.voice ? (
        <span
          className="friend-status-voice"
          role="img"
          aria-label={t("social.presence.inVoiceSuffix")}
        >
          <PixelMicIcon />
        </span>
      ) : null}
    </StatusBadge>
  );
}
