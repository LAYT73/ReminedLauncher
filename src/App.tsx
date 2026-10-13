import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
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
import { SkinModel } from "./components/SkinModel";
import { Toast } from "./components/Toast";
import {
  ensureCloudProfile,
  updateCloudUsername,
} from "./lib/cloudProfile";
import {
  CatalogPack,
  fetchCatalogFromSupabase,
  pickDefaultPack,
} from "./lib/packsCatalog";
import { clearAccountSkin, publishAccountSkin } from "./lib/skinsCloud";
import { supabase } from "./lib/supabase";
import brandLogo from "./assets/logo.png";
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

const RAM_OPTIONS_GB = [2, 4, 6, 8, 12, 16] as const;

const DEFAULT_PROFILE: Profile = {
  username: "Player",
  skin_path: null,
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

const HOME_TABS: Array<[Exclude<TopTab, "home" | "play">, string]> = [
  ["installations", "Installations"],
  ["friends", "Friends"],
  ["network", "Network"],
  ["skins", "Skins"],
  ["settings", "Settings"],
];

const PACK_TABS: Array<[Exclude<TopTab, "home">, string]> = [
  ["play", "Play"],
  ...HOME_TABS,
];

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

type ProgressEvent = {
  phase: string;
  percent: number;
  message: string;
};

type Gate = "loading" | "auth" | "onboarding" | "app";

const PROGRESS_PHASE: Record<string, string> = {
  pack: "Pack",
  fabric: "Fabric",
  assets: "Assets",
  runtime: "Runtime",
  done: "Done",
};

export default function App() {
  const [gate, setGate] = useState<Gate>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [catalog, setCatalog] = useState<CatalogPack[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [skinPreview, setSkinPreview] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"idle" | "ok" | "error">("idle");
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [topTab, setTopTab] = useState<TopTab>("home");
  const [rail, setRail] = useState<"home" | "java" | "settings">("home");
  const [javaInfo, setJavaInfo] = useState<JavaInfo | null>(null);
  const [appVersion, setAppVersion] = useState("0.4.1");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installPercent, setInstallPercent] = useState(0);
  const [installPhase, setInstallPhase] = useState("");
  const [installMessage, setInstallMessage] = useState("");
  const [reminedId, setReminedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [hostingLan, setHostingLan] = useState<HostingLan | null>(null);
  const [joiningFriendId, setJoiningFriendId] = useState<string | null>(null);
  const hostingBusyRef = useRef(false);
  const lastHostPortRef = useRef<number | null>(null);
  const hostFailRef = useRef<{ port: number; at: number } | null>(null);

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
      const [packList, saved, gamePhase, version, remoteCatalog] =
        await Promise.all([
          invoke<Pack[]>("list_packs"),
          invoke<Profile>("get_profile"),
          invoke<GamePhase>("get_game_phase"),
          invoke<string>("get_app_version").catch(() => "0.4.1"),
          fetchCatalogFromSupabase().catch(() => [] as CatalogPack[]),
        ]);
      const next = normalizeProfile(saved);
      setCatalog(remoteCatalog);
      setPacks(packList);

      // Prefer installed packs; fall back to catalog ids for selection UI
      const merged: Pack[] =
        packList.length > 0
          ? packList.map((p) => {
              const meta = remoteCatalog.find((c) => c.id === p.id);
              return {
                ...p,
                name: meta?.name || p.name,
                description: meta?.blurb || p.description,
              };
            })
          : remoteCatalog.map((c) => ({
              id: c.id,
              name: c.name,
              version: "—",
              description: c.blurb,
            }));
      setPacks(merged);

      if (!next.selected_pack) {
        const def = pickDefaultPack(remoteCatalog);
        if (def) next.selected_pack = def.id;
        else if (merged[0]) next.selected_pack = merged[0].id;
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
      setPhase(gamePhase);
      setAppVersion(version);
      void refreshJava(next.java_path);
      // Skin preview comes from syncCloudProfile (per-account Supabase), not local leftovers
    } catch (err) {
      setStatus(String(err));
      setStatusKind("error");
    }
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
      // cache-bust so friends / own avatar refresh after upsert
      const bust = path.includes("?") ? path : `${path}?t=${Date.now()}`;
      setSkinPreview(bust);
      return;
    }
    try {
      const data = await invoke<string | null>("read_skin_data_url", {
        path,
      });
      setSkinPreview(data);
    } catch {
      setSkinPreview(null);
    }
  }

  useEffect(() => {
    if (!installing) return;
    let unlisten: (() => void) | undefined;
    void listen<ProgressEvent>("remined-progress", (ev) => {
      setInstallPhase(ev.payload.phase);
      setInstallPercent((prev) => Math.max(prev, ev.payload.percent));
      setInstallMessage(ev.payload.message);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [installing]);

  async function syncCloudProfile(nextSession: Session) {
    try {
      const cloud = await ensureCloudProfile(nextSession.user.id);
      setReminedId(cloud.remined_id);

      const local = normalizeProfile(await invoke<Profile>("get_profile"));
      // Local profile.json is shared across accounts — always overwrite
      // account-bound fields from Supabase (null skin = default Steve).
      const next: Profile = {
        ...local,
        username: cloud.username || local.username || "Player",
        skin_path: cloud.skin_path ?? null,
      };

      await persist(next);
      await applySkinPreview(cloud.skin_path);
      setUsernameDraft(null);
    } catch (err) {
      console.warn("cloud profile", err);
      setSkinPreview(null);
    }
  }

  const usernameCommitted = profile.username.trim() || "Player";
  const usernameEditing = usernameDraft !== null;
  const usernameDirty =
    usernameEditing && usernameDraft.trim() !== usernameCommitted;

  async function commitUsername() {
    if (!session?.user?.id || !usernameDirty || usernameBusy) return;
    setUsernameBusy(true);
    try {
      const saved = await updateCloudUsername(session.user.id, usernameDraft!);
      await persist({ ...profile, username: saved });
      setUsernameDraft(null);
      setToast("Username updated");
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setUsernameBusy(false);
    }
  }

  function resetUsernameDraft() {
    setUsernameDraft(null);
  }

  async function resolveGate(nextSession: Session | null) {
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
      setGate("auth");
      return;
    }
    // Switching accounts: reset avatar until cloud profile loads
    setSkinPreview(null);
    setUsernameDraft(null);
    try {
      const runtime = await invoke<RuntimeStatus>("get_runtime_status");
      if (!runtime.onboarding.completed) {
        setGate("onboarding");
        return;
      }
      await bootstrapLauncher();
      await syncCloudProfile(nextSession);
      setGate("app");
    } catch {
      setGate("onboarding");
    }
  }

  async function copyReminedId() {
    if (!reminedId) return;
    try {
      await navigator.clipboard.writeText(reminedId);
      setToast("Copied Remined id");
    } catch {
      setToast("Couldn’t copy");
    }
  }

  function profileChip() {
    return (
      <div className="topnav-profile">
        <SkinModel
          skinUrl={skinPreview}
          variant="bust"
          className="avatar-3d"
        />
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
    void (async () => {
      const { data } = await supabase.auth.getSession();
      await resolveGate(data.session);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      void resolveGate(next);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    if (!session?.user?.id || gate !== "app") return;
    const userId = session.user.id;
    const packId = selectedPack?.id ?? profile.selected_pack ?? null;

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
        packId: playing ? packId : null,
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
    selectedPack?.id,
    profile.selected_pack,
    hostingLan,
  ]);

  // Watch Open-to-LAN → Porthole expose → publish share code while game runs.
  useEffect(() => {
    if (gate !== "app" || phase !== "running" || !selectedPack) {
      if (phase === "idle") {
        setHostingLan(null);
        lastHostPortRef.current = null;
        hostingBusyRef.current = false;
        void portholeStopAll().catch(() => undefined);
      }
      return;
    }
    const packId = selectedPack.id;
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
                setToast("Hosting stopped");
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
            setToast("Hosting — friends can Join you now");
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
  }, [gate, phase, selectedPack?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;
    return () => {
      void setPresence({ userId, status: "offline", packId: null });
    };
  }, [session?.user?.id]);

  const packContent = useMemo(() => {
    if (!selectedPack) return undefined;
    return catalog.find((c) => c.id === selectedPack.id);
  }, [catalog, selectedPack]);

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
    if (!session?.user?.id) {
      setToast("Sign in to save a skin");
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
      await applySkinPreview(url);
      setToast("Skin saved");
    } catch (err) {
      setSkinPreview(profile.skin_path && isSkinUrl(profile.skin_path) ? profile.skin_path : null);
      setToast(err instanceof Error ? err.message : String(err));
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

  async function deleteInstalledPack(packId: string) {
    if (
      !window.confirm(
        `Delete installation “${packId}”? Saves in that folder will be removed.`,
      )
    ) {
      return;
    }
    setStatus("Deleting pack…");
    setStatusKind("idle");
    try {
      await invoke("delete_pack", { packId });
      setInstalledIds((prev) => {
        const next = new Set(prev);
        next.delete(packId);
        return next;
      });
      if (profile.selected_pack === packId) {
        const fallback =
          packs.find((p) => p.id !== packId)?.id ??
          catalog.find((c) => c.id !== packId)?.id ??
          "";
        await persist({ ...profile, selected_pack: fallback });
      }
      await bootstrapLauncher();
      setStatus("Pack deleted");
      setStatusKind("ok");
      setToast("Installation removed");
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
            {selectedPack?.name ?? profile.selected_pack ?? "—"}
            {selectedPack?.version ? ` · ${selectedPack.version}` : ""}
          </span>
        </div>
        <p className="pack-sync-note">
          Catalog from Supabase · artifacts from GitHub Releases (`catalog.json`).
        </p>
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
        <button
          type="button"
          className="btn-signout"
          onClick={() => {
            const uid = session?.user?.id;
            void (async () => {
              if (uid) {
                await setPresence({
                  userId: uid,
                  status: "offline",
                  packId: null,
                });
              }
              await supabase.auth.signOut();
            })();
          }}
        >
          Sign out
        </button>
      </div>
    </section>
  );

  async function syncPack() {
    const packId = profile.selected_pack || selectedPack?.id;
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

  const packReady = Boolean(
    selectedPack && installedIds.has(selectedPack.id),
  );

  const playKind = installing
    ? "installing"
    : phase === "launching"
      ? "launching"
      : phase === "running"
        ? "running"
        : packReady
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
  const playBusy = phase !== "idle" || installing;

  async function downloadPack() {
    if (!selectedPack || playBusy) return;
    setInstalling(true);
    setInstallPercent(0);
    setInstallPhase("pack");
    setInstallMessage("Preparing…");
    setStatus("");
    setStatusKind("idle");
    try {
      await invoke("ensure_pack", { packId: selectedPack.id });
      setInstalledIds((prev) => new Set(prev).add(selectedPack.id));
      await bootstrapLauncher();
      setStatus("Ready to play");
      setStatusKind("ok");
    } catch (err) {
      setStatus(String(err));
      setStatusKind("error");
    } finally {
      setInstalling(false);
    }
  }

  async function ensurePackUpToDate(): Promise<boolean> {
    if (!selectedPack) return false;
    setStatus("Checking pack update…");
    setStatusKind("idle");
    try {
      const [remote, local] = await Promise.all([
        invoke<PackRelease>("fetch_pack_release", { packId: selectedPack.id }),
        invoke<PackStatus>("get_pack_status", { packId: selectedPack.id }),
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
        packId: selectedPack.id,
      });
      return again.installed;
    } catch (err) {
      setStatus(String(err));
      setStatusKind("error");
      return false;
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
    const name = profile.username.trim() || "Player";
    if (name.length < 3 || name.length > 16) {
      setStatus("3–16 characters");
      setStatusKind("error");
      return;
    }

    if (!opts?.quickPlay) {
      const ready = await ensurePackUpToDate();
      if (!ready) return;
    } else {
      setStatus("Preparing pack…");
      setStatusKind("idle");
      try {
        await invoke("ensure_pack", { packId });
        setInstalledIds((prev) => new Set(prev).add(packId));
      } catch (err) {
        setStatus(String(err));
        setStatusKind("error");
        return;
      }
    }

    setPhase("launching");
    if (!opts?.quickPlay) {
      setHostingLan(null);
      lastHostPortRef.current = null;
      void portholeStopAll().catch(() => undefined);
    }
    setStatus(opts?.quickPlay ? "Joining friend…" : "");
    setStatusKind("idle");
    try {
      if (session) {
        await syncCloudProfile(session);
      }
      const result = await invoke<LaunchResult>("launch_pack", {
        packId,
        username: name,
        skinPath: profile.skin_path,
        quickPlay: opts?.quickPlay ?? null,
      });
      setPhase(result.phase);
      if (!result.ok) {
        if (opts?.quickPlay) {
          void portholeStopJoin().catch(() => undefined);
        }
        setStatus(result.message);
        setStatusKind("error");
      } else if (opts?.quickPlay) {
        setStatus("Joined — connecting in Minecraft");
        setStatusKind("ok");
        setRail("java");
        setTopTab("play");
      }
    } catch (err) {
      if (opts?.quickPlay) {
        void portholeStopJoin().catch(() => undefined);
      }
      setPhase("idle");
      setStatus(String(err));
      setStatusKind("error");
    }
  }

  async function launch() {
    await launchWithOpts();
  }

  async function joinFriendSession(row: FriendRow) {
    if (!canJoinFriend(row) || joiningFriendId) return;
    const packId = row.sessionPackId!;
    const shareCode = row.sessionShareCode!.trim();
    const port = row.sessionGamePort!;
    setJoiningFriendId(row.friendshipId);
    setToast(`Joining ${row.profile.username}…`);
    setStatus("Connecting Network Play…");
    setStatusKind("idle");
    try {
      const st = await portholeStatus();
      if (!st.installed) {
        setStatus(st.message);
        setStatusKind("error");
        setToast("Install Porthole from Network Play first");
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
      <div className="gate-screen">
        <div className="gate-panel">
          <p className="gate-kicker">Remined</p>
          <h1 className="gate-title">Loading</h1>
        </div>
      </div>
    );
  }

  if (gate === "auth") {
    return <AuthScreen onAuthed={() => setGate("loading")} />;
  }

  if (gate === "onboarding") {
    return (
      <OnboardingScreen
        onDone={() => {
          void bootstrapLauncher().then(() => setGate("app"));
        }}
      />
    );
  }

  const homeLanding = (
    <>
      <header className="hero home">
        <img className="home-brand-logo" src={brandLogo} alt="" />
        <p className="hero-kicker">For our servers</p>
        <h1 className="hero-title">Remined</h1>
      </header>
      <section className="section home-body">
        <p className="home-blurb">
          Small launcher for our Minecraft pack. It keeps Java and the build in
          one place so you don’t fight with a pile of folders every time
          someone updates the pack. Download once, play with friends, done.
        </p>
      </section>
    </>
  );

  const installationsPanel = (
    <section className="section">
      <h2 className="page-title">Installations</h2>
      <ul className="install-list">
        {packs.map((pack) => {
          const active = selectedPack?.id === pack.id;
          const installed = installedIds.has(pack.id);
          return (
            <li key={pack.id} className="install-item">
              <button
                type="button"
                className={`install-row ${active ? "active" : ""}`}
                onClick={() =>
                  void persist({
                    ...profile,
                    selected_pack: pack.id,
                  })
                }
              >
                {catalog.find((c) => c.id === pack.id)?.logo_url ? (
                  <img
                    className="install-icon"
                    src={catalog.find((c) => c.id === pack.id)!.logo_url!}
                    alt=""
                  />
                ) : (
                  <span className="install-icon" aria-hidden />
                )}
                <span className="install-copy">
                  <strong>{pack.name}</strong>
                  <span>{installed ? pack.version : "Not installed"}</span>
                </span>
                {active ? <span className="install-badge">Selected</span> : null}
              </button>
              {installed ? (
                <button
                  type="button"
                  className="btn-mc dim install-delete"
                  onClick={() => void deleteInstalledPack(pack.id)}
                >
                  Delete
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );

  const friendsPanel =
    topTab === "friends" && session?.user?.id ? (
      <FriendsPanel
        userId={session.user.id}
        myReminedId={reminedId}
        onToast={setToast}
        joiningFriendId={joiningFriendId}
        hostingSelf={Boolean(hostingLan)}
        onOpenNetworkPlay={() => setTopTab("network")}
        onInstallPorthole={() => {
          void openPortholeOnSteam().then(() =>
            setToast("Opening Steam — install Porthole, then Refresh"),
          );
        }}
        onJoinFriend={(row) => void joinFriendSession(row)}
      />
    ) : null;

  const networkPanel =
    topTab === "network" ? (
      <NetworkPlayPanel
        hostingSelf={Boolean(hostingLan)}
        hostingPort={hostingLan?.gamePort ?? null}
        onToast={setToast}
      />
    ) : null;

  const skinsPanel = (
    <section className="section">
      <h2 className="page-title">Skins</h2>
      <p className="friends-lead">
        PNG only — 64×64, 64×32 or 128×128, max 256 KB.
      </p>
      <div className="skin-layout">
        <SkinModel
          skinUrl={skinPreview}
          variant="full"
          className="skin-stage"
        />
        <div className="skin-controls">
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
    </section>
  );

  const sharedTabBody =
    topTab === "installations"
      ? installationsPanel
      : topTab === "friends"
        ? friendsPanel
        : topTab === "network"
          ? networkPanel
          : topTab === "skins"
            ? skinsPanel
            : topTab === "settings"
              ? settingsForm
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
          className={`rail-game ${rail === "java" ? "active" : ""}`}
          title={selectedPack?.name ?? "Pack"}
          onClick={() => {
            setRail("java");
            setTopTab("play");
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
          className={`rail-settings ${rail === "settings" ? "active" : ""}`}
          title="Settings"
          onClick={() => setRail("settings")}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.86 14.5a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54c.05.22.25.41.48.41h3.84c.23 0 .43-.19.48-.41l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" />
          </svg>
        </button>
      </aside>

      <div className="stage">
        {rail === "settings" ? (
          <>
            <nav className="topnav">
              <div className="topnav-tabs" />
              {profileChip()}
            </nav>
            <div className="content">{settingsForm}</div>
          </>
        ) : (
          <>
            <nav className="topnav">
              <div className="topnav-tabs">
                {(rail === "java" ? PACK_TABS : HOME_TABS).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`topnav-tab ${topTab === id ? "active" : ""}`}
                    onClick={() => setTopTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {profileChip()}
            </nav>

            <div className="content">
              {rail === "home" && (topTab === "home" || topTab === "play")
                ? homeLanding
                : null}

              {rail === "java" && topTab === "play" ? (
                <>
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

                  {selectedPack ? (
                    <section className="pack-about">
                      <div className="pack-about-head">
                        <div
                          className={`pack-logo ${packContent?.logo_url ? "has-art" : "is-placeholder"}`}
                          aria-hidden={!packContent?.logo_url}
                        >
                          {packContent?.logo_url ? (
                            <img src={packContent.logo_url} alt="" />
                          ) : (
                            <span className="pack-logo-fallback">
                              {selectedPack.name.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="pack-about-titles">
                          <h2 className="pack-about-title">
                            {selectedPack.name}
                          </h2>
                          {packContent?.tagline ? (
                            <p className="pack-about-tagline">
                              {packContent.tagline}
                            </p>
                          ) : null}
                          <p className="pack-about-version">
                            {selectedPack.version}
                          </p>
                        </div>
                      </div>

                      {packContent?.blurb ? (
                        <p className="pack-about-blurb">{packContent.blurb}</p>
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
                          <h3 className="pack-gallery-heading">Screenshots</h3>
                          <PackGallery
                            images={packContent.gallery}
                            altPrefix={selectedPack.name}
                          />
                        </>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : null}

              {sharedTabBody}
            </div>
          </>
        )}

        <footer className={`playbar ${installing ? "is-installing" : ""}`}>
          <PackSelect
            packs={packs}
            value={selectedPack?.id ?? ""}
            onChange={(id) => void persist({ ...profile, selected_pack: id })}
            disabled={installing}
          />

          {installing ? (
            <div className="playbar-progress">
              <PixelProgress
                value={installPercent}
                phase={PROGRESS_PHASE[installPhase] ?? installPhase}
                label={installMessage}
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

          <PlayButton
            kind={playKind}
            label={playLabel}
            disabled={playBusy || !selectedPack || rail !== "java"}
            onClick={() => void launch()}
          />
        </footer>
      </div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
