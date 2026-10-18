import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { listFriendships, type FriendRow } from "../lib/friends";
import { McSelect } from "./McSelect";
import {
  idleVoiceRuntimeModal,
  VoiceRuntimeModal,
  type VoiceRuntimeModalState,
} from "./VoiceRuntimeModal";
import {
  closeVoiceRoom,
  createVoiceRoom,
  inviteFriendToRoom,
  leaveVoiceRoom,
  listMessages,
  listMyOpenRooms,
  listPendingInvites,
  listRoomMembers,
  respondVoiceInvite,
  sendMessage,
  setVoiceRoomShareCode,
  subscribeInvites,
  subscribeRoomChat,
  type VoiceInvite,
  type VoiceMember,
  type VoiceMessage,
  type VoiceRoom,
} from "../lib/voiceRooms";
import {
  voiceEnsureRuntime,
  voiceGuestConnect,
  voiceLog,
  voiceStartLivekit,
  voiceStartPorthole,
  voiceStopHost,
} from "../lib/voiceNative";
import { VoiceSession } from "../lib/voiceSession";
import { SkinHead } from "./SkinHead";
import { InfoNote } from "./InfoNote";
import { VoiceDevicesModal } from "./VoiceDevicesModal";

type Props = {
  userId: string;
  displayName: string;
  onToast: (msg: string, tone?: "default" | "ok" | "err") => void;
  onOpenNetworkPlay?: () => void;
  onRoomStatusChange?: (inRoom: boolean) => void;
  /** Pending invite count — drives the badge on the Voice tab. */
  onInvitesChange?: (count: number) => void;
};

function statusTone(
  status: string,
): "ok" | "warn" | "bad" | "idle" {
  const s = status.toLowerCase();
  if (s.includes("in voice")) return "ok";
  if (s.includes("disconnect") || s.includes("fail")) return "bad";
  if (s.includes("connect") || s.includes("start") || s.includes("prepar")) {
    return "warn";
  }
  return "idle";
}

function MicIcon({ slashed }: { slashed?: boolean }) {
  return (
    <svg className="voice-icon-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V20h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0z"
      />
      {slashed ? (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          d="M5 5l14 14"
        />
      ) : null}
    </svg>
  );
}

function HearIcon({ slashed }: { slashed?: boolean }) {
  return (
    <svg className="voice-icon-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 3a7 7 0 0 0-7 7v3.2c0 .7-.3 1.4-.8 1.9L3 16.3A1.5 1.5 0 0 0 4.1 19h2.4A2.5 2.5 0 0 0 9 16.5V12H7v-2a5 5 0 0 1 10 0v2h-2v4.5A2.5 2.5 0 0 0 17.5 19h2.4A1.5 1.5 0 0 0 21 16.3l-1.2-1.2c-.5-.5-.8-1.2-.8-1.9V10a7 7 0 0 0-7-7z"
      />
      {slashed ? (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          d="M5 5l14 14"
        />
      ) : null}
    </svg>
  );
}

