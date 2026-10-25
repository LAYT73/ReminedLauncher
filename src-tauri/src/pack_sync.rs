use crate::config::remined_config;
use crate::instance::{self, PackInstallMeta};
use crate::paths::pack_dir;
use crate::progress;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use crate::progress::Ctx as AppHandle;
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
        .ok_or_else(|| crate::i18n::trf("pack.not_in_catalog", &[("id", &pack_id)]))
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
            progress::emit(app, "pack", pct.min(80), crate::i18n::tr("progress.downloading_pack"));
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
    Err(crate::i18n::tr("pack.sha_unavailable").into())
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
    progress::emit(app, "pack", 2, crate::i18n::tr("pack.fetching_catalog"));
    let release = fetch_release(pack_id).await?;
    progress::check_cancelled()?;
    let dest = pack_dir(root, pack_id);

    if instance::is_pack_installed(&dest) {
        if let Some(local) = read_local_version(&dest) {
            if local == release.version {
                progress::emit(app, "pack", 100, crate::i18n::trf("pack.already_installed", &[("version", &local)]));
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
            crate::paths::write_atomic(&local_version_file(&dest), &release.version).map_err(|e| e.to_string())?;
            progress::emit(
                app,
                "pack",
                100,
                crate::i18n::trf("pack.using_existing", &[("version", &release.version)]),
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
    progress::emit(app, "pack", 8, crate::i18n::trf("pack.downloading_file", &[("name", &release.artifact)]));
    download_file(&url, &zip_path, app).await?;
    progress::check_cancelled()?;

    match sha256_file(&zip_path) {
        Ok(hash) if hash != release.sha256.to_lowercase() => {
            return Err(crate::i18n::trf(
                "pack.sha_mismatch",
                &[("got", &hash), ("expected", &release.sha256)],
            ));
        }
        Ok(_) => progress::emit(app, "pack", 82, crate::i18n::tr("pack.checksum_ok")),
        Err(msg) => progress::emit(app, "pack", 82, msg),
    }

    progress::emit(app, "pack", 85, crate::i18n::tr("pack.extracting"));
    let staging = root
        .join(".remined")
        .join("cache")
        .join(format!("{pack_id}-staging"));
    let _ = fs::remove_dir_all(&staging);
    extract_zip(&zip_path, &staging)?;

    // Player data survives updates: move it aside, swap in the new pack, move it back.
    let keep_root = root.join(".remined").join("cache").join(format!("{pack_id}-keep"));
    let _ = fs::remove_dir_all(&keep_root);
    let old_options = fs::read_to_string(dest.join("options.txt")).ok();
    let old_defaults = fs::read_to_string(defaults_snapshot(&dest)).ok();
    if dest.exists() {
        for rel in PRESERVE {
            let from = dest.join(rel);
            if from.exists() {
                let to = keep_root.join(rel);
                if let Some(parent) = to.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::rename(&from, &to);
            }
        }
        let _ = fs::remove_dir_all(&dest);
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&staging, &dest).map_err(|e| e.to_string())?;
    for rel in PRESERVE {
        let from = keep_root.join(rel);
        if from.exists() {
            let to = dest.join(rel);
            let _ = fs::remove_dir_all(&to);
            let _ = fs::remove_file(&to);
            if let Some(parent) = to.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::rename(&from, &to);
        }
    }
    let _ = fs::remove_dir_all(&keep_root);
    // The pack's own options.txt becomes the defaults snapshot; the player's settings merge over it.
    if let Ok(pack_options) = fs::read_to_string(dest.join("options.txt")) {
        let _ = crate::paths::write_atomic(&defaults_snapshot(&dest), &pack_options);
        if let Some(user) = old_options {
            let merged = merge_options(&pack_options, &user, old_defaults.as_deref());
            let _ = crate::paths::write_atomic(&dest.join("options.txt"), &merged);
        }
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
    crate::paths::write_atomic(&local_version_file(&dest), &release.version).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&zip_path);

    // Validate discovery works
    let _ = instance::find_version_json(&dest, release.version_json.as_deref())?;

    progress::emit(app, "pack", 100, crate::i18n::trf("pack.ready", &[("version", &release.version)]));
    Ok(PackStatus {
        id: pack_id.to_string(),
        installed: true,
        local_version: Some(release.version.clone()),
        remote: Some(release),
        path: dest.display().to_string(),
    })
}

/// Player data kept across pack updates (relative to the instance).
const PRESERVE: &[&str] = &[
    "saves",
    "screenshots",
    "xaero",
    "Notebook",
    "notes",
    "village-quest",
    "schematics",
    "TrashSlotSaveState.json",
    "command_history.txt",
    "backups",
    "config/remined-companion.json",
    "config/remined-compass-hidden",
    "config/remined-hints-hidden",
];

fn defaults_snapshot(instance: &Path) -> PathBuf {
    instance.join(".remined").join("pack-options.txt")
}

/// Merge the player's options.txt into the new pack defaults.
/// With the previous pack defaults known, a key keeps the player's value only if they changed it.
/// Without them (first update from an older launcher) personal settings are kept, but keybinds and
/// the resource-pack list come from the new pack, which ships its own binds and packs.
fn merge_options(pack: &str, user: &str, old_defaults: Option<&str>) -> String {
    fn parse(text: &str) -> Vec<(String, String)> {
        text.lines()
            .filter_map(|l| l.split_once(':').map(|(k, v)| (k.to_string(), v.to_string())))
            .collect()
    }
    let pack = parse(pack);
    let user_lines = parse(user);
    let user: std::collections::HashMap<&str, &str> =
        user_lines.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let old: Option<std::collections::HashMap<String, String>> =
        old_defaults.map(|t| parse(t).into_iter().collect());
    let pack_owned =
        |k: &str| k.starts_with("key_") || k == "resourcePacks" || k == "incompatibleResourcePacks";
    let mut out = String::new();
    for (k, pack_value) in &pack {
        let value = match (user.get(k.as_str()), &old) {
            (Some(u), Some(old)) if old.get(k).map(String::as_str) != Some(*u) => u.to_string(),
            (Some(u), None) if !pack_owned(k) => u.to_string(),
            _ => pack_value.clone(),
        };
        out.push_str(&format!("{k}:{value}\n"));
    }
    // Keys the pack does not ship (e.g. binds of mods the player added) stay as they are.
    for (k, v) in &user_lines {
        if !pack.iter().any(|(pk, _)| pk == k) {
            out.push_str(&format!("{k}:{v}\n"));
        }
    }
    out
}

/// Remove an installed pack directory (and cached zip if present).
pub fn delete_pack(root: &Path, pack_id: &str) -> Result<(), String> {
    let id = pack_id.trim();
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(crate::i18n::tr("pack.invalid_id").into());
    }
    let dest = pack_dir(root, id);
    if !dest.exists() {
        return Err(crate::i18n::trf("pack.not_installed", &[("id", &id)]));
    }
    // Only delete under packs/ or known install roots — never wipe random paths
    let packs_root = root.join("packs");
    let under_packs = dest.starts_with(&packs_root);
    let under_root_named = dest.parent() == Some(root) && dest.file_name().and_then(|n| n.to_str()) == Some(id);
    if !under_packs && !under_root_named {
        return Err(crate::i18n::tr("pack.delete_outside").into());
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

#[cfg(test)]
mod merge_tests {
    use super::merge_options;

    #[test]
    fn keeps_player_changes_and_takes_new_defaults() {
        let old = "fov:70\nkey_key.jump:key.keyboard.space\nresourcePacks:[\"a\"]\n";
        let user = "fov:90\nkey_key.jump:key.keyboard.space\nresourcePacks:[\"a\"]\nkey_key.mymod:key.keyboard.g\n";
        let pack = "fov:70\nkey_key.jump:key.keyboard.c\nresourcePacks:[\"a\",\"b\"]\n";
        let out = merge_options(pack, user, Some(old));
        assert!(out.contains("fov:90\n"));
        assert!(out.contains("key_key.jump:key.keyboard.c\n"));
        assert!(out.contains("resourcePacks:[\"a\",\"b\"]\n"));
        assert!(out.contains("key_key.mymod:key.keyboard.g\n"));
    }

    #[test]
    fn first_update_keeps_personal_settings_but_not_binds() {
        let user = "fov:90\nkey_key.jump:key.keyboard.x\n";
        let pack = "fov:70\nkey_key.jump:key.keyboard.c\n";
        let out = merge_options(pack, user, None);
        assert_eq!(out, "fov:90\nkey_key.jump:key.keyboard.c\n");
    }
}
