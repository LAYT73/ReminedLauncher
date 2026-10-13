use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pack {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
}

fn default_ram_mb() -> u32 {
    4096
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub username: String,
    pub skin_path: Option<String>,
    pub selected_pack: String,
    #[serde(default = "default_ram_mb")]
    pub ram_mb: u32,
    /// Absolute path to `java` binary, or empty/None for auto-detect.
    #[serde(default)]
    pub java_path: Option<String>,
    /// Extra JVM flags, space-separated (e.g. `-XX:+UseG1GC -Dfoo=bar`).
    #[serde(default)]
    pub jvm_args: String,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            username: "Player".into(),
            skin_path: None,
            selected_pack: "vanillapro".into(),
            ram_mb: default_ram_mb(),
            java_path: None,
            jvm_args: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInfo {
    pub path: String,
    pub version: String,
    pub major: Option<u32>,
    pub ok: bool,
}

#[derive(Debug, Serialize)]
pub struct LaunchResult {
    pub ok: bool,
    pub message: String,
    pub phase: GamePhase,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GamePhase {
    Idle,
    Launching,
    Running,
}

struct GameSession {
    phase: GamePhase,
    child: Option<Child>,
}

impl Default for GameSession {
    fn default() -> Self {
        Self {
            phase: GamePhase::Idle,
            child: None,
        }
    }
}

fn refresh_session(session: &mut GameSession) {
    let finished = match session.child.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(Some(_)) => true,
            Ok(None) => {
                session.phase = GamePhase::Running;
                false
            }
            Err(_) => true,
        },
        None => {
            if session.phase != GamePhase::Launching {
                session.phase = GamePhase::Idle;
            }
            false
        }
    };
    if finished {
        session.child = None;
        session.phase = GamePhase::Idle;
    }
}

fn project_root() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    // Dev: app/src-tauri → cwd may be app/src-tauri or app
    let candidates = [
        cwd.clone(),
        cwd.join(".."),
        cwd.join("../.."),
        cwd.join("../../.."),
    ];
    for c in candidates {
        let ok = c.join("VanillaPro").join("VanillaPro.json").is_file()
            && c.join("scripts").join("launch_vanillapro.py").is_file();
        if ok {
            return c.canonicalize().map_err(|e| e.to_string());
        }
    }
    Err("Project root not found".into())
}

fn profile_path(root: &Path) -> PathBuf {
    root.join(".remined").join("profile.json")
}

