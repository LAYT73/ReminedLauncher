import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useGameStore } from "@/entities/game";
import { setStatus } from "@/entities/install";
import { usePackStore } from "@/entities/pack";
import { useProfileStore } from "@/entities/profile";
import {
  setPartyPack,
  type VoiceMember,
  type VoiceRoom,
} from "@/entities/voice-room";
import { t } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/errors";
import { isReminePackId } from "@/shared/lib/packIds";
import {
  canChangePartyPack,
  derivePrimary,
  isMemberStale,
  type PartyGameSnapshot,
  type PartyPrimary,
} from "../lib/partyState";
import { TIMING } from "@/shared/config/timings";
import { usePartyJoinStore } from "./partyJoin";
import { usePartyInstall } from "./usePartyInstall";
import type { ToastFn, VoicePartyBridge } from "./types";
import { FALLBACK_USERNAME } from "@/shared/config/limits";

type Opts = {
  room: VoiceRoom | null;
  setActive: Dispatch<SetStateAction<VoiceRoom | null>>;
  userId: string;
  isHost: boolean;
  members: VoiceMember[];
  bridge?: VoicePartyBridge;
  onToast: ToastFn;
};

/**
 * Party controls: the single primary button (state machine in partyState.ts),
 * host pack picker, and the play / join actions wired through the bridge.
 */
export function usePartyActions({
  room,
  setActive,
  isHost,
  members,
  bridge,
  onToast,
}: Opts) {
  const [busy, setBusy] = useState(false);

  const phase = useGameStore((s) => s.phase);
  const runningPackId = useGameStore((s) => s.runningPackId);
  const lastLaunchedPackId = useGameStore((s) => s.lastLaunchedPackId);
  const live = useGameStore((s) => s.live);
  const hostingLanPort = useGameStore((s) => s.hostingLan?.gamePort ?? null);
  const installed = usePackStore((s) =>
    room?.packId ? s.installedIds.has(room.packId) : false,
  );
  const { installing, percent } = usePartyInstall(room?.packId ?? null, installed);
  const joinedRoomId = usePartyJoinStore((s) => s.joinedRoomId);

  const hostRow = members.find((m) => m.role === "host");
  const hostName = hostRow?.username || t("voice.aFriend");

  // Re-check member staleness every so often: a silent host turns stale without any event.
  const [, setStaleTick] = useState(0);
  const roomIdForTick = room?.id ?? null;
  useEffect(() => {
    if (!roomIdForTick) return;
    const id = window.setInterval(() => setStaleTick((n) => n + 1), TIMING.partyStaleTick);
    return () => window.clearInterval(id);
  }, [roomIdForTick]);
  // A guest whose host's row is stale treats the room as idle (host seems offline).
  const hostStale = Boolean(room && !isHost && hostRow && isMemberStale(hostRow));

  const primary: PartyPrimary | null = useMemo(() => {
    if (!room) return null;
    const game: PartyGameSnapshot = {
      phase,
      runningPackId,
      lastLaunchedPackId,
      live,
      hostingLanPort,
    };
    return derivePrimary({
      room,
      isHost,
      game,
      installed,
      installing,
      percent,
      joinedRoomId,
      hostStale,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, isHost, phase, runningPackId, lastLaunchedPackId, live, hostingLanPort, installed, installing, percent, joinedRoomId, hostStale]);

  async function onPrimary() {
    if (!room || !room.packId || !primary || busy || !bridge) return;
    const packId = room.packId;
    if (primary.kind === "play") {
      setBusy(true);
      try {
        // Only catalog packs are a profile selection; vanilla editions are picked on their rail.
        const { profile, persist } = useProfileStore.getState();
        if (isReminePackId(packId) && profile.selected_pack !== packId) {
          await persist({ ...profile, selected_pack: packId });
        }
        await bridge.play(packId);
      } catch (err) {
        setStatus(errorMessage(err, ""), "error");
      } finally {
        setBusy(false);
      }
      return;
    }
    if ((primary.kind === "join" || primary.kind === "install") && room.relayShareCode && room.lanPort) {
      setBusy(true);
      try {
        const ok = await bridge.joinWorld({
          packId,
          shareCode: room.relayShareCode,
          port: room.lanPort,
          hostName: hostName || FALLBACK_USERNAME,
        });
        if (ok) usePartyJoinStore.getState().setJoinedRoomId(room.id);
      } finally {
        setBusy(false);
      }
    }
  }

  async function pickPack(packId: string) {
    if (!room || !isHost || busy) return;
    if (packId === room.packId) return;
    if (!canChangePartyPack(room, members)) {
      onToast(t("voice.party.packLocked"), "err");
      return;
    }
    setBusy(true);
    try {
      await setPartyPack(room.id, packId);
      setActive((prev) => (prev && prev.id === room.id ? { ...prev, packId } : prev));
      const { profile, persist } = useProfileStore.getState();
      if (isReminePackId(packId) && profile.selected_pack !== packId) {
        await persist({ ...profile, selected_pack: packId });
      }
    } catch (err) {
      onToast(errorMessage(err, ""), "err");
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    primary,
    hostName,
    canChangePack: room ? canChangePartyPack(room, members) : false,
    pickPack,
    onPrimary,
  };
}
