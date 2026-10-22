mod asset_cache;
pub mod cli;
mod config;
mod diag;
mod i18n;
mod gamewatch;
pub mod mod_audit;
mod instance;
mod java_runtime;
mod onboarding;
mod pack_sync;
mod paths;
mod process_ext;
mod progress;
mod remined_vanilla;
mod runtime;
mod skinshuffle_patch;
mod smoke;
mod vanilla;
mod vanilla_skin_pack;
mod net_log;
mod tray;
mod relay;
mod voice_log;
mod voice_runtime;

use java_runtime::JavaInfo;
use onboarding::{OnboardingState, RuntimeStatus};
use pack_sync::{PackCatalog, PackRelease, PackStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use runtime::LaunchedGame;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
#[cfg(target_os = "macos")]
use tauri::RunEvent;

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
    "dark-pink".into()
}

fn default_friend_toasts() -> bool {
    true
}

fn default_network_mode() -> String {
    "relay".into()
}

fn default_lan_port() -> u16 {
    relay::DEFAULT_LAN_TCP_PORT
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeCustom {
    pub mode: String,
    pub accent: String,
    pub surface: String,
}

fn default_skin_model() -> String {
    "default".into()
}

fn normalize_skin_model(raw: &str) -> &'static str {
    if raw.trim().eq_ignore_ascii_case("slim") {
        "slim"
    } else {
        "default"
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub username: String,
    pub skin_path: Option<String>,
    /// Custom cape PNG URL / path (optional).
    #[serde(default)]
    pub cape_path: Option<String>,
    /// `"default"` (classic/wide) or `"slim"`.
    #[serde(default = "default_skin_model")]
    pub skin_model: String,
    pub selected_pack: String,
    #[serde(default = "default_ram_mb")]
    pub ram_mb: u32,
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub jvm_args: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_friend_toasts")]
    pub friend_toasts: bool,
    /// `"relay"` — voice and LAN on Remined Relay.
    #[serde(default = "default_network_mode")]
    pub network_mode: String,
    /// Open-to-LAN / mcwifipnp port (Relay-only pre-reserve).
    #[serde(default = "default_lan_port")]
    pub lan_port: u16,
    #[serde(default)]
    pub theme_custom: Option<ThemeCustom>,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            username: "Player".into(),
            skin_path: None,
            cape_path: None,
            skin_model: default_skin_model(),
            selected_pack: String::new(),
            ram_mb: default_ram_mb(),
            java_path: None,
            jvm_args: String::new(),
            theme: default_theme(),
            friend_toasts: true,
            network_mode: default_network_mode(),
            lan_port: default_lan_port(),
            theme_custom: None,
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
    child: Option<LaunchedGame>,
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
    // Commands run on the thread pool: serialize writers and swap atomically so
    // a concurrent load_profile never sees a half-written file.
    static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = paths::profile_path(root);
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
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
    // Remined is offline — hide SkinShuffle's "not authenticated" toast (newer mod versions).
    cfg["disableOfflineToast"] = serde_json::json!(true);
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

/// Bundled Remined default skin (same PNG as the launcher UI Steve).
fn default_steve_png() -> &'static [u8] {
    include_bytes!("../assets/steve.png")
}

fn apply_default_steve_skin(instance: &Path, skin_model: &str) -> Result<(), String> {
    let dir = instance
        .join("config")
        .join("skinshuffle")
        .join("skins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join("remined_default.png");
    fs::write(&dest, default_steve_png()).map_err(|e| e.to_string())?;
    apply_skinshuffle(instance, &dest, skin_model)
}

/// Point CustomSkinLoader at Remined Supabase CustomSkinAPI (friends see each other's skins).
fn apply_customskinloader_config(instance: &Path) -> Result<(), String> {
    let root = crate::config::remined_config().skins_csl_root.trim();
    if root.is_empty() {
        return Ok(());
    }
    let root = if root.ends_with('/') {
        root.to_string()
    } else {
        format!("{root}/")
    };

    let dir = instance.join("CustomSkinLoader");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("CustomSkinLoader.json");

    let cfg = serde_json::json!({
        "version": "14.20",
        "buildNumber": 0,
        "enable": true,
        "enableSkull": true,
        "enableDynamicSkull": true,
        "enableTransparentSkin": true,
        "ignoreHttpsCertificate": false,
        // Seconds — keep short so Storage/profile changes show up next join.
        "cacheExpiry": 5,
        "enableUpdateSkull": false,
        "enableLocalProfileCache": false,
        "enableCacheAutoClean": true,
        // When Remined returns skin-only, still pull cape from LocalSkin / later sources.
        "forceLoadAllTextures": true,
        "enableCape": true,
        "threadPoolSize": 8,
        "loadlist": [
            {
                "name": "Remined",
                "type": "CustomSkinAPI",
                "root": root
            },
            {
                "name": "LocalSkin",
                "type": "Legacy",
                "skin": "LocalSkin/skins/{USERNAME}.png",
                "model": "auto",
                "cape": "LocalSkin/capes/{USERNAME}.png",
                "elytra": "LocalSkin/elytras/{USERNAME}.png"
            },
            {
                "name": "Mojang",
                "type": "MojangAPI"
            }
        ]
    });
    fs::write(
        path,
        serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Drop stale profile JSON caches (e.g. skin-only responses before cape existed).
    let caches = dir.join("caches");
    if caches.is_dir() {
        let _ = fs::remove_dir_all(&caches);
    }
    Ok(())
}

fn apply_skinshuffle(instance: &Path, skin_src: &Path, skin_model: &str) -> Result<(), String> {
    if !skin_src.is_file() {
        return Err(i18n::trf("skin.not_found", &[("path", &skin_src.display().to_string())]));
    }
    let bytes = fs::read(skin_src).map_err(|e| e.to_string())?;
    if bytes.len() < 100 {
        return Err(i18n::tr("skin.invalid_png").into());
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let skin_name = format!("remined{stamp}");
    let model = normalize_skin_model(skin_model);

    let skins_dir = instance.join("config").join("skinshuffle").join("skins");
    fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;
    // Drop stale Remined PNGs so SkinShuffle cannot keep serving an old stamp.
    if skins_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&skins_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with("remined") && name.ends_with(".png") {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
    fs::write(skins_dir.join(format!("{skin_name}.png")), &bytes).map_err(|e| e.to_string())?;

    let presets_path = instance.join("config").join("skinshuffle").join("presets.json");
    let preset = serde_json::json!({
        "skin": {
            "skin_name": skin_name,
            "model": model,
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

/// Write skin for CustomSkinLoader LocalSkin (self-view when Remined API 404s / offline).
fn apply_csl_local_skin(instance: &Path, username: &str, skin_src: &Path) -> Result<(), String> {
    if !skin_src.is_file() {
        return Err(i18n::trf("skin.not_found", &[("path", &skin_src.display().to_string())]));
    }
    let bytes = fs::read(skin_src).map_err(|e| e.to_string())?;
    if bytes.len() < 100 {
        return Err(i18n::tr("skin.invalid_png").into());
    }
    let dir = instance
        .join("CustomSkinLoader")
        .join("LocalSkin")
        .join("skins");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{username}.png"));
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

fn clear_csl_local_skin(instance: &Path, username: &str) {
    let dest = instance
        .join("CustomSkinLoader")
        .join("LocalSkin")
        .join("skins")
        .join(format!("{username}.png"));
    let _ = fs::remove_file(dest);
}

/// Write cape for CustomSkinLoader LocalSkin fallback (self-view / offline).
fn apply_csl_local_cape(instance: &Path, username: &str, cape_src: &Path) -> Result<(), String> {
    if !cape_src.is_file() {
        return Err(i18n::trf("cape.not_found", &[("path", &cape_src.display().to_string())]));
    }
    let bytes = fs::read(cape_src).map_err(|e| e.to_string())?;
    if bytes.len() < 50 {
        return Err(i18n::tr("cape.invalid_png").into());
    }
    let dir = instance
        .join("CustomSkinLoader")
        .join("LocalSkin")
        .join("capes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{username}.png"));
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

fn clear_csl_local_cape(instance: &Path, username: &str) {
    let dest = instance
        .join("CustomSkinLoader")
        .join("LocalSkin")
        .join("capes")
        .join(format!("{username}.png"));
    let _ = fs::remove_file(dest);
}

pub(crate) fn base64_encode(data: &[u8]) -> String {
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
async fn list_packs(app: AppHandle) -> Result<Vec<Pack>, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_profile(app: AppHandle) -> Result<Profile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = paths::remined_root(&app)?;
        Ok(load_profile(&root))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_profile(app: AppHandle, profile: Profile) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn probe_java(app: AppHandle, path: Option<String>) -> Result<JavaInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = paths::remined_root(&app)?;
        Ok(java_runtime::find_java25(&root, path.as_deref()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_skin_data_url(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if !p.is_file() {
            return Ok(None);
        }
        let bytes = fs::read(p).map_err(|e| e.to_string())?;
        Ok(Some(format!("data:image/png;base64,{}", base64_encode(&bytes))))
    })
    .await
    .map_err(|e| e.to_string())?
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
        return Err(i18n::tr("skin.empty_path").into());
    }
    if !is_http_url(skin) {
        let p = PathBuf::from(skin);
        if !p.is_file() {
            return Err(i18n::trf("skin.not_found", &[("path", &skin)]));
        }
        return Ok(p);
    }

    let client = reqwest::Client::builder()
        .user_agent("ReminedLauncher/0.2")
        .build()
        .map_err(|e| e.to_string())?;
    // Skins are upserted at a stable URL — skip intermediary caches.
    let bytes = client
        .get(skin)
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    if bytes.len() < 24 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(i18n::tr("skin.dl_not_png").into());
    }
    if bytes.len() > 256 * 1024 {
        return Err(i18n::tr("skin.dl_too_large").into());
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

/// Download remote media into `.remined/cache/media/` and return data-URL map.
#[tauri::command]
async fn cache_media_urls(
    app: AppHandle,
    urls: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    let root = paths::remined_root(&app)?;
    Ok(asset_cache::ensure_many(&root, &urls).await)
}

/// Read already-cached media only (offline-safe, no network).
#[tauri::command]
fn resolve_media_cache(
    app: AppHandle,
    urls: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    let root = paths::remined_root(&app)?;
    Ok(asset_cache::resolve_many(&root, &urls))
}

#[tauri::command]
fn get_game_phase(session: State<'_, Mutex<GameSession>>) -> GamePhase {
    let mut session = diag::lock_session(&session);
    refresh_session(&mut session);
    session.phase
}

#[tauri::command]
async fn get_runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = paths::remined_root(&app)?;
        Ok(onboarding::status(&root))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn run_onboarding(app: AppHandle) -> Result<OnboardingState, String> {
    let root = paths::remined_root(&app)?;
    onboarding::run_full(&app.clone().into(), &root).await
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
    pack_sync::sync_pack(&app.clone().into(), &root, &pack_id).await
}

#[tauri::command]
async fn get_pack_status(app: AppHandle, pack_id: String) -> Result<PackStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = paths::remined_root(&app)?;
        Ok(pack_sync::pack_status(&root, &pack_id))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Download/update pack zip, then ensure Fabric libraries + assets.
#[tauri::command]
async fn ensure_pack(app: AppHandle, pack_id: String) -> Result<PackStatus, String> {
    let root = paths::remined_root(&app)?;
    if pack_id.trim().is_empty() {
        return Err(i18n::tr("launch.no_pack").into());
    }
    onboarding::ensure_pack(&app.clone().into(), &root, pack_id.trim()).await
}

#[tauri::command]
fn cancel_install() {
    progress::request_cancel();
}

#[tauri::command]
async fn list_vanilla_versions(
    app: AppHandle,
) -> Result<vanilla::VanillaListResponse, String> {
    let root = paths::remined_root(&app)?;
    let (latest, versions) = vanilla::list_versions(&root).await?;
    Ok(vanilla::VanillaListResponse { latest, versions })
}

#[tauri::command]
async fn install_vanilla_version(
    app: AppHandle,
    version_id: String,
) -> Result<PackStatus, String> {
    let root = paths::remined_root(&app)?;
    vanilla::install_version(&app.clone().into(), &root, version_id.trim()).await
}

#[tauri::command]
async fn list_remined_vanilla_versions(
    app: AppHandle,
) -> Result<remined_vanilla::ReminedVanillaListResponse, String> {
    let root = paths::remined_root(&app)?;
    remined_vanilla::list_versions(&root).await
}

#[tauri::command]
async fn install_remined_vanilla_version(
    app: AppHandle,
    version_id: String,
) -> Result<PackStatus, String> {
    let root = paths::remined_root(&app)?;
    remined_vanilla::install_version(&app.clone().into(), &root, version_id.trim()).await
}

#[tauri::command]
async fn delete_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = paths::remined_root(&app)?;
        pack_sync::delete_pack(&root, &pack_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_pack_folder(app: AppHandle, pack_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = paths::remined_root(&app)?;
        let dir = paths::pack_dir(&root, pack_id.trim());
        if !dir.is_dir() {
            return Err(i18n::tr("pack.folder_not_found").into());
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg(&dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            std::process::Command::new("xdg-open")
                .arg(&dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn voice_log_path(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        voice_log::log_path(&app).map(|p| p.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn voice_log_append(app: AppHandle, source: String, message: String) -> Result<(), String> {
    voice_log::append(&app, &source, &message)
}

#[tauri::command]
async fn voice_log_tail(app: AppHandle, max_bytes: Option<usize>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        voice_log::read_tail(&app, max_bytes.unwrap_or(48_000))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn voice_ensure_runtime(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        voice_runtime::ensure_runtime(&app).map(|p| p.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn voice_start_livekit(
    app: AppHandle,
    voice: State<'_, voice_runtime::VoiceRuntimeState>,
) -> Result<voice_runtime::VoiceHostReady, String> {
    let voice = voice.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        voice_runtime::start_voice_livekit(&app, &voice)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn voice_start_relay(
    app: AppHandle,
    relay: State<'_, relay::RelayState>,
    lan_port: Option<u16>,
) -> Result<voice_runtime::VoiceHostReady, String> {
    let relay = relay.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        voice_runtime::start_voice_relay(app, relay, lan_port)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn voice_start_host(
    app: AppHandle,
    voice: State<'_, voice_runtime::VoiceRuntimeState>,
    relay: State<'_, relay::RelayState>,
) -> Result<voice_runtime::VoiceHostReady, String> {
    let voice = voice.inner().clone();
    let relay = relay.inner().clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        voice_runtime::start_voice_host(app2, voice, relay)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn voice_stop_host(
    app: AppHandle,
    voice: State<'_, voice_runtime::VoiceRuntimeState>,
    relay: State<'_, relay::RelayState>,
    keep_lan_port: Option<u16>,
    keep_relay: Option<bool>,
) {
    voice_runtime::stop_voice_host(
        &app,
        &voice,
        &relay,
        keep_lan_port,
        keep_relay.unwrap_or(false),
    );
}

#[tauri::command]
async fn voice_guest_connect(
    app: AppHandle,
    relay: State<'_, relay::RelayState>,
    share_code: String,
) -> Result<(), String> {
    let relay = relay.inner().clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        voice_runtime::guest_connect(app2, relay, &share_code)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn voice_guest_disconnect(
    app: AppHandle,
    relay: State<'_, relay::RelayState>,
) {
    voice_runtime::guest_disconnect(&app, &relay);
}

#[tauri::command]
fn relay_set_creds(addr: String, port: u16, token: String) -> Result<(), String> {
    relay::set_frps_creds(addr, port, token)
}

/// Frontend tells us the UI language (startup + whenever it changes).
#[tauri::command]
fn set_ui_locale(app: AppHandle, locale: String) {
    i18n::set_locale(&locale);
    tray::relocalize(&app);
}

#[tauri::command]
async fn relay_status(app: AppHandle) -> relay::RelayStatus {
    tauri::async_runtime::spawn_blocking(move || relay::status(&app))
        .await
        .unwrap_or_else(|e| relay::RelayStatus {
            installed: false,
            path: None,
            version: None,
            message: i18n::trf("relay.status_failed", &[("err", &e.to_string())]),
            custom_path: false,
        })
}

#[tauri::command]
async fn relay_check(app: AppHandle) -> relay::RelayCheckResult {
    tauri::async_runtime::spawn_blocking(move || relay::check(&app))
        .await
        .unwrap_or_else(|e| relay::RelayCheckResult {
            ok: false,
            installed: false,
            message: i18n::trf("relay.check_failed", &[("err", &e.to_string())]),
            detail: String::new(),
            path: None,
            version: None,
        })
}

#[tauri::command]
async fn relay_get_path(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || relay::get_custom_path(&app))
        .await
        .unwrap_or(None)
}

#[tauri::command]
async fn relay_set_path(app: AppHandle, path: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || relay::set_custom_path(&app, path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn relay_lan_port() -> u16 {
    relay::DEFAULT_LAN_TCP_PORT
}

#[tauri::command]
fn relay_current_key(relay: State<'_, relay::RelayState>) -> Option<String> {
    relay::current_host_key(relay.inner())
}

#[tauri::command]
fn relay_host_state(
    app: AppHandle,
    relay: State<'_, relay::RelayState>,
) -> relay::RelayHostState {
    relay::host_state(&app, relay.inner())
}

#[tauri::command]
async fn relay_ensure_host(
    app: AppHandle,
    relay: State<'_, relay::RelayState>,
    lan_port: Option<u16>,
) -> Result<String, String> {
    let relay = relay.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        relay::ensure_shared_host(&app, &relay, lan_port)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn relay_attach_lan(
    app: AppHandle,
    relay: State<'_, relay::RelayState>,
    port: u16,
) -> Result<String, String> {
    let relay = relay.inner().clone();
    tauri::async_runtime::spawn_blocking(move || relay::attach_lan_port(&app, &relay, port))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn relay_detach_lan(relay: State<'_, relay::RelayState>) -> Option<String> {
    relay::detach_lan_port(relay.inner())
}

#[tauri::command]
async fn relay_apply_lan_port(app: AppHandle, pack_id: String, port: u16) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = paths::remined_root(&app)?;
        let instance = paths::pack_dir(&root, &pack_id);
        if !instance.is_dir() {
            return Ok(());
        }
        relay::write_mcwifipnp_lan_port(&instance, port)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn relay_start_game_join(
    app: AppHandle,
    relay: State<'_, relay::RelayState>,
    key: String,
    port: u16,
) -> Result<(), String> {
    let relay = relay.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        relay::start_game_join(&app, &relay, &key, port)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn relay_stop_game_join(app: AppHandle, relay: State<'_, relay::RelayState>) {
    relay::stop_join(&app, relay.inner());
}

#[tauri::command]
fn relay_stop_host(app: AppHandle, relay: State<'_, relay::RelayState>) {
    relay::stop_host(&app, relay.inner());
}

#[tauri::command]
fn voice_mint_token(room: String, identity: String, name: String) -> Result<String, String> {
    voice_runtime::mint_token(&room, &identity, &name)
}

#[tauri::command]
async fn read_lan_port(app: AppHandle, pack_id: String) -> Result<Option<u16>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = paths::remined_root(&app)?;
        let log = paths::pack_dir(&root, &pack_id).join("logs").join("latest.log");
        let port = gamewatch::read_lan_port(&log);
        net_log::lan_poll(&app, &pack_id, port);
        Ok(port)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn diag_logs_dir(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = paths::remined_root(&app)?;
        diag::ensure_logs_dir(&root).map(|p| p.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn net_log_dir(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        net_log::dir(&app).map(|p| p.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Must match `app.windows[0].additionalBrowserArgs` in tauri.conf.json so the
/// toast webview shares the main window's WebView2 environment (a different
/// arg string with the same user-data folder makes creation fail on Windows).
#[cfg(windows)]
const WEBVIEW2_ARGS: &str =
    "--proxy-bypass-list=<-loopback>;localhost;127.0.0.1;::1;*.local";

/// Friend "now playing" desktop toast. Async so window creation never runs on
/// the main thread (sync commands creating windows deadlock on Windows).
#[tauri::command]
async fn show_friend_toast(
    app: AppHandle,
    query: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use tauri::{Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

    let log = |msg: &str| net_log::append_ok(&app, "friend-toast", msg);

    if let Some(old) = app.get_webview_window("friend-toast") {
        let _ = old.destroy();
        for _ in 0..20 {
            tauri::async_runtime::spawn_blocking(|| {
                std::thread::sleep(std::time::Duration::from_millis(25))
            })
            .await
            .ok();
            if app.get_webview_window("friend-toast").is_none() {
                break;
            }
        }
    }

    let url = format!("index.html?window=friend-toast&{query}");
    let builder = WebviewWindowBuilder::new(&app, "friend-toast", WebviewUrl::App(url.into()))
        .title("Remined")
        .inner_size(width, height)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .resizable(false)
        .shadow(false)
        .visible(false);
    #[cfg(windows)]
    let builder = builder.additional_browser_args(WEBVIEW2_ARGS);

    let win = match builder.build() {
        Ok(w) => w,
        Err(e) => {
            let msg = format!("build window failed: {e}");
            log(&msg);
            return Err(msg);
        }
    };

    // Bottom-right of the primary monitor work area (above the taskbar).
    match app.primary_monitor() {
        Ok(Some(mon)) => {
            let scale = mon.scale_factor();
            let wa = mon.work_area();
            let margin = 16.0 * scale;
            let x = wa.position.x as f64 + wa.size.width as f64 - width * scale - margin;
            let y = wa.position.y as f64 + wa.size.height as f64 - height * scale - margin;
            if let Err(e) = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32)) {
                log(&format!("set_position failed: {e}"));
            }
        }
        other => log(&format!("primary monitor unavailable: {:?}", other.map(|m| m.is_some()))),
    }

    if let Err(e) = win.show() {
        let msg = format!("show failed: {e}");
        log(&msg);
        return Err(msg);
    }
    log("shown");
    Ok(())
}

#[tauri::command]
fn net_log_append(app: AppHandle, source: String, message: String) -> Result<(), String> {
    net_log::append(&app, &source, &message)
}

#[tauri::command]
async fn net_log_tail(app: AppHandle, max_bytes: Option<usize>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        net_log::read_tail(&app, max_bytes.unwrap_or(64_000))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn net_log_list(app: AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || net_log::list_chunks(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn launch_pack(
    app: AppHandle,
    pack_id: String,
    username: String,
    skin_path: Option<String>,
    cape_path: Option<String>,
    skin_model: Option<String>,
    quick_play: Option<String>,
    session: State<'_, Mutex<GameSession>>,
) -> Result<LaunchResult, String> {
    {
        let mut session = diag::lock_session(&session);
        refresh_session(&mut session);
        if session.phase != GamePhase::Idle {
            return Ok(LaunchResult {
                ok: false,
                message: i18n::tr("launch.already_running").into(),
                phase: session.phase,
            });
        }
        session.phase = GamePhase::Launching;
    }

    let fail = |session: &State<'_, Mutex<GameSession>>, msg: String| {
        diag::lock_session(&session).phase = GamePhase::Idle;
        Ok(LaunchResult {
            ok: false,
            message: msg,
            phase: GamePhase::Idle,
        })
    };

    let root = match paths::remined_root(&app) {
        Ok(root) => root,
        Err(err) => {
            diag::lock_session(&session).phase = GamePhase::Idle;
            return Err(err);
        }
    };

    if pack_id.trim().is_empty() {
        return fail(&session, i18n::tr("launch.no_pack").into());
    }

    let name = username.trim();
    if name.len() < 3 || name.len() > 16 {
        return fail(&session, i18n::tr("launch.name_length").into());
    }

    let model = normalize_skin_model(skin_model.as_deref().unwrap_or("default")).to_string();

    let mut profile = load_profile(&root);
    profile.username = name.to_string();
    profile.skin_path = skin_path.clone();
    profile.cape_path = cape_path.clone();
    profile.skin_model = model.clone();
    // Keep Remined pack selection stable — vanilla rails are separate.
    if !vanilla::is_vanilla_pack_id(&pack_id) && !remined_vanilla::is_pack_id(&pack_id) {
        profile.selected_pack = pack_id.clone();
    }
    if let Err(err) = write_profile(&root, &profile) {
        diag::lock_session(&session).phase = GamePhase::Idle;
        return Err(err);
    }

    let instance = paths::pack_dir(&root, &pack_id);
    if !instance::is_pack_installed(&instance) {
        return fail(
            &session,
            i18n::trf("launch.pack_not_installed", &[("pack", &pack_id)]),
        );
    }

    let is_vanilla = vanilla::is_vanilla_pack_id(&pack_id);
    if is_vanilla {
        // Unmodded: resource pack + options.txt (SkinShuffle/CSL won't load).
        let version_id = pack_id
            .strip_prefix("vanilla-")
            .unwrap_or(pack_id.as_str());
        let skin_local = if let Some(ref skin) = skin_path {
            match materialize_skin(&root, skin).await {
                Ok(local) => local,
                Err(err) => {
                    diag::lock_session(&session).phase = GamePhase::Idle;
                    return Err(err);
                }
            }
        } else {
            let dir = root.join(".remined").join("skins");
            if let Err(err) = fs::create_dir_all(&dir) {
                diag::lock_session(&session).phase = GamePhase::Idle;
                return Err(err.to_string());
            }
            let dest = dir.join("active.png");
            if let Err(err) = fs::write(&dest, default_steve_png()) {
                diag::lock_session(&session).phase = GamePhase::Idle;
                return Err(err.to_string());
            }
            dest
        };
        if let Err(err) =
            vanilla_skin_pack::apply(&instance, &skin_local, &model, version_id, name)
        {
            diag::lock_session(&session).phase = GamePhase::Idle;
            return Err(err);
        }
    } else {
        // Do not force a fixed LAN port here — tunnel follows whatever port
        // Minecraft actually publishes (see useLanHosting + relay_attach_lan).
        if let Err(err) = lock_skinshuffle_ui(&instance) {
            diag::lock_session(&session).phase = GamePhase::Idle;
            return Err(err);
        }
        // Re-apply SkinShuffle jar patches (UI lock + live cape from SkinManager).
        let game_ver = instance::read_meta(&instance)
            .map(|m| m.version)
            .unwrap_or_default();
        if let Err(err) = crate::skinshuffle_patch::prepare_instance(&instance, &game_ver) {
            eprintln!("[remined] SkinShuffle patch: {err}");
        }
        if let Err(err) = apply_customskinloader_config(&instance) {
            eprintln!("[remined] CustomSkinLoader config: {err}");
        }
        // SkinShuffle + CSL LocalSkin must stay in sync. If Remined API 404s,
        // CSL falls through to LocalSkin/skins/{nick}.png — stale files look like
        // "old skin still exists" even after Storage/profile cleared.
        let skin_for_local = if let Some(ref skin) = skin_path {
            match materialize_skin(&root, skin).await {
                Ok(local) => {
                    if let Err(err) = apply_skinshuffle(&instance, &local, &model) {
                        diag::lock_session(&session).phase = GamePhase::Idle;
                        return Err(err);
                    }
                    local
                }
                Err(err) => {
                    diag::lock_session(&session).phase = GamePhase::Idle;
                    return Err(err);
                }
            }
        } else {
            // No cloud skin → Remined default Steve (same as UI), not blank Mojang.
            if let Err(err) = apply_default_steve_skin(&instance, &model) {
                let _ = clear_skinshuffle(&instance);
                clear_csl_local_skin(&instance, name);
                diag::lock_session(&session).phase = GamePhase::Idle;
                return Err(err);
            }
            let dir = root.join(".remined").join("skins");
            if let Err(err) = fs::create_dir_all(&dir) {
                diag::lock_session(&session).phase = GamePhase::Idle;
                return Err(err.to_string());
            }
            let dest = dir.join("default_steve.png");
            if let Err(err) = fs::write(&dest, default_steve_png()) {
                diag::lock_session(&session).phase = GamePhase::Idle;
                return Err(err.to_string());
            }
            dest
        };
        if let Err(err) = apply_csl_local_skin(&instance, name, &skin_for_local) {
            eprintln!("[remined] skin LocalSkin: {err}");
        }
        // Cape: CSL Remined API for friends; LocalSkin for self fallback.
        if let Some(ref cape) = cape_path {
            match materialize_skin(&root, cape).await {
                Ok(local) => {
                    if let Err(err) = apply_csl_local_cape(&instance, name, &local) {
                        eprintln!("[remined] cape LocalSkin: {err}");
                    }
                }
                Err(err) => eprintln!("[remined] cape materialize: {err}"),
            }
        } else {
            clear_csl_local_cape(&instance, name);
        }
    }

    let java_major = instance::read_meta(&instance)
        .and_then(|m| m.java_major)
        .or_else(|| {
            // Fall back to version JSON if meta predates java_major.
            instance::find_version_json(&instance, None)
                .ok()
                .and_then(|p| fs::read_to_string(p).ok())
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| {
                    v.pointer("/javaVersion/majorVersion")
                        .and_then(|x| x.as_u64())
                        .map(|n| n as u32)
                })
        })
        .unwrap_or(25);

    let java_info = {
        let found =
            java_runtime::find_java(&root, java_major, profile.java_path.as_deref());
        if found.ok {
            found
        } else {
            // Fresh JDK download — drive the playbar PixelProgress via remined-progress.
            progress::reset();
            progress::emit(
                &app.clone().into(),
                "java",
                1,
                i18n::trf("launch.java_downloading", &[("major", &java_major.to_string())]),
            );
            match java_runtime::ensure_java(&app.clone().into(), &root, java_major).await {
                Ok(info) => info,
                Err(err) => return fail(&session, err),
            }
        }
    };
    if !java_info.ok {
        return fail(
            &session,
            i18n::trf("launch.java_failed", &[("major", &java_major.to_string())]),
        );
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
        launch_label_suffix: None,
    };

    let mut child = match runtime::launch_game(&app.clone().into(), opts).await {
        Ok(child) => child,
        Err(err) => return fail(&session, err),
    };

    // Detached LaunchServices starts are slower to become "alive"; give JNA/mixins time.
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    let mut session = diag::lock_session(&session);
    match child.try_wait() {
        Ok(Some(status)) if !status.success() => {
            let err = child.error_tail();
            session.child = None;
            session.phase = GamePhase::Idle;
            Ok(LaunchResult {
                ok: false,
                message: if err.is_empty() {
                    i18n::trf("launch.exit_status", &[("status", &status.to_string())])
                } else {
                    err
                },
                phase: GamePhase::Idle,
            })
        }
        Ok(Some(_)) => {
            session.child = None;
            session.phase = GamePhase::Idle;
            Ok(LaunchResult {
                ok: false,
                message: i18n::tr("launch.exited_immediately").into(),
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
    diag::install_panic_hook();
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            voice_runtime::apply_loopback_no_proxy();
            if let Ok(root) = paths::remined_root(app.handle()) {
                diag::set_log_dir(&root);
                diag::log(
                    "app",
                    &format!("start v{} root={}", env!("CARGO_PKG_VERSION"), root.display()),
                );
            }
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
                if let Err(err) = tray::install(app.handle()) {
                    diag::log("tray", &format!("install failed: {err}"));
                }
            }
            Ok(())
        })
        .manage(Mutex::new(GameSession::default()))
        .manage(relay::RelayState::default())
        .manage(voice_runtime::VoiceRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            list_packs,
            set_ui_locale,
            get_profile,
            save_profile,
            probe_java,
            read_skin_data_url,
            materialize_skin_path,
            cache_media_urls,
            resolve_media_cache,
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
            cancel_install,
            list_vanilla_versions,
            install_vanilla_version,
            list_remined_vanilla_versions,
            install_remined_vanilla_version,
            delete_pack,
            open_pack_folder,
            diag_logs_dir,
            net_log_dir,
            net_log_append,
            show_friend_toast,
            net_log_tail,
            net_log_list,
            voice_log_path,
            voice_log_append,
            voice_log_tail,
            voice_ensure_runtime,
            voice_start_livekit,
            voice_start_relay,
            voice_start_host,
            voice_stop_host,
            voice_guest_connect,
            voice_guest_disconnect,
            voice_mint_token,
            relay_set_creds,
            relay_status,
            relay_check,
            relay_get_path,
            relay_set_path,
            relay_lan_port,
            relay_current_key,
            relay_host_state,
            relay_ensure_host,
            relay_attach_lan,
            relay_detach_lan,
            relay_apply_lan_port,
            relay_start_game_join,
            relay_stop_game_join,
            relay_stop_host,
            read_lan_port,
            gamewatch::latest_crash_report,
            gamewatch::game_log_status,
            gamewatch::list_screenshots,
            gamewatch::read_screenshot,
            gamewatch::screenshots_dir,
        ]);

    #[cfg(desktop)]
    {
        builder = builder.on_window_event(|window, event| {
            tray::on_window_event(window, &event);
        });
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // `RunEvent::Reopen` is macOS-only (Dock click while hidden).
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen {
                has_visible_windows, ..
            } = event
            {
                tray::on_reopen(app, has_visible_windows);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, event);
            }
        });
}
