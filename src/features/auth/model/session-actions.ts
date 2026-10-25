import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/shared/api/supabase";
import { MSG } from "@/shared/config/messages";
import { TIMING } from "@/shared/config/timings";
import { bootElapsed } from "@/shared/lib/bootClock";
import {
  isBrowserOnline,
  probeOnline,
  withTimeout,
} from "@/shared/lib/network";
import { resolveMediaFromDisk } from "@/shared/lib/mediaCache";
import { toast } from "@/shared/lib/toast";
import { bootstrapLauncher, hydratePackMedia, usePackStore } from "@/entities/pack";
import { usePlaytimeStore } from "@/entities/playtime";
import { usePartyStore } from "@/entities/voice-room";
import {
  applyOfflineAccount,
  loadLocalProfile,
  profileApi,
  syncCloudProfile,
  useProfileStore,
} from "@/entities/profile";
import {
  cacheOnboardingCompleted,
  canEnterOffline,
  clearOfflineAccount,
  readOfflineCache,
  setPresence,
  useSessionStore,
  type Gate,
} from "@/entities/session";
import { isSkinUrl, useSkinStore } from "@/entities/skin";

const session = () => useSessionStore.getState();

let reconnecting = false;

/** Fade out the boot splash, then switch gate. */
export async function leaveBoot(next: Exclude<Gate, "loading">): Promise<void> {
  const wait = TIMING.bootIntroMin - bootElapsed();
  if (wait > 0) await new Promise((r) => window.setTimeout(r, wait));
  session().setBootLeaving(true);
  await new Promise((r) => window.setTimeout(r, TIMING.bootLeave));
  session().setGate(next);
  session().setBootLeaving(false);
}

/** Enter the app with the cached account. Returns false if there is none. */
export async function enterOfflineMode(reason?: string): Promise<boolean> {
  const cache = readOfflineCache();
  if (!canEnterOffline(cache)) return false;

  session().setOfflineMode(true);
  session().setSession(null);
  session().setAuthOfflineHint(null);
  await applyOfflineAccount();

  // Prefer cached marketing catalog; packs still come from disk.
  if (cache.catalog.length > 0) {
    usePackStore.getState().setCatalog(cache.catalog);
    await hydratePackMedia(cache.catalog, false);
  }
  await bootstrapLauncher();
  const skinUrl = cache.account?.skin_path;
  if (skinUrl && isSkinUrl(skinUrl)) {
    await resolveMediaFromDisk([skinUrl]);
    usePackStore.getState().bumpMedia();
  }
  if (reason) toast(reason, "err");
  return true;
}

/** Probe + restore the session while staying in the app (no full re-login). */
export async function tryReconnectFromOffline(): Promise<void> {
  if (!session().offlineMode || reconnecting) return;
  reconnecting = true;
  try {
    const online = isBrowserOnline() && (await probeOnline());
    if (!online) return;

    session().setOfflineMode(false);
    try {
      const restored = await withTimeout(
        supabase.auth.getSession().then(({ data }) => data.session),
        TIMING.sessionFetch,
      );
      if (!restored) {
        session().setSession(null);
        session().setGate("auth");
        session().setAuthOfflineHint(null);
        toast(MSG.boot.backOnlineSignInShort, "ok");
        return;
      }
      session().setSession(restored);
      await withTimeout(bootstrapLauncher(), TIMING.bootstrap);
      await withTimeout(syncCloudProfile(restored), TIMING.cloudProfileSync);
      toast(MSG.boot.backOnline, "ok");
    } catch {
      session().setOfflineMode(true);
      toast(MSG.boot.stillOffline, "err");
    }
  } finally {
    reconnecting = false;
  }
}

