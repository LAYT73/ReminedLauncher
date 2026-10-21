import type { ReactNode } from "react";
import type { VoiceInvite, VoiceRoom } from "@/entities/voice-room";
import { InfoNote } from "@/shared/ui/InfoNote";
import { TitleHint } from "@/shared/ui/TitleHint";
import { SkinHead } from "@/entities/skin";
import { MSG } from "@/shared/config/messages";
import { randomVoiceRoomTitle } from "../lib/roomName";

type Props = {
  userId: string;
  status: string;
  tone: string;
  title: string;
  setTitle: (v: string) => void;
  busy: boolean;
  /** True only during Create — leave/close must not show "Starting…". */
  creating?: boolean;
  listsLoading: boolean;
  invites: VoiceInvite[];
  rooms: VoiceRoom[];
  onToast: (msg: string, tone?: "default" | "ok" | "err") => void;
  onOpenNetworkPlay?: () => void;
  setDevicesOpen: (open: boolean) => void;
  onCreate: () => Promise<void>;
  onAcceptInvite: (inv: VoiceInvite) => Promise<void>;
  onDeclineInvite: (inv: VoiceInvite) => Promise<void>;
  onRejoin: (room: VoiceRoom) => Promise<void>;
  onCloseListedRoom: (room: VoiceRoom) => Promise<void>;
  /** Modals rendered inside the panel section. */
  children?: ReactNode;
};

/** Voice landing page: create a room, pending invites, your open rooms. */
export function VoiceLobby({
  userId,
  status,
  tone,
  title,
  setTitle,
  busy,
  creating = false,
  listsLoading,
  invites,
  rooms,
  onToast,
  onOpenNetworkPlay,
  setDevicesOpen,
  onCreate,
  onAcceptInvite,
  onDeclineInvite,
  onRejoin,
  onCloseListedRoom,
  children,
}: Props) {
  return (
    <section className="section voice-panel is-lobby">
      <TitleHint
        title="Voice"
        hint="Host a room on your PC, invite friends over Unlim, keep chat in Remined."
        end={
          status ? (
            <div className="network-status-badges" aria-live="polite">
              <span className={`network-pill is-${tone}`}>
                <span className="network-pill-dot" aria-hidden />
                <span className="network-pill-label">Status</span>
                <span className="network-pill-value">{status}</span>
              </span>
            </div>
          ) : null
        }
      />

      <InfoNote id="voice.unlim-setup">
        Needs Unlim installed (Settings → Network). Friends join via invite —
        they do not need your public IP.
        {onOpenNetworkPlay ? (
          <>
            {" "}
            <button
              type="button"
              className="friends-inline-link"
              onClick={onOpenNetworkPlay}
            >
              Open Network
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
          type="button"
          className="btn-mc dim voice-reroll-name"
          disabled={busy}
          title="New random name"
          aria-label="Generate new room name"
          onClick={() => setTitle(randomVoiceRoomTitle())}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect
              x="3.5"
              y="3.5"
              width="17"
              height="17"
              rx="2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" />
            <circle cx="15.5" cy="8.5" r="1.6" fill="currentColor" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
            <circle cx="8.5" cy="15.5" r="1.6" fill="currentColor" />
            <circle cx="15.5" cy="15.5" r="1.6" fill="currentColor" />
          </svg>
        </button>
        <button
          type="submit"
          className="btn-mc ok"
          disabled={busy || !title.trim()}
        >
          {creating ? "Starting…" : "Create room"}
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
                No open rooms — create one above.
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
                                onToast(MSG.voice.copiedShareCode);
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

      {children}
    </section>
  );
}
