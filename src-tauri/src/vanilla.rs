//! Mojang vanilla version list + install into `packs/vanilla-{id}`.

use crate::instance::{self, PackInstallMeta};
use crate::paths::pack_dir;
use crate::progress;
use crate::runtime;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use crate::progress::Ctx as AppHandle;

const MANIFEST_URL: &str = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VanillaVersionInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    #[serde(default, rename = "releaseTime")]
    pub release_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VanillaManifest {
    pub latest: VanillaLatest,
    pub versions: Vec<VanillaVersionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VanillaLatest {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VanillaVersionRow {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub release_time: String,
    pub pack_id: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VanillaListResponse {
    pub latest: VanillaLatest,
    pub versions: Vec<VanillaVersionRow>,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("ReminedLauncher/0.1")
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())
}

pub fn pack_id_for(version_id: &str) -> String {
    format!("vanilla-{version_id}")
}

pub fn is_vanilla_pack_id(pack_id: &str) -> bool {
    pack_id.starts_with("vanilla-")
}

pub fn is_vanilla_instance(instance: &Path) -> bool {
    if let Some(meta) = instance::read_meta(instance) {
        if meta.kind.as_deref() == Some("vanilla") {
            return true;
        }
        if is_vanilla_pack_id(&meta.id) {
            return true;
        }
    }
    instance
        .file_name()
        .and_then(|n| n.to_str())
        .map(is_vanilla_pack_id)
        .unwrap_or(false)
}

pub async fn fetch_manifest() -> Result<VanillaManifest, String> {
    let client = http_client()?;
    let resp = client
        .get(MANIFEST_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    resp.json::<VanillaManifest>()
        .await
        .map_err(|e| e.to_string())
}

pub async fn list_versions(root: &Path) -> Result<(VanillaLatest, Vec<VanillaVersionRow>), String> {
    let manifest = fetch_manifest().await?;
    let rows = manifest
        .versions
        .into_iter()
        .map(|v| {
            let pack_id = pack_id_for(&v.id);
            let installed = instance::is_pack_installed(&pack_dir(root, &pack_id));
            VanillaVersionRow {
                id: v.id,
                version_type: v.version_type,
                release_time: v.release_time,
                pack_id,
                installed,
            }
        })
        .collect();
    Ok((manifest.latest, rows))
}

async fn download_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err(format!("empty download: {url}"));
    }
    Ok(bytes.to_vec())
}

async fn download_to_file(client: &reqwest::Client, url: &str, dest: &Path) -> Result<(), String> {
    if dest.is_file() && dest.metadata().map(|m| m.len() > 0).unwrap_or(false) {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = download_bytes(client, url).await?;
    let tmp = dest.with_extension("part");
    {
        let mut file = File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, dest).map_err(|e| e.to_string())
}

/// Download Mojang version JSON + client jar into `packs/vanilla-{id}`, then prepare libs/assets.
pub async fn install_version(
    app: &AppHandle,
    root: &Path,
    version_id: &str,
) -> Result<crate::pack_sync::PackStatus, String> {
    let version_id = version_id.trim();
    if version_id.is_empty() {
        return Err(crate::i18n::tr("vanilla.no_version").into());
    }

    progress::reset();
    progress::emit(app, "pack", 2, crate::i18n::trf("progress.looking_up", &[("version", version_id)]));

    let manifest = fetch_manifest().await?;
    let entry = manifest
        .versions
        .iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| crate::i18n::trf("vanilla.unknown_version", &[("version", version_id)]))?;

    let pack_id = pack_id_for(version_id);
    let dest = pack_dir(root, &pack_id);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let client = http_client()?;
    progress::emit(app, "pack", 10, crate::i18n::tr("progress.dl_version_meta"));
    let version_bytes = download_bytes(&client, &entry.url).await?;
    let version: Value =
        serde_json::from_slice(&version_bytes).map_err(|e| format!("Invalid version JSON: {e}"))?;

    if version.pointer("/arguments/jvm").is_none() {
        return Err(crate::i18n::trf("vanilla.old_format", &[("version", version_id)]));
    }

    let version_json_name = format!("{version_id}.json");
    let version_path = dest.join(&version_json_name);
    crate::paths::write_atomic(&version_path, &version_bytes).map_err(|e| e.to_string())?;

    let client_jar_name = format!("{version_id}.jar");
    let client_jar_path = dest.join(&client_jar_name);
    let client_url = version
        .pointer("/downloads/client/url")
        .and_then(|u| u.as_str())
        .ok_or("version JSON missing downloads.client.url")?;

    progress::emit(app, "pack", 25, crate::i18n::tr("progress.dl_client"));
    download_to_file(&client, client_url, &client_jar_path).await?;
    progress::check_cancelled()?;
    progress::emit(app, "pack", 55, crate::i18n::tr("progress.client_ready"));

    let java_major = version
        .pointer("/javaVersion/majorVersion")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

    let meta = PackInstallMeta {
        id: pack_id.clone(),
        name: format!("Minecraft {version_id}"),
        version: version_id.to_string(),
        version_json: Some(version_json_name),
        client_jar: Some(client_jar_name),
        java_major,
        kind: Some("vanilla".into()),
    };
    instance::write_meta(&dest, &meta)?;

    progress::emit(app, "fabric", 1, crate::i18n::tr("progress.checking_libraries"));
    runtime::prepare_runtime(app, root, &dest).await?;
    progress::emit(app, "done", 100, crate::i18n::tr("progress.vanilla_ready"));

    Ok(crate::pack_sync::pack_status(root, &pack_id))
}

/// Re-prepare libs/assets for an already-installed vanilla pack (no catalog sync).
pub async fn ensure_installed(
    app: &AppHandle,
    root: &Path,
    pack_id: &str,
) -> Result<crate::pack_sync::PackStatus, String> {
    let instance = pack_dir(root, pack_id);
    if !instance::is_pack_installed(&instance) {
        let version_id = pack_id
            .strip_prefix("vanilla-")
            .unwrap_or(pack_id)
            .to_string();
        return install_version(app, root, &version_id).await;
    }
    progress::reset();
    progress::emit(app, "fabric", 1, crate::i18n::tr("progress.checking_libraries"));
    runtime::prepare_runtime(app, root, &instance).await?;
    progress::emit(app, "done", 100, crate::i18n::tr("progress.ready_to_play"));
    Ok(crate::pack_sync::pack_status(root, pack_id))
}
