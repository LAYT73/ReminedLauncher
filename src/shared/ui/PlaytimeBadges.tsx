import { formatDuration, formatRelativeTime, useT } from "@/shared/i18n";
import { PixelCalendarIcon, PixelClockIcon } from "./PixelIcons";
import {
  hasPlayStats,
  type PlayStats,
} from "@/shared/lib/playtime";

type Props = {
  stats?: PlayStats | null;
  /** Compact row under a friend name. */
  compact?: boolean;
  className?: string;
};

/** Steam-like hours + last played. Hidden when the user has never played. */
export function PlaytimeBadges({ stats, compact, className }: Props) {
  const t = useT();
  if (!hasPlayStats(stats)) return null;
  const seconds = Math.max(0, Math.floor(stats!.playtimeSeconds));
  // Hide the hours badge until at least 1 minute is banked.
  const hours = seconds >= 60 ? formatDuration(seconds / 3600) : null;
  const lastMs = stats!.lastPlayedAt ? Date.parse(stats!.lastPlayedAt) : NaN;
  const last = Number.isNaN(lastMs)
    ? null
    : Date.now() - lastMs < 60_000
      ? t("pack.playtime.justNow")
      : t("pack.playtime.lastLaunch", { when: formatRelativeTime(lastMs) });
  if (!hours && !last) return null;
  return (
    <div
      className={`playtime-badges${compact ? " is-compact" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {hours ? (
        <span className="playtime-badge" title={t("pack.playtime.totalSeconds", { seconds: stats!.playtimeSeconds })}>
          <PixelClockIcon className="playtime-icon" />
          <span>{t("pack.playtime.played", { time: hours })}</span>
        </span>
      ) : null}
      {last ? (
        <span className="playtime-badge" title={stats!.lastPlayedAt ?? undefined}>
          <PixelCalendarIcon className="playtime-icon" />
          <span>{last}</span>
        </span>
      ) : null}
    </div>
  );
}
