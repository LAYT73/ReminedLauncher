import { useEffect, useRef } from "react";
import { useGameStore } from "@/entities/game";
import type { VoiceRoom } from "@/entities/voice-room";
import { netLog } from "@/shared/api/netLog";
import { onGameBridgeEvent, sendGameBridge, sendGameNotify } from "@/shared/api/gameBridge";
import { relayLanPort } from "@/shared/api/relay";
import { TIMING } from "@/shared/config/timings";
import { useGameBridgePrefs } from "@/shared/lib/gameBridgePrefs";
import { hasBridgeCap, useGameBridgeStore } from "@/shared/lib/gameBridgeStore";
import { t } from "@/shared/i18n";
import { activityBase, gameOnPartyPack } from "../lib/partyState";
import { usePartyJoinStore } from "./partyJoin";

/** Player-facing reason for a failed open_lan (codes from the mod's protocol v3). */
function openFailReason(code: string): string {
  switch (code) {
    case "not_singleplayer":
      return t("voice.party.openReasonNotSingleplayer");
    case "client not ready":
      return t("voice.party.openReasonNotReady");
    case "unsupported":
      return t("voice.party.openReasonUnsupported");
    case "publish_failed":
      return t("voice.party.openReasonPublishFailed");
    default:
      return t("voice.party.openReasonOther");
  }
}

/** In-game note; silent when the mod is not connected or the player turned notifications off. */
function notifyInGame(body: string): void {
  if (!useGameBridgeStore.getState().connected || !useGameBridgePrefs.getState().notifications) {
    return;
  }
  sendGameNotify({ kind: "info", title: t("voice.party.title"), body });
}

function setAutoOpen(roomId: string, status: "failed", reason: string): void;
function setAutoOpen(roomId: string, status: "opening" | "opened" | "unsupported"): void;
function setAutoOpen(roomId: string, status: "opening" | "opened" | "unsupported" | "failed", reason = ""): void {
  const set = usePartyJoinStore.getState().setAutoOpen;
  if (status === "failed") set({ roomId, status, reason });
  else set({ roomId, status });
}

/**
 * Host only. While the host's party pack runs a single-player world (not yet on
 * LAN), ask the companion mod to open it to LAN, once per world entry. Success
 * is confirmed by the game log (useLanHosting then attaches the relay and the
 * room goes 'open'). Failures and a missing `open_lan` capability are reported
 * in-game and in PartyCard; the manual "Esc → Open to LAN" path always remains.
 */
export function usePartyAutoOpen(room: VoiceRoom | null, isHost: boolean): void {
  const phase = useGameStore((s) => s.phase);
  const runningPackId = useGameStore((s) => s.runningPackId);
  const lastLaunchedPackId = useGameStore((s) => s.lastLaunchedPackId);
  const live = useGameStore((s) => s.live);
  const hostingLan = useGameStore((s) => s.hostingLan);
  const connected = useGameBridgeStore((s) => s.connected);
  const caps = useGameBridgeStore((s) => s.caps);
  const roomId = room?.id ?? null;
  const packId = room?.packId ?? null;
  // LAN counts as open only once the relay tunnel is attached to that port.
  const lanSeen = Boolean(
    live?.phase === "lan" && live.lan_port && hostingLan?.gamePort === live.lan_port,
  );
  const inSingleplayer = Boolean(
    isHost &&
      roomId &&
      packId &&
      gameOnPartyPack(
        { phase, runningPackId, lastLaunchedPackId, live, hostingLanPort: hostingLan?.gamePort ?? null },
        packId,
      ) &&
      activityBase(live) === "sp" &&
      !lanSeen,
  );

  /** Room whose current world entry already had its one open_lan attempt. */
  const attempted = useRef<string | null>(null);

  // open_lan replies from the mod.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onGameBridgeEvent((ev) => {
      if (ev.t !== "open_lan_result") return;
      const cur = usePartyJoinStore.getState().autoOpen;
      if (!cur || cur.status !== "opening") return;
      if (ev.ok === true) {
        setAutoOpen(cur.roomId, "opened");
        void netLog("party", `open_lan ok port=${String(ev.port ?? "?")}`);
        notifyInGame(t("voice.party.inGameWorldOpen"));
        return;
      }
      const reason = openFailReason(String(ev.error ?? ""));
      setAutoOpen(cur.roomId, "failed", reason);
      void netLog("party", `open_lan failed: ${String(ev.error ?? "")}`);
      notifyInGame(t("voice.party.inGameOpenFailed", { reason }));
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

  // One attempt per world entry; leaving the world re-arms it.
  useEffect(() => {
    if (!inSingleplayer || !roomId) {
      attempted.current = null;
      if (usePartyJoinStore.getState().autoOpen) usePartyJoinStore.getState().setAutoOpen(null);
      return;
    }
    if (!connected || attempted.current === roomId) return;
    attempted.current = roomId;

    if (!hasBridgeCap("open_lan")) {
      setAutoOpen(roomId, "unsupported");
      notifyInGame(t("voice.party.inGameOpenManual"));
      void netLog("party", "open_lan not advertised by the mod: manual open");
      return;
    }
    setAutoOpen(roomId, "opening");
    void (async () => {
      try {
        const port = await relayLanPort();
        const sent = await sendGameBridge({ t: "open_lan", port });
        if (!sent) setAutoOpen(roomId, "failed", t("voice.party.openReasonNotConnected"));
      } catch {
        setAutoOpen(roomId, "failed", t("voice.party.openReasonOther"));
      }
    })();
    // `caps` re-runs the check when the mod's capabilities arrive after connecting.
  }, [inSingleplayer, roomId, connected, caps]);

  // Confirm the outcome: no reply in time, or open_lan ok but the log never shows the port.
  const autoOpen = usePartyJoinStore((s) => s.autoOpen);
  useEffect(() => {
    if (!autoOpen) return;
    if (autoOpen.status === "opening") {
      const id = window.setTimeout(() => {
        const cur = usePartyJoinStore.getState().autoOpen;
        if (cur && cur.roomId === autoOpen.roomId && cur.status === "opening") {
          setAutoOpen(cur.roomId, "failed", t("voice.party.openReasonNoReply"));
          notifyInGame(t("voice.party.inGameOpenManual"));
        }
      }, TIMING.partyOpenReply);
      return () => window.clearTimeout(id);
    }
    if (autoOpen.status === "opened" && !lanSeen) {
      const id = window.setTimeout(() => {
        const cur = usePartyJoinStore.getState().autoOpen;
        if (cur && cur.roomId === autoOpen.roomId && cur.status === "opened") {
          setAutoOpen(cur.roomId, "failed", t("voice.party.openReasonNotSeen"));
        }
      }, TIMING.partyOpenConfirm);
      return () => window.clearTimeout(id);
    }
  }, [autoOpen, lanSeen]);
}
