import type { FriendRow } from "../api/friends";
import { getLocale, t } from "@/shared/i18n";
import { activityLabel } from "@/shared/lib/activityLabel";

export type PresenceBadge = {
  status: string;
  kind: string;
  detail?: string;
  /** Localized activity line (menu, singleplayer, ...) when known. */
  activity?: string;
  voice: boolean;
  /** Full line for tooltip / aria. */
  title: string;
};

/** Compact relative time for friend last-seen badges. */
export function formatLastSeen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const diff = Date.now() - ms;
  if (diff < 0) return t("social.presence.justNow");
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return t("social.presence.justNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("social.presence.minAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("social.presence.hrAgo", { n: hr });
  const day = Math.floor(hr / 24);
  if (day === 1) return t("social.presence.yesterday");
  if (day < 7) return t("social.presence.dayAgo", { n: day });
  try {
    return new Date(ms).toLocaleDateString(getLocale(), {
      day: "numeric",
      month: "short",
    });
  } catch {
    return null;
  }
}

/** Badge parts + full title for a friend presence row. */
export function presenceBadge(row: FriendRow): PresenceBadge {
  const st = row.sessionStatus ?? "offline";
  const voice = Boolean(row.sessionInVoice);
  const pack = row.sessionPackName?.trim() || undefined;

  if (st === "in_game" || st === "hosting") {
    const kind =
      st === "hosting"
        ? t("social.presence.hosting")
        : t("social.presence.playing");
    const code = row.sessionActivity?.trim();
    const activity = code ? activityLabel(code) : undefined;
    const title =
      (pack ? `${kind} ${pack}` : kind) +
      (activity ? ` · ${activity}` : "") +
      (voice ? ` · ${t("social.presence.inVoiceSuffix")}` : "");
    return { status: st, kind, detail: pack, activity, voice, title };
  }
  if (st === "online") {
    const title = voice
      ? t("social.presence.onlineInVoice")
      : t("social.presence.online");
    return { status: st, kind: t("social.presence.online"), voice, title };
  }

  const when = formatLastSeen(row.sessionUpdatedAt);
  if (when) {
    return {
      status: "offline",
      kind: t("social.presence.lastSeen"),
      detail: when,
      voice: false,
      title: t("social.presence.lastSeenTitle", { when }),
    };
  }
  const offline = t("social.presence.offline");
  return { status: "offline", kind: offline, voice: false, title: offline };
}

/** Legacy one-line label (tooltips / plain text). */
export function presenceLabel(row: FriendRow): string {
  return presenceBadge(row).title;
}
