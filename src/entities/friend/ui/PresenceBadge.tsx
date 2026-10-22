import { useT } from "@/shared/i18n";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import type { FriendRow } from "../api/friends";
import { presenceBadge } from "../lib/presenceLabel";

/** Live presence badge for a friend row (kind, pack, activity, voice tag). */
export function PresenceBadge({ row }: { row: FriendRow }) {
  const t = useT();
  const p = presenceBadge(row);
  return (
    <StatusBadge tone={p.status} title={p.title}>
      <span className="friend-status-kind">{p.kind}</span>
      {p.detail ? <span className="friend-status-detail">{p.detail}</span> : null}
      {p.activity ? (
        <span className="friend-status-activity">{p.activity}</span>
      ) : null}
      {p.voice ? (
        <span className="friend-status-voice">{t("social.presence.voiceTag")}</span>
      ) : null}
    </StatusBadge>
  );
}
