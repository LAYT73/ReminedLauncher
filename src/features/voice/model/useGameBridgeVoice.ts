import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { VoiceMember, VoiceRoom } from "@/entities/voice-room";
import { sendGameHead } from "@/entities/skin";
import {
  onGameBridgeEvent,
  sendGameBridge,
  type GameBridgeMessage,
} from "@/shared/api/gameBridge";
import { FALLBACK_USERNAME } from "@/shared/config/limits";
import { useGameBridgePrefs } from "@/shared/lib/gameBridgePrefs";
import { useGameBridgeStore } from "@/shared/lib/gameBridgeStore";
import type { VoiceSession } from "../lib/voiceSession";

const SNAPSHOT_THROTTLE_MS = 100;
/** Remote mute/deafen changes carry no event here, so the snapshot is re-checked on this tick. */
const SNAPSHOT_POLL_MS = 1000;

type Args = {
  userId: string;
  room: VoiceRoom | null;
  /** Changes whenever the live session connects or drops; re-evaluates the snapshot. */
  status: string;
  speaking: Record<string, boolean>;
  members: VoiceMember[];
  muted: boolean;
  deafened: boolean;
  sessionRef: RefObject<VoiceSession | null>;
  toggleMute: () => void;
  toggleDeafen: () => void;
};

/**
 * In-game voice HUD and keys (only when the companion mod is connected).
 * Sends a full `voice` snapshot on every change (100 ms trailing throttle), or
 * `active:false` when voice ends or the HUD is off. Handles the mod's mute and deafen keys.
 * Mounted once by VoicePanel.
 */
export function useGameBridgeVoice({
  userId,
  room,
  status,
  speaking,
  members,
  muted,
  deafened,
  sessionRef,
  toggleMute,
  toggleDeafen,
}: Args): void {
  const connected = useGameBridgeStore((s) => s.connected);
  const hudOn = useGameBridgePrefs((s) => s.voiceHud);

  const toggleMuteRef = useRef(toggleMute);
  toggleMuteRef.current = toggleMute;
  const toggleDeafenRef = useRef(toggleDeafen);
  toggleDeafenRef.current = toggleDeafen;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onGameBridgeEvent((ev) => {
      if (ev.t !== "key" || !sessionRef.current) return;
      if (ev.action === "mute") toggleMuteRef.current();
      else if (ev.action === "deafen") toggleDeafenRef.current();
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
  }, [sessionRef]);

  // Latest inputs for the throttled sender (read at send time, not at schedule time).
  const latestRef = useRef({ userId, room, speaking, members, muted, deafened, hudOn, sessionRef });
  useLayoutEffect(() => {
    latestRef.current = { userId, room, speaking, members, muted, deafened, hudOn, sessionRef };
  });

  const lastJsonRef = useRef("");
  const lastSentAtRef = useRef(0);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Last snapshot the mod received was `active: true`, so unmount must send `active: false`. */
  const activeSentRef = useRef(false);

  const sendSnapshot = useCallback(() => {
    timerRef.current = null;
    const l = latestRef.current;
    const sess = l.sessionRef.current;
    const snap: GameBridgeMessage =
      !sess || !l.room || !l.hudOn
        ? { t: "voice", active: false }
        : {
            t: "voice",
            active: true,
            room: l.room.title,
            self: l.userId,
            selfMuted: l.muted,
            selfDeafened: l.deafened,
            members: l.members.map((m) => {
              const st =
                m.userId === l.userId
                  ? { muted: sess.isMuted(), deafened: sess.isDeafened() }
                  : sess.getParticipantState(m.userId);
              return {
                id: m.userId,
                name: m.username || FALLBACK_USERNAME,
                speaking: Boolean(l.speaking[m.userId]),
                muted: st.muted,
                deafened: st.deafened,
              };
            }),
          };
    const json = JSON.stringify(snap);
    if (json === lastJsonRef.current) return;
    lastJsonRef.current = json;
    lastSentAtRef.current = Date.now();
    const seq = ++seqRef.current;
    // Heads go first so the mod can draw every member in this snapshot.
    const heads = snap.active
      ? l.members.map((m) => sendGameHead(m.userId, m.skinPath))
      : [];
    void Promise.all(heads).then(() => {
      if (seq === seqRef.current) {
        activeSentRef.current = snap.active === true;
        void sendGameBridge(snap);
      }
    });
  }, []);

  useEffect(() => {
    if (!connected) {
      // Next connection gets a fresh snapshot.
      lastJsonRef.current = "";
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }
    if (timerRef.current) return;
    const wait = Math.max(0, SNAPSHOT_THROTTLE_MS - (Date.now() - lastSentAtRef.current));
    timerRef.current = setTimeout(sendSnapshot, wait);
  }, [connected, hudOn, room, status, speaking, members, muted, deafened, userId, sendSnapshot]);

  // Participant mute/deafen state is not in the React inputs above, so poll while voice is live.
  useEffect(() => {
    if (!connected || !hudOn || !room) return;
    const id = window.setInterval(() => {
      if (!timerRef.current) timerRef.current = setTimeout(sendSnapshot, 0);
    }, SNAPSHOT_POLL_MS);
    return () => window.clearInterval(id);
  }, [connected, hudOn, room, sendSnapshot]);

  useEffect(
    () => () => {
      seqRef.current++;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (activeSentRef.current) {
        activeSentRef.current = false;
        void sendGameBridge({ t: "voice", active: false });
      }
    },
    [],
  );
}
