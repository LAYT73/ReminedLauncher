import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Session } from "@supabase/supabase-js";
import { AuthScreen } from "./components/AuthScreen";
import { FriendsPanel } from "./components/FriendsPanel";
import { NetworkPlayPanel } from "./components/NetworkPlayPanel";
import { OnboardingScreen } from "./components/OnboardingScreen";
import { PackGallery } from "./components/PackGallery";
import { PackSelect } from "./components/PackSelect";
import { PixelProgress } from "./components/PixelProgress";
import { PlayButton } from "./components/PlayButton";
import { EnchantParticles } from "./components/EnchantParticles";
import { PageMotion } from "./components/PageMotion";
import { SkinHead } from "./components/SkinHead";
import { SkinModel } from "./components/SkinModel";
import { Toast, type ToastTone } from "./components/Toast";
import {
  ensureCloudProfile,
  updateCloudSkinModel,
  updateCloudUsername,
} from "./lib/cloudProfile";
import {
  normalizeSkinModel,
  type SkinModelKind,
} from "./lib/skinModel";
import {
  CatalogPack,
  fetchCatalogFromSupabase,
  pickDefaultPack,
} from "./lib/packsCatalog";
import {
  cacheAccount,
  cacheOnboardingCompleted,
  canEnterOffline,
  clearOfflineAccount,
  readOfflineCache,
} from "./lib/offlineCache";
import { readLastPlayed, writeLastPlayed } from "./lib/lastPlayed";
import {
  collectCatalogMediaUrls,
  localizeCatalog,
  mediaSrc,
  resolveMediaFromDisk,
  warmMediaCache,
} from "./lib/mediaCache";
import {
  isBrowserOnline,
  probeOnline,
  subscribeConnectivity,
  withTimeout,
} from "./lib/network";
import { clearAccountSkin, publishAccountSkin } from "./lib/skinsCloud";
import { supabase } from "./lib/supabase";
import brandLogo from "./assets/logo.png";
import vanillaLogo from "./assets/vanilla.png";
import reminedVanillaLogo from "./assets/remined-vanilla-logo.png";
import reminedVanillaBanner from "./assets/remined-vanilla-banner.jpg";
import vanillaWallpaper from "./assets/vanilla-wallpaper.jpg";
import homeWallpaperVideo from "./assets/home-wallpaper.mp4";
import homeMcLogo from "./assets/home-mc-logo.png";
import { setPresence } from "./lib/presence";
import type { FriendRow } from "./lib/friends";
import { canJoinFriend } from "./lib/friends";
import {
  openPortholeOnSteam,
  portholeStartHost,
  portholeStartJoin,
  portholeStatus,
  portholeStopAll,
  portholeStopHost,
  portholeStopJoin,
  readLanPort,
} from "./lib/porthole";
import {
  applyTheme,
  DEFAULT_THEME,
  normalizeThemeId,
  THEME_PRESETS,
  type ThemeId,
} from "./lib/themes";

type HostingLan = {
  packId: string;
  shareCode: string;
  gamePort: number;
};

type Pack = {
  id: string;
  name: string;
  version: string;
  description: string;
};

type Profile = {
  username: string;
  skin_path: string | null;
  skin_model: SkinModelKind;
  selected_pack: string;
  ram_mb: number;
  java_path: string | null;
  jvm_args: string;
  theme: ThemeId;
};

type JavaInfo = {
  path: string;
  version: string;
  major: number | null;
  ok: boolean;
};

const RAM_OPTIONS_GB = [2, 4, 6, 8, 10, 12, 16] as const;

const DEFAULT_PROFILE: Profile = {
  username: "Player",
  skin_path: null,
  skin_model: "default",
  selected_pack: "",
  ram_mb: 4096,
  java_path: null,
  jvm_args: "",
  theme: DEFAULT_THEME,
};

function normalizeProfile(raw: Partial<Profile> | null | undefined): Profile {
  return {
    ...DEFAULT_PROFILE,
    ...raw,
    skin_model: normalizeSkinModel(raw?.skin_model),
    ram_mb: Math.max(1024, Number(raw?.ram_mb) || DEFAULT_PROFILE.ram_mb),
    java_path: raw?.java_path ?? null,
    jvm_args: raw?.jvm_args ?? "",
    theme: normalizeThemeId(raw?.theme),
  };
}

type LaunchResult = {
  ok: boolean;
  message: string;
  phase: GamePhase;
};

type GamePhase = "idle" | "launching" | "running";

type TopTab =
  | "home"
  | "play"
  | "installations"
  | "friends"
  | "network"
  | "skins"
  | "settings";

const HOME_TABS: Array<
  [Exclude<TopTab, "home" | "play" | "installations" | "settings" | "skins">, string]
> = [
  ["friends", "Friends"],
  ["network", "Network"],
];

const PACK_TABS: Array<
  [Exclude<TopTab, "home" | "installations" | "settings" | "skins">, string]
> = [["play", "Play"], ...HOME_TABS];

function TopNavTabIcon({ id }: { id: string }) {
  if (id === "play") {
    return (
      <svg className="topnav-tab-icon" viewBox="0 0 24 24" aria-hidden>
        <path fill="currentColor" d="M8 5.14v13.72L19 12 8 5.14z" />
      </svg>
    );
  }
  if (id === "friends") {
    return (
      <svg className="topnav-tab-icon" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm6.5-.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5zM3.5 19.25c0-2.9 2.35-5.25 5.5-5.25s5.5 2.35 5.5 5.25V20H3.5v-.75zm11.25-.75c0-1.55.48-2.98 1.28-4.16.72.28 1.5.44 2.32.44 2.76 0 5 2.01 5 4.5V20h-8.6v-.75z"
        />
      </svg>
    );
  }
  if (id === "network") {
    return (
      <svg className="topnav-tab-icon" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M12 4a8 8 0 0 1 8 8h-2a6 6 0 1 0-6 6v2a8 8 0 0 1 0-16zm0 4a4 4 0 0 1 4 4h-2a2 2 0 1 0-2 2v2a4 4 0 0 1 0-8zm-.75 7.25a1.25 1.25 0 1 1 1.5 0V20h-1.5v-4.75z"
        />
      </svg>
    );
  }
  return null;
}

type PackRelease = {
  id: string;
  version: string;
};

type RuntimeStatus = {
  onboarding: {
    completed: boolean;
    java_ok: boolean;
    java_path: string | null;
  };
};

type PackStatus = {
  id: string;
  installed: boolean;
  local_version: string | null;
  path: string;
};

type VanillaVersionRow = {
  id: string;
  type: string;
  release_time: string;
  pack_id: string;
  installed: boolean;
};

type VanillaListResponse = {
  latest: { release: string; snapshot: string };
  versions: VanillaVersionRow[];
};

type ProgressEvent = {
  phase: string;
  percent: number;
  message: string;
};

type Gate = "loading" | "auth" | "onboarding" | "app";

const PROGRESS_PHASE: Record<string, string> = {
  java: "Java",
  pack: "Pack",
  fabric: "Libraries",
  assets: "Assets",
  runtime: "Runtime",
  done: "Done",
};

function isVanillaPackId(packId: string | null | undefined): boolean {
  return Boolean(packId?.startsWith("vanilla-"));
}

function isReminedVanillaPackId(packId: string | null | undefined): boolean {
  return Boolean(packId?.startsWith("remined-vanilla-"));
}

