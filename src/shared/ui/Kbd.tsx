import type { ReactNode } from "react";
import { PixelMouseIcon } from "./PixelIcons";

/** Raised Minecraft-style key cap for hotkey legends. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={className ? `kbd ${className}` : "kbd"}>{children}</kbd>;
}

/** Mouse chip with the left button highlighted. `label` is the accessible name (e.g. "LMB"). */
export function KbdMouse({ label }: { label: string }) {
  return (
    <kbd className="kbd kbd-mouse" role="img" aria-label={label} title={label}>
      <PixelMouseIcon />
    </kbd>
  );
}
