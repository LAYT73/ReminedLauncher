import type { FriendRow } from "@/entities/friend";

export type PresenceBadge = {
  status: string;
  kind: string;
  detail?: string;
  voice: boolean;
  /** Full line for tooltip / aria. */
  title: string;
};

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
  return { status: "offline", kind: "Offline", voice: false, title: "Offline" };
}

/** Legacy one-line label (tooltips / plain text). */
export function presenceLabel(row: FriendRow): string {
  return presenceBadge(row).title;
}
