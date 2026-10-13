mod config;
mod instance;
mod java_runtime;
mod onboarding;
mod pack_sync;
mod paths;
mod porthole;
mod progress;
mod runtime;

use java_runtime::JavaInfo;
use onboarding::{OnboardingState, RuntimeStatus};
use pack_sync::{PackCatalog, PackRelease, PackStatus};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

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

fn default_theme() -> String {
    "dark-green".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub username: String,
    pub skin_path: Option<String>,
    pub selected_pack: String,
    #[serde(default = "default_ram_mb")]
    pub ram_mb: u32,
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub jvm_args: String,
    #[serde(default = "default_theme")]
    pub theme: String,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            username: "Player".into(),
            skin_path: None,
            selected_pack: String::new(),
            ram_mb: default_ram_mb(),
            java_path: None,
            jvm_args: String::new(),
            theme: default_theme(),
        }
    }
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

fn load_profile(root: &Path) -> Profile {
    fs::read_to_string(paths::profile_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_profile(root: &Path, profile: &Profile) -> Result<(), String> {
    let dir = root.join(".remined");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(profile).map_err(|e| e.to_string())?;
    fs::write(paths::profile_path(root), json).map_err(|e| e.to_string())
}

fn lock_skinshuffle_ui(instance: &Path) -> Result<(), String> {
    let path = instance.join("config").join("skinshuffle").join("config.json");
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
    fs::write(path, serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn clear_skinshuffle(instance: &Path) -> Result<(), String> {
    let presets_path = instance.join("config").join("skinshuffle").join("presets.json");
    if let Some(parent) = presets_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let presets = serde_json::json!({
        "chosenPreset": -1,
        "apiPreset": -1,
        "loadedPresets": []
    });
    fs::write(
        presets_path,
        serde_json::to_string_pretty(&presets).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn apply_skinshuffle(instance: &Path, skin_src: &Path) -> Result<(), String> {
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

    let skins_dir = instance.join("config").join("skinshuffle").join("skins");
    fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;
    fs::write(skins_dir.join(format!("{skin_name}.png")), &bytes).map_err(|e| e.to_string())?;

    let presets_path = instance.join("config").join("skinshuffle").join("presets.json");
    let preset = serde_json::json!({
        "skin": {
            "skin_name": skin_name,
            "model": "default",
            "type": "skinshuffle:config"
        },
        "name": "Remined"
    });
    let presets = serde_json::json!({
        "chosenPreset": 0,
        "apiPreset": -1,
        "loadedPresets": [preset]
    });
    fs::write(
        presets_path,
        serde_json::to_string_pretty(&presets).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
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
fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn list_packs(app: AppHandle) -> Result<Vec<Pack>, String> {
    let root = paths::remined_root(&app)?;
    let mut packs = Vec::new();
    for st in pack_sync::list_installed(&root) {
        if !st.installed {
            continue;
        }
        let meta = instance::read_meta(Path::new(&st.path));
        let id = meta
            .as_ref()
            .map(|m| m.id.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| st.id.clone());
        let name = meta
            .as_ref()
            .map(|m| m.name.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| id.clone());
        packs.push(Pack {
            id,
            name,
            version: st.local_version.unwrap_or_else(|| "local".into()),
            description: String::new(),
        });
    }
    Ok(packs)
}

#[tauri::command]
fn get_profile(app: AppHandle) -> Result<Profile, String> {
    let root = paths::remined_root(&app)?;
    Ok(load_profile(&root))
}

#[tauri::command]
fn save_profile(app: AppHandle, profile: Profile) -> Result<(), String> {
    let root = paths::remined_root(&app)?;
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
fn probe_java(app: AppHandle, path: Option<String>) -> Result<JavaInfo, String> {
    let root = paths::remined_root(&app)?;
    Ok(java_runtime::find_java25(&root, path.as_deref()))
}

#[tauri::command]
fn read_skin_data_url(path: String) -> Result<Option<String>, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    Ok(Some(format!("data:image/png;base64,{}", base64_encode(&bytes))))
}

fn is_http_url(s: &str) -> bool {
    let t = s.trim();
    t.starts_with("https://") || t.starts_with("http://")
}

/// If `skin` is an http(s) URL, download into `.remined/skins/active.png`.
/// Local paths are returned unchanged.
async fn materialize_skin(root: &Path, skin: &str) -> Result<PathBuf, String> {
    let skin = skin.trim();
    if skin.is_empty() {
        return Err("Empty skin path".into());
    }
    if !is_http_url(skin) {
        let p = PathBuf::from(skin);
        if !p.is_file() {
            return Err(format!("Skin file not found: {skin}"));
        }
        return Ok(p);
    }

    let client = reqwest::Client::builder()
        .user_agent("ReminedLauncher/0.2")
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(skin)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    if bytes.len() < 24 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("Downloaded skin is not a PNG".into());
    }
    if bytes.len() > 256 * 1024 {
        return Err("Downloaded skin is too large".into());
    }

    let dir = root.join(".remined").join("skins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join("active.png");
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest)
}

#[tauri::command]
async fn materialize_skin_path(app: AppHandle, skin: String) -> Result<String, String> {
    let root = paths::remined_root(&app)?;
    let path = materialize_skin(&root, &skin).await?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn get_game_phase(session: State<'_, Mutex<GameSession>>) -> GamePhase {
    let mut session = session.lock().expect("game session lock");
    refresh_session(&mut session);
    session.phase
}

#[tauri::command]
fn get_runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
    let root = paths::remined_root(&app)?;
    Ok(onboarding::status(&root))
}

#[tauri::command]
async fn run_onboarding(app: AppHandle) -> Result<OnboardingState, String> {
    let root = paths::remined_root(&app)?;
    onboarding::run_full(&app, &root).await
}

#[tauri::command]
async fn fetch_pack_catalog() -> Result<PackCatalog, String> {
    pack_sync::fetch_catalog().await
}

#[tauri::command]
async fn fetch_pack_release(pack_id: String) -> Result<PackRelease, String> {
    pack_sync::fetch_release(&pack_id).await
}

#[tauri::command]
async fn sync_selected_pack(app: AppHandle, pack_id: String) -> Result<PackStatus, String> {
    let root = paths::remined_root(&app)?;
    pack_sync::sync_pack(&app, &root, &pack_id).await
}

#[tauri::command]
fn get_pack_status(app: AppHandle, pack_id: String) -> Result<PackStatus, String> {
    let root = paths::remined_root(&app)?;
    Ok(pack_sync::pack_status(&root, &pack_id))
}

/// Download/update pack zip, then ensure Fabric libraries + assets.
#[tauri::command]
async fn ensure_pack(app: AppHandle, pack_id: String) -> Result<PackStatus, String> {
    let root = paths::remined_root(&app)?;
    if pack_id.trim().is_empty() {
        return Err("No pack selected".into());
    }
    onboarding::ensure_pack(&app, &root, pack_id.trim()).await
}

#[tauri::command]
fn delete_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    let root = paths::remined_root(&app)?;
    pack_sync::delete_pack(&root, &pack_id)
}

#[tauri::command]
fn porthole_status() -> porthole::PortholeStatus {
    porthole::status()
}

#[tauri::command]
async fn porthole_selftest() -> porthole::PortholeCheckResult {
    tauri::async_runtime::spawn_blocking(porthole::selftest)
        .await
        .unwrap_or_else(|e| porthole::PortholeCheckResult {
            ok: false,
            installed: false,
            steam_ok: false,
            message: format!("Check failed: {e}"),
            detail: String::new(),
        })
}

#[tauri::command]
async fn porthole_start_host(
    app: AppHandle,
    state: State<'_, porthole::PortholeState>,
    port: u16,
) -> Result<porthole::PortholeHostInfo, String> {
    let state = state.inner().clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || porthole::start_host(app2, state, port))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn porthole_start_join(
    app: AppHandle,
    state: State<'_, porthole::PortholeState>,
    share_code: String,
    port: u16,
) -> Result<(), String> {
    let state = state.inner().clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        porthole::start_join(app2, state, &share_code, port)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn porthole_stop_host(state: State<'_, porthole::PortholeState>) {
    porthole::stop_host(&state);
}

#[tauri::command]
fn porthole_stop_join(state: State<'_, porthole::PortholeState>) {
    porthole::stop_join(&state);
}

#[tauri::command]
fn porthole_stop_all(state: State<'_, porthole::PortholeState>) {
    porthole::stop_all(&state);
}

#[tauri::command]
fn porthole_current_host(
    state: State<'_, porthole::PortholeState>,
) -> Option<porthole::PortholeHostInfo> {
    porthole::current_host(&state)
}

#[tauri::command]
fn read_lan_port(app: AppHandle, pack_id: String) -> Result<Option<u16>, String> {
    let root = paths::remined_root(&app)?;
    let log = paths::pack_dir(&root, &pack_id).join("logs").join("latest.log");
    Ok(porthole::read_lan_port(&log))
}

#[tauri::command]
async fn launch_pack(
    app: AppHandle,
    pack_id: String,
    username: String,
    skin_path: Option<String>,
    quick_play: Option<String>,
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

    let fail = |session: &State<'_, Mutex<GameSession>>, msg: String| {
        session.lock().expect("game session lock").phase = GamePhase::Idle;
        Ok(LaunchResult {
            ok: false,
            message: msg,
            phase: GamePhase::Idle,
        })
    };

    let root = match paths::remined_root(&app) {
        Ok(root) => root,
        Err(err) => {
            session.lock().expect("game session lock").phase = GamePhase::Idle;
            return Err(err);
        }
    };

    if pack_id.trim().is_empty() {
        return fail(&session, "No pack selected".into());
    }

    let name = username.trim();
    if name.len() < 3 || name.len() > 16 {
        return fail(&session, "3–16 characters".into());
    }

    let mut profile = load_profile(&root);
    profile.username = name.to_string();
    profile.skin_path = skin_path.clone();
    profile.selected_pack = pack_id.clone();
    if let Err(err) = write_profile(&root, &profile) {
        session.lock().expect("game session lock").phase = GamePhase::Idle;
        return Err(err);
    }

    let instance = paths::pack_dir(&root, &pack_id);
    if !instance::is_pack_installed(&instance) {
        return fail(
            &session,
            format!("Pack `{pack_id}` is not installed — run setup or Update pack"),
        );
    }
    if let Err(err) = lock_skinshuffle_ui(&instance) {
        session.lock().expect("game session lock").phase = GamePhase::Idle;
        return Err(err);
    }
    if let Some(ref skin) = skin_path {
        match materialize_skin(&root, skin).await {
            Ok(local) => {
                if let Err(err) = apply_skinshuffle(&instance, &local) {
                    session.lock().expect("game session lock").phase = GamePhase::Idle;
                    return Err(err);
                }
            }
            Err(err) => {
                session.lock().expect("game session lock").phase = GamePhase::Idle;
                return Err(err);
            }
        }
    } else if let Err(err) = clear_skinshuffle(&instance) {
        // No cloud skin → default Steve (don't keep previous account's SkinShuffle preset)
        session.lock().expect("game session lock").phase = GamePhase::Idle;
        return Err(err);
    }

    let java_info = java_runtime::find_java25(&root, profile.java_path.as_deref());
    if !java_info.ok {
        return fail(&session, "Java 25 required — run setup".into());
    }

    let opts = runtime::LaunchOpts {
        root: root.clone(),
        instance,
        java: PathBuf::from(&java_info.path),
        username: name.to_string(),
        ram_mb: profile.ram_mb.clamp(1024, 32768),
        jvm_args: profile.jvm_args.trim().to_string(),
        quick_play: quick_play
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    };

    let mut child = match runtime::launch_game(&app, opts).await {
        Ok(child) => child,
        Err(err) => return fail(&session, err),
    };

    tokio::time::sleep(std::time::Duration::from_millis(700)).await;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .manage(Mutex::new(GameSession::default()))
        .manage(porthole::PortholeState::default())
        .invoke_handler(tauri::generate_handler![
            list_packs,
            get_profile,
            save_profile,
            probe_java,
            read_skin_data_url,
            materialize_skin_path,
            launch_pack,
            get_game_phase,
            get_app_version,
            get_runtime_status,
            run_onboarding,
            fetch_pack_catalog,
            fetch_pack_release,
            sync_selected_pack,
            get_pack_status,
            ensure_pack,
            delete_pack,
            porthole_status,
            porthole_selftest,
            porthole_start_host,
            porthole_start_join,
            porthole_stop_host,
            porthole_stop_join,
            porthole_stop_all,
            porthole_current_host,
            read_lan_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
