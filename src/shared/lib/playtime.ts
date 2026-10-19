/** Format cumulative seconds like Steam ("12.4 hours" / "42 minutes"). */
export function formatPlaytime(seconds: number): string | null {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return null; // hide badge until at least 1 minute
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return m === 1 ? "1 minute" : `${m} minutes`;
  }
  const hours = s / 3600;
  if (hours < 10) return `${hours.toFixed(1)} hours`;
  if (hours < 100) return `${hours.toFixed(1)} hours`;
  return `${Math.floor(hours)} hours`;
}

/** Relative last-launch label; null if never. */
export function formatLastPlayed(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  if (diff < 0) return "Last launch just now";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Last launch just now";
  if (min < 60) return `Last launch ${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Last launch ${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 14) return `Last launch ${days}d ago`;
  try {
    return `Last launch ${new Date(t).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;
  } catch {
    return "Last launch";
  }
}

export type PlayStats = {
  playtimeSeconds: number;
  lastPlayedAt: string | null;
};

export function hasPlayStats(stats: PlayStats | null | undefined): boolean {
  if (!stats) return false;
  // Show as soon as we have a last-launch stamp (even 0s banked).
  return Boolean(stats.lastPlayedAt) || stats.playtimeSeconds >= 30;
}
