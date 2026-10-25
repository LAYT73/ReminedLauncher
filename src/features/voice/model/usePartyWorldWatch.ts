import { useEffect, useRef } from "react";
import type { VoiceMember, VoiceRoom } from "@/entities/voice-room";
import { sendGameNotify } from "@/shared/api/gameBridge";
import { useGameBridgePrefs } from "@/shared/lib/gameBridgePrefs";
import { useGameBridgeStore } from "@/shared/lib/gameBridgeStore";
import { notifySystem } from "@/shared/lib/systemNotify";
import { t } from "@/shared/i18n";
import { usePartyJoinStore } from "./partyJoin";

/**
 * Member side: when the host's world opens while I am in the party but not in
 * that world, tell me in-game (with a [J] join action) and on the desktop.
 * Fires on the open transition only, never for the state the room already had.
 */
export function usePartyWorldWatch(
  room: VoiceRoom | null,
  isHost: boolean,
  members: VoiceMember[],
): void {
  const last = useRef<{ roomId: string; gameState: VoiceRoom["gameState"] } | null>(null);
  const roomId = room?.id ?? null;
  const gameState = room?.gameState ?? null;

  useEffect(() => {
    if (!room || !roomId || !gameState) {
      last.current = null;
      return;
    }
    const prev = last.current;
    last.current = { roomId, gameState };
    if (!prev || prev.roomId !== roomId) return;
    if (isHost || gameState !== "open" || prev.gameState === "open") return;
    if (usePartyJoinStore.getState().joinedRoomId === roomId) return;

    const host = members.find((m) => m.role === "host")?.username || t("voice.aFriend");
    if (
      useGameBridgeStore.getState().connected &&
      useGameBridgePrefs.getState().notifications
    ) {
      sendGameNotify({
        kind: "info",
        title: t("voice.party.title"),
        body: t("voice.party.inGameWorldOpened", { host }),
        action: { type: "join", id: `party:${roomId}`, ttl: 30_000 },
      });
    }
    void notifySystem(
      t("shell.notify.partyWorld.title", { host }),
      t("shell.notify.partyWorld.body"),
    );
    // `members` is read for the host name only; a member refresh must not re-announce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, gameState, isHost]);
}
