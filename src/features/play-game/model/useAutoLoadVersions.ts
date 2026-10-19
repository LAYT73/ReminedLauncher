import { useEffect } from "react";
import { RAIL } from "@/shared/config/routes";
import { useRail } from "@/shared/lib/useRoute";
import { useSessionStore } from "@/entities/session";
import { loadVersions } from "./versions";

/** Load a vanilla edition's manifest when its rail is opened. */
export function useAutoLoadVersions(): void {
  const rail = useRail();
  const inApp = useSessionStore((s) => s.gate === "app");
  useEffect(() => {
    if (!inApp) return;
    if (rail === RAIL.vanilla) void loadVersions("vanilla");
    if (rail === RAIL.reminedVanilla) void loadVersions("remined-vanilla");
  }, [inApp, rail]);
}
