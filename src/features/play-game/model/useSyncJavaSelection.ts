import { useEffect } from "react";
import { RAIL } from "@/shared/config/routes";
import { useRail } from "@/shared/lib/useRoute";
import { useActiveReminePack } from "@/entities/pack";
import { useProfileStore } from "@/entities/profile";

/** Entering the Java rail makes the shown Remined pack the profile's selection. */
export function useSyncJavaSelection(): void {
  const rail = useRail();
  const activeId = useActiveReminePack()?.id;
  const selected = useProfileStore((s) => s.profile.selected_pack);
  useEffect(() => {
    if (rail !== RAIL.java || !activeId || selected === activeId) return;
    const { profile, persist } = useProfileStore.getState();
    void persist({ ...profile, selected_pack: activeId });
  }, [rail, activeId, selected]);
}
