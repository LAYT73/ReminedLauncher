export type PlayStats = {
  playtimeSeconds: number;
  lastPlayedAt: string | null;
};

export function hasPlayStats(stats: PlayStats | null | undefined): boolean {
  if (!stats) return false;
  // Show as soon as we have a last-launch stamp (even 0s banked).
  return Boolean(stats.lastPlayedAt) || stats.playtimeSeconds >= 30;
}
