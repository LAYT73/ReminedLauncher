import { setFriendToasts } from "@/features/profile-edit";
import { useProfileStore } from "@/entities/profile";
import { McToggle } from "@/shared/ui/McToggle";

export function NotificationsSection() {
  const friendToasts = useProfileStore((s) => s.profile.friend_toasts);

  return (
    <div className="settings-block">
      <h3 className="settings-heading">Notifications</h3>
      <McToggle
        checked={friendToasts}
        onChange={(next) => void setFriendToasts(next)}
        label="Friend alerts"
      />
    </div>
  );
}
