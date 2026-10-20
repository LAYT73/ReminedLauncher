import type { FriendRow } from "@/entities/friend";

export type PresenceBadge = {
  status: string;
  kind: string;
  detail?: string;
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
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  try {
    return new Date(ms).toLocaleDateString(undefined, {
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
    const kind = st === "hosting" ? "Hosting" : "Playing";
    const title =
      (pack ? `${kind} ${pack}` : kind) + (voice ? " · in voice" : "");
    return { status: st, kind, detail: pack, voice, title };
  }
  if (st === "online") {
    const title = voice ? "Online · in voice" : "Online";
    return { status: st, kind: "Online", voice, title };
  }

  const when = formatLastSeen(row.sessionUpdatedAt);
  if (when) {
    return {
      status: "offline",
      kind: "Last seen",
      detail: when,
      voice: false,
      title: `Last seen ${when}`,
    };
  }
  return { status: "offline", kind: "Offline", voice: false, title: "Offline" };
}

/** Legacy one-line label (tooltips / plain text). */
export function presenceLabel(row: FriendRow): string {
  return presenceBadge(row).title;
}
