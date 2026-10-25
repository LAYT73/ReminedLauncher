import { setFriendToasts } from "@/features/profile-edit";
import { useT } from "@/shared/i18n";
import { useProfileStore } from "@/entities/profile";
import { McToggle } from "@/shared/ui/McToggle";
import { useSharePrefs } from "@/shared/lib/sharePrefs";
import { useSystemNotifyPrefs } from "@/shared/lib/systemNotify";

export function NotificationsSection() {
  const t = useT();
  const friendToasts = useProfileStore((s) => s.profile.friend_toasts);
  const shareActivity = useSharePrefs((s) => s.shareActivity);
  const setShareActivity = useSharePrefs((s) => s.setShareActivity);
  const systemNotify = useSystemNotifyPrefs((s) => s.enabled);
  const setSystemNotify = useSystemNotifyPrefs((s) => s.setEnabled);

  return (
    <div className="settings-block">
      <h3 className="settings-heading">{t("settings.notifications.title")}</h3>
      <McToggle
        checked={friendToasts}
        onChange={(next) => void setFriendToasts(next).catch(() => undefined)}
        label={t("settings.notifications.friendAlerts")}
      />
      <McToggle
        checked={shareActivity}
        onChange={setShareActivity}
        label={t("settings.notifications.shareActivity")}
      />
      <McToggle
        checked={systemNotify}
        onChange={setSystemNotify}
        label={t("settings.notifications.systemNotify")}
      />
    </div>
  );
}