fn load_profile(root: &Path) -> Profile {
    let path = profile_path(root);
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_profile(root: &Path, profile: &Profile) -> Result<(), String> {
    let dir = root.join(".remined");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = profile_path(root);
    let json = serde_json::to_string_pretty(profile).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Title screen keeps skin preview (patched jar hides only the Skin Presets button).
/// Pause menu button stays off — skins only via Remined.
fn lock_skinshuffle_ui(root: &Path) -> Result<(), String> {
    let path = root
        .join("VanillaPro")
        .join("config")
        .join("skinshuffle")
        .join("config.json");
    let mut cfg = if path.is_file() {
        serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    cfg["displayInTitleScreen"] = serde_json::json!(true);
    cfg["displayInPauseMenu"] = serde_json::json!(false);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(path, out).map_err(|e| e.to_string())
}

fn apply_skinshuffle(root: &Path, skin_src: &Path) -> Result<(), String> {
    if !skin_src.is_file() {
        return Err(format!("Skin file not found: {}", skin_src.display()));
    }
    let bytes = fs::read(skin_src).map_err(|e| e.to_string())?;
    if bytes.len() < 100 {
        return Err("Invalid skin PNG".into());
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let skin_name = format!("remined{stamp}");

    let skins_dir = root
        .join("VanillaPro")
        .join("config")
        .join("skinshuffle")
        .join("skins");
    fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;
    let dest = skins_dir.join(format!("{skin_name}.png"));
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;

    let presets_path = root
        .join("VanillaPro")
        .join("config")
        .join("skinshuffle")
        .join("presets.json");

    let mut presets = if presets_path.is_file() {
        serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&presets_path).map_err(|e| e.to_string())?)
            .unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let preset = serde_json::json!({
        "skin": {
            "skin_name": skin_name,
            "model": "default",
            "type": "skinshuffle:config"
        },
        "name": "Remined"
    });

    presets["chosenPreset"] = serde_json::json!(0);
    presets["apiPreset"] = serde_json::json!(-1);
    presets["loadedPresets"] = serde_json::json!([preset]);

    let out = serde_json::to_string_pretty(&presets).map_err(|e| e.to_string())?;
    fs::write(presets_path, out).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_packs() -> Result<Vec<Pack>, String> {
    let root = project_root()?;
    let mut packs = Vec::new();
    if root.join("VanillaPro").join("VanillaPro.json").is_file() {
        packs.push(Pack {
            id: "vanillapro".into(),
            name: "VanillaPro".into(),
            version: "Fabric 26.2".into(),
            description: "Vanilla+ Fabric pack with cinematic shaders, QoL HUD, and Remined skin sync for LAN."
                .into(),
        });
    }
    Ok(packs)
}

#[tauri::command]
fn get_profile() -> Result<Profile, String> {
    let root = project_root()?;
    Ok(load_profile(&root))
}

#[tauri::command]
fn save_profile(profile: Profile) -> Result<(), String> {
    let root = project_root()?;
    let mut next = profile;
    next.ram_mb = next.ram_mb.clamp(1024, 32768);
    if let Some(ref path) = next.java_path {
        let trimmed = path.trim();
        next.java_path = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    next.jvm_args = next.jvm_args.trim().to_string();
    write_profile(&root, &next)
}

#[tauri::command]
fn probe_java(path: Option<String>) -> Result<JavaInfo, String> {
    let candidates: Vec<PathBuf> = if let Some(p) = path
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        let pb = PathBuf::from(&p);
        if pb.is_dir() {
            vec![pb.join("bin").join("java")]
        } else {
            vec![pb]
        }
    } else {
        vec![
            PathBuf::from("/opt/homebrew/opt/openjdk@25/bin/java"),
            PathBuf::from("/opt/homebrew/opt/openjdk/bin/java"),
            PathBuf::from("/usr/bin/java"),
        ]
    };

    for java in candidates {
        if !java.is_file() {
            continue;
        }
        let output = Command::new(&java)
            .arg("-version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| e.to_string())?;
        let text = {
            let err = String::from_utf8_lossy(&output.stderr);
            let out = String::from_utf8_lossy(&output.stdout);
            let combined = format!("{err}{out}");
            combined.trim().to_string()
        };
        let first = text.lines().next().unwrap_or("unknown").to_string();
        let major = text.lines().find_map(|line| {
            let marker = "version \"";
            let idx = line.find(marker)?;
            let rest = &line[idx + marker.len()..];
            let ver = rest.split('"').next()?;
            let maj = ver.split('.').next()?;
            maj.parse::<u32>().ok()
        });
        return Ok(JavaInfo {
            path: java.display().to_string(),
            version: first,
            major,
            ok: major == Some(25),
        });
    }

    Ok(JavaInfo {
        path: String::new(),
        version: "Java not found".into(),
        major: None,
        ok: false,
    })
}

#[tauri::command]
fn read_skin_data_url(path: String) -> Result<Option<String>, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    let b64 = base64_encode(&bytes);
    Ok(Some(format!("data:image/png;base64,{b64}")))
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i] as u32;
        let b1 = if i + 1 < data.len() {
            data[i + 1] as u32
        } else {
            0
        };
        let b2 = if i + 2 < data.len() {
            data[i + 2] as u32
        } else {
            0
        };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if i + 1 < data.len() {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < data.len() {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

#[tauri::command]
fn get_game_phase(session: State<'_, Mutex<GameSession>>) -> GamePhase {
    let mut session = session.lock().expect("game session lock");
    refresh_session(&mut session);
    session.phase
}

#[tauri::command]
fn launch_pack(
    pack_id: String,
    username: String,
    skin_path: Option<String>,
    session: State<'_, Mutex<GameSession>>,
) -> Result<LaunchResult, String> {
    {
        let mut session = session.lock().expect("game session lock");
        refresh_session(&mut session);
        if session.phase != GamePhase::Idle {
            return Ok(LaunchResult {
                ok: false,
                message: "Already running".into(),
                phase: session.phase,
            });
        }
        session.phase = GamePhase::Launching;
    }

    let root = match project_root() {
        Ok(root) => root,
        Err(err) => {
            session.lock().expect("game session lock").phase = GamePhase::Idle;
            return Err(err);
        }
    };

    if pack_id != "vanillapro" {
        session.lock().expect("game session lock").phase = GamePhase::Idle;
        return Ok(LaunchResult {
            ok: false,
            message: format!("Unknown pack: {pack_id}"),
            phase: GamePhase::Idle,
        });
    }

    let name = username.trim();
    if name.len() < 3 || name.len() > 16 {
        session.lock().expect("game session lock").phase = GamePhase::Idle;
        return Ok(LaunchResult {
            ok: false,
            message: "3–16 characters".into(),
            phase: GamePhase::Idle,
        });
    }

    let mut profile = load_profile(&root);
    profile.username = name.to_string();
    profile.skin_path = skin_path.clone();
    profile.selected_pack = pack_id;
    if let Err(err) = write_profile(&root, &profile) {
        session.lock().expect("game session lock").phase = GamePhase::Idle;
        return Err(err);
    }

    if let Err(err) = lock_skinshuffle_ui(&root) {
        session.lock().expect("game session lock").phase = GamePhase::Idle;
        return Err(err);
    }

    if let Some(ref skin) = skin_path {
        if let Err(err) = apply_skinshuffle(&root, Path::new(skin)) {
            session.lock().expect("game session lock").phase = GamePhase::Idle;
            return Err(err);
        }
    }

    let script = root.join("scripts").join("launch_vanillapro.py");
    let ram_mb = profile.ram_mb.clamp(1024, 32768);
    let mut cmd = Command::new("python3");
    cmd.arg(&script)
        .arg(name)
        .current_dir(&root)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .env("REMINED_RAM", ram_mb.to_string())
        .env("REMINED_JVM_ARGS", profile.jvm_args.trim());

    // Resolve Java: explicit binary path, or Homebrew OpenJDK 25 default
    let java_bin = profile
        .java_path
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    if let Some(java) = java_bin {
        let home = java
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("/opt/homebrew/opt/openjdk@25"));
        cmd.env("REMINED_JAVA", &java)
            .env("JAVA_HOME", &home)
            .env(
                "PATH",
                format!(
                    "{}:{}",
                    java.parent().unwrap_or(Path::new(".")).display(),
                    std::env::var("PATH").unwrap_or_default()
                ),
            );
    } else {
        let java_home = PathBuf::from("/opt/homebrew/opt/openjdk@25");
        cmd.env("JAVA_HOME", &java_home).env(
            "PATH",
            format!(
                "{}:{}",
                java_home.join("bin").display(),
                std::env::var("PATH").unwrap_or_default()
            ),
        );
    }

    match cmd.spawn() {
        Ok(mut child) => {
            std::thread::sleep(std::time::Duration::from_millis(600));
            let mut session = session.lock().expect("game session lock");
            match child.try_wait() {
                Ok(Some(status)) if !status.success() => {
                    let mut err = String::new();
                    if let Some(mut stderr) = child.stderr.take() {
                        let _ = stderr.read_to_string(&mut err);
                    }
                    session.child = None;
                    session.phase = GamePhase::Idle;
                    Ok(LaunchResult {
                        ok: false,
                        message: if err.is_empty() {
                            format!("Exit {status}")
                        } else {
                            err.chars().take(200).collect()
                        },
                        phase: GamePhase::Idle,
                    })
                }
                Ok(Some(_)) => {
                    session.child = None;
                    session.phase = GamePhase::Idle;
                    Ok(LaunchResult {
                        ok: false,
                        message: "Exited immediately".into(),
                        phase: GamePhase::Idle,
                    })
                }
                Ok(None) => {
                    session.child = Some(child);
                    session.phase = GamePhase::Running;
                    Ok(LaunchResult {
                        ok: true,
                        message: String::new(),
                        phase: GamePhase::Running,
                    })
                }
                Err(e) => {
                    session.child = None;
                    session.phase = GamePhase::Idle;
                    Ok(LaunchResult {
                        ok: false,
                        message: e.to_string(),
                        phase: GamePhase::Idle,
                    })
                }
            }
        }
        Err(e) => {
            session.lock().expect("game session lock").phase = GamePhase::Idle;
            Ok(LaunchResult {
                ok: false,
                message: e.to_string(),
                phase: GamePhase::Idle,
            })
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(GameSession::default()))
        .invoke_handler(tauri::generate_handler![
            list_packs,
            get_profile,
            save_profile,
            probe_java,
            read_skin_data_url,
            launch_pack,
            get_game_phase
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
