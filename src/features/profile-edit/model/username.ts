import { MSG } from "@/shared/config/messages";
import { toast } from "@/shared/lib/toast";
import {
  committedUsername,
  updateCloudUsername,
  useProfileStore,
} from "@/entities/profile";
import { useSessionStore } from "@/entities/session";

/** Username input state for the profile page (draft → cloud commit). */
export function useUsernameEditor() {
  const profile = useProfileStore((s) => s.profile);
  const draft = useProfileStore((s) => s.usernameDraft);
  const busy = useProfileStore((s) => s.usernameBusy);
  const setDraft = useProfileStore((s) => s.setUsernameDraft);

  const committed = committedUsername(profile);
  const editing = draft !== null;
  const dirty = editing && draft.trim() !== committed;

  return {
    value: draft ?? committed,
    dirty,
    busy,
    onChange: setDraft,
    onFocus: () => {
      if (!editing) setDraft(committed);
    },
    reset: () => setDraft(null),
    commit: () => void commitUsername(),
  };
}

export async function commitUsername(): Promise<void> {
  const session = useSessionStore.getState();
  const store = useProfileStore.getState();
  const draft = store.usernameDraft;
  if (session.offlineMode) {
    toast(MSG.offline.usernameSync);
    return;
  }
  const userId = session.session?.user?.id;
  const dirty =
    draft !== null && draft.trim() !== committedUsername(store.profile);
  if (!userId || !dirty || store.usernameBusy) return;

  store.setUsernameBusy(true);
  try {
    const saved = await updateCloudUsername(userId, draft);
    await store.persist({ ...useProfileStore.getState().profile, username: saved });
    store.setUsernameDraft(null);
    toast(MSG.profile.usernameUpdated);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  } finally {
    store.setUsernameBusy(false);
  }
}
