//! Discover version JSON + client jar inside an installed pack (no pack-name hardcoding).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PackInstallMeta {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub version_json: Option<String>,
    #[serde(default)]
    pub client_jar: Option<String>,
    #[serde(default)]
    pub java_major: Option<u32>,
    /// `"vanilla"` for Mojang installs; empty/omitted for Remined packs.
    #[serde(default)]
    pub kind: Option<String>,
}

pub fn meta_path(instance: &Path) -> PathBuf {
    instance.join(".remined-pack.json")
}

pub fn read_meta(instance: &Path) -> Option<PackInstallMeta> {
    fs::read_to_string(meta_path(instance))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn write_meta(instance: &Path, meta: &PackInstallMeta) -> Result<(), String> {
    fs::write(
        meta_path(instance),
        serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

pub fn find_version_json(instance: &Path, hint: Option<&str>) -> Result<PathBuf, String> {
    if let Some(name) = hint {
        let p = instance.join(name);
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Some(meta) = read_meta(instance) {
        if let Some(name) = meta.version_json {
            let p = instance.join(name);
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    // pack.meta.json convention
    let pack_meta = instance.join("pack.meta.json");
    if pack_meta.is_file() {
        if let Ok(v) = serde_json::from_str::<Value>(&fs::read_to_string(&pack_meta).unwrap_or_default()) {
            if let Some(name) = v.get("version_json").and_then(|x| x.as_str()) {
                let p = instance.join(name);
                if p.is_file() {
                    return Ok(p);
                }
            }
        }
    }
    // Scan root *.json for Fabric/Minecraft version docs
    let mut candidates = Vec::new();
    if let Ok(entries) = fs::read_dir(instance) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with('.') {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&p) {
                if let Ok(v) = serde_json::from_str::<Value>(&text) {
                    if v.get("mainClass").is_some() && v.get("libraries").is_some() {
                        candidates.push(p);
                    }
                }
            }
        }
    }
    if candidates.len() == 1 {
        return Ok(candidates.remove(0));
    }
    if let Some(p) = candidates.into_iter().next() {
        return Ok(p);
    }
    Err(format!(
        "No version JSON found in {}",
        instance.display()
    ))
}

pub fn find_client_jar(
    instance: &Path,
    version: &Value,
    hint: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(name) = hint {
        let p = instance.join(name);
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Some(meta) = read_meta(instance) {
        if let Some(name) = meta.client_jar {
            let p = instance.join(name);
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    // Prefer jar named like version id
    if let Some(id) = version.get("id").and_then(|i| i.as_str()) {
        let p = instance.join(format!("{id}.jar"));
        if p.is_file() {
            return Ok(p);
        }
    }
    // Single jar in instance root
    let mut jars = Vec::new();
    if let Ok(entries) = fs::read_dir(instance) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("jar") {
                jars.push(p);
            }
        }
    }
    if jars.len() == 1 {
        return Ok(jars.remove(0));
    }
    // Largest jar as last resort
    jars.sort_by_key(|p| std::cmp::Reverse(p.metadata().map(|m| m.len()).unwrap_or(0)));
    jars.into_iter()
        .next()
        .ok_or_else(|| format!("No client jar in {}", instance.display()))
}

pub fn is_pack_installed(instance: &Path) -> bool {
    find_version_json(instance, None).is_ok()
}
