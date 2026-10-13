import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { PackGallery } from "./components/PackGallery";
import { PackSelect } from "./components/PackSelect";
import { SkinModel } from "./components/SkinModel";
import { PACK_CONTENT } from "./packs";

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
  selected_pack: "vanillapro",
  ram_mb: 4096,
  java_path: null,
  jvm_args: "",
};

function normalizeProfile(raw: Partial<Profile> | null | undefined): Profile {
  return {
    ...DEFAULT_PROFILE,
    ...raw,
    ram_mb: Math.max(1024, Number(raw?.ram_mb) || DEFAULT_PROFILE.ram_mb),
    java_path: raw?.java_path ?? null,
    jvm_args: raw?.jvm_args ?? "",
  };
}

type LaunchResult = {
  ok: boolean;
  message: string;
  phase: GamePhase;
};

type GamePhase = "idle" | "launching" | "running";

type TopTab = "play" | "installations" | "skins" | "settings";

export default function App() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [skinPreview, setSkinPreview] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"idle" | "ok" | "error">("idle");
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [topTab, setTopTab] = useState<TopTab>("play");
  const [rail, setRail] = useState<"home" | "java" | "settings">("java");
  const [javaInfo, setJavaInfo] = useState<JavaInfo | null>(null);

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

  useEffect(() => {
    void (async () => {
      try {
        const [packList, saved, gamePhase] = await Promise.all([
          invoke<Pack[]>("list_packs"),
          invoke<Profile>("get_profile"),
          invoke<GamePhase>("get_game_phase"),
        ]);
        const next = normalizeProfile(saved);
        setPacks(packList);
        setProfile(next);
        setPhase(gamePhase);
        void refreshJava(next.java_path);
        if (next.skin_path) {
          const data = await invoke<string | null>("read_skin_data_url", {
            path: next.skin_path,
          });
          setSkinPreview(data);
        }
      } catch (err) {
        setStatus(String(err));
        setStatusKind("error");
      }
    })();
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

  const packContent = selectedPack
    ? PACK_CONTENT[selectedPack.id]
    : undefined;

  async function persist(next: Profile) {
    setProfile(next);
    await invoke("save_profile", { profile: next });
  }

  async function pickSkin() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    const next = { ...profile, skin_path: selected };
    await persist(next);
    const data = await invoke<string | null>("read_skin_data_url", {
      path: selected,
    });
    setSkinPreview(data);
  }

  async function clearSkin() {
    const next = { ...profile, skin_path: null };
    await persist(next);
    setSkinPreview(null);
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

      <div className="settings-row">
        <span>Launcher</span>
        <span className="settings-value">0.1.0</span>
      </div>
    </section>
  );

  const playLabel =
    phase === "launching"
      ? "Launching"
      : phase === "running"
        ? "Running"
        : "Play";
  const playBusy = phase !== "idle";

  async function launch() {
    if (!selectedPack || playBusy) return;
    const name = profile.username.trim() || "Player";
    if (name.length < 3 || name.length > 16) {
      setStatus("3–16 characters");
      setStatusKind("error");
      return;
    }
    setPhase("launching");
    setStatus("");
    setStatusKind("idle");
    try {
      const result = await invoke<LaunchResult>("launch_pack", {
        packId: selectedPack.id,
        username: name,
        skinPath: profile.skin_path,
      });
      setPhase(result.phase);
      if (!result.ok) {
        setStatus(result.message);
        setStatusKind("error");
      }
    } catch (err) {
      setPhase("idle");
      setStatus(String(err));
      setStatusKind("error");
    }
  }

  return (
    <div className="shell">
      <aside className="rail">
        <button
          type="button"
          className={`rail-home ${rail === "home" ? "active" : ""}`}
          title="Home"
          onClick={() => setRail("home")}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
          </svg>
        </button>

        <button
          type="button"
          className={`rail-game ${rail === "java" ? "active" : ""}`}
          title="VanillaPro"
          onClick={() => {
            setRail("java");
            setTopTab("play");
          }}
        >
          {PACK_CONTENT.vanillapro?.logo ? (
            <img
              className="rail-pack-logo"
              src={PACK_CONTENT.vanillapro.logo}
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
        {rail === "java" ? (
          <>
            <nav className="topnav">
              <div className="topnav-tabs">
                {(
                  [
                    ["play", "Play"],
                    ["installations", "Installations"],
                    ["skins", "Skins"],
                    ["settings", "Settings"],
                  ] as const
                ).map(([id, label]) => (
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
              <div className="topnav-profile">
                <SkinModel
                  skinUrl={skinPreview}
                  variant="bust"
                  className="avatar-3d"
                />
                <strong className="topnav-nick">
                  {profile.username.trim() || "Player"}
                </strong>
              </div>
            </nav>

            <div className="content">
              {topTab === "play" && (
                <>
                  <header className="hero">
                    <p className="hero-kicker">Java Edition</p>
                    <h1 className="hero-title">Remined</h1>
                  </header>

                  {selectedPack && packContent ? (
                    <section className="pack-about">
                      <div className="pack-about-head">
                        <div
                          className={`pack-logo ${packContent.logo ? "has-art" : "is-placeholder"}`}
                          aria-hidden={!packContent.logo}
                        >
                          {packContent.logo ? (
                            <img src={packContent.logo} alt="" />
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
                          <p className="pack-about-tagline">
                            {packContent.tagline}
                          </p>
                          <p className="pack-about-version">
                            {selectedPack.version}
                          </p>
                        </div>
                      </div>

                      <p className="pack-about-blurb">{packContent.blurb}</p>

                      <ul className="pack-highlights">
                        {packContent.highlights.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>

                      <h3 className="pack-gallery-heading">Screenshots</h3>
                      <PackGallery
                        images={packContent.gallery}
                        altPrefix={selectedPack.name}
                      />
                    </section>
                  ) : null}
                </>
              )}

              {topTab === "installations" && (
                <section className="section">
                  <h2 className="page-title">Installations</h2>
                  <ul className="install-list">
                    {packs.map((pack) => {
                      const active = selectedPack?.id === pack.id;
                      return (
                        <li key={pack.id}>
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
                            {PACK_CONTENT[pack.id]?.logo ? (
                              <img
                                className="install-icon"
                                src={PACK_CONTENT[pack.id].logo}
                                alt=""
                              />
                            ) : (
                              <span className="install-icon" aria-hidden />
                            )}
                            <span className="install-copy">
                              <strong>{pack.name}</strong>
                              <span>{pack.version}</span>
                            </span>
                            {active ? (
                              <span className="install-badge">Selected</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {topTab === "skins" && (
                <section className="section">
                  <h2 className="page-title">Skins</h2>
                  <div className="skin-layout">
                    <SkinModel
                      skinUrl={skinPreview}
                      variant="full"
                      className="skin-stage"
                    />
                    <div className="skin-controls">
                      <div className="field">
                        <label htmlFor="username">Username</label>
                        <input
                          id="username"
                          maxLength={16}
                          value={profile.username}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              username: e.target.value,
                            })
                          }
                          onBlur={() => void persist(profile)}
                        />
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
              )}

              {topTab === "settings" && settingsForm}
            </div>
          </>
        ) : rail === "home" ? (
          <>
            <nav className="topnav">
              <div className="topnav-tabs" />
              <div className="topnav-profile">
                <SkinModel
                  skinUrl={skinPreview}
                  variant="bust"
                  className="avatar-3d"
                />
                <strong className="topnav-nick">
                  {profile.username.trim() || "Player"}
                </strong>
              </div>
            </nav>
            <div className="content">
              <header className="hero home">
                <h1 className="hero-title">Remined</h1>
              </header>
            </div>
          </>
        ) : (
          <>
            <nav className="topnav">
              <div className="topnav-tabs" />
              <div className="topnav-profile">
                <SkinModel
                  skinUrl={skinPreview}
                  variant="bust"
                  className="avatar-3d"
                />
                <strong className="topnav-nick">
                  {profile.username.trim() || "Player"}
                </strong>
              </div>
            </nav>
            <div className="content">{settingsForm}</div>
          </>
        )}

        <footer className="playbar">
          <PackSelect
            packs={packs}
            value={selectedPack?.id ?? ""}
            onChange={(id) => void persist({ ...profile, selected_pack: id })}
          />

          <div
            className={`status ${statusKind === "error" ? "error" : ""}`}
            aria-live="polite"
          >
            {status}
          </div>

          <button
            type="button"
            className={`play-btn ${phase !== "idle" ? `is-${phase}` : ""}`}
            disabled={playBusy || !selectedPack || rail !== "java"}
            onClick={() => void launch()}
          >
            {playLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
