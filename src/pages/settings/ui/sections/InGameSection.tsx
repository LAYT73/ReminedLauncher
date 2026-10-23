import { useT } from "@/shared/i18n";
import { McToggle } from "@/shared/ui/McToggle";
import { useGameBridgePrefs } from "@/shared/lib/gameBridgePrefs";

export function InGameSection() {
  const t = useT();
  const notifications = useGameBridgePrefs((s) => s.notifications);
  const voiceHud = useGameBridgePrefs((s) => s.voiceHud);
  const setNotifications = useGameBridgePrefs((s) => s.setNotifications);
  const setVoiceHud = useGameBridgePrefs((s) => s.setVoiceHud);

  return (
    <div className="settings-block">
      <h3 className="settings-heading">{t("settings.inGame.title")}</h3>
      <McToggle
        checked={notifications}
        onChange={setNotifications}
        label={t("settings.inGame.notifications")}
      />
      <McToggle
        checked={voiceHud}
        onChange={setVoiceHud}
        label={t("settings.inGame.voiceHud")}
      />
    </div>
  );
}
