import type { FriendRow } from "@/entities/friend";

/** "Playing Pack · in voice" style status line for a friend. */
export function presenceLabel(row: FriendRow): string {
  const st = row.sessionStatus ?? "offline";
  const voice = row.sessionInVoice ? " · in voice" : "";
  if (st === "in_game" || st === "hosting") {
    const pack = row.sessionPackName?.trim();
    if (pack)
      return (st === "hosting" ? `Hosting ${pack}` : `Playing ${pack}`) + voice;
    return (st === "hosting" ? "Hosting" : "In game") + voice;
  }
  if (st === "online") return `Online${voice}`;
  return "Offline";
}
