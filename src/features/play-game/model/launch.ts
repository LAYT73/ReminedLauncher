import {
  portholeStopAll,
  portholeStopHost,
  portholeStopJoin,
} from "@/shared/api/porthole";
import { MSG } from "@/shared/config/messages";
import { FALLBACK_USERNAME, USERNAME } from "@/shared/config/limits";
import { RAIL, routeFor, parseRoute, type Rail } from "@/shared/config/routes";
import { unlockAchievement } from "@/shared/lib/achievements";
import { writeLastPlayed } from "@/shared/lib/lastPlayed";
import { currentPathname, navigateTo } from "@/shared/lib/navigator";
import {
  isReminedVanillaPackId,
  isVanillaPackId,
  versionFromPackId,
} from "@/shared/lib/packIds";
import { toast } from "@/shared/lib/toast";
import { gameApi, useGameStore } from "@/entities/game";
import { EDITIONS, useVersionStore } from "@/entities/game-version";
import { setStatus, useInstallStore } from "@/entities/install";
import {
  getActiveReminePack,
  getSelectedPack,
  packApi,
  usePackStore,
} from "@/entities/pack";
import { usePlaytimeStore } from "@/entities/playtime";
import { syncCloudProfile, useProfileStore } from "@/entities/profile";
import { useSessionStore } from "@/entities/session";
import {
  setVoiceRoomShareCode,
  useVoiceStatusStore,
} from "@/entities/voice-room";
import { voiceStartPorthole } from "@/features/voice/api/voiceNative";
import { downloadPack, ensurePackUpToDate } from "./pack-install";
import { getPlayState } from "./play-state";
import { installVersion } from "./versions";

type LaunchOpts = { packId?: string; quickPlay?: string | null };

/** Make sure `packId` is on disk before launching (never throws; returns ready). */
async function prepareInstall(packId: string, quickPlay: boolean): Promise<boolean> {
  const markInstalled = () => usePackStore.getState().markInstalled(packId);
  if (quickPlay || isReminedVanillaPackId(packId)) {
    await packApi.ensure(packId);
    markInstalled();
    return true;
  }
  if (isVanillaPackId(packId)) return true; // installed via the vanilla rail
  return ensurePackUpToDate();
}

/** Remember the launched pack and jump to its rail. */
function rememberLaunched(packId: string): void {
  const versions = useVersionStore.getState();
  if (isVanillaPackId(packId)) {
    const ver = versionFromPackId(packId);
    versions.patch("vanilla", { pick: ver });
    writeLastPlayed({ vanilla: ver });
    navigateTo(routeFor(RAIL.vanilla));
  } else if (isReminedVanillaPackId(packId)) {
    const ver = versionFromPackId(packId);
    versions.patch("remined-vanilla", { pick: ver });
    writeLastPlayed({ "remined-vanilla": ver });
    navigateTo(routeFor(RAIL.reminedVanilla));
  } else {
    writeLastPlayed({ java: packId });
    navigateTo(routeFor(RAIL.java));
  }
}

export async function launchWithOpts(opts: LaunchOpts = {}): Promise<void> {
  const packId = opts.packId ?? getSelectedPack()?.id;
  const play = getPlayState();
  if (!packId || play.busy) return;
  if (!opts.packId && !play.packReady) {
    await downloadPack();
    return;
  }

  const game = useGameStore.getState();
  const quick = Boolean(opts.quickPlay);

  // Pin pack id before phase flips so playtime / presence can key off it.
  game.setLastLaunchedPackId(packId);

  // Show playbar progress for runtime prep + Java download during launch.
  game.setPhase("launching");
  useInstallStore
    .getState()
    .beginLaunch(quick ? MSG.launch.joiningFriend : MSG.launch.preparing);
  if (!quick) {
    // Fresh local launch clears LAN, but must not tear down an active voice tunnel.
    game.setHostingLan(null);
    const voice = useVoiceStatusStore.getState();
    if (voice.hostRoomId) {
      void voiceStartPorthole(null)
        .then((ready) =>
          setVoiceRoomShareCode(voice.hostRoomId!, ready.share_code),
        )
        .catch(() => undefined);
    } else if (voice.inRoom) {
      // Voice guest: keep join, drop any leftover host expose.
      void portholeStopHost().catch(() => undefined);
    } else {
      void portholeStopAll().catch(() => undefined);
    }
  }

  try {
    if (!(await prepareInstall(packId, quick))) {
      game.setPhase("idle");
      return;
    }
  } catch (err) {
    game.setPhase("idle");
    setStatus(String(err), "error");
    return;
  }

  setStatus(quick ? MSG.launch.joiningFriend : "");
  try {
    // Sync first, then launch with the returned profile — state alone is stale.
    const session = useSessionStore.getState().session;
    const profile = session
      ? await syncCloudProfile(session)
      : useProfileStore.getState().profile;
    const name = profile.username.trim() || FALLBACK_USERNAME;
    if (name.length < USERNAME.min || name.length > USERNAME.max) {
      game.setPhase("idle");
      setStatus(MSG.launch.usernameLength, "error");
      return;
    }
    const result = await gameApi.launch({
      packId,
      username: name,
      skinPath: profile.skin_path,
      skinModel: profile.skin_model,
      quickPlay: opts.quickPlay ?? null,
    });
    game.setPhase(result.phase);
    if (!result.ok) {
      game.setRunningPackId(null);
      if (quick) void portholeStopJoin().catch(() => undefined);
      setStatus(result.message, "error");
      return;
    }
    game.setRunningPackId(packId);
    game.setLastLaunchedPackId(packId);
    // Touch last launch for this pack as soon as the process is up
    // (don't rely only on phase-poll transitions — they can race).
    const sess = useSessionStore.getState();
    if (sess.session && !sess.offlineMode) {
      void usePlaytimeStore.getState().record(packId, 0);
    }
    if (quick) unlockAchievement("first-network-join", toast);
    rememberLaunched(packId);
    if (quick) setStatus(MSG.launch.joined, "ok");
  } catch (err) {
    game.setRunningPackId(null);
    if (quick) void portholeStopJoin().catch(() => undefined);
    game.setPhase("idle");
    setStatus(String(err), "error");
  }
}

/** Playbar "Play": install if needed, then launch the current rail's pack. */
export async function launch(): Promise<void> {
  const rail: Rail = parseRoute(currentPathname()).rail;
  if (rail === RAIL.vanilla || rail === RAIL.reminedVanilla) {
    const edition = rail === RAIL.vanilla ? "vanilla" : "remined-vanilla";
    const state = useVersionStore.getState().by[edition];
    if (!state.pick || getPlayState().busy) return;
    const packId = EDITIONS[edition].packId(state.pick);
    if (!usePackStore.getState().installedIds.has(packId)) {
      if (!(await installVersion(edition, state.pick))) return;
    }
    await launchWithOpts({ packId });
    return;
  }
  const active = getActiveReminePack();
  if (active) await launchWithOpts({ packId: active.id });
}