export default function App() {
  const [gate, setGate] = useState<Gate>("loading");
  const [bootLeaving, setBootLeaving] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [authOfflineHint, setAuthOfflineHint] = useState<string | null>(null);
  const [mediaTick, setMediaTick] = useState(0);
  const themeReadyRef = useRef(false);
  const offlineModeRef = useRef(false);
  const reconnectingRef = useRef(false);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [catalog, setCatalog] = useState<CatalogPack[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [skinPreview, setSkinPreview] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"idle" | "ok" | "error">("idle");
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [topTab, setTopTab] = useState<TopTab>("home");
  const [rail, setRail] = useState<
    | "home"
    | "java"
    | "vanilla"
    | "remined-vanilla"
    | "installations"
    | "settings"
    | "profile"
  >("home");
  const [javaInfo, setJavaInfo] = useState<JavaInfo | null>(null);
  const [appVersion, setAppVersion] = useState("0.5.1");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installPercent, setInstallPercent] = useState(0);
  const [installPhase, setInstallPhase] = useState("");
  const [installMessage, setInstallMessage] = useState("");
  const [vanillaVersions, setVanillaVersions] = useState<VanillaVersionRow[]>(
    [],
  );
  const [vanillaPick, setVanillaPick] = useState(
    () => readLastPlayed().vanilla ?? "",
  );
  const [vanillaBusy, setVanillaBusy] = useState(false);
  const [vanillaLoaded, setVanillaLoaded] = useState(false);
  const [rvVersions, setRvVersions] = useState<VanillaVersionRow[]>([]);
  const [rvPick, setRvPick] = useState(
    () => readLastPlayed()["remined-vanilla"] ?? "",
  );
  const [rvBusy, setRvBusy] = useState(false);
  const [rvLoaded, setRvLoaded] = useState(false);
  /** Pack actually launched this session (vanilla or remine) — for LAN/presence. */
  const [runningPackId, setRunningPackId] = useState<string | null>(null);
  const [reminedId, setReminedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<ToastTone>("default");

  function showToast(message: string, tone: ToastTone = "default") {
    setToastTone(tone);
    setToast(message);
  }
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [hostingLan, setHostingLan] = useState<HostingLan | null>(null);
  const [joiningFriendId, setJoiningFriendId] = useState<string | null>(null);
  const hostingBusyRef = useRef(false);
  const lastHostPortRef = useRef<number | null>(null);
  const hostFailRef = useRef<{ port: number; at: number } | null>(null);
  /** Keep home wallpaper <video> mounted so return visits don't re-decode. */
  const homeVideoRef = useRef<HTMLVideoElement | null>(null);
  const [homeVideoKept, setHomeVideoKept] = useState(false);
  const [homeVideoReady, setHomeVideoReady] = useState(false);

  async function refreshJava(path?: string | null) {
    try {
      const info = await invoke<JavaInfo>("probe_java", {
        path: path?.trim() ? path.trim() : null,
      });
      setJavaInfo(info);
    } catch {
      setJavaInfo(null);
    }
  }

  async function bootstrapLauncher() {
    try {
      // Offline / flaky net: never wait on Supabase/GitHub catalog forever.
      const catalogPromise = offlineModeRef.current
        ? Promise.resolve(readOfflineCache().catalog)
        : withTimeout(fetchCatalogFromSupabase(), 5000, () => {
            const cached = readOfflineCache().catalog;
            return cached.length > 0 ? cached : ([] as CatalogPack[]);
          });

      const [packList, saved, gamePhase, version, remoteCatalog] =
        await Promise.all([
          invoke<Pack[]>("list_packs"),
          invoke<Profile>("get_profile"),
          invoke<GamePhase>("get_game_phase"),
          invoke<string>("get_app_version").catch(() => "0.5.1"),
          catalogPromise,
        ]);
      const next = normalizeProfile(saved);
      setCatalog(remoteCatalog);

      // Union catalog + local installs. Important for DMG: a lone vanilla
      // install must not hide Remined packs that still need Download.
      const byId = new Map<string, Pack>();
      for (const c of remoteCatalog) {
        byId.set(c.id, {
          id: c.id,
          name: c.name,
          version: c.version ?? "—",
          description: c.blurb,
        });
      }
      for (const p of packList) {
        const meta = remoteCatalog.find((c) => c.id === p.id);
        byId.set(p.id, {
          ...p,
          name: meta?.name || p.name,
          description: meta?.blurb || p.description,
        });
      }
      const merged = Array.from(byId.values());
      setPacks(merged);

      if (!next.selected_pack || isVanillaPackId(next.selected_pack)) {
        if (isVanillaPackId(next.selected_pack) && next.selected_pack) {
          const ver =
            packList.find((p) => p.id === next.selected_pack)?.version ??
            next.selected_pack.replace(/^vanilla-/, "");
          setVanillaPick(ver);
          writeLastPlayed({ vanilla: ver });
        }
        const lastJava = readLastPlayed().java;
        const def = pickDefaultPack(remoteCatalog);
        const remineId =
          (lastJava &&
          merged.some(
            (p) =>
              p.id === lastJava &&
              !isVanillaPackId(p.id) &&
              !isReminedVanillaPackId(p.id),
          )
            ? lastJava
            : null) ??
          merged.find(
            (p) => !isVanillaPackId(p.id) && !isReminedVanillaPackId(p.id),
          )?.id ??
          def?.id ??
          "";
        if (lastJava && remineId === lastJava) next.selected_pack = lastJava;
        else if (def) next.selected_pack = def.id;
        else if (remineId) next.selected_pack = remineId;
        else next.selected_pack = "";
      }

      const ids = new Set(packList.map((p) => p.id));
      // Also probe selected / catalog packs for install state
      await Promise.all(
        merged.map(async (p) => {
          try {
            const st = await invoke<PackStatus>("get_pack_status", {
              packId: p.id,
            });
            if (st.installed) ids.add(p.id);
          } catch {
            /* ignore */
          }
        }),
      );
      setInstalledIds(ids);

      setProfile(next);
      applyTheme(next.theme);
      themeReadyRef.current = true;
      setPhase(gamePhase);
      setAppVersion(version);
      void refreshJava(next.java_path);
      void hydratePackMedia(remoteCatalog, !offlineModeRef.current);
      // Skin preview comes from syncCloudProfile (per-account Supabase), not local leftovers
    } catch (err) {
      setStatus(String(err));
      setStatusKind("error");
    }
  }

  async function hydratePackMedia(packs: CatalogPack[], download: boolean) {
    const urls = collectCatalogMediaUrls(packs);
    if (download) await warmMediaCache(urls);
    else await resolveMediaFromDisk(urls);
    setMediaTick((n) => n + 1);
  }

  function isSkinUrl(path: string | null | undefined): boolean {
    if (!path) return false;
    return /^https?:\/\//i.test(path.trim());
  }

  async function applySkinPreview(path: string | null | undefined) {
    if (!path) {
      setSkinPreview(null);
      return;
    }
    if (isSkinUrl(path)) {
      const local = mediaSrc(path);
      if (local && local.startsWith("data:")) {
        setSkinPreview(local);
        return;
      }
      if (offlineModeRef.current) {
        const cached = readOfflineCache().account?.skin_data_url;
        if (cached) {
          setSkinPreview(cached);
          return;
        }
      }
      // Online: show remote now, warm disk cache in background
      const bust = path.includes("?") ? path : `${path}?t=${Date.now()}`;
      setSkinPreview(bust);
      void warmMediaCache([path]).then(() => {
        const warmed = mediaSrc(path);
        if (warmed?.startsWith("data:")) setSkinPreview(warmed);
      });
      return;
    }
    try {
      const data = await invoke<string | null>("read_skin_data_url", {
        path,
      });
      setSkinPreview(data);
    } catch {
      const cached = readOfflineCache().account?.skin_data_url ?? null;
      setSkinPreview(cached);
    }
  }

  async function rememberOfflineSnapshot(opts: {
    userId: string;
    email?: string | null;
    reminedId: string | null;
    username: string;
    skinPath: string | null;
    skinModel?: SkinModelKind | null;
  }) {
    let skinData: string | null =
      readOfflineCache().account?.skin_data_url ?? null;
    if (opts.skinPath && !offlineModeRef.current) {
      try {
        if (isSkinUrl(opts.skinPath)) {
          await warmMediaCache([opts.skinPath]);
          skinData = mediaSrc(opts.skinPath) ?? skinData;
          // Also keep launch materialization warm
          await invoke<string>("materialize_skin_path", {
            skin: opts.skinPath,
          }).catch(() => "");
        } else {
          skinData = await invoke<string | null>("read_skin_data_url", {
            path: opts.skinPath,
          });
        }
      } catch {
        /* keep previous cache */
      }
    } else if (opts.skinPath && isSkinUrl(opts.skinPath)) {
      await resolveMediaFromDisk([opts.skinPath]);
      skinData = mediaSrc(opts.skinPath) ?? skinData;
    }
    cacheAccount({
      userId: opts.userId,
      email: opts.email ?? null,
      remined_id: opts.reminedId,
      username: opts.username,
      skin_path: opts.skinPath,
      skin_model: normalizeSkinModel(
        opts.skinModel ?? readOfflineCache().account?.skin_model,
      ),
      skin_data_url: skinData,
    });
  }

  const launchPreparing = phase === "launching";
  const showPlayProgress = installing || launchPreparing;

  // Footer status is for transient feedback — don't leave "Pack deleted" etc. stuck.
  useEffect(() => {
    if (!status || showPlayProgress) return;
    if (statusKind !== "ok" && statusKind !== "error") return;
    const delay = statusKind === "error" ? 6500 : 3200;
    const id = window.setTimeout(() => {
      setStatus("");
      setStatusKind("idle");
    }, delay);
    return () => window.clearTimeout(id);
  }, [status, statusKind, showPlayProgress]);

  useEffect(() => {
    if (!showPlayProgress) return;
    let unlisten: (() => void) | undefined;
    void listen<ProgressEvent>("remined-progress", (ev) => {
      setInstallPhase(ev.payload.phase);
      setInstallPercent((prev) => Math.max(prev, ev.payload.percent));
      setInstallMessage(ev.payload.message);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [showPlayProgress]);

  async function syncCloudProfile(nextSession: Session): Promise<Profile> {
    const local = normalizeProfile(await invoke<Profile>("get_profile"));
    try {
      const cloud = await ensureCloudProfile(nextSession.user.id);
      setReminedId(cloud.remined_id);

      // Local profile.json is shared across accounts — always overwrite
      // account-bound fields from Supabase (null skin = Remined default Steve).
      const next: Profile = {
        ...local,
        username: cloud.username.trim() || "Player",
        skin_path: cloud.skin_path ?? null,
        skin_model: cloud.skin_model,
      };

      await persist(next);
      await applySkinPreview(cloud.skin_path);
      setUsernameDraft(null);
      void rememberOfflineSnapshot({
        userId: nextSession.user.id,
        email: nextSession.user.email ?? null,
        reminedId: cloud.remined_id,
        username: next.username,
        skinPath: next.skin_path,
        skinModel: next.skin_model,
      });
      return next;
    } catch (err) {
      console.warn("cloud profile", err);
      const cached = readOfflineCache().account;
      if (cached?.skin_data_url) setSkinPreview(cached.skin_data_url);
      else if (cached?.skin_path) await applySkinPreview(cached.skin_path);
      else setSkinPreview(null);
      if (cached?.remined_id) setReminedId(cached.remined_id);
      return local;
    }
  }

  async function enterOfflineMode(reason?: string): Promise<boolean> {
    const cache = readOfflineCache();
    if (!canEnterOffline(cache)) return false;

    offlineModeRef.current = true;
    setOfflineMode(true);
    setSession(null);
    setAuthOfflineHint(null);

    const acct = cache.account!;
    setReminedId(acct.remined_id);
    const local = normalizeProfile(await invoke<Profile>("get_profile"));
    const next: Profile = {
      ...local,
      username: acct.username.trim() || local.username || "Player",
      skin_path: acct.skin_path ?? local.skin_path,
      skin_model: normalizeSkinModel(acct.skin_model ?? local.skin_model),
    };
    await persist(next);
    if (acct.skin_data_url) setSkinPreview(acct.skin_data_url);
    else await applySkinPreview(next.skin_path);

    // Prefer cached marketing catalog; packs still come from disk
    if (cache.catalog.length > 0) {
      setCatalog(cache.catalog);
      await hydratePackMedia(cache.catalog, false);
    }
    await bootstrapLauncher();
    const skinUrl = cache.account?.skin_path;
    if (skinUrl && isSkinUrl(skinUrl)) {
      await resolveMediaFromDisk([skinUrl]);
      setMediaTick((n) => n + 1);
    }
    if (reason) showToast(reason, "err");
    return true;
  }

  /** Probe + restore session while staying in the app (no full re-login). */
  async function tryReconnectFromOffline() {
    if (!offlineModeRef.current || reconnectingRef.current) return;
    reconnectingRef.current = true;
    try {
      const online = isBrowserOnline() && (await probeOnline());
      if (!online) return;

      offlineModeRef.current = false;
      try {
        const session = await withTimeout(
          supabase.auth.getSession().then(({ data }) => data.session),
          6000,
        );
        if (!session) {
          setOfflineMode(false);
          setSession(null);
          setGate("auth");
          setAuthOfflineHint(null);
          showToast("Back online — sign in to sync", "ok");
          return;
        }
        setOfflineMode(false);
        setSession(session);
        await withTimeout(bootstrapLauncher(), 20000);
        await withTimeout(syncCloudProfile(session), 8000);
        showToast("Back online", "ok");
      } catch {
        offlineModeRef.current = true;
        setOfflineMode(true);
        showToast("Still can’t reach the cloud — staying offline", "err");
      }
    } finally {
      reconnectingRef.current = false;
    }
  }

  const usernameCommitted = profile.username.trim() || "Player";
  const usernameEditing = usernameDraft !== null;
  const usernameDirty =
    usernameEditing && usernameDraft.trim() !== usernameCommitted;

  async function commitUsername() {
    if (offlineMode) {
      showToast("Username sync needs internet");
      return;
    }
    if (!session?.user?.id || !usernameDirty || usernameBusy) return;
    setUsernameBusy(true);
    try {
      const saved = await updateCloudUsername(session.user.id, usernameDraft!);
      await persist({ ...profile, username: saved });
      setUsernameDraft(null);
      showToast("Username updated");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setUsernameBusy(false);
    }
  }

  function resetUsernameDraft() {
    setUsernameDraft(null);
  }

  async function leaveBoot(next: Exclude<Gate, "loading">) {
    setBootLeaving(true);
    await new Promise((r) => window.setTimeout(r, 480));
    setGate(next);
    setBootLeaving(false);
  }

  async function resolveGate(nextSession: Session | null) {
    // Deliberate offline session — ignore auth callbacks until user leaves it.
    if (offlineModeRef.current) return;

    setSession(nextSession);
    if (!nextSession) {
      setReminedId(null);
      setSkinPreview(null);
      setUsernameDraft(null);
      // Drop account-bound skin so the next login doesn't flash the previous one
      try {
        const local = normalizeProfile(await invoke<Profile>("get_profile"));
        if (local.skin_path) {
          await invoke("save_profile", {
            profile: { ...local, skin_path: null },
          });
          setProfile({ ...local, skin_path: null });
        }
      } catch {
        /* ignore */
      }
      await leaveBoot("auth");
      return;
    }
    // Switching accounts: reset avatar until cloud profile loads
    offlineModeRef.current = false;
    setOfflineMode(false);
    setSkinPreview(null);
    setUsernameDraft(null);
    try {
      const runtime = await invoke<RuntimeStatus>("get_runtime_status");
      cacheOnboardingCompleted(runtime.onboarding.completed);
      if (!runtime.onboarding.completed) {
        await leaveBoot("onboarding");
        return;
      }
      await withTimeout(bootstrapLauncher(), 20000);
      await withTimeout(syncCloudProfile(nextSession), 8000);
      await leaveBoot("app");
    } catch {
      // Network/cloud failure after auth — try cached offline app
      if (await enterOfflineMode("Couldn’t reach cloud — offline mode")) {
        await leaveBoot("app");
        return;
      }
      await leaveBoot("onboarding");
    }
  }

  async function copyReminedId() {
    if (!reminedId) return;
    try {
      await navigator.clipboard.writeText(reminedId);
      showToast("Copied Remined id");
    } catch {
      showToast("Couldn’t copy");
    }
  }

  function openProfile() {
    setRail("profile");
    setTopTab("skins");
  }

  async function signOut() {
    const uid = session?.user?.id;
    if (uid) {
      await setPresence({
        userId: uid,
        status: "offline",
        packId: null,
      });
    }
    clearOfflineAccount();
    offlineModeRef.current = false;
    setOfflineMode(false);
    if (session) await supabase.auth.signOut();
    else {
      setGate("auth");
      setAuthOfflineHint(null);
    }
  }

  function profileChip() {
    return (
      <div
        className={`topnav-profile ${rail === "profile" ? "is-active" : ""}`}
      >
        {offlineMode ? (
          <button
            type="button"
            className="topnav-offline-btn"
            title="Offline — click to check connection"
            aria-label="Offline mode — check connection"
            onClick={() => {
              showToast(
                "You’re offline — cached account & packs only. Friends, skins, and updates need internet.",
                "err",
              );
              void tryReconnectFromOffline();
            }}
          >
            <svg
              className="topnav-offline-icon"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              aria-hidden
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="square"
                d="M2 8.5c3.2-3 7-4.5 10-4.5s6.8 1.5 10 4.5"
              />
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="square"
                d="M5.5 12.2c2.2-2 5-3 6.5-3s4.3 1 6.5 3"
              />
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="square"
                d="M9 15.8c.9-.8 2-1.2 3-1.2s2.1.4 3 1.2"
              />
              <circle cx="12" cy="19" r="1.4" fill="currentColor" />
              {/* Outline in button fill so the slash cuts cleanly through the wifi */}
              <path
                className="topnav-offline-slash-outline"
                fill="none"
                strokeWidth="7.5"
                strokeLinecap="square"
                d="M4 20 L20 4"
              />
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="square"
                d="M4 20 L20 4"
              />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          className="topnav-avatar-btn"
          title="Profile"
          onClick={openProfile}
        >
          <SkinHead
            skinUrl={skinPreview}
            className="topnav-avatar"
            size={36}
          />
        </button>
        <div className="topnav-identity">
          <strong className="topnav-nick">
            {profile.username.trim() || "Player"}
          </strong>
          {reminedId ? (
            <button
              type="button"
              className="topnav-id"
              title="Copy Remined id"
              onClick={() => void copyReminedId()}
            >
              #{reminedId}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  useEffect(() => {
    // Hydrate theme ASAP so boot UI never snaps when profile arrives later
    void invoke<Profile>("get_profile")
      .then((saved) => {
        applyTheme(normalizeProfile(saved).theme);
        themeReadyRef.current = true;
      })
      .catch(() => {
        applyTheme(DEFAULT_THEME);
        themeReadyRef.current = true;
      });

    void (async () => {
      // Mirror onboarding into cache for offline entry
      try {
        const runtime = await invoke<RuntimeStatus>("get_runtime_status");
        cacheOnboardingCompleted(runtime.onboarding.completed);
      } catch {
        /* ignore */
      }

      const online = isBrowserOnline() && (await probeOnline());
      if (!online) {
        if (await enterOfflineMode("You’re offline — using cached account")) {
          await leaveBoot("app");
          return;
        }
        setAuthOfflineHint(
          canEnterOffline()
            ? "No network — you can continue offline with your last account."
            : "No network. Sign in once online to enable offline play.",
        );
        await leaveBoot("auth");
        return;
      }

      setAuthOfflineHint(null);
      try {
        const session = await withTimeout(
          supabase.auth.getSession().then(({ data }) => data.session),
          6000,
        );
        await resolveGate(session);
      } catch {
        if (await enterOfflineMode("Cloud unreachable — offline mode")) {
          await leaveBoot("app");
          return;
        }
        setAuthOfflineHint("Cloud unreachable. Try again when you’re online.");
        await leaveBoot("auth");
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // Boot already handles getSession; INITIAL_SESSION would race / re-enter cloud.
      if (event === "INITIAL_SESSION") return;
      if (offlineModeRef.current) return;
      void resolveGate(next);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribeConnectivity((online) => {
      if (!online) {
        if (gate === "app" && !offlineModeRef.current) {
          offlineModeRef.current = true;
          setOfflineMode(true);
          showToast("Connection lost — offline mode", "err");
        }
        return;
      }
      if (offlineModeRef.current && gate === "app") {
        showToast("Back online — sign in again to sync friends & skins");
      }
    });
  }, [gate]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void invoke<GamePhase>("get_game_phase")
        .then(setPhase)
        .catch(() => undefined);
    }, 700);
    return () => window.clearInterval(id);
  }, []);

  const selectedPack = useMemo(
    () => packs.find((p) => p.id === profile.selected_pack) ?? packs[0],
    [packs, profile.selected_pack],
  );

  const reminePacks = useMemo(
    () =>
      packs.filter(
        (p) => !isVanillaPackId(p.id) && !isReminedVanillaPackId(p.id),
      ),
    [packs],
  );

  const installedPacks = useMemo(
    () => packs.filter((p) => installedIds.has(p.id)),
    [packs, installedIds],
  );

  /** Remined catalog pack for rail logo / pack page — never vanilla rails. */
  const activeReminePack = useMemo(() => {
    if (
      selectedPack &&
      !isVanillaPackId(selectedPack.id) &&
      !isReminedVanillaPackId(selectedPack.id)
    ) {
      return selectedPack;
    }
    return reminePacks[0];
  }, [selectedPack, reminePacks]);

  const vanillaSelectPacks = useMemo(() => {
    const fromManifest = vanillaVersions
      .filter((v) => v.type === "release")
      .map((v) => ({
        id: v.id,
        name: v.id,
        version: v.installed ? "Installed" : "Release",
      }));
    if (fromManifest.length > 0) return fromManifest;
    return packs
      .filter((p) => isVanillaPackId(p.id))
      .map((p) => ({
        id: p.version,
        name: p.version,
        version: "Installed",
      }));
  }, [vanillaVersions, packs]);

  const rvSelectPacks = useMemo(() => {
    if (rvVersions.length > 0) {
      return rvVersions.map((v) => ({
        id: v.id,
        name: v.id,
        version: v.installed ? "Installed" : "Fabric + skins",
      }));
    }
    return packs
      .filter((p) => isReminedVanillaPackId(p.id))
      .map((p) => ({
        id: p.version,
        name: p.version,
        version: "Installed",
      }));
  }, [rvVersions, packs]);

  useEffect(() => {
    if (gate === "app" && rail === "vanilla") {
      void loadVanillaVersions();
    }
    if (gate === "app" && rail === "remined-vanilla") {
      void loadReminedVanillaVersions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when opening vanilla rails
  }, [gate, rail]);

  useEffect(() => {
    if (!session?.user?.id || gate !== "app" || offlineMode) return;
    const userId = session.user.id;
    const playPack =
      runningPackId ??
      (rail === "vanilla" && vanillaPick
        ? `vanilla-${vanillaPick}`
        : rail === "remined-vanilla" && rvPick
          ? `remined-vanilla-${rvPick}`
          : null);

    const push = () => {
      if (hostingLan) {
        void setPresence({
          userId,
          status: "hosting",
          packId: hostingLan.packId,
          shareCode: hostingLan.shareCode,
          gamePort: hostingLan.gamePort,
        });
        return;
      }
      const playing = phase === "running" || phase === "launching";
      void setPresence({
        userId,
        status: playing ? "in_game" : "online",
        packId: playing
          ? (playPack ?? activeReminePack?.id ?? profile.selected_pack ?? null)
          : null,
        shareCode: null,
        gamePort: null,
      });
    };
    push();
    const heartbeat = window.setInterval(push, 40_000);

    const goOffline = () => {
      void setPresence({ userId, status: "offline", packId: null });
    };
    window.addEventListener("pagehide", goOffline);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", goOffline);
    };
  }, [
    session?.user?.id,
    gate,
    phase,
    rail,
    vanillaPick,
    rvPick,
    runningPackId,
    activeReminePack?.id,
    profile.selected_pack,
    hostingLan,
    offlineMode,
  ]);

  // Watch Open-to-LAN → Porthole expose → publish share code while game runs.
  useEffect(() => {
    const lanPackId =
      runningPackId ??
      (rail === "vanilla" && vanillaPick
        ? `vanilla-${vanillaPick}`
        : rail === "remined-vanilla" && rvPick
          ? `remined-vanilla-${rvPick}`
          : activeReminePack?.id ?? selectedPack?.id ?? null);

    if (gate !== "app" || phase !== "running" || !lanPackId) {
      if (phase === "idle") {
        setRunningPackId(null);
        setHostingLan(null);
        lastHostPortRef.current = null;
        hostingBusyRef.current = false;
        void portholeStopAll().catch(() => undefined);
      }
      return;
    }
    const packId = lanPackId;
    let cancelled = false;

    const tick = window.setInterval(() => {
      void (async () => {
        if (cancelled || hostingBusyRef.current) return;
        try {
          const port = await readLanPort(packId);
          if (cancelled) return;

          // World left / LAN closed (log shows stop after publish) — tear down tunnel.
          if (!port) {
            if (lastHostPortRef.current !== null) {
              lastHostPortRef.current = null;
              hostFailRef.current = null;
              setHostingLan(null);
              await portholeStopHost().catch(() => undefined);
              if (!cancelled) {
                showToast("Hosting stopped");
              }
            }
            return;
          }

          if (lastHostPortRef.current === port) return;
          const fail = hostFailRef.current;
          if (fail && fail.port === port && Date.now() - fail.at < 20_000) {
            return;
          }
          hostingBusyRef.current = true;
          setStatus("Opening Network Play tunnel…");
          setStatusKind("idle");
          try {
            if (lastHostPortRef.current && lastHostPortRef.current !== port) {
              await portholeStopHost();
            }
            const info = await portholeStartHost(port);
            if (cancelled) {
              await portholeStopHost();
              return;
            }
            lastHostPortRef.current = port;
            hostFailRef.current = null;
            setHostingLan({
              packId,
              shareCode: info.share_code,
              gamePort: info.port,
            });
            showToast("Hosting — friends can Join you now");
            setStatus("");
            setStatusKind("ok");
          } catch (err) {
            hostFailRef.current = { port, at: Date.now() };
            if (!cancelled) {
              setStatus(
                err instanceof Error
                  ? err.message
                  : "Could not start Network Play — check Steam + Porthole",
              );
              setStatusKind("error");
            }
          } finally {
            hostingBusyRef.current = false;
          }
        } catch {
          /* keep polling */
        }
      })();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [
    gate,
    phase,
    runningPackId,
    rail,
    vanillaPick,
    rvPick,
    activeReminePack?.id,
    selectedPack?.id,
  ]);

  useEffect(() => {
    if (!session?.user?.id || offlineMode) return;
    const userId = session.user.id;
    return () => {
      void setPresence({ userId, status: "offline", packId: null });
    };
  }, [session?.user?.id, offlineMode]);

  const showHomeLanding =
    rail === "home" && (topTab === "home" || topTab === "play");

  useEffect(() => {
    if (showHomeLanding) setHomeVideoKept(true);
  }, [showHomeLanding]);

  useEffect(() => {
    const el = homeVideoRef.current;
    if (!el) return;
    if (showHomeLanding) {
      // WebKit sometimes stalls at end after pause — force loop restart
      if (el.ended || el.paused) {
        try {
          el.currentTime = el.ended ? 0 : el.currentTime;
        } catch {
          /* ignore seek errors while not ready */
        }
      }
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [showHomeLanding, homeVideoKept]);

  const viewCatalog = useMemo(
    () => localizeCatalog(catalog),
    // mediaTick forces re-localize after disk/network hydrate
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, mediaTick],
  );

  const packContent = useMemo(() => {
    if (!activeReminePack) return undefined;
    return viewCatalog.find((c) => c.id === activeReminePack.id);
  }, [viewCatalog, activeReminePack]);

  async function persist(next: Profile) {
    setProfile(next);
    applyTheme(next.theme);
    await invoke("save_profile", { profile: next });
  }

  async function setTheme(theme: ThemeId) {
    await persist({ ...profile, theme });
  }

  async function pickSkin() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    if (offlineMode) {
      showToast("Skins sync needs internet — go online and sign in");
      return;
    }
    if (!session?.user?.id) {
      showToast("Sign in to save a skin");
      return;
    }

    // Local preview while uploading
    const data = await invoke<string | null>("read_skin_data_url", {
      path: selected,
    });
    setSkinPreview(data);

    try {
      let id = reminedId;
      if (!id) {
        const cloud = await ensureCloudProfile(session.user.id);
        id = cloud.remined_id;
        setReminedId(id);
      }
      const url = await publishAccountSkin(id, selected, session.user.id);
      const next = { ...profile, skin_path: url };
      await persist(next);
      await warmMediaCache([url]);
      await applySkinPreview(url);
      void rememberOfflineSnapshot({
        userId: session.user.id,
        email: session.user.email ?? null,
        reminedId: id,
        username: next.username,
        skinPath: url,
        skinModel: next.skin_model,
      });
      showToast("Skin saved");
    } catch (err) {
      setSkinPreview(profile.skin_path && isSkinUrl(profile.skin_path) ? profile.skin_path : null);
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function clearSkin() {
    const next = { ...profile, skin_path: null };
    await persist(next);
    setSkinPreview(null);
    if (session?.user?.id && reminedId) {
      try {
        await clearAccountSkin(reminedId, session.user.id);
      } catch {
        /* ignore */
      }
    }
  }

  async function setSkinModel(model: SkinModelKind) {
    const nextModel = normalizeSkinModel(model);
    if (nextModel === profile.skin_model) return;
    const next = { ...profile, skin_model: nextModel };
    await persist(next);
    if (offlineMode) {
      const acct = readOfflineCache().account;
      if (acct) {
        cacheAccount({ ...acct, skin_model: nextModel });
      }
      return;
    }
    if (!session?.user?.id) return;
    try {
      const saved = await updateCloudSkinModel(session.user.id, nextModel);
      if (saved !== nextModel) {
        await persist({ ...next, skin_model: saved });
      }
      void rememberOfflineSnapshot({
        userId: session.user.id,
        email: session.user.email ?? null,
        reminedId: reminedId,
        username: next.username,
        skinPath: next.skin_path,
        skinModel: saved,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteInstalledPack(packId: string) {
    // window.confirm is non-blocking in Tauri/WKWebView — use plugin dialog.
    const ok = await confirm(
      `Delete installation “${packId}”? Saves in that folder will be removed.`,
      {
        title: "Delete installation",
        kind: "warning",
        okLabel: "Delete",
        cancelLabel: "Cancel",
      },
    );
    if (!ok) return;
    setStatus("Deleting pack…");
    setStatusKind("idle");
    try {
      await invoke("delete_pack", { packId });
      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.delete(packId);
        return next;
      });
      if (isVanillaPackId(packId) && packId === `vanilla-${vanillaPick}`) {
        setVanillaPick("");
      }
      if (
        isReminedVanillaPackId(packId) &&
        packId === `remined-vanilla-${rvPick}`
      ) {
        setRvPick("");
      }
      if (profile.selected_pack === packId) {
        const fallback =
          packs.find((p) => p.id !== packId && !isVanillaPackId(p.id))?.id ??
          catalog.find((c) => c.id !== packId)?.id ??
          reminePacks.find((p) => p.id !== packId)?.id ??
          "";
        await persist({ ...profile, selected_pack: fallback });
      }
      if (runningPackId === packId) setRunningPackId(null);
      await bootstrapLauncher();
      setStatus("Pack deleted");
      setStatusKind("ok");
      showToast("Installation removed");
    } catch (err) {
      setStatus(String(err));
      setStatusKind("error");
    }
  }

  async function pickJava() {
    const selected = await open({
      multiple: false,
      directory: false,
    });
    if (!selected || Array.isArray(selected)) return;
    const next = { ...profile, java_path: selected };
    await persist(next);
    void refreshJava(selected);
  }

  async function clearJava() {
    const next = { ...profile, java_path: null };
    await persist(next);
    void refreshJava(null);
  }

  const settingsForm = (
    <section className="section settings-panel">
      <h2 className="page-title">Settings</h2>

      <div className="settings-block">
        <h3 className="settings-heading">Java</h3>

        <div className="field">
          <label htmlFor="ram">Memory (RAM)</label>
          <select
            id="ram"
            value={String(profile.ram_mb)}
            onChange={(e) =>
              void persist({ ...profile, ram_mb: Number(e.target.value) })
            }
          >
            {RAM_OPTIONS_GB.map((gb) => (
              <option key={gb} value={gb * 1024}>
                {gb} GB
              </option>
            ))}
            {RAM_OPTIONS_GB.every((gb) => gb * 1024 !== profile.ram_mb) ? (
              <option value={profile.ram_mb}>
                {Math.round(profile.ram_mb / 1024)} GB
              </option>
            ) : null}
          </select>
        </div>

        <div className="field">
          <label htmlFor="java-path">Java path</label>
          <div className="field-row">
            <input
              id="java-path"
              type="text"
              spellCheck={false}
              placeholder="Auto (OpenJDK 25)"
              value={profile.java_path ?? ""}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  java_path: e.target.value || null,
                })
              }
              onBlur={() => {
                void persist(profile);
                void refreshJava(profile.java_path);
              }}
            />
            <button type="button" className="btn-mc" onClick={() => void pickJava()}>
              Browse
            </button>
            {profile.java_path ? (
              <button
                type="button"
                className="btn-mc dim"
                onClick={() => void clearJava()}
              >
                Auto
              </button>
            ) : null}
          </div>
          {javaInfo ? (
            <p
              className={`java-probe ${javaInfo.ok ? "is-ok" : "is-warn"}`}
              title={javaInfo.path}
            >
              {javaInfo.version}
              {javaInfo.major != null ? ` · major ${javaInfo.major}` : ""}
              {!javaInfo.ok && javaInfo.path
                ? " — need Java 25 for Fabric 26.2"
                : ""}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="jvm-args">JVM flags</label>
          <textarea
            id="jvm-args"
            rows={3}
            spellCheck={false}
            placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=200"
            value={profile.jvm_args}
            onChange={(e) =>
              setProfile({ ...profile, jvm_args: e.target.value })
            }
            onBlur={() => void persist(profile)}
          />
          <p className="field-hint">
            Extra args after -Xmx. Space-separated. Leave empty for defaults.
          </p>
        </div>
      </div>

      <div className="settings-block">
        <h3 className="settings-heading">Pack</h3>
        <div className="update-row">
          <button
            type="button"
            className="btn-mc"
            disabled={packBusy}
            onClick={() => void syncPack()}
          >
            {packBusy ? "Updating…" : "Update pack"}
          </button>
          <span className="settings-value">
            {activeReminePack?.name ?? profile.selected_pack ?? "—"}
            {activeReminePack?.version ? ` · ${activeReminePack.version}` : ""}
          </span>
        </div>
      </div>

      <div className="settings-block">
        <h3 className="settings-heading">Theme</h3>
        <p className="field-hint theme-hint">
          Pick a surface and accent. Applies instantly.
        </p>
        <div className="theme-grid" role="listbox" aria-label="Theme presets">
          {THEME_PRESETS.map((preset) => {
            const active = profile.theme === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`theme-card ${active ? "is-active" : ""}`}
                onClick={() => void setTheme(preset.id)}
              >
                <span
                  className="theme-swatch"
                  style={{
                    background: `linear-gradient(135deg, ${preset.surface} 0 55%, ${preset.accent} 55%)`,
                  }}
                  aria-hidden
                />
                <span className="theme-card-copy">
                  <strong>{preset.label}</strong>
                  <em>{preset.mode}</em>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="settings-block">
        <h3 className="settings-heading">Launcher</h3>
        <div className="settings-row">
          <span>Version</span>
          <span className="settings-value">{appVersion}</span>
        </div>
        <div className="update-row">
          <button
            type="button"
            className="btn-mc"
            disabled={updateBusy}
            onClick={() => void checkForUpdate()}
          >
            {updateBusy ? "Checking…" : "Check for updates"}
          </button>
        </div>
      </div>

      <div className="settings-block settings-account">
        <h3 className="settings-heading">Account</h3>
        {session?.user?.email ? (
          <p className="settings-account-email">{session.user.email}</p>
        ) : null}
        {reminedId ? (
          <p className="settings-account-id">
            Remined id{" "}
            <button
              type="button"
              className="topnav-id"
              onClick={() => void copyReminedId()}
            >
              #{reminedId}
            </button>
          </p>
        ) : null}
        {offlineMode ? (
          <p className="field-hint">
            Offline — playing with your cached account. Sign in when online to
            sync friends and skins.
          </p>
        ) : null}
        <button
          type="button"
          className="btn-signout"
          onClick={() => void signOut()}
        >
          {offlineMode ? "Leave offline" : "Sign out"}
        </button>
      </div>
    </section>
  );

  async function syncPack() {
    if (offlineMode || !isBrowserOnline()) {
      showToast("Pack updates need internet");
      return;
    }
    const packId = activeReminePack?.id;
    if (!packId) return;
    setPackBusy(true);
    setInstalling(true);
    setInstallPercent(0);
    setInstallMessage("Updating pack…");
    setStatus("");
    setStatusKind("idle");
    try {
      await invoke("ensure_pack", { packId });
      await bootstrapLauncher();
      setStatus("Pack ready");
      setStatusKind("ok");
    } catch (err) {
      setStatus(String(err));
      setStatusKind("error");
    } finally {
      setPackBusy(false);
      setInstalling(false);
    }
  }

  async function checkForUpdate() {
    if (offlineMode || !isBrowserOnline()) {
      showToast("Update check needs internet");
      return;
    }
    setUpdateBusy(true);
    setStatus("Checking for launcher updates…");
    setStatusKind("idle");
    try {
      const update = await check();
      if (!update) {
        setStatus("Already on the latest launcher");
        setStatusKind("ok");
        return;
      }
      setStatus(`Downloading ${update.version}…`);
      await update.downloadAndInstall();
      setStatus("Restarting…");
      await relaunch();
    } catch (err) {
      setStatus(String(err));
      setStatusKind("error");
    } finally {
      setUpdateBusy(false);
    }
  }

  const vanillaPackId = vanillaPick ? `vanilla-${vanillaPick}` : "";
  const vanillaReady = Boolean(
    vanillaPick && installedIds.has(vanillaPackId),
  );
  const rvPackId = rvPick ? `remined-vanilla-${rvPick}` : "";
  const rvReady = Boolean(rvPick && installedIds.has(rvPackId));
  const packReady = Boolean(
    activeReminePack && installedIds.has(activeReminePack.id),
  );
  const activeReady =
    rail === "vanilla"
      ? vanillaReady
      : rail === "remined-vanilla"
        ? rvReady
        : packReady;

  const playKind = installing
    ? "installing"
    : phase === "launching"
      ? "launching"
      : phase === "running"
        ? "running"
        : activeReady
          ? "play"
          : "download";
  const playLabel =
    playKind === "installing"
      ? "Installing"
      : playKind === "launching"
        ? "Launching"
        : playKind === "running"
          ? "Running"
          : playKind === "download"
            ? "Download"
            : "Play";
  const playBusy = phase !== "idle" || installing || vanillaBusy || rvBusy;

  function isCancelledError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /cancelled/i.test(msg);
  }

  async function cancelCurrentInstall() {
    if (!installing) return;
    try {
      await invoke("cancel_install");
    } catch {
      /* ignore */
    }
  }

  async function downloadPack() {
    if (!activeReminePack || playBusy) return;
    setInstalling(true);
    setInstallPercent(0);
    setInstallPhase("pack");
    setInstallMessage("Preparing…");
    setStatus("");
    setStatusKind("idle");
    try {
      await invoke("ensure_pack", { packId: activeReminePack.id });
      setInstalledIds((prev) => new Set(prev).add(activeReminePack.id));
      await bootstrapLauncher();
      setStatus("Ready to play");
      setStatusKind("ok");
    } catch (err) {
      if (isCancelledError(err)) {
        setStatus("Cancelled");
        setStatusKind("idle");
      } else {
        setStatus(String(err));
        setStatusKind("error");
      }
    } finally {
      setInstalling(false);
    }
  }

  async function ensurePackUpToDate(): Promise<boolean> {
    if (!activeReminePack) return false;
    setStatus("Checking pack update…");
    setStatusKind("idle");
    try {
      const [remote, local] = await Promise.all([
        invoke<PackRelease>("fetch_pack_release", {
          packId: activeReminePack.id,
        }),
        invoke<PackStatus>("get_pack_status", {
          packId: activeReminePack.id,
        }),
      ]);
      if (local.installed && local.local_version === remote.version) {
        return true;
      }
      setStatus(
        local.installed
          ? `Updating to ${remote.version}…`
          : `Downloading ${remote.version}…`,
      );
      await downloadPack();
      const again = await invoke<PackStatus>("get_pack_status", {
        packId: activeReminePack.id,
      });
      return again.installed;
    } catch (err) {
      setStatus(String(err));
      setStatusKind("error");
      return false;
    }
  }

  async function loadVanillaVersions(force = false) {
    if (vanillaBusy) return;
    if (vanillaLoaded && !force) return;
    if (offlineMode || !isBrowserOnline()) {
      if (!vanillaPick) {
        const local = packs.find((p) => isVanillaPackId(p.id));
        if (local) setVanillaPick(local.version);
      }
      return;
    }
    setVanillaBusy(true);
    try {
      const res = await invoke<VanillaListResponse>("list_vanilla_versions");
      setVanillaVersions(res.versions);
      setVanillaLoaded(true);
      if (!vanillaPick) {
        const remembered = readLastPlayed().vanilla;
        const preferred =
          (remembered && res.versions.some((v) => v.id === remembered)
            ? remembered
            : null) ??
          res.versions.find((v) => v.installed && v.type === "release")?.id ??
          res.latest.release;
        setVanillaPick(preferred);
      } else if (!res.versions.some((v) => v.id === vanillaPick)) {
        const preferred =
          res.versions.find((v) => v.installed && v.type === "release")?.id ??
          res.latest.release;
        setVanillaPick(preferred);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setVanillaBusy(false);
    }
  }

  async function selectVanillaVersion(versionId: string) {
    setVanillaPick(versionId);
    writeLastPlayed({ vanilla: versionId });
  }

  async function installVanillaVersion(versionId: string): Promise<boolean> {
    if (!versionId) return false;
    if (offlineMode || !isBrowserOnline()) {
      showToast("Install needs internet");
      return false;
    }
    setVanillaBusy(true);
    setInstalling(true);
    setInstallPercent(0);
    setInstallPhase("pack");
    setInstallMessage(`Installing ${versionId}…`);
    setStatus("");
    setStatusKind("idle");
    try {
      const st = await invoke<PackStatus>("install_vanilla_version", {
        versionId,
      });
      setInstalledIds((prev) => new Set(prev).add(st.id));
      setVanillaPick(versionId);
      writeLastPlayed({ vanilla: versionId });
      await bootstrapLauncher();
      setVanillaVersions((prev) =>
        prev.map((v) =>
          v.id === versionId ? { ...v, installed: true } : v,
        ),
      );
      setStatus("Ready to play");
      setStatusKind("ok");
      return true;
    } catch (err) {
      if (isCancelledError(err)) {
        setStatus("Cancelled");
        setStatusKind("idle");
      } else {
        setStatus(String(err));
        setStatusKind("error");
      }
      return false;
    } finally {
      setVanillaBusy(false);
      setInstalling(false);
    }
  }

  async function loadReminedVanillaVersions(force = false) {
    if (rvBusy) return;
    if (rvLoaded && !force) return;
    if (offlineMode || !isBrowserOnline()) {
      if (!rvPick) {
        const local = packs.find((p) => isReminedVanillaPackId(p.id));
        if (local) setRvPick(local.version);
      }
      return;
    }
    setRvBusy(true);
    try {
      const res = await invoke<{ latest: string; versions: VanillaVersionRow[] }>(
        "list_remined_vanilla_versions",
      );
      setRvVersions(res.versions);
      setRvLoaded(true);
      if (!rvPick) {
        const remembered = readLastPlayed()["remined-vanilla"];
        const preferred =
          (remembered && res.versions.some((v) => v.id === remembered)
            ? remembered
            : null) ??
          res.versions.find((v) => v.installed)?.id ??
          res.latest;
        setRvPick(preferred);
      } else if (!res.versions.some((v) => v.id === rvPick)) {
        const preferred =
          res.versions.find((v) => v.installed)?.id ?? res.latest;
        setRvPick(preferred);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setRvBusy(false);
    }
  }

  async function installReminedVanillaVersion(
    versionId: string,
  ): Promise<boolean> {
    if (!versionId) return false;
    if (offlineMode || !isBrowserOnline()) {
      showToast("Install needs internet");
      return false;
    }
    setRvBusy(true);
    setInstalling(true);
    setInstallPercent(0);
    setInstallPhase("pack");
    setInstallMessage(`Installing Remined Vanilla ${versionId}…`);
    setStatus("");
    setStatusKind("idle");
    try {
      const st = await invoke<PackStatus>("install_remined_vanilla_version", {
        versionId,
      });
      setInstalledIds((prev) => new Set(prev).add(st.id));
      setRvPick(versionId);
      writeLastPlayed({ "remined-vanilla": versionId });
      await bootstrapLauncher();
      setRvVersions((prev) =>
        prev.map((v) =>
          v.id === versionId ? { ...v, installed: true } : v,
        ),
      );
      setStatus("Ready to play");
      setStatusKind("ok");
      return true;
    } catch (err) {
      if (isCancelledError(err)) {
        setStatus("Cancelled");
        setStatusKind("idle");
      } else {
        setStatus(String(err));
        setStatusKind("error");
      }
      return false;
    } finally {
      setRvBusy(false);
      setInstalling(false);
    }
  }

  async function launchWithOpts(opts?: {
    packId?: string;
    quickPlay?: string | null;
  }) {
    const packId = opts?.packId ?? selectedPack?.id;
    if (!packId || playBusy) return;
    if (!opts?.packId && !packReady) {
      await downloadPack();
      return;
    }

    // Show playbar progress for runtime prep + Java download during launch.
    setPhase("launching");
    setInstallPercent(0);
    setInstallPhase("");
    setInstallMessage(
      opts?.quickPlay ? "Joining friend…" : "Preparing to launch…",
    );
    setStatusKind("idle");
    if (!opts?.quickPlay) {
      setHostingLan(null);
      lastHostPortRef.current = null;
      void portholeStopAll().catch(() => undefined);
    }

    try {
      if (!opts?.quickPlay) {
        if (isVanillaPackId(packId)) {
          /* already installed on vanilla rail */
        } else if (isReminedVanillaPackId(packId)) {
          await invoke("ensure_pack", { packId });
          setInstalledIds((prev) => new Set(prev).add(packId));
        } else {
          const ready = await ensurePackUpToDate();
          if (!ready) {
            setPhase("idle");
            return;
          }
        }
      } else {
        await invoke("ensure_pack", { packId });
        setInstalledIds((prev) => new Set(prev).add(packId));
      }
    } catch (err) {
      setPhase("idle");
      setStatus(String(err));
      setStatusKind("error");
      return;
    }

    setStatus(opts?.quickPlay ? "Joining friend…" : "");
    try {
      // Sync first, then launch with the returned profile — React state alone is stale.
      const launchProfile = session
        ? await syncCloudProfile(session)
        : profile;
      const name = launchProfile.username.trim() || "Player";
      if (name.length < 3 || name.length > 16) {
        setPhase("idle");
        setStatus("3–16 characters");
        setStatusKind("error");
        return;
      }
      const result = await invoke<LaunchResult>("launch_pack", {
        packId,
        username: name,
        skinPath: launchProfile.skin_path,
        skinModel: launchProfile.skin_model,
        quickPlay: opts?.quickPlay ?? null,
      });
      setPhase(result.phase);
      if (!result.ok) {
        setRunningPackId(null);
        if (opts?.quickPlay) {
          void portholeStopJoin().catch(() => undefined);
        }
        setStatus(result.message);
        setStatusKind("error");
      } else {
        setRunningPackId(packId);
        if (isVanillaPackId(packId)) {
          const ver = packId.replace(/^vanilla-/, "");
          setVanillaPick(ver);
          writeLastPlayed({ vanilla: ver });
          setRail("vanilla");
        } else if (isReminedVanillaPackId(packId)) {
          const ver = packId.replace(/^remined-vanilla-/, "");
          setRvPick(ver);
          writeLastPlayed({ "remined-vanilla": ver });
          setRail("remined-vanilla");
        } else {
          writeLastPlayed({ java: packId });
          setRail("java");
        }
        setTopTab("play");
        if (opts?.quickPlay) {
          setStatus("Joined — connecting in Minecraft");
          setStatusKind("ok");
        }
      }
    } catch (err) {
      setRunningPackId(null);
      if (opts?.quickPlay) {
        void portholeStopJoin().catch(() => undefined);
      }
      setPhase("idle");
      setStatus(String(err));
      setStatusKind("error");
    }
  }

  async function launch() {
    if (rail === "vanilla") {
      if (!vanillaPick || playBusy) return;
      const packId = `vanilla-${vanillaPick}`;
      if (!installedIds.has(packId)) {
        const ok = await installVanillaVersion(vanillaPick);
        if (!ok) return;
      }
      await launchWithOpts({ packId });
      return;
    }
    if (rail === "remined-vanilla") {
      if (!rvPick || playBusy) return;
      const packId = `remined-vanilla-${rvPick}`;
      if (!installedIds.has(packId)) {
        const ok = await installReminedVanillaVersion(rvPick);
        if (!ok) return;
      }
      await launchWithOpts({ packId });
      return;
    }
    if (!activeReminePack) return;
    await launchWithOpts({ packId: activeReminePack.id });
  }

  async function joinFriendSession(row: FriendRow) {
    if (!canJoinFriend(row) || joiningFriendId) return;
    const packId = row.sessionPackId!;
    const shareCode = row.sessionShareCode!.trim();
    const port = row.sessionGamePort!;
    setJoiningFriendId(row.friendshipId);
    showToast(`Joining ${row.profile.username}…`);
    setStatus("Connecting Network Play…");
    setStatusKind("idle");
    try {
      const st = await portholeStatus();
      if (!st.installed) {
        setStatus(st.message);
        setStatusKind("error");
        showToast("Install Porthole from Network Play first");
        setTopTab("network");
        return;
      }
      await portholeStartJoin(shareCode, port);
      await launchWithOpts({
        packId,
        quickPlay: `127.0.0.1:${port}`,
      });
    } catch (err) {
      void portholeStopJoin().catch(() => undefined);
      setStatus(err instanceof Error ? err.message : String(err));
      setStatusKind("error");
      setPhase("idle");
    } finally {
      setJoiningFriendId(null);
    }
  }

  if (gate === "loading") {
    return (
      <div
        className={`gate-screen loading-screen${bootLeaving ? " is-leaving" : ""}`}
        role="status"
        aria-live="polite"
      >
        <div className="loading-panel">
          <img className="loading-logo" src={brandLogo} alt="" />
          <p className="loading-kicker">Remined Launcher</p>
          <h1 className="loading-title">Loading</h1>
          <div className="loading-bar" aria-hidden>
            {Array.from({ length: 14 }, (_, i) => (
              <span
                key={i}
                className="loading-bar-cell"
                style={{ animationDelay: `${i * 0.08}s` }}
              />
            ))}
          </div>
          <p className="loading-hint">Building terrain…</p>
        </div>
      </div>
    );
  }

  if (gate === "auth") {
    return (
      <AuthScreen
        onAuthed={() => {
          setAuthOfflineHint(null);
          setGate("loading");
        }}
        canOffline={canEnterOffline()}
        offlineHint={authOfflineHint}
        onContinueOffline={() => {
          void (async () => {
            if (await enterOfflineMode("Offline mode")) {
              setGate("app");
            } else {
              showToast("No cached account for offline play");
            }
          })();
        }}
      />
    );
  }

  if (gate === "onboarding") {
    return (
      <OnboardingScreen
        onDone={() => {
          void (async () => {
            cacheOnboardingCompleted(true);
            await bootstrapLauncher();
            if (session) {
              await syncCloudProfile(session);
            }
            setGate("app");
          })();
        }}
      />
    );
  }

  async function revealPackFolder(packId: string) {
    try {
      await invoke("open_pack_folder", { packId });
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  function renderInstallRow(pack: Pack) {
    const vanilla = isVanillaPackId(pack.id);
    const rv = isReminedVanillaPackId(pack.id);
    const active = vanilla
      ? Boolean(vanillaPick) && pack.id === `vanilla-${vanillaPick}`
      : rv
        ? Boolean(rvPick) && pack.id === `remined-vanilla-${rvPick}`
        : pack.id === (activeReminePack?.id ?? "");
    return (
      <li key={pack.id} className="install-item">
        <button
          type="button"
          className={`install-row ${active ? "active" : ""}`}
          onClick={() => {
            if (vanilla) {
              setVanillaPick(pack.version);
              writeLastPlayed({ vanilla: pack.version });
              setRail("vanilla");
              setTopTab("play");
            } else if (rv) {
              setRvPick(pack.version);
              writeLastPlayed({ "remined-vanilla": pack.version });
              setRail("remined-vanilla");
              setTopTab("play");
            } else {
              writeLastPlayed({ java: pack.id });
              void persist({
                ...profile,
                selected_pack: pack.id,
              });
              setRail("java");
              setTopTab("play");
            }
          }}
        >
          {vanilla ? (
            <img className="install-icon is-bare" src={vanillaLogo} alt="" />
          ) : rv ? (
            <img
              className="install-icon is-bare"
              src={reminedVanillaLogo}
              alt=""
            />
          ) : viewCatalog.find((c) => c.id === pack.id)?.logo_url ? (
            <img
              className="install-icon is-bare"
              src={viewCatalog.find((c) => c.id === pack.id)!.logo_url!}
              alt=""
            />
          ) : (
            <span className="install-icon" aria-hidden />
          )}
          <span className="install-copy">
            <strong>{pack.name}</strong>
            <span>{pack.version}</span>
          </span>
          {active ? <span className="install-badge">Selected</span> : null}
        </button>
        <div className="install-actions">
          <button
            type="button"
            className="btn-mc dim install-folder"
            title="Open folder"
            aria-label="Open folder"
            onClick={() => void revealPackFolder(pack.id)}
          >
            <svg viewBox="0 0 20 16" aria-hidden>
              <path d="M0 2h7l2 2h11v12H0V2z" />
            </svg>
          </button>
          <button
            type="button"
            className="btn-mc dim install-delete"
            onClick={() => void deleteInstalledPack(pack.id)}
          >
            Delete
          </button>
        </div>
      </li>
    );
  }

  const installedRemine = installedPacks.filter(
    (p) => !isVanillaPackId(p.id) && !isReminedVanillaPackId(p.id),
  );
  const installedVanilla = installedPacks.filter((p) => isVanillaPackId(p.id));
  const installedRv = installedPacks.filter((p) =>
    isReminedVanillaPackId(p.id),
  );

  const homeFeaturePack = activeReminePack ?? reminePacks[0] ?? null;
  const homeFeatureContent = homeFeaturePack
    ? viewCatalog.find((c) => c.id === homeFeaturePack.id)
    : viewCatalog.find((c) => !isVanillaPackId(c.id));
  const homePackReady = Boolean(
    homeFeaturePack && installedIds.has(homeFeaturePack.id),
  );

  /** One persistent <video> — survives rail changes (settings/java/etc.). */
  const homeVideoLayer =
    showHomeLanding || homeVideoKept ? (
      <video
        ref={homeVideoRef}
        className={`home-video${showHomeLanding ? " is-live" : " is-parked"}${
          homeVideoReady ? " is-ready" : ""
        }`}
        src={homeWallpaperVideo}
        autoPlay={showHomeLanding}
        muted
        loop
        playsInline
        preload="auto"
        onCanPlay={() => setHomeVideoReady(true)}
        onEnded={(e) => {
          // Fallback if native `loop` stalls (common after park/pause on WebKit)
          const v = e.currentTarget;
          v.currentTime = 0;
          if (showHomeLanding) void v.play().catch(() => {});
        }}
        aria-hidden
      />
    ) : null;

  const homeLanding = showHomeLanding ? (
    <div
      className={`home-stage has-video${homeVideoReady ? " is-video-ready" : ""}`}
    >
      <div className="home-video-scrim" aria-hidden />
      <EnchantParticles className="pack-enchant" count={26} />
      <div className="home-splash">
        <img
          className="home-mc-logo"
          src={homeMcLogo}
          alt="Remined Launcher — Java Edition"
          draggable={false}
        />
      </div>
      <div className="home-body-row">
        <div className="home-main">
          <div className="home-bottom">
            {homeFeaturePack ? (
              <button
                type="button"
                className="home-feature"
                onClick={() => {
                  void persist({
                    ...profile,
                    selected_pack: homeFeaturePack.id,
                  });
                  setRail("java");
                  setTopTab("play");
                }}
              >
                {homeFeatureContent?.logo_url ? (
                  <img
                    className="home-feature-logo"
                    src={homeFeatureContent.logo_url}
                    alt=""
                  />
                ) : (
                  <span className="home-feature-logo is-fallback" aria-hidden>
                    {(homeFeaturePack.name || "?").slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="home-feature-copy">
                  <strong>{homeFeaturePack.name}</strong>
                  <span>
                    {homeFeatureContent?.tagline?.trim() ||
                      homeFeaturePack.version ||
                      (homePackReady ? "Installed" : "Not installed")}
                  </span>
                </span>
                <span className="home-feature-cta">
                  {homePackReady ? "Open" : "View"}
                </span>
              </button>
            ) : null}
            <p className="home-foot">v{appVersion}</p>
          </div>
        </div>

        <div className="home-player">
          <SkinModel
            preset="home"
            skinUrl={skinPreview}
            skinModel={profile.skin_model}
            variant="full"
            transparent
            nameTag={profile.username.trim() || "Player"}
            className="home-player-skin"
          />
        </div>
      </div>
    </div>
  ) : null;

  const installationsPanel = (
    <section className="section">
      <h2 className="page-title">Installations</h2>
      {installedPacks.length === 0 ? (
        <p className="friends-lead">Nothing installed yet.</p>
      ) : (
        <div className="install-groups">
          {installedRemine.length > 0 ? (
            <ul className="install-list">
              {installedRemine.map(renderInstallRow)}
            </ul>
          ) : null}
          {installedRemine.length > 0 &&
          (installedRv.length > 0 || installedVanilla.length > 0) ? (
            <hr className="install-divider" />
          ) : null}
          {installedRv.length > 0 ? (
            <ul className="install-list">
              {installedRv.map(renderInstallRow)}
            </ul>
          ) : null}
          {installedRv.length > 0 && installedVanilla.length > 0 ? (
            <hr className="install-divider" />
          ) : null}
          {installedVanilla.length > 0 ? (
            <ul className="install-list">
              {installedVanilla.map(renderInstallRow)}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );

  const friendsPanel =
    topTab === "friends" ? (
      offlineMode || !session?.user?.id ? (
        <section className="section">
          <h2 className="page-title">Friends</h2>
          <p className="friends-lead">
            {offlineMode
              ? "Friends need an internet connection. You’re in offline mode."
              : "Sign in to see friends."}
          </p>
        </section>
      ) : (
        <FriendsPanel
          userId={session.user.id}
          myReminedId={reminedId}
          onToast={showToast}
          joiningFriendId={joiningFriendId}
          hostingSelf={Boolean(hostingLan)}
          onOpenNetworkPlay={() => setTopTab("network")}
          onInstallPorthole={() => {
            void openPortholeOnSteam().then(() =>
              showToast("Opening Steam — install Porthole, then Refresh"),
            );
          }}
          onJoinFriend={(row) => void joinFriendSession(row)}
        />
      )
    ) : null;

  const networkPanel =
    topTab === "network" ? (
      offlineMode ? (
        <section className="section">
          <h2 className="page-title">Network Play</h2>
          <p className="friends-lead">
            Network Play needs internet and Steam. You’re in offline mode —
            local worlds still work from Play.
          </p>
        </section>
      ) : (
        <NetworkPlayPanel
          hostingSelf={Boolean(hostingLan)}
          hostingPort={hostingLan?.gamePort ?? null}
          onToast={showToast}
        />
      )
    ) : null;

  const profilePanel = (
    <section className="section">
      <h2 className="page-title">Profile</h2>
      {session?.user?.email ? (
        <p className="friends-lead">{session.user.email}</p>
      ) : offlineMode ? (
        <p className="friends-lead">Offline account</p>
      ) : (
        <p className="friends-lead">Your Remined account</p>
      )}
      {reminedId ? (
        <div className="friends-info-block" role="note">
          <p>
            Your Remined id is{" "}
            <button
              type="button"
              className="friends-inline-link"
              title="Copy Remined id"
              onClick={() => void copyReminedId()}
            >
              #{reminedId}
            </button>
            . Friends add you with this id.
          </p>
        </div>
      ) : null}

      <div className="skin-layout">
        <SkinModel
          skinUrl={skinPreview}
          skinModel={profile.skin_model}
          variant="full"
          className="skin-stage"
        />
        <div className="skin-controls">
          <div className="field">
            <span className="field-label" id="skin-model-label">
              Arms
            </span>
            <div
              className="skin-model-toggle"
              role="group"
              aria-labelledby="skin-model-label"
            >
              <button
                type="button"
                className={`skin-model-btn${
                  profile.skin_model === "default" ? " is-active" : ""
                }`}
                aria-pressed={profile.skin_model === "default"}
                onClick={() => void setSkinModel("default")}
              >
                Wide
              </button>
              <button
                type="button"
                className={`skin-model-btn${
                  profile.skin_model === "slim" ? " is-active" : ""
                }`}
                aria-pressed={profile.skin_model === "slim"}
                onClick={() => void setSkinModel("slim")}
              >
                Slim
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="username">Username</label>
            <div className="username-edit">
              <input
                id="username"
                maxLength={16}
                spellCheck={false}
                value={usernameEditing ? usernameDraft! : usernameCommitted}
                onChange={(e) => setUsernameDraft(e.target.value)}
                onFocus={() => {
                  if (!usernameEditing) {
                    setUsernameDraft(usernameCommitted);
                  }
                }}
              />
              {usernameDirty ? (
                <div className="username-draft-actions">
                  <button
                    type="button"
                    className="btn-pixel-check"
                    title="Save username"
                    disabled={usernameBusy}
                    onClick={() => void commitUsername()}
                  >
                    <svg
                      className="btn-pixel-icon"
                      viewBox="0 0 11 9"
                      aria-hidden
                    >
                      <rect x="0" y="4" width="1" height="1" fill="#fff" />
                      <rect x="1" y="5" width="1" height="1" fill="#fff" />
                      <rect x="2" y="6" width="1" height="1" fill="#fff" />
                      <rect x="3" y="7" width="1" height="1" fill="#fff" />
                      <rect x="4" y="6" width="1" height="1" fill="#fff" />
                      <rect x="5" y="5" width="1" height="1" fill="#fff" />
                      <rect x="6" y="4" width="1" height="1" fill="#fff" />
                      <rect x="7" y="3" width="1" height="1" fill="#fff" />
                      <rect x="8" y="2" width="1" height="1" fill="#fff" />
                      <rect x="9" y="1" width="1" height="1" fill="#fff" />
                      <rect x="10" y="0" width="1" height="1" fill="#fff" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="btn-pixel-reset"
                    title="Discard"
                    disabled={usernameBusy}
                    onClick={resetUsernameDraft}
                  >
                    <svg
                      className="btn-pixel-icon"
                      viewBox="0 0 7 7"
                      aria-hidden
                    >
                      <rect x="0" y="0" width="1" height="1" fill="#1a1a1a" />
                      <rect x="1" y="1" width="1" height="1" fill="#1a1a1a" />
                      <rect x="2" y="2" width="1" height="1" fill="#1a1a1a" />
                      <rect x="3" y="3" width="1" height="1" fill="#1a1a1a" />
                      <rect x="4" y="4" width="1" height="1" fill="#1a1a1a" />
                      <rect x="5" y="5" width="1" height="1" fill="#1a1a1a" />
                      <rect x="6" y="6" width="1" height="1" fill="#1a1a1a" />
                      <rect x="6" y="0" width="1" height="1" fill="#1a1a1a" />
                      <rect x="5" y="1" width="1" height="1" fill="#1a1a1a" />
                      <rect x="4" y="2" width="1" height="1" fill="#1a1a1a" />
                      <rect x="2" y="4" width="1" height="1" fill="#1a1a1a" />
                      <rect x="1" y="5" width="1" height="1" fill="#1a1a1a" />
                      <rect x="0" y="6" width="1" height="1" fill="#1a1a1a" />
                    </svg>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <p className="field-hint">
            PNG only — 64×64, 64×32 or 128×128, max 256 KB.
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn-mc"
              onClick={() => void pickSkin()}
            >
              Choose skin
            </button>
            {profile.skin_path ? (
              <button
                type="button"
                className="btn-mc dim"
                onClick={() => void clearSkin()}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="profile-account">
        {offlineMode ? (
          <p className="field-hint">
            Offline — playing with your cached account. Sign in when online to
            sync friends and skins.
          </p>
        ) : null}
        <button
          type="button"
          className="btn-signout"
          onClick={() => void signOut()}
        >
          {offlineMode ? "Leave offline" : "Sign out"}
        </button>
      </div>
    </section>
  );

  const sharedTabBody =
    topTab === "friends"
      ? friendsPanel
      : topTab === "network"
        ? networkPanel
        : null;

  return (
    <div className="shell">
      <aside className="rail">
        <button
          type="button"
          className={`rail-home ${rail === "home" ? "active" : ""}`}
          title="Home"
          onClick={() => {
            setRail("home");
            setTopTab("home");
          }}
        >
          <img className="rail-brand-logo" src={brandLogo} alt="Remined" />
        </button>

        <button
          type="button"
          className={`rail-game${packContent?.logo_url ? " is-bare-logo" : ""}${
            rail === "java" ? " active" : ""
          }`}
          title={activeReminePack?.name ?? "Pack"}
          onClick={() => {
            setRail("java");
            setTopTab("play");
            if (
              activeReminePack &&
              profile.selected_pack !== activeReminePack.id
            ) {
              void persist({
                ...profile,
                selected_pack: activeReminePack.id,
              });
            }
          }}
        >
          {packContent?.logo_url ? (
            <img
              className="rail-pack-logo"
              src={packContent.logo_url}
              alt=""
            />
          ) : (
            <div className="block" aria-hidden />
          )}
        </button>

        <div className="rail-spacer" />

        <button
          type="button"
          className={`rail-vanilla ${rail === "vanilla" ? "active" : ""}`}
          title="Vanilla Minecraft"
          onClick={() => {
            setRail("vanilla");
            setTopTab("play");
          }}
        >
          <img className="rail-vanilla-logo" src={vanillaLogo} alt="" />
        </button>

        <button
          type="button"
          className={`rail-vanilla ${rail === "remined-vanilla" ? "active" : ""}`}
          title="Remined Vanilla"
          onClick={() => {
            setRail("remined-vanilla");
            setTopTab("play");
          }}
        >
          <img className="rail-vanilla-logo" src={reminedVanillaLogo} alt="" />
        </button>

        <button
          type="button"
          className={`rail-settings ${rail === "installations" ? "active" : ""}`}
          title="Installations"
          onClick={() => {
            setRail("installations");
            setTopTab("installations");
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M5 20h14v-2H5v2zm7-18L5.33 9h3.84v4h5.66V9h3.84L12 2z" />
          </svg>
        </button>

        <button
          type="button"
          className={`rail-settings ${rail === "settings" ? "active" : ""}`}
          title="Settings"
          onClick={() => {
            setRail("settings");
            setTopTab("settings");
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.86 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54c.05.22.25.41.48.41h3.84c.23 0 .43-.19.48-.41l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
          </svg>
        </button>
      </aside>

      <div className="stage">
        {homeVideoLayer}
        {rail === "settings" ||
        rail === "installations" ||
        rail === "profile" ? (
          <>
            <nav className="topnav">
              <div className="topnav-tabs" />
              {profileChip()}
            </nav>
            <div className="content">
              <PageMotion viewKey={`${rail}:${topTab}`}>
                {rail === "settings"
                  ? settingsForm
                  : rail === "installations"
                    ? installationsPanel
                    : profilePanel}
              </PageMotion>
            </div>
          </>
        ) : (
          <>
            <nav className="topnav">
              <div className="topnav-tabs">
                {(rail === "java" ||
                rail === "vanilla" ||
                rail === "remined-vanilla"
                  ? PACK_TABS
                  : HOME_TABS
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`topnav-tab ${topTab === id ? "active" : ""}`}
                    onClick={() => setTopTab(id)}
                  >
                    <TopNavTabIcon id={id} />
                    {label}
                  </button>
                ))}
              </div>
              {profileChip()}
            </nav>

            <div className="content">
              {/* Home / heroes stay outside motion — banners & scrims don't animate */}
              {homeLanding}

              {rail === "vanilla" && topTab === "play" ? (
                <div className="pack-stage">
                  <EnchantParticles className="pack-enchant" count={18} />
                  <header
                    className="hero has-art"
                    style={
                      {
                        ["--hero-image"]: `url("${vanillaWallpaper}")`,
                      } as CSSProperties
                    }
                  >
                    <p className="hero-kicker">Java Edition</p>
                    <h1 className="hero-title">Vanilla</h1>
                  </header>
                  <PageMotion viewKey={`${rail}:${topTab}`}>
                    <section className="pack-about">
                      <div className="pack-about-head">
                        <div className="pack-logo is-bare" aria-hidden>
                          <img src={vanillaLogo} alt="" />
                        </div>
                        <div className="pack-about-titles">
                          <h2 className="pack-about-title">
                            Minecraft {vanillaPick || "—"}
                          </h2>
                          <p className="pack-about-version">
                            {vanillaReady
                              ? vanillaPick
                              : vanillaPick
                                ? "Not installed"
                                : "—"}
                          </p>
                          <p
                            className="vanilla-skin-badge"
                            title="Your Remined skin is applied locally via a resource pack. Other players won’t see it in multiplayer."
                          >
                            Local skin only · friends won’t see it online
                          </p>
                        </div>
                      </div>
                      <p className="pack-about-blurb">
                        Minecraft is an open world of blocks where you dig,
                        craft, and build whatever you want. Survive the night,
                        explore caves and biomes, or settle down and shape the
                        land — alone or with friends on the same world.
                      </p>
                    </section>
                  </PageMotion>
                </div>
              ) : null}

              {rail === "remined-vanilla" && topTab === "play" ? (
                <div className="pack-stage">
                  <EnchantParticles className="pack-enchant" count={18} />
                  <header
                    className="hero has-art"
                    style={
                      {
                        ["--hero-image"]: `url("${reminedVanillaBanner}")`,
                      } as CSSProperties
                    }
                  >
                    <p className="hero-kicker">Fabric · Skins</p>
                    <h1 className="hero-title hero-title-row">
                      Remined Vanilla
                      <span
                        className="hero-beta-badge"
                        title="Beta — expect bugs and rough edges while we polish this pack."
                      >
                        Beta
                      </span>
                    </h1>
                  </header>
                  <PageMotion viewKey={`${rail}:${topTab}`}>
                    <section className="pack-about">
                      <div className="pack-about-head">
                        <div className="pack-logo is-bare" aria-hidden>
                          <img src={reminedVanillaLogo} alt="" />
                        </div>
                        <div className="pack-about-titles">
                          <h2 className="pack-about-title">
                            Minecraft {rvPick || "—"}
                          </h2>
                          <p className="pack-about-version">
                            {rvReady
                              ? rvPick
                              : rvPick
                                ? "Not installed"
                                : "—"}
                          </p>
                          <p
                            className="vanilla-skin-badge is-beta"
                            title="Beta — expect bugs and rough edges while we polish this pack."
                          >
                            Beta · bugs may happen
                          </p>
                          <p
                            className="vanilla-skin-badge is-ok"
                            title="Installs Fabric with SkinShuffle + CustomSkinLoader so your Remined skin works for you and friends, plus Sodium/Iris and other performance mods when available for that version."
                          >
                            Skins + Sodium/Iris · friends can see your skin
                          </p>
                        </div>
                      </div>
                      <p className="pack-about-blurb">
                        Clean Minecraft on Fabric, limited to versions where
                        Remined skins work. Download installs skins, LAN helper,
                        and the Remined opti stack for that branch (1.20-style or
                        26.x-style: Sodium/Iris, Lithium, Culling, C2ME, and more)
                        plus Resourcify when Modrinth has a build.
                      </p>
                    </section>
                  </PageMotion>
                </div>
              ) : null}

              {rail === "java" && topTab === "play" ? (
                <div className="pack-stage">
                  <EnchantParticles className="pack-enchant" count={22} />
                  <header
                    className={`hero${packContent?.wallpaper_url ? " has-art" : ""}`}
                    style={
                      packContent?.wallpaper_url
                        ? ({
                            ["--hero-image"]: `url("${packContent.wallpaper_url}")`,
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    <p className="hero-kicker">Java Edition</p>
                    <h1 className="hero-title">Remined</h1>
                  </header>

                  {activeReminePack ? (
                    <PageMotion viewKey={`${rail}:${topTab}`}>
                      <section className="pack-about">
                        <div className="pack-about-head">
                          <div
                            className={`pack-logo ${
                              packContent?.logo_url
                                ? "is-bare"
                                : "is-placeholder"
                            }`}
                            aria-hidden={!packContent?.logo_url}
                          >
                            {packContent?.logo_url ? (
                              <img src={packContent.logo_url} alt="" />
                            ) : (
                              <span className="pack-logo-fallback">
                                {activeReminePack.name
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="pack-about-titles">
                            <h2 className="pack-about-title">
                              {activeReminePack.name}
                            </h2>
                            {packContent?.tagline ? (
                              <p className="pack-about-tagline">
                                {packContent.tagline}
                              </p>
                            ) : null}
                            <p className="pack-about-version">
                              {activeReminePack.version}
                            </p>
                          </div>
                        </div>

                        {packContent?.blurb ? (
                          <p className="pack-about-blurb">
                            {packContent.blurb}
                          </p>
                        ) : null}

                        {packContent?.highlights?.length ? (
                          <ul className="pack-highlights">
                            {packContent.highlights.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : null}

                        {packContent?.gallery?.length ? (
                          <>
                            <h3 className="pack-gallery-heading">
                              Screenshots
                            </h3>
                            <PackGallery
                              images={packContent.gallery}
                              altPrefix={activeReminePack.name}
                            />
                          </>
                        ) : null}
                      </section>
                    </PageMotion>
                  ) : null}
                </div>
              ) : null}

              {sharedTabBody ? (
                <PageMotion viewKey={`${rail}:${topTab}`}>
                  {sharedTabBody}
                </PageMotion>
              ) : null}
            </div>
          </>
        )}

        {rail === "java" || rail === "vanilla" || rail === "remined-vanilla" ? (
          <footer
            className={`playbar ${showPlayProgress ? "is-installing" : ""}`}
          >
            {rail === "vanilla" ? (
              <PackSelect
                label="Version"
                packs={vanillaSelectPacks}
                value={vanillaPick}
                onChange={(id) => void selectVanillaVersion(id)}
                disabled={showPlayProgress || vanillaBusy}
              />
            ) : rail === "remined-vanilla" ? (
              <PackSelect
                label="Version"
                packs={rvSelectPacks}
                value={rvPick}
                onChange={(id) => {
                  setRvPick(id);
                  writeLastPlayed({ "remined-vanilla": id });
                }}
                disabled={showPlayProgress || rvBusy}
              />
            ) : (
              <PackSelect
                packs={reminePacks}
                value={activeReminePack?.id ?? ""}
                onChange={(id) => {
                  writeLastPlayed({ java: id });
                  void persist({ ...profile, selected_pack: id });
                }}
                disabled={showPlayProgress}
              />
            )}

            {showPlayProgress ? (
              <div className="playbar-progress">
                <PixelProgress
                  value={installPercent}
                  phase={
                    PROGRESS_PHASE[installPhase] ??
                    (installPhase || (launchPreparing ? "Launch" : ""))
                  }
                  label={installMessage || status}
                />
              </div>
            ) : (
              <div
                className={`status ${statusKind === "error" ? "error" : ""}`}
                aria-live="polite"
              >
                {status}
              </div>
            )}

            <div className="playbar-actions">
              {installing ? (
                <button
                  type="button"
                  className="play-cancel"
                  title="Cancel"
                  aria-label="Cancel install"
                  onClick={() => void cancelCurrentInstall()}
                >
                  <svg
                    className="btn-pixel-icon"
                    viewBox="0 0 7 7"
                    aria-hidden
                  >
                    <rect x="0" y="0" width="1" height="1" fill="#fff" />
                    <rect x="1" y="1" width="1" height="1" fill="#fff" />
                    <rect x="2" y="2" width="1" height="1" fill="#fff" />
                    <rect x="3" y="3" width="1" height="1" fill="#fff" />
                    <rect x="4" y="4" width="1" height="1" fill="#fff" />
                    <rect x="5" y="5" width="1" height="1" fill="#fff" />
                    <rect x="6" y="6" width="1" height="1" fill="#fff" />
                    <rect x="6" y="0" width="1" height="1" fill="#fff" />
                    <rect x="5" y="1" width="1" height="1" fill="#fff" />
                    <rect x="4" y="2" width="1" height="1" fill="#fff" />
                    <rect x="2" y="4" width="1" height="1" fill="#fff" />
                    <rect x="1" y="5" width="1" height="1" fill="#fff" />
                    <rect x="0" y="6" width="1" height="1" fill="#fff" />
                  </svg>
                </button>
              ) : null}
              <PlayButton
                kind={playKind}
                label={playLabel}
                disabled={
                  playBusy ||
                  (rail === "vanilla"
                    ? !vanillaPick
                    : rail === "remined-vanilla"
                      ? !rvPick
                      : !activeReminePack || rail !== "java")
                }
                onClick={() => void launch()}
              />
            </div>
          </footer>
        ) : null}
      </div>
      <Toast
        message={toast}
        tone={toastTone}
        onDone={() => {
          setToast(null);
          setToastTone("default");
        }}
      />
    </div>
  );
}
