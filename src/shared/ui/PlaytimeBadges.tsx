import {
  formatLastPlayed,
  formatPlaytime,
  hasPlayStats,
  type PlayStats,
} from "@/shared/lib/playtime";

function ClockIcon() {
  return (
    <svg className="playtime-icon" viewBox="0 0 16 16" aria-hidden>
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 4.5V8l2.25 1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="playtime-icon" viewBox="0 0 16 16" aria-hidden>
      <rect
        x="2"
        y="3.5"
        width="12"
        height="10"
        rx="0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M2 6.5h12M5 2v3M11 2v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  );
}

type Props = {
  stats?: PlayStats | null;
  /** Compact row under a friend name. */
  compact?: boolean;
  className?: string;
};

/** Steam-like hours + last played. Hidden when the user has never played. */
export function PlaytimeBadges({ stats, compact, className }: Props) {
  if (!hasPlayStats(stats)) return null;
  const hours = formatPlaytime(stats!.playtimeSeconds);
  const last = formatLastPlayed(stats!.lastPlayedAt);
  if (!hours && !last) return null;
  return (
    <div
      className={`playtime-badges${compact ? " is-compact" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {hours ? (
        <span className="playtime-badge" title={`${stats!.playtimeSeconds}s total`}>
          <ClockIcon />
          <span>{hours} played</span>
        </span>
      ) : null}
      {last ? (
        <span className="playtime-badge" title={stats!.lastPlayedAt ?? undefined}>
          <CalendarIcon />
          <span>{last}</span>
        </span>
      ) : null}
    </div>
  );
}
