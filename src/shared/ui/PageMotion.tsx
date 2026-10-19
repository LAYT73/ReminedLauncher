import type { ReactNode } from "react";

type Props = {
  /** Changes remount the panel and replay the enter motion. */
  viewKey: string;
  children: ReactNode;
  className?: string;
};

/**
 * Snappy content enter (translate only).
 * Wrap copy panels — never heroes, wallpapers, or scrims.
 *
 * Outer shell clips transform overflow so translateY cannot grow the
 * parent scrollport during the enter animation.
 */
export function PageMotion({ viewKey, children, className }: Props) {
  return (
    <div
      className={["page-motion-shell", className].filter(Boolean).join(" ")}
    >
      <div key={viewKey} className="page-motion">
        {children}
      </div>
    </div>
  );
}
