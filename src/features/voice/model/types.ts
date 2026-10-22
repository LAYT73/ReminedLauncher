import type { FriendRow } from "@/entities/friend";
import type { ToastTone } from "@/shared/lib/toast";

export type ToastFn = (message: string, tone?: ToastTone) => void;

/** Join a friend's LAN world from the member list (wired by the host widget). */
export type VoiceLanJoin = {
  onJoin: (row: FriendRow) => void;
  /** Friendship id currently being joined. */
  joiningFriendId: string | null;
  /** Game is launching/running — hide Join. */
  blocked: boolean;
};

export type VoicePanelProps = {
  userId: string;
  displayName: string;
  onToast: ToastFn;
  onOpenNetworkPlay?: () => void;
  onRoomStatusChange?: (inRoom: boolean) => void;
  /** Pending invite count — drives the badge on the Voice tab. */
  onInvitesChange?: (count: number) => void;
  lanJoin?: VoiceLanJoin;
};
