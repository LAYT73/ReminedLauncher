import type { ReactNode } from "react";

/** Compact pixel badge (same look as the Friends presence badge). */
export function StatusBadge({
  tone,
  title,
  className = "",
  children,
}: {
  /** Maps to `.friend-status-badge.is-<tone>` (online, offline, pending, host, connecting, ...). */
  tone: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`friend-status-badge is-${tone} ${className}`.trim()}
      title={title}
      aria-label={title}
    >
      {children}
    </span>
  );
}
