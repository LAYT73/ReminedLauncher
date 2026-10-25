import { useT } from "@/shared/i18n";

type Props = {
  isHost: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Confirm-to-join variant (not in a party yet): replaces the leave copy. */
  joinAsk?: { hostName: string };
};

/** Asked before a join leaves the party this client is in, or before joining one (deep link). */
export function PartySwitchBanner({ isHost, busy, onConfirm, onCancel, joinAsk }: Props) {
  const t = useT();
  const title = joinAsk
    ? t("voice.party.joinAskTitle", { host: joinAsk.hostName })
    : t("voice.party.switchTitle");
  return (
    <div className="party-switch" role="alertdialog" aria-labelledby="party-switch-title">
      <div className="party-switch-copy">
        <strong id="party-switch-title">{title}</strong>
        {joinAsk ? null : <p>{isHost ? t("voice.party.switchHostBody") : t("voice.party.switchBody")}</p>}
      </div>
      <div className="party-switch-actions">
        <button type="button" className="btn-mc dim" disabled={busy} onClick={onCancel}>
          {joinAsk ? t("voice.cancel") : t("voice.party.switchStay")}
        </button>
        <button type="button" className={joinAsk ? "btn-mc ok" : "btn-mc danger"} disabled={busy} onClick={onConfirm}>
          {joinAsk ? t("voice.party.joinAskConfirm") : t("voice.party.switchLeave")}
        </button>
      </div>
    </div>
  );
}
