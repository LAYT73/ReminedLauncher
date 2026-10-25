import type { VoiceRoom } from "@/entities/voice-room";
import { useT } from "@/shared/i18n";
import type { PartyPrimary } from "../lib/partyState";
import type { PartyPackOption } from "../lib/partyPack";
import type { PartyAutoOpen } from "../model/partyJoin";
import { PackSelect } from "@/entities/pack";

type Props = {
  room: VoiceRoom;
  isHost: boolean;
  hostName: string;
  /** Packs the host can pick from (catalog, installed Vanilla / Remined Vanilla, current). */
  packs: PartyPackOption[];
  packName: string | null;
  primary: PartyPrimary | null;
  busy: boolean;
  canChangePack: boolean;
  memberCount: number;
  autoOpen: PartyAutoOpen | null;
  onPickPack: (packId: string) => void;
  onPrimary: () => void;
  onCopyLink: () => void;
};

type View = { label: string | null; hint: string | null; disabled: boolean };

/** Pack picker, member count, the one primary action for this client, and the invite link. */
export function PartyCard({
  room,
  isHost,
  hostName,
  packs,
  packName,
  primary,
  busy,
  canChangePack,
  memberCount,
  autoOpen,
  onPickPack,
  onPrimary,
  onCopyLink,
}: Props) {
  const t = useT();
  const pack = packName ?? room.packId ?? "";
  const full = memberCount >= room.maxMembers;

  const view = ((): View => {
    if (!primary) return { label: null, hint: null, disabled: true };
    switch (primary.kind) {
      case "legacy":
        return {
          label: null,
          hint: primary.host ? t("voice.party.hostNoPack") : t("voice.party.legacyHint"),
          disabled: true,
        };
      case "play":
        return { label: t("voice.party.play"), hint: null, disabled: busy };
      case "busyOther":
        return isHost
          ? { label: t("voice.party.busyOther"), hint: t("voice.party.busyOtherHint"), disabled: true }
          : { label: t("voice.party.busyOtherJoin"), hint: t("voice.party.busyOtherJoinHint"), disabled: true };
      case "starting":
        return { label: t("voice.party.starting"), hint: null, disabled: true };
      case "hostLaunching":
        return {
          label: t("voice.party.hostLaunching"),
          hint: `${t("voice.party.hostLaunchingHint")} ${t("voice.party.hostLaunchingFallback")}`,
          disabled: true,
        };
      case "hostWorld": {
        if (primary.open) {
          return { label: t("voice.party.worldOpen"), hint: t("voice.party.worldOpenHint"), disabled: true };
        }
        let hint = t("voice.party.openLanHint");
        if (autoOpen?.status === "opening") hint = t("voice.party.autoOpening");
        else if (autoOpen?.status === "failed") hint = t("voice.party.autoOpenFailed", { reason: autoOpen.reason });
        else if (autoOpen?.status === "unsupported") hint = t("voice.party.autoOpenUnsupported");
        return { label: t("voice.party.inOwnWorld"), hint, disabled: true };
      }
      case "waitHost":
        return { label: t("voice.party.waitHost", { host: hostName }), hint: t("voice.party.waitHostHint"), disabled: true };
      case "hostOffline":
        return { label: t("voice.party.hostOffline"), hint: t("voice.party.hostOfflineHint"), disabled: true };
      case "install":
        if (primary.installing) {
          return {
            label:
              primary.progress != null
                ? t("voice.party.installingPct", { p: primary.progress })
                : t("voice.party.installing"),
            hint: t("voice.party.installHint", { pack }),
            disabled: true,
          };
        }
        return {
          label: t("voice.party.install", { pack }),
          hint: t("voice.party.installHint", { pack }),
          disabled: busy,
        };
      case "join":
        return { label: t("voice.party.join", { host: hostName }), hint: t("voice.party.joinHint", { pack }), disabled: busy };
      case "inWorld":
        return { label: t("voice.party.inWorld", { host: hostName }), hint: null, disabled: true };
    }
  })();

  return (
    <div className="party-card">
      <div className="party-card-pack">
        {isHost && packs.length > 0 ? (
          <PackSelect
            label={t("voice.party.pack")}
            packs={packs}
            value={room.packId ?? ""}
            onChange={onPickPack}
            disabled={busy || !canChangePack}
            placeholder={room.packId ? undefined : t("voice.party.noPack")}
            menuPlacement="down"
            className="pack-select--full"
            withIcons
          />
        ) : (
          <div className="party-card-stat">
            <span className="party-card-label">{t("voice.party.pack")}</span>
            <strong className="party-card-value party-card-box">
              {room.packId ? pack : t("voice.party.noPack")}
            </strong>
          </div>
        )}
      </div>
      <p className="party-card-note party-card-pack-note">
        {isHost && !canChangePack && room.packId ? t("voice.party.packLocked") : null}
      </p>

      <div className="party-card-meta">
        <div className="party-card-stat">
          <span className="party-card-label">{t("voice.party.host")}</span>
          <strong className="party-card-value party-card-box">{isHost ? t("voice.party.you") : hostName}</strong>
        </div>
        <div className="party-card-stat">
          <span className="party-card-label">{t("voice.party.members")}</span>
          <strong className="party-card-value party-card-box">
            {t("voice.party.memberCount", { n: memberCount, max: room.maxMembers })}
          </strong>
        </div>
        <button type="button" className="btn-mc dim party-card-link" onClick={onCopyLink}>
          {t("voice.party.copyLink")}
        </button>
      </div>
      <p className="party-card-note party-card-meta-note">
        {full ? t("voice.party.full") : null}
      </p>

      <div className="party-card-action">
        {view.label ? (
          <button type="button" className="btn-mc ok party-card-button" disabled={view.disabled} onClick={onPrimary}>
            {view.label}
          </button>
        ) : null}
      </div>
      <p className="party-card-note party-card-hint">{view.hint}</p>
    </div>
  );
}