export function VoicePanel({
  userId,
  displayName,
  onToast,
  onOpenNetworkPlay,
  onRoomStatusChange,
  onInvitesChange,
}: Props) {
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [invites, setInvites] = useState<VoiceInvite[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [active, setActive] = useState<VoiceRoom | null>(null);
  const [members, setMembers] = useState<VoiceMember[]>([]);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("Squad");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [micId, setMicId] = useState("");
  const [outputId, setOutputId] = useState("");
  const [invitePick, setInvitePick] = useState("");
  const [runtimeModal, setRuntimeModal] = useState<VoiceRuntimeModalState>(
    idleVoiceRuntimeModal,
  );
  const sessionRef = useRef<VoiceSession | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const membersRef = useRef<VoiceMember[]>([]);
  /** Invite ids we've already announced — so we only toast on genuinely new ones. */
  const seenInvitesRef = useRef<Set<string> | null>(null);
  const isHost = active?.hostId === userId;

  const beginRuntimeModal = useCallback(() => {
    setRuntimeModal({
      open: true,
      phase: "Voice",
      message: "Preparing…",
      percent: 4,
      error: null,
    });
  }, []);

  const closeRuntimeModal = useCallback(() => {
    setRuntimeModal(idleVoiceRuntimeModal());
  }, []);

  membersRef.current = members;

  const resetActiveUi = useCallback(() => {
    setActive(null);
    setMessages([]);
    setMembers([]);
    setSpeaking({});
    setStatus("");
    setMuted(false);
    setDeafened(false);
    onRoomStatusChange?.(false);
  }, [onRoomStatusChange]);

  const refreshLists = useCallback(async () => {
    try {
      const [r, i, f] = await Promise.all([
        listMyOpenRooms(userId),
        listPendingInvites(userId),
        listFriendships(userId),
      ]);
      setRooms(r);
      setInvites(i);
      setFriends(f);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setListsLoading(false);
    }
  }, [userId, onToast]);

  useEffect(() => {
    void refreshLists();
    return subscribeInvites(userId, () => {
      void refreshLists();
    });
  }, [userId, refreshLists]);

  // Keep the Voice-tab badge in sync with the pending-invite count.
  useEffect(() => {
    onInvitesChange?.(invites.length);
  }, [invites.length, onInvitesChange]);

  // Toast when a genuinely new invite arrives (not on the initial load).
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  useEffect(() => {
    const current = new Set(invites.map((i) => i.id));
    const seen = seenInvitesRef.current;
    if (seen === null) {
      // First load — remember what's already there, don't announce.
      seenInvitesRef.current = current;
      return;
    }
    const fresh = invites.filter((i) => !seen.has(i.id));
    seenInvitesRef.current = current;
    if (fresh.length === 0) return;
    const first = fresh[0];
    onToastRef.current(
      `${first.fromName || "A friend"} invited you to ${
        first.roomTitle || "a voice room"
      }`,
      "ok",
    );
  }, [invites]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      void sessionRef.current?.disconnect();
      sessionRef.current = null;
    };
  }, []);

  async function enterLiveKit(room: VoiceRoom, asGuest: boolean) {
    setStatus(asGuest ? "Connecting Porthole…" : "Connecting voice…");
    if (asGuest) {
      if (!room.portholeShareCode) {
        throw new Error("Room has no share code");
      }
      await voiceGuestConnect(room.portholeShareCode);
    }
    const session = new VoiceSession({
      onParticipants: () => {
        void listRoomMembers(room.id).then(setMembers);
      },
      onSpeaking: (id, on) => {
        setSpeaking((prev) => ({ ...prev, [id]: on }));
      },
      onDisconnected: () => {
        setStatus("Voice disconnected");
      },
      onError: (m) => onToast(m, "err"),
    });
    await session.connect({
      wsUrl: room.lkWsUrl || "ws://127.0.0.1:7880",
      roomId: room.id,
      identity: userId,
      name: displayName,
      micDeviceId: micId || undefined,
      outputDeviceId: outputId || undefined,
    });
    sessionRef.current = session;
    setMuted(false);
    setDeafened(false);
    setStatus("In voice");
  }

  async function openRoomSession(room: VoiceRoom, asGuest: boolean) {
    setActive(room);
    try {
      const [msgs, mems] = await Promise.all([
        listMessages(room.id),
        listRoomMembers(room.id),
      ]);
      setMessages(msgs);
      setMembers(mems);
      await enterLiveKit(room, asGuest);
      await refreshLists();
      onRoomStatusChange?.(true);
    } catch (err) {
      await sessionRef.current?.disconnect().catch(() => undefined);
      sessionRef.current = null;
      if (!asGuest) voiceStopHost().catch(() => undefined);
      resetActiveUi();
      throw err;
    }
  }

  async function onCreate() {
    if (busy) return;
    setBusy(true);
    beginRuntimeModal();
    setStatus("Preparing voice…");
    const unlisten = await listen<{
      phase: string;
      message: string;
      percent: number;
    }>("voice-runtime-progress", (ev) => {
      setRuntimeModal((prev) =>
        prev.open
          ? {
              ...prev,
              phase: ev.payload.phase || prev.phase,
              message: ev.payload.message || prev.message,
              percent: ev.payload.percent ?? prev.percent,
              error: null,
            }
          : prev,
      );
    });
    try {
      await voiceEnsureRuntime();
      setRuntimeModal((prev) => ({
        ...prev,
        message: "Starting voice server…",
        percent: Math.max(prev.percent, 85),
      }));
      setStatus("Starting voice server…");
      // LiveKit first — host WebRTC must succeed before Porthole binds the same ports.
      const livekit = await voiceStartLivekit();
      const room = await createVoiceRoom({
        hostId: userId,
        title,
        shareCode: "",
        wsUrl: livekit.ws_url,
        tcpPort: livekit.tcp_port,
        udpStart: livekit.udp_start,
        udpEnd: livekit.udp_end,
      });
      setRuntimeModal((prev) => ({
        ...prev,
        message: "Connecting voice…",
        percent: 93,
      }));
      await openRoomSession(room, false);
      setRuntimeModal((prev) => ({
        ...prev,
        message: "Opening Porthole…",
        percent: 96,
      }));
      setStatus("Opening Porthole…");
      const ready = await voiceStartPorthole();
      await setVoiceRoomShareCode(room.id, ready.share_code);
      setActive((prev) =>
        prev
          ? { ...prev, portholeShareCode: ready.share_code }
          : { ...room, portholeShareCode: ready.share_code },
      );
      setStatus("In voice");
      closeRuntimeModal();
      onToast("Voice room live", "ok");
    } catch (err) {
      voiceStopHost().catch(() => undefined);
      resetActiveUi();
      const msg = err instanceof Error ? err.message : String(err);
      void voiceLog("ui", `onCreate FAILED: ${msg}`);
      setRuntimeModal((prev) => ({
        ...prev,
        open: true,
        error: msg,
        percent: 0,
        message: "Failed",
      }));
    } finally {
      unlisten();
      setBusy(false);
    }
  }

  async function onAcceptInvite(inv: VoiceInvite) {
    if (busy) return;
    setBusy(true);
    setStatus("Accepting invite…");
    try {
      // Switching rooms: leave the current one first so the old session/SFU
      // does not linger (and so we don't keep hosting a dead room).
      if (active && active.id !== inv.roomId) {
        await sessionRef.current?.disconnect().catch(() => undefined);
        sessionRef.current = null;
        if (active.hostId === userId) {
          await closeVoiceRoom(active.id).catch(() => undefined);
          voiceStopHost().catch(() => undefined);
        } else {
          await leaveVoiceRoom(active.id, userId).catch(() => undefined);
        }
        resetActiveUi();
      }
      const room = await respondVoiceInvite(inv.id, true, userId);
      if (!room) throw new Error("Room unavailable");
      await openRoomSession(room, true);
      onToast("Joined voice room", "ok");
    } catch (err) {
      resetActiveUi();
      onToast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setBusy(false);
    }
  }

  async function onDeclineInvite(inv: VoiceInvite) {
    try {
      await respondVoiceInvite(inv.id, false, userId);
      await refreshLists();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "err");
    }
  }

  async function onLeave() {
    setBusy(true);
    try {
      await sessionRef.current?.disconnect();
      sessionRef.current = null;
      if (active && isHost) {
        await closeVoiceRoom(active.id);
        voiceStopHost();
      }
      resetActiveUi();
      await refreshLists();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setBusy(false);
    }
  }

  async function onInvite() {
    if (!active || !invitePick) return;
    try {
      await inviteFriendToRoom({
        roomId: active.id,
        fromId: userId,
        toId: invitePick,
      });
      setInvitePick("");
      onToast("Invite sent", "ok");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "err");
    }
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !draft.trim()) return;
    const body = draft.trim();
    setDraft("");
    try {
      const msg = await sendMessage({
        roomId: active.id,
        senderId: userId,
        body,
      });
      const selfMember = membersRef.current.find((m) => m.userId === userId);
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id)
          ? prev
          : [
              ...prev,
              {
                ...msg,
                senderName: selfMember?.username || displayName,
                senderSkinPath: selfMember?.skinPath ?? null,
              },
            ],
      );
    } catch (err) {
      setDraft(body);
      onToast(err instanceof Error ? err.message : String(err), "err");
    }
  }

  async function onRejoin(room: VoiceRoom) {
    if (busy) return;
    setBusy(true);
    try {
      await openRoomSession(room, room.hostId !== userId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setBusy(false);
    }
  }

  async function onCloseListedRoom(room: VoiceRoom) {
    if (busy) return;
    setBusy(true);
    try {
      if (room.hostId === userId) {
        await closeVoiceRoom(room.id);
        voiceStopHost();
        onToast("Room closed", "ok");
      } else {
        await leaveVoiceRoom(room.id, userId);
        onToast("Left room", "ok");
      }
      if (active?.id === room.id) {
        await sessionRef.current?.disconnect().catch(() => undefined);
        sessionRef.current = null;
        resetActiveUi();
      }
      await refreshLists();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "err");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    return subscribeRoomChat(active.id, (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const member = membersRef.current.find(
          (m) => m.userId === msg.senderId,
        );
        const name =
          member?.username ||
          (msg.senderId === userId ? displayName : "Player");
        return [
          ...prev,
          { ...msg, senderName: name, senderSkinPath: member?.skinPath ?? null },
        ];
      });
    });
  }, [active, userId, displayName]);

  const inviteOptions = useMemo(
    () =>
      friends
        .filter((f) => f.direction === "friend")
        .map((f) => ({
          id: f.profile.id,
          label: f.profile.username || "Friend",
          hint: f.profile.remined_id ? `#${f.profile.remined_id}` : undefined,
        })),
    [friends],
  );
  const tone = statusTone(status);

  const devicesModal = (
    <VoiceDevicesModal
      open={devicesOpen}
      session={sessionRef.current}
      micId={micId}
      outputId={outputId}
      onClose={() => setDevicesOpen(false)}
      onApply={(mic, out) => {
        setMicId(mic);
        setOutputId(out);
        if (mic) void sessionRef.current?.switchMic(mic);
        if (out) void sessionRef.current?.switchOutput(out);
        onToast("Devices updated", "ok");
      }}
    />
  );

  const runtimeUi = (
    <VoiceRuntimeModal
      state={runtimeModal}
      onClose={closeRuntimeModal}
      onRetry={() => {
        closeRuntimeModal();
        void onCreate();
      }}
    />
  );

  if (active) {
    return (
      <section className="section voice-panel">
        <div className="page-title-row">
          <h2 className="page-title">{active.title}</h2>
          <div className="network-status-badges" aria-live="polite">
            <span className={`network-pill is-${tone}`}>
              <span className="network-pill-dot" aria-hidden />
              <span className="network-pill-label">Voice</span>
              <span className="network-pill-value">
                {status || "Idle"}
              </span>
            </span>
            <span
              className={`network-pill is-${isHost ? "ok" : "idle"}`}
            >
              <span className="network-pill-dot" aria-hidden />
              <span className="network-pill-label">Role</span>
              <span className="network-pill-value">
                {isHost ? "Host" : "Guest"}
              </span>
            </span>
          </div>
        </div>

        {invites.length > 0 ? (
          <div className="voice-invite-banner" role="status" aria-live="polite">
            {invites.map((inv) => (
              <div key={inv.id} className="voice-invite-banner-row">
                <SkinHead
                  skinUrl={inv.fromSkinPath ?? null}
                  className="voice-invite-banner-avatar"
                  size={28}
                />
                <div className="voice-invite-banner-copy">
                  <strong>{inv.fromName || "A friend"}</strong> invited you to{" "}
                  <strong>{inv.roomTitle || "a voice room"}</strong>
                </div>
                <div className="voice-invite-banner-actions">
                  <button
                    type="button"
                    className="btn-mc ok"
                    disabled={busy}
                    onClick={() => void onAcceptInvite(inv)}
                  >
                    Join
                  </button>
                  <button
                    type="button"
                    className="btn-mc dim"
                    disabled={busy}
                    onClick={() => void onDeclineInvite(inv)}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {active.portholeShareCode ? (
          <p className="friends-lead voice-code-lead">
            Porthole code{" "}
            <button
              type="button"
              className="friend-id"
              onClick={() => {
                void navigator.clipboard.writeText(active.portholeShareCode!);
                onToast("Copied share code");
              }}
            >
              {active.portholeShareCode}
            </button>
          </p>
        ) : null}

        <div className="voice-room-toolbar">
          <div className="voice-icon-group" role="group" aria-label="Voice controls">
            <button
              type="button"
              className={`voice-icon-btn ${muted ? "is-off" : "is-on"}`}
              aria-pressed={!muted}
              title={muted ? "Unmute microphone" : "Mute microphone"}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              onClick={() => {
                const next = !muted;
                setMuted(next);
                void sessionRef.current?.setMuted(next);
              }}
            >
              <MicIcon slashed={muted} />
            </button>
            <button
              type="button"
              className={`voice-icon-btn ${deafened ? "is-off" : "is-on"}`}
              aria-pressed={!deafened}
              title={deafened ? "Undeafen" : "Deafen"}
              aria-label={deafened ? "Undeafen" : "Deafen"}
              onClick={() => {
                const next = !deafened;
                setDeafened(next);
                sessionRef.current?.setDeafened(next);
              }}
            >
              <HearIcon slashed={deafened} />
            </button>
            <button
              type="button"
              className="voice-icon-btn is-neutral"
              title="Devices"
              aria-label="Voice devices"
              onClick={() => setDevicesOpen(true)}
            >
              <svg className="voice-icon-svg" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-6a1 1 0 0 1 1 1v1.07a7.96 7.96 0 0 1 2.86 1.18l.76-.76a1 1 0 1 1 1.41 1.41l-.76.76A7.96 7.96 0 0 1 18.93 11H20a1 1 0 1 1 0 2h-1.07a7.96 7.96 0 0 1-1.18 2.86l.76.76a1 1 0 1 1-1.41 1.41l-.76-.76A7.96 7.96 0 0 1 13 18.93V20a1 1 0 1 1-2 0v-1.07a7.96 7.96 0 0 1-2.86-1.18l-.76.76a1 1 0 1 1-1.41-1.41l.76-.76A7.96 7.96 0 0 1 5.07 13H4a1 1 0 1 1 0-2h1.07a7.96 7.96 0 0 1 1.18-2.86l-.76-.76a1 1 0 1 1 1.41-1.41l.76.76A7.96 7.96 0 0 1 11 4.07V3a1 1 0 0 1 1-1z"
                />
              </svg>
            </button>
          </div>
          <div className="voice-room-actions">
            <button
              type="button"
              className="btn-mc danger"
              disabled={busy}
              onClick={() => void onLeave()}
            >
              {isHost ? "End room" : "Leave"}
            </button>
          </div>
        </div>

        <div className="voice-room-grid">
          <div className="voice-col">
            <h3 className="settings-heading">In room</h3>
            {members.length === 0 ? (
              <p className="friends-muted">Waiting for members…</p>
            ) : (
              <ul className="friends-list voice-member-list">
                {members.map((m) => (
                  <li
                    key={m.userId}
                    className={`friend-row voice-member-row ${
                      speaking[m.userId] ? "is-speaking" : ""
                    }`}
                  >
                    <SkinHead
                      skinUrl={m.skinPath ?? null}
                      className="friend-avatar"
                      size={40}
                    />
                    <div className="friend-copy">
                      <strong>
                        {m.username || "Player"}
                        {m.userId === userId ? " (you)" : ""}
                      </strong>
                      <span className="friend-id-static">
                        {m.role === "host" ? "Host" : "Member"}
                      </span>
                    </div>
                    <span
                      className={`friend-status ${
                        speaking[m.userId] ? "is-online" : ""
                      }`}
                    >
                      {speaking[m.userId] ? "Talking" : "Quiet"}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {isHost ? (
              <div className="voice-invite-block">
                <McSelect
                  className="pack-select--full"
                  label="Invite friend"
                  menuPlacement="down"
                  disabled={inviteOptions.length === 0}
                  placeholder={
                    inviteOptions.length === 0
                      ? "No friends yet"
                      : "Choose a friend…"
                  }
                  options={inviteOptions}
                  value={invitePick}
                  onChange={setInvitePick}
                />
                <button
                  type="button"
                  className="btn-mc ok"
                  disabled={!invitePick}
                  onClick={() => void onInvite()}
                >
                  Invite
                </button>
              </div>
            ) : null}
          </div>

          <div className="voice-col voice-chat">
            <h3 className="settings-heading">Chat</h3>
            <div className="voice-chat-log">
              {messages.length === 0 ? (
                <p className="friends-muted">No messages yet.</p>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`voice-chat-line ${
                      m.senderId === userId ? "is-mine" : ""
                    }`}
                  >
                    <SkinHead
                      skinUrl={m.senderSkinPath ?? null}
                      className="voice-chat-avatar"
                      size={32}
                    />
                    <div className="voice-chat-body">
                      <strong>{m.senderName || "Player"}</strong>
                      <span>{m.body}</span>
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <form
              className="friends-add voice-chat-form"
              onSubmit={(e) => void onSend(e)}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message the room…"
                maxLength={2000}
                aria-label="Chat message"
              />
              <button
                type="submit"
                className="btn-mc ok"
                disabled={!draft.trim()}
              >
                Send
              </button>
            </form>
          </div>
        </div>

        {devicesModal}
        {runtimeUi}
      </section>
    );
  }

  return (
    <section className="section voice-panel">
      <div className="page-title-row">
        <h2 className="page-title">Voice</h2>
        {status ? (
          <div className="network-status-badges" aria-live="polite">
            <span className={`network-pill is-${tone}`}>
              <span className="network-pill-dot" aria-hidden />
              <span className="network-pill-label">Status</span>
              <span className="network-pill-value">{status}</span>
            </span>
          </div>
        ) : null}
      </div>

      <p className="friends-lead">
        Host a room on your PC, invite friends over Steam Porthole, keep chat in
        Remined.
      </p>

      <InfoNote id="voice.porthole-setup">
        Needs Steam + Porthole (same setup as Network Play). Friends join via
        invite — they do not need your public IP.
        {onOpenNetworkPlay ? (
          <>
            {" "}
            <button
              type="button"
              className="friends-inline-link"
              onClick={onOpenNetworkPlay}
            >
              Open Network Play
            </button>
          </>
        ) : null}
      </InfoNote>

      <InfoNote id="voice.vpn-note" style={{ marginTop: "8px" }}>
        <strong>Note:</strong> If using a VPN or proxy, voice may not work. Try
        disabling VPN or adding 127.0.0.1, localhost to the VPN bypass list.
      </InfoNote>

      <form
        className="friends-add"
        onSubmit={(e) => {
          e.preventDefault();
          void onCreate();
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Room name"
          maxLength={48}
          aria-label="Room name"
          disabled={busy}
        />
        <button
          type="submit"
          className="btn-mc ok"
          disabled={busy || !title.trim()}
        >
          {busy ? "Starting…" : "Create room"}
        </button>
        <button
          type="button"
          className="btn-mc dim"
          disabled={busy}
          onClick={() => setDevicesOpen(true)}
        >
          Devices
        </button>
      </form>

      {listsLoading ? (
        <div className="friends-block">
          <h3 className="settings-heading">Loading…</h3>
          <ul className="friends-list" aria-busy="true">
            {[0, 1].map((i) => (
              <li key={i} className="friend-row is-skeleton">
                <span className="skel skel-avatar" />
                <div className="friend-copy">
                  <span className="skel skel-line skel-name" />
                  <span className="skel skel-line skel-id" />
                </div>
                <span className="skel skel-chip" />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {invites.length > 0 ? (
            <div className="friends-block">
              <h3 className="settings-heading">Invites</h3>
              <ul className="friends-list">
                {invites.map((inv) => (
                  <li key={inv.id} className="friend-row">
                    <SkinHead
                      skinUrl={inv.fromSkinPath ?? null}
                      className="friend-avatar"
                      size={40}
                    />
                    <div className="friend-copy">
                      <strong>{inv.roomTitle || "Voice room"}</strong>
                      <span className="friend-id-static">
                        from {inv.fromName || "friend"}
                      </span>
                    </div>
                    <div className="friend-actions">
                      <button
                        type="button"
                        className="btn-mc ok"
                        disabled={busy}
                        onClick={() => void onAcceptInvite(inv)}
                      >
                        Join
                      </button>
                      <button
                        type="button"
                        className="btn-mc dim"
                        disabled={busy}
                        onClick={() => void onDeclineInvite(inv)}
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="friends-block">
            <h3 className="settings-heading">Your open rooms</h3>
            {rooms.length === 0 ? (
              <p className="friends-muted">
                No open rooms — create one above when Steam is running.
              </p>
            ) : (
              <ul className="friends-list">
                {rooms.map((r) => (
                  <li key={r.id} className="friend-row has-join">
                    <span className="voice-room-icon" aria-hidden>
                      {r.hostId === userId ? "H" : "G"}
                    </span>
                    <div className="friend-copy">
                      <strong>{r.title}</strong>
                      <span className="friend-id-static">
                        {r.hostId === userId ? "You host" : "Member"}
                        {r.portholeShareCode ? (
                          <>
                            {" · "}
                            <button
                              type="button"
                              className="friend-id"
                              onClick={() => {
                                void navigator.clipboard.writeText(
                                  r.portholeShareCode!,
                                );
                                onToast("Copied share code");
                              }}
                            >
                              {r.portholeShareCode}
                            </button>
                          </>
                        ) : null}
                      </span>
                    </div>
                    <div className="friend-actions">
                      <button
                        type="button"
                        className="btn-mc ok"
                        disabled={busy}
                        onClick={() => void onRejoin(r)}
                      >
                        Rejoin
                      </button>
                      <button
                        type="button"
                        className="btn-mc danger"
                        disabled={busy}
                        onClick={() => void onCloseListedRoom(r)}
                      >
                        {r.hostId === userId ? "Close" : "Leave"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {devicesModal}
      {runtimeUi}
    </section>
  );
}
