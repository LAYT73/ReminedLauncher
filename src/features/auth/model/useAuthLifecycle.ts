import { useEffect } from "react";
import { supabase } from "@/shared/api/supabase";
import { MSG } from "@/shared/config/messages";
import { subscribeConnectivity } from "@/shared/lib/network";
import { toast } from "@/shared/lib/toast";
import { applyTheme, DEFAULT_THEME } from "@/entities/theme";
import { loadLocalProfile } from "@/entities/profile";
import { useSessionStore } from "@/entities/session";
import { resolveGate, startBoot } from "./session-actions";

/** Boot flow, Supabase auth subscription and the online/offline watcher. */
export function useAuthLifecycle(): void {
  useEffect(() => {
    // Hydrate the theme ASAP so boot UI never snaps when the profile arrives.
    void loadLocalProfile()
      .then((p) => applyTheme(p.theme))
      .catch(() => applyTheme(DEFAULT_THEME));

    void startBoot();

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // Boot already handles getSession; INITIAL_SESSION would race / re-enter cloud.
      if (event === "INITIAL_SESSION") return;
      if (useSessionStore.getState().offlineMode) return;
      void resolveGate(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(
    () =>
      subscribeConnectivity((online) => {
        const s = useSessionStore.getState();
        if (!online) {
          if (s.gate === "app" && !s.offlineMode) {
            s.setOfflineMode(true);
            toast(MSG.boot.connectionLost, "err");
          }
          return;
        }
        if (s.offlineMode && s.gate === "app") toast(MSG.boot.backOnlineSignIn);
      }),
    [],
  );
}