/** Auth state changed (sign in / out / token): decide which gate to show. */
export async function resolveGate(next: Session | null): Promise<void> {
  // Deliberate offline session — ignore auth callbacks until user leaves it.
  if (session().offlineMode) return;

  // Already signed in as this user in the app — do not re-bootstrap / leaveBoot
  // (that remounts chrome and kills an active voice session).
  const cur = session();
  if (
    next &&
    cur.gate === "app" &&
    cur.session?.user?.id &&
    cur.session.user.id === next.user.id
  ) {
    cur.setSession(next);
    return;
  }

  session().setSession(next);
  const profile = useProfileStore.getState();
  if (!next) {
    session().setReminedId(null);
    useSkinStore.getState().setPreview(null);
    profile.setUsernameDraft(null);
    // Drop account-bound skin so the next login doesn't flash the previous one.
    try {
      const local = await loadLocalProfile();
      if (local.skin_path) {
        const cleared = { ...local, skin_path: null };
        await profileApi.save(cleared);
        profile.setProfile(cleared);
      }
    } catch {
      /* ignore */
    }
    await leaveBoot("auth");
    return;
  }

  // Switching accounts: reset avatar until cloud profile loads.
  session().setOfflineMode(false);
  useSkinStore.getState().setPreview(null);
  profile.setUsernameDraft(null);
  try {
    const runtime = await profileApi.runtimeStatus();
    cacheOnboardingCompleted(runtime.onboarding.completed);
    if (!runtime.onboarding.completed) {
      await leaveBoot("onboarding");
      return;
    }
    await withTimeout(bootstrapLauncher(), TIMING.bootstrap);
    await withTimeout(syncCloudProfile(next), TIMING.cloudProfileSync);
    await leaveBoot("app");
  } catch {
    // Network/cloud failure after auth — try the cached offline app.
    if (await enterOfflineMode(MSG.boot.cloudUnreachableAfterAuth)) {
      await leaveBoot("app");
      return;
    }
    await leaveBoot("onboarding");
  }
}

/** Initial boot: onboarding cache → connectivity → session → gate. */
export async function startBoot(): Promise<void> {
  try {
    const runtime = await profileApi.runtimeStatus();
    cacheOnboardingCompleted(runtime.onboarding.completed);
  } catch {
    /* ignore */
  }

  const online = isBrowserOnline() && (await probeOnline());
  if (!online) {
    if (await enterOfflineMode(MSG.boot.usingCache)) {
      await leaveBoot("app");
      return;
    }
    session().setAuthOfflineHint(
      canEnterOffline()
        ? MSG.boot.hintOfflineCanContinue
        : MSG.boot.hintOfflineNeedsSignIn,
    );
    await leaveBoot("auth");
    return;
  }

  session().setAuthOfflineHint(null);
  try {
    const current = await withTimeout(
      supabase.auth.getSession().then(({ data }) => data.session),
      TIMING.sessionFetch,
    );
    await resolveGate(current);
  } catch {
    if (await enterOfflineMode(MSG.boot.cloudUnreachable)) {
      await leaveBoot("app");
      return;
    }
    session().setAuthOfflineHint(MSG.boot.hintCloudUnreachable);
    await leaveBoot("auth");
  }
}

/** "Continue offline" on the auth screen. */
export async function continueOffline(): Promise<void> {
  if (await enterOfflineMode(MSG.boot.offlineMode)) session().setGate("app");
  else toast(MSG.boot.noCachedAccount);
}

/** Auth screen finished a sign-in: go back through the boot splash. */
export function onAuthed(): void {
  session().setAuthOfflineHint(null);
  session().setGate("loading");
}

export async function signOut(): Promise<void> {
  const current = session().session;
  const uid = current?.user?.id;
  if (uid) await setPresence({ userId: uid, status: "offline", packId: null });
  clearOfflineAccount();
  session().setOfflineMode(false);
  usePlaytimeStore.getState().clear();
  usePartyStore.getState().reset();
  if (current) await supabase.auth.signOut();
  else {
    session().setGate("auth");
    session().setAuthOfflineHint(null);
  }
}
