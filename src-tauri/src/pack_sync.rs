use crate::config::remined_config;
use crate::instance::{self, PackInstallMeta};
use crate::paths::pack_dir;
use crate::progress;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackRelease {
    pub id: String,
    pub name: String,
    pub version: String,
    pub artifact: String,
    pub sha256: String,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub version_json: Option<String>,
    #[serde(default)]
    pub client_jar: Option<String>,
    #[serde(default)]
    pub java_major: Option<u32>,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackCatalog {
    #[serde(default)]
    pub schema: u32,
    #[serde(default)]
    pub packs: Vec<PackRelease>,
}

/// Legacy single-pack manifest.json shape (still accepted and wrapped).
#[derive(Debug, Deserialize)]
struct LegacyManifest {
    pack_id: String,
    name: String,
    version: String,
    artifact: String,
    sha256: String,
    #[serde(default)]
    bytes: u64,
    #[serde(default)]
    version_json: Option<String>,
    #[serde(default)]
    client_jar: Option<String>,
    #[serde(default)]
    java_major: Option<u32>,
    #[serde(default)]
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackStatus {
    pub id: String,
    pub installed: bool,
    pub local_version: Option<String>,
    pub remote: Option<PackRelease>,
    pub path: String,
}

pub async fn fetch_catalog() -> Result<PackCatalog, String> {
    let cfg = remined_config();
    let client = reqwest::Client::builder()
        .user_agent("ReminedLauncher/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let catalog_url = &cfg.packs_catalog_url;
    let resp = client
        .get(catalog_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if let Ok(cat) = serde_json::from_str::<PackCatalog>(&text) {
            if !cat.packs.is_empty() {
                return Ok(cat);
            }
        }
        // Maybe legacy single object at catalog URL
        if let Ok(legacy) = serde_json::from_str::<LegacyManifest>(&text) {
            return Ok(legacy_to_catalog(legacy));
        }
    }

    // Fallback: older releases published only manifest.json
    let manifest_url = format!("{}/manifest.json", cfg.packs_release_base.trim_end_matches('/'));
    let legacy: LegacyManifest = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(legacy_to_catalog(legacy))
}

fn legacy_to_catalog(m: LegacyManifest) -> PackCatalog {
    PackCatalog {
        schema: 1,
        packs: vec![PackRelease {
            id: m.pack_id,
            name: m.name,
            version: m.version,
            artifact: m.artifact,
            sha256: m.sha256,
            bytes: m.bytes,
            version_json: m.version_json,
            client_jar: m.client_jar,
            java_major: m.java_major,
            is_default: true,
            updated_at: m.updated_at,
        }],
    }
}

pub async fn fetch_release(pack_id: &str) -> Result<PackRelease, String> {
    let catalog = fetch_catalog().await?;
    catalog
        .packs
        .into_iter()
        .find(|p| p.id == pack_id)
        .ok_or_else(|| format!("Pack `{pack_id}` not in remote catalog"))
}

pub async fn default_pack_id() -> Result<String, String> {
    let catalog = fetch_catalog().await?;
    if let Some(p) = catalog.packs.iter().find(|p| p.is_default) {
        return Ok(p.id.clone());
    }
    catalog
        .packs
        .first()
        .map(|p| p.id.clone())
        .ok_or_else(|| "Remote pack catalog is empty".into())
}

fn local_version_file(dir: &Path) -> PathBuf {
    dir.join(".remined-pack-version")
}

pub fn read_local_version(dir: &Path) -> Option<String> {
    if let Some(meta) = instance::read_meta(dir) {
        if !meta.version.is_empty() {
            return Some(meta.version);
        }
    }
    fs::read_to_string(local_version_file(dir))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn pack_status(root: &Path, pack_id: &str) -> PackStatus {
    let dir = pack_dir(root, pack_id);
    PackStatus {
        id: pack_id.to_string(),
        installed: instance::is_pack_installed(&dir),
        local_version: read_local_version(&dir),
        remote: None,
        path: dir.display().to_string(),
    }
}

pub fn list_installed(root: &Path) -> Vec<PackStatus> {
    let packs_root = root.join("packs");
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&packs_root) {
        for e in entries.flatten() {
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            let id = e.file_name().to_string_lossy().to_string();
            out.push(pack_status(root, &id));
        }
    }
    // Legacy single-folder install at root (any dir with discoverable version json)
    if let Ok(entries) = fs::read_dir(root) {
        for e in entries.flatten() {
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "packs" || name == "app" || name == "scripts" {
                continue;
            }
            if instance::is_pack_installed(&p) {
                if !out.iter().any(|s| s.path == p.display().to_string()) {
                    out.push(PackStatus {
                        id: name,
                        installed: true,
                        local_version: read_local_version(&p),
                        remote: None,
                        path: p.display().to_string(),
                    });
                }
            }
        }
    }
    out
}

async fn download_file(url: &str, dest: &Path, app: &AppHandle) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let client = reqwest::Client::builder()
        .user_agent("ReminedLauncher/0.1")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(0);
    let mut file = File::create(dest).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        progress::check_cancelled()?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = 10 + ((downloaded as f64 / total as f64) * 70.0) as u32;
            progress::emit(app, "pack", pct.min(80), "Downloading pack…");
        }
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let output = std::process::Command::new("shasum")
        .args(["-a", "256"])
        .arg(path)
        .output();
    if let Ok(out) = output {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(hash) = text.split_whitespace().next() {
                return Ok(hash.to_lowercase());
            }
        }
    }
    Err("sha256 verify unavailable — skipping".into())
}

fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let file = File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut top_dirs = std::collections::BTreeSet::new();
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if let Some(name) = entry.enclosed_name() {
            if let Some(first) = name.components().next() {
                top_dirs.insert(first.as_os_str().to_owned());
            }
        }
    }
    let strip_one = top_dirs.len() == 1;

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let enclosed = match entry.enclosed_name() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };
        let rel = if strip_one {
            enclosed.components().skip(1).collect::<PathBuf>()
        } else {
            enclosed
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let outpath = dest.join(&rel);
        if entry.name().map(|n| n.ends_with('/')).unwrap_or(false) {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub async fn sync_pack(app: &AppHandle, root: &Path, pack_id: &str) -> Result<PackStatus, String> {
    progress::check_cancelled()?;
    progress::emit(app, "pack", 2, "Fetching pack catalog…");
    let release = fetch_release(pack_id).await?;
    progress::check_cancelled()?;
    let dest = pack_dir(root, pack_id);

    if instance::is_pack_installed(&dest) {
        if let Some(local) = read_local_version(&dest) {
            if local == release.version {
                progress::emit(app, "pack", 100, format!("Pack {} already installed", local));
                return Ok(PackStatus {
                    id: pack_id.to_string(),
                    installed: true,
                    local_version: Some(local),
                    remote: Some(release),
                    path: dest.display().to_string(),
                });
            }
        } else {
            // Adopt remote version stamp for existing install
            let meta = PackInstallMeta {
                id: release.id.clone(),
                name: release.name.clone(),
                version: release.version.clone(),
                version_json: release.version_json.clone(),
                client_jar: release.client_jar.clone(),
                java_major: release.java_major,
                kind: None,
            };
            instance::write_meta(&dest, &meta)?;
            fs::write(local_version_file(&dest), &release.version).map_err(|e| e.to_string())?;
            progress::emit(
                app,
                "pack",
                100,
                format!("Using existing pack as {}", release.version),
            );
            return Ok(PackStatus {
                id: pack_id.to_string(),
                installed: true,
                local_version: Some(release.version.clone()),
                remote: Some(release),
                path: dest.display().to_string(),
            });
        }
    }

    let cfg = remined_config();
    let url = format!(
        "{}/{}",
        cfg.packs_release_base.trim_end_matches('/'),
        release.artifact
    );
    let zip_path = root
        .join(".remined")
        .join("cache")
        .join(&release.artifact);
    progress::emit(app, "pack", 8, format!("Downloading {}…", release.artifact));
    download_file(&url, &zip_path, app).await?;
    progress::check_cancelled()?;

    match sha256_file(&zip_path) {
        Ok(hash) if hash != release.sha256.to_lowercase() => {
            return Err(format!(
                "SHA256 mismatch: got {hash}, expected {}",
                release.sha256
            ));
        }
        Ok(_) => progress::emit(app, "pack", 82, "Checksum OK"),
        Err(msg) => progress::emit(app, "pack", 82, msg),
    }

    progress::emit(app, "pack", 85, "Extracting pack…");
    let staging = root
        .join(".remined")
        .join("cache")
        .join(format!("{pack_id}-staging"));
    let _ = fs::remove_dir_all(&staging);
    extract_zip(&zip_path, &staging)?;

    let saves_backup = root.join(".remined").join("cache").join("saves-backup");
    if dest.exists() {
        let saves = dest.join("saves");
        if saves.is_dir() {
            let _ = fs::remove_dir_all(&saves_backup);
            let _ = fs::rename(&saves, &saves_backup);
        }
        let _ = fs::remove_dir_all(&dest);
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&staging, &dest).map_err(|e| e.to_string())?;
    if saves_backup.is_dir() {
        let _ = fs::rename(&saves_backup, dest.join("saves"));
    }

    let meta = PackInstallMeta {
        id: release.id.clone(),
        name: release.name.clone(),
        version: release.version.clone(),
        version_json: release.version_json.clone(),
        client_jar: release.client_jar.clone(),
        java_major: release.java_major,
        kind: None,
    };
    instance::write_meta(&dest, &meta)?;
    fs::write(local_version_file(&dest), &release.version).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&zip_path);

    // Validate discovery works
    let _ = instance::find_version_json(&dest, release.version_json.as_deref())?;

    progress::emit(app, "pack", 100, format!("Pack {} ready", release.version));
    Ok(PackStatus {
        id: pack_id.to_string(),
        installed: true,
        local_version: Some(release.version.clone()),
        remote: Some(release),
        path: dest.display().to_string(),
    })
}

/// Remove an installed pack directory (and cached zip if present).
pub fn delete_pack(root: &Path, pack_id: &str) -> Result<(), String> {
    let id = pack_id.trim();
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("Invalid pack id".into());
    }
    let dest = pack_dir(root, id);
    if !dest.exists() {
        return Err(format!("Pack `{id}` is not installed"));
    }
    // Only delete under packs/ or known install roots — never wipe random paths
    let packs_root = root.join("packs");
    let under_packs = dest.starts_with(&packs_root);
    let under_root_named = dest.parent() == Some(root) && dest.file_name().and_then(|n| n.to_str()) == Some(id);
    if !under_packs && !under_root_named {
        return Err("Refusing to delete pack outside packs folder".into());
    }
    fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;

    let cache = root.join(".remined").join("cache");
    if cache.is_dir() {
        if let Ok(entries) = fs::read_dir(&cache) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with(id) {
                    let _ = fs::remove_file(e.path());
                    let _ = fs::remove_dir_all(e.path());
                }
            }
        }
    }
    Ok(())
}
