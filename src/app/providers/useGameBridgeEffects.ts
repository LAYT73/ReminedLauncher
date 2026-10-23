import { useEffect } from "react";
import { useFriendBadgeStore } from "@/entities/friend";
import { joinFriendSession } from "@/features/play-game";
import { onGameBridgeEvent } from "@/shared/api/gameBridge";
import { relayStopGameJoin } from "@/shared/api/relay";
import { t } from "@/shared/i18n";
import { useGameBridgeSync } from "@/shared/lib/gameBridgeStore";
import { toast } from "@/shared/lib/toast";

/** Launcher side of the in-game companion bridge (no-op while the mod is not connected). */
export function useGameBridgeEffects(): void {
  useGameBridgeSync();

  // Mod -> launcher. Mute and deafen keys are handled by the voice feature.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onGameBridgeEvent((ev) => {
      if (ev.t === "key" && ev.action === "join" && typeof ev.id === "string") {
        const id = ev.id;
        const row = useFriendBadgeStore
          .getState()
          .rows?.find((r) => r.profile.id === id);
        if (row) void joinFriendSession(row);
      } else if (ev.t === "connect_result" && ev.ok === false) {
        toast(ev.error || t("social.inGame.connectFailed"), "err");
        void relayStopGameJoin().catch(() => undefined);
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
