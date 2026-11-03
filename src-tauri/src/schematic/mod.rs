//! Schematics library: import, decode and serve schematic files.

pub mod assets;
pub mod catalog;
pub mod formats;
pub mod nbt;

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::AppHandle;

static INDEX_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchematicEntry {
    pub id: String,
    pub name: String,
    /// "litematic" | "schem" | "nbt"
    pub format: String,
    pub size: [i32; 3],
    pub block_count: u64,
    pub imported_at: String,
    #[serde(default)]
    pub built_layers: Vec<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
}

/// Catalog provenance attached to an entry on install.
pub(crate) struct CatalogMeta {
    pub catalog_id: String,
    pub author: Option<String>,
    pub license: Option<String>,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchematicData {
    pub id: String,
    pub name: String,
    pub size: [i32; 3],
    pub palette: Vec<String>,
    /// Always 16: `blocks` is base64 of little-endian u16 palette indices.
    pub bits: u8,
    pub blocks: String,
}

fn lib_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::paths::remined_root(app)?
        .join(".remined")
        .join("schematics");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_index(dir: &Path) -> Vec<SchematicEntry> {
    let path = dir.join("library.json");
    let Ok(bytes) = std::fs::read(&path) else {
        return Vec::new();
    };
    match serde_json::from_slice(&bytes) {
        Ok(list) => list,
        Err(e) => {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let bad = dir.join(format!("library.json.bad-{ts}"));
            eprintln!("schematic: library.json is corrupt ({e}); moved to {}", bad.display());
            let _ = std::fs::rename(&path, &bad);
            Vec::new()
        }
    }
}

fn write_index(dir: &Path, list: &[SchematicEntry]) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
    crate::paths::write_atomic(&dir.join("library.json"), json).map_err(|e| e.to_string())
}

fn file_path(dir: &Path, e: &SchematicEntry) -> PathBuf {
    dir.join(format!("{}.{}", e.id, e.format))
}

