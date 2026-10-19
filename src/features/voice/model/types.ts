import type { ToastTone } from "@/shared/lib/toast";

export type ToastFn = (message: string, tone?: ToastTone) => void;

export type VoicePanelProps = {
  userId: string;
  displayName: string;
  onToast: ToastFn;
  onOpenNetworkPlay?: () => void;
  onRoomStatusChange?: (inRoom: boolean) => void;
  /** Pending invite count — drives the badge on the Voice tab. */
  onInvitesChange?: (count: number) => void;
};

export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
