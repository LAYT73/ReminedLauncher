import type { ReactNode } from "react";
import type { VoiceInvite, VoiceRoom } from "@/entities/voice-room";
import { InfoNote } from "@/shared/ui/InfoNote";
import { TitleHint } from "@/shared/ui/TitleHint";
import { SkinHead } from "@/entities/skin";
import { useT } from "@/shared/i18n";
import { EmptyState } from "@/shared/ui/EmptyState";
import { PixelDiceIcon, PixelGearIcon } from "@/shared/ui/PixelIcons";
import { displayRoomTitle, randomVoiceRoomTitle } from "../lib/roomName";

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
    onOpenNetworkPlay,
    setDevicesOpen,
    onCreate,
    onAcceptInvite,
    onDeclineInvite,
    onRejoin,
    onCloseListedRoom,
    children,
}: Props) {
    const t = useT();
    return (
        <section className="section voice-panel is-lobby">
            <TitleHint
                title={t("voice.title")}
                hint={t("voice.lobbyHint")}
                end={
                    status ? (
                        <div
                            className="network-status-badges"
                            aria-live="polite"
                        >
                            <span className={`network-pill is-${tone}`}>
                                <span
                                    className="network-pill-dot"
                                    aria-hidden
                                />
                                <span className="network-pill-label">
                                    {t("voice.status")}
                                </span>
                                <span className="network-pill-value">
                                    {status}
                                </span>
                            </span>
                        </div>
                    ) : null
                }
            />

            <InfoNote id="voice.relay-setup">
                {t("voice.lobby.relayNote")}
                {onOpenNetworkPlay ? (
                    <>
                        {" "}
                        <button
                            type="button"
                            className="friends-inline-link"
                            onClick={onOpenNetworkPlay}
                        >
                            {t("voice.lobby.openNetwork")}
                        </button>
                    </>
                ) : null}
            </InfoNote>

            <InfoNote id="voice.vpn-note" style={{ marginTop: "8px" }}>
                <strong>{t("voice.lobby.vpnNoteLabel")}</strong>{" "}
                {t("voice.lobby.vpnNote")}
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
                    placeholder={t("voice.lobby.roomName")}
                    maxLength={48}
                    aria-label={t("voice.lobby.roomName")}
                    disabled={busy}
                />
                <button
                    type="button"
                    className="btn-mc dim voice-reroll-name"
                    disabled={busy}
                    title={t("voice.lobby.newRandomName")}
                    aria-label={t("voice.lobby.generateName")}
                    onClick={() => setTitle(randomVoiceRoomTitle())}
                >
                    <PixelDiceIcon />
                </button>
                <button
                    type="submit"
                    className="btn-mc ok"
                    disabled={busy || !title.trim()}
                >
                    {creating
                        ? t("voice.lobby.starting")
                        : t("voice.lobby.createRoom")}
                </button>
                <button
                    type="button"
                    className="btn-mc dim btn-icon-sq"
                    disabled={busy}
                    title={t("voice.devices")}
                    aria-label={t("voice.devices")}
                    onClick={() => setDevicesOpen(true)}
                >
                    <PixelGearIcon />
                </button>
            </form>

            {listsLoading ? (
                <div className="friends-block">
                    <h3 className="settings-heading">{t("voice.lobby.loading")}</h3>
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
                            <h3 className="settings-heading">{t("voice.lobby.invites")}</h3>
                            <ul className="friends-list">
                                {invites.map((inv) => (
                                    <li key={inv.id} className="friend-row">
                                        <SkinHead
                                            skinUrl={inv.fromSkinPath ?? null}
                                            className="friend-avatar"
                                            size={40}
                                        />
                                        <div className="friend-copy">
                                            <strong>
                                                {displayRoomTitle(inv.roomTitle) || t("voice.voiceRoom")}
                                            </strong>
                                            <span className="friend-id-static">
                                                {t("voice.lobby.fromName", {
                                                    name:
                                                        inv.fromName ||
                                                        t("voice.friendLower"),
                                                })}
                                            </span>
                                        </div>
                                        <div className="friend-actions">
                                            <button
                                                type="button"
                                                className="btn-mc ok"
                                                disabled={busy}
                                                onClick={() =>
                                                    void onAcceptInvite(inv)
                                                }
                                            >
                                                {t("voice.join")}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn-mc dim"
                                                disabled={busy}
                                                onClick={() =>
                                                    void onDeclineInvite(inv)
                                                }
                                            >
                                                {t("voice.decline")}
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

                    <div className="friends-block">
                        <h3 className="settings-heading">{t("voice.lobby.yourOpenRooms")}</h3>
                        {rooms.length === 0 ? (
                            <EmptyState
                                kind="rooms"
                                title={t("voice.lobby.noRoomsTitle")}
                                description={t("voice.lobby.noRoomsHint")}
                            />
                        ) : (
                            <ul className="friends-list">
                                {rooms.map((r) => (
                                    <li
                                        key={r.id}
                                        className="friend-row has-join"
                                    >
                                        <span
                                            className="voice-room-icon"
                                            aria-hidden
                                        >
                                            {r.hostId === userId ? "H" : "G"}
                                        </span>
                                        <div className="friend-copy">
                                            <strong>{displayRoomTitle(r.title)}</strong>
                                            <span className="friend-id-static">
                                                {r.hostId === userId
                                                    ? t("voice.lobby.youHost")
                                                    : t("voice.lobby.member")}
                                            </span>
                                        </div>
                                        <div className="friend-actions">
                                            <button
                                                type="button"
                                                className="btn-mc ok"
                                                disabled={busy}
                                                onClick={() => void onRejoin(r)}
                                            >
                                                {t("voice.lobby.rejoin")}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn-mc danger"
                                                disabled={busy}
                                                onClick={() =>
                                                    void onCloseListedRoom(r)
                                                }
                                            >
                                                {r.hostId === userId
                                                    ? t("voice.close")
                                                    : t("voice.leave")}
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