fn is_air(name: &str) -> bool {
    let base = name.split('[').next().unwrap_or(name);
    matches!(
        base,
        "minecraft:air" | "minecraft:cave_air" | "minecraft:void_air"
    )
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

fn mutate_entry<F: FnOnce(&mut SchematicEntry) -> Result<(), String>>(
    app: &AppHandle,
    id: &str,
    f: F,
) -> Result<SchematicEntry, String> {
    let dir = lib_dir(app)?;
    let _g = INDEX_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut list = read_index(&dir);
    let e = list
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or("Схематика не найдена / Schematic not found")?;
    f(e)?;
    let out = e.clone();
    write_index(&dir, &list)?;
    Ok(out)
}

#[tauri::command]
pub async fn schematic_list(app: AppHandle) -> Result<Vec<SchematicEntry>, String> {
    let dir = lib_dir(&app)?;
    let _g = INDEX_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut list = read_index(&dir);
    list.sort_by(|a, b| b.imported_at.cmp(&a.imported_at));
    Ok(list)
}

/// Decode `data`, store it in the library and index it. With `meta`, an
/// existing entry with the same catalog id is returned instead of a duplicate.
pub(crate) fn import_bytes(
    dir: &Path,
    data: &[u8],
    name: &str,
    ext: &str,
    meta: Option<CatalogMeta>,
) -> Result<SchematicEntry, String> {
    let (decoded, format) = formats::decode(ext, data)?;
    let air: Vec<bool> = decoded.palette.iter().map(|p| is_air(p)).collect();
    let block_count = decoded
        .blocks
        .iter()
        .filter(|&&b| !air.get(b as usize).copied().unwrap_or(true))
        .count() as u64;
    let name: String = name.trim().chars().take(80).collect();
    let (catalog_id, author, license, source_url) = match meta {
        Some(m) => (Some(m.catalog_id), m.author, m.license, m.source_url),
        None => (None, None, None, None),
    };
    let entry = SchematicEntry {
        id: uuid::Uuid::new_v4().simple().to_string(),
        name: if name.is_empty() { "schematic".into() } else { name },
        format: format.to_string(),
        size: decoded.size,
        block_count,
        imported_at: chrono::Utc::now().to_rfc3339(),
        built_layers: Vec::new(),
        catalog_id,
        author,
        license,
        source_url,
    };
    let dest = file_path(dir, &entry);
    if let Err(e) = crate::paths::write_atomic(&dest, data) {
        let _ = std::fs::remove_file(&dest);
        return Err(e.to_string());
    }
    let _g = INDEX_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut list = read_index(dir);
    if let Some(cid) = &entry.catalog_id {
        if let Some(existing) = list.iter().find(|e| e.catalog_id.as_deref() == Some(cid)) {
            let existing = existing.clone();
            let _ = std::fs::remove_file(&dest);
            return Ok(existing);
        }
    }
    list.push(entry.clone());
    if let Err(e) = write_index(dir, &list) {
        let _ = std::fs::remove_file(&dest);
        return Err(e);
    }
    Ok(entry)
}

/// Existing library entry installed from the given catalog item, if any.
pub(crate) fn find_by_catalog_id(dir: &Path, cid: &str) -> Option<SchematicEntry> {
    let _g = INDEX_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    read_index(dir)
        .into_iter()
        .find(|e| e.catalog_id.as_deref() == Some(cid))
}

#[tauri::command]
pub async fn schematic_import(app: AppHandle, path: String) -> Result<SchematicEntry, String> {
    let dir = lib_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        let src = PathBuf::from(&path);
        let data = std::fs::read(&src).map_err(|e| format!("Не удалось прочитать файл / Cannot read file: {e}"))?;
        let ext = src
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let name = src
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "schematic".into());
        import_bytes(&dir, &data, &name, &ext, None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn schematic_delete(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Bad id".into());
    }
    let dir = lib_dir(&app)?;
    let _g = INDEX_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut list = read_index(&dir);
    if let Some(pos) = list.iter().position(|e| e.id == id) {
        let e = list.remove(pos);
        write_index(&dir, &list)?;
        let _ = std::fs::remove_file(file_path(&dir, &e));
    }
    Ok(())
}

#[tauri::command]
pub async fn schematic_rename(app: AppHandle, id: String, name: String) -> Result<SchematicEntry, String> {
    let name = name.trim().to_string();
    let n = name.chars().count();
    if n == 0 || n > 80 {
        return Err("Имя: 1–80 символов / Name must be 1-80 characters".into());
    }
    mutate_entry(&app, &id, |e| {
        e.name = name;
        Ok(())
    })
}

#[tauri::command]
pub async fn schematic_set_built(app: AppHandle, id: String, layers: Vec<i32>) -> Result<SchematicEntry, String> {
    let mut layers = layers;
    layers.sort_unstable();
    layers.dedup();
    mutate_entry(&app, &id, |e| {
        e.built_layers = layers;
        Ok(())
    })
}

#[tauri::command]
pub async fn schematic_load(app: AppHandle, id: String) -> Result<SchematicData, String> {
    let dir = lib_dir(&app)?;
    tokio::task::spawn_blocking(move || {
        let entry = {
            let _g = INDEX_LOCK.lock().unwrap_or_else(|p| p.into_inner());
            read_index(&dir)
                .into_iter()
                .find(|e| e.id == id)
                .ok_or("Схематика не найдена / Schematic not found")?
        };
        let data = std::fs::read(file_path(&dir, &entry)).map_err(|e| e.to_string())?;
        let (d, _) = formats::decode(&entry.format, &data)?;
        let mut raw = Vec::with_capacity(d.blocks.len() * 2);
        for b in &d.blocks {
            raw.extend_from_slice(&(*b as u16).to_le_bytes());
        }
        Ok(SchematicData {
            id: entry.id,
            name: entry.name,
            size: d.size,
            palette: d.palette,
            bits: 16,
            blocks: base64::engine::general_purpose::STANDARD.encode(raw),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
