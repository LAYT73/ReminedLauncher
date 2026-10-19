import { useEffect } from "react";
import { supabase } from "@/shared/api/supabase";
import { MSG } from "@/shared/config/messages";
import { isBrowserOnline, subscribeConnectivity } from "@/shared/lib/network";
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
      // Token refresh must NOT re-run bootstrap/leaveBoot — that remounts the
      // shell (and tears down LiveKit) and feels like a full launcher reload.
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        useSessionStore.getState().setSession(next);
        return;
      }
      void resolveGate(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
    const clearOfflineTimer = () => {
      if (offlineTimer) {
        clearTimeout(offlineTimer);
        offlineTimer = null;
      }
    };

    const unsub = subscribeConnectivity((online) => {
      const s = useSessionStore.getState();
      if (!online) {
        // WebRTC / Porthole ICE can briefly flip navigator.onLine when a peer
        // joins. Debounce so we don't tear down cloud state mid-call.
        if (s.gate !== "app" || s.offlineMode || offlineTimer) return;
        offlineTimer = setTimeout(() => {
          offlineTimer = null;
          if (isBrowserOnline()) return;
          const cur = useSessionStore.getState();
          if (cur.gate === "app" && !cur.offlineMode) {
            cur.setOfflineMode(true);
            toast(MSG.boot.connectionLost, "err");
          }
        }, 2500);
        return;
      }
      clearOfflineTimer();
      if (s.offlineMode && s.gate === "app") toast(MSG.boot.backOnlineSignIn);
    });
    return () => {
      clearOfflineTimer();
      unsub();
    };
  }, []);
}
