//! Built-in schematic catalog: fetch/cached catalog.json, thumbnails, install.

use super::{CatalogMeta, SchematicEntry};
use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::AppHandle;

const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/LAYT73/ReminedPacks/main/schematics/catalog.json";
const CATALOG_ENV: &str = "REMINED_SCHEM_CATALOG";
const CATALOG_TTL: Duration = Duration::from_secs(10 * 60);
const CATALOG_TIMEOUT: Duration = Duration::from_secs(10);
const FILE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CATALOG_BYTES: usize = 4 * 1024 * 1024;
const MAX_THUMB_BYTES: usize = 2 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 16 * 1024 * 1024;

const ERR_OFFLINE: &str =
    "Каталог недоступен, а сохранённой копии нет / Catalog unavailable and no cached copy";
const ERR_BAD_CATALOG: &str = "Некорректный каталог / Invalid catalog";
const ERR_NO_ITEM: &str = "Схематика не найдена в каталоге / Item not found in catalog";
const ERR_SIZE: &str = "Размер файла не совпадает / File size mismatch";
const ERR_SUM: &str = "Контрольная сумма не совпадает / Checksum mismatch";
const ERR_BAD_PATH: &str = "Недопустимый путь в каталоге / Invalid path in catalog";

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::paths::remined_root(app)?.join(".remined").join("cache");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn catalog_source() -> String {
    match std::env::var(CATALOG_ENV) {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => CATALOG_URL.to_string(),
    }
}

fn is_http(src: &str) -> bool {
    src.starts_with("http://") || src.starts_with("https://")
}

/// Local sources (`file://`, paths, plain http) are only allowed with the catalog override.
fn local_override() -> bool {
    std::env::var(CATALOG_ENV).is_ok_and(|v| !v.trim().is_empty())
}

fn src_allowed(src: &str, local_ok: bool) -> bool {
    src.starts_with("https://") || local_ok
}

/// Fetch bytes from https; `file://` URLs, local paths and http only with the override env var.
async fn fetch_bytes(src: &str, timeout: Duration, max: usize) -> Result<Vec<u8>, String> {
    if !src_allowed(src, local_override()) {
        return Err("Разрешены только https-адреса / Only https URLs are allowed".into());
    }
    if !is_http(src) {
        let path = src.strip_prefix("file://").unwrap_or(src);
        let data = std::fs::read(path).map_err(|e| e.to_string())?;
        if data.len() > max {
            return Err("Файл слишком большой / File too large".into());
        }
        return Ok(data);
    }
    let client = reqwest::Client::builder()
        .user_agent("ReminedLauncher/0.2")
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(src)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    if resp.content_length().is_some_and(|n| n as usize > max) {
        return Err("Файл слишком большой / File too large".into());
    }
    let mut out = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if out.len() + chunk.len() > max {
            return Err("Файл слишком большой / File too large".into());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

fn str_field(o: &serde_json::Map<String, Value>, key: &str) -> String {
    o.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

/// Keeps only string `ru`/`en` entries; None when neither is a non-empty string.
fn norm_localized(v: Option<&Value>) -> Option<Value> {
    let o = v?.as_object()?;
    let mut out = serde_json::Map::new();
    for k in ["ru", "en"] {
        if let Some(s) = o.get(k).and_then(Value::as_str) {
            out.insert(k.into(), Value::String(s.to_string()));
        }
    }
    out.values().any(|s| s.as_str().is_some_and(|s| !s.trim().is_empty())).then(|| Value::Object(out))
}

fn norm_item(v: &Value) -> Option<Value> {
    let o = v.as_object()?;
    let id = o.get("id").and_then(Value::as_str).filter(|i| valid_item_id(i))?;
    let category = o.get("category").and_then(Value::as_str).filter(|c| !c.is_empty())?;
    let name = norm_localized(o.get("name"))?;
    let file = o.get("file").and_then(Value::as_str)?;
    let ext = valid_rel_path(file, &["schem", "litematic", "nbt"])?;
    let sha = o.get("sha256").and_then(Value::as_str).filter(|s| !s.is_empty())?;
    let size = o.get("size").and_then(Value::as_array).filter(|a| a.len() == 3)?;
    if !size.iter().all(|n| n.as_u64().is_some_and(|n| n > 0)) {
        return None;
    }
    let mut out = o.clone();
    out.insert("id".into(), id.into());
    out.insert("category".into(), category.into());
    out.insert("name".into(), name);
    out.insert("sha256".into(), sha.into());
    out.insert("format".into(), ext.into());
    out.insert("description".into(), norm_localized(o.get("description")).unwrap_or_else(|| Value::Object(Default::default())));
    out.insert(
        "tags".into(),
        Value::Array(
            o.get("tags")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter(|t| t.is_string()).cloned().collect())
                .unwrap_or_default(),
        ),
    );
    let diff = o.get("difficulty").and_then(Value::as_str).filter(|d| ["easy", "medium", "hard"].contains(d));
    out.insert("difficulty".into(), diff.unwrap_or("easy").into());
    out.insert("author".into(), str_field(o, "author").into());
    out.insert("license".into(), str_field(o, "license").into());
    out.insert("mcVersion".into(), str_field(o, "mcVersion").into());
    let src = o.get("sourceUrl").and_then(Value::as_str).filter(|s| !s.is_empty());
    out.insert("sourceUrl".into(), src.map_or(Value::Null, Value::from));
    out.insert("blockCount".into(), o.get("blockCount").and_then(Value::as_u64).unwrap_or(0).into());
    if !o.get("thumb").is_some_and(Value::is_string) {
        out.remove("thumb");
    }
    Some(Value::Object(out))
}

/// Validates the catalog and drops/defaults malformed entries; returns the normalized catalog.
fn parse_catalog(text: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(text).map_err(|_| ERR_BAD_CATALOG.to_string())?;
    if v.get("version").and_then(Value::as_i64) != Some(1) {
        return Err(ERR_BAD_CATALOG.into());
    }
    let raw_items = v.get("items").and_then(Value::as_array).ok_or(ERR_BAD_CATALOG)?;
    let mut seen = std::collections::HashSet::new();
    let items: Vec<Value> = raw_items
        .iter()
        .filter_map(norm_item)
        .filter(|i| seen.insert(i["id"].as_str().unwrap_or_default().to_string()))
        .collect();
    let categories: Vec<Value> = v
        .get("categories")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    let id = c.get("id").and_then(Value::as_str).filter(|i| !i.is_empty())?;
                    let name = norm_localized(c.get("name"))?;
                    Some(serde_json::json!({ "id": id, "name": name }))
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(serde_json::json!({
        "version": 1,
        "updatedAt": v.get("updatedAt").and_then(Value::as_str).unwrap_or(""),
        "baseUrl": v.get("baseUrl").and_then(Value::as_str).unwrap_or(""),
        "categories": categories,
        "items": items,
    }))
}

fn cache_fresh(path: &Path) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < CATALOG_TTL)
}

/// Serializes catalog fetches so concurrent callers wait for a single one.
static CATALOG_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn read_cached(cache_path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(cache_path).ok()?;
    parse_catalog(&text).ok().map(|c| c.to_string())
}

/// Cached catalog regardless of TTL (thumbnails); fetches only when no cache exists.
async fn load_catalog_cached(cache_path: &Path) -> Result<String, String> {
    match read_cached(cache_path) {
        Some(t) => Ok(t),
        None => load_catalog(cache_path, false).await.map(|(t, _)| t),
    }
}

/// Returns the normalized catalog JSON text and whether it is a stale fallback
/// (fetch failed, cache used), using `cache_path` as cache.
async fn load_catalog(cache_path: &Path, force: bool) -> Result<(String, bool), String> {
    let _guard = CATALOG_LOCK.lock().await;
    if !force && cache_fresh(cache_path) {
        if let Some(t) = read_cached(cache_path) {
            return Ok((t, false));
        }
    }
    let fetched = async {
        let bytes = fetch_bytes(&catalog_source(), CATALOG_TIMEOUT, MAX_CATALOG_BYTES).await?;
        let text = String::from_utf8(bytes).map_err(|_| ERR_BAD_CATALOG.to_string())?;
        Ok::<_, String>(parse_catalog(&text)?.to_string())
    }
    .await;
    match fetched {
        Ok(text) => {
            if let Some(parent) = cache_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = crate::paths::write_atomic(cache_path, &text);
            Ok((text, false))
        }
        Err(e) => {
            eprintln!("schematic catalog: fetch failed: {e}");
            read_cached(cache_path).map(|t| (t, true)).ok_or_else(|| ERR_OFFLINE.to_string())
        }
    }
}

fn valid_item_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// `^[a-z0-9_\-/]+\.<ext>$` with no empty segments, no leading slash, no "..".
/// Returns the extension on success.
fn valid_rel_path<'a>(path: &'a str, exts: &[&'a str]) -> Option<&'a str> {
    let (stem, ext) = path.rsplit_once('.')?;
    if !exts.contains(&ext) || stem.is_empty() || stem.contains("..") {
        return None;
    }
    if !stem
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-' || c == '/')
    {
        return None;
    }
    if stem.split('/').any(str::is_empty) {
        return None;
    }
    Some(ext)
}

fn base_url(cat: &Value) -> Result<String, String> {
    let b = cat
        .get("baseUrl")
        .and_then(Value::as_str)
        .filter(|b| !b.is_empty())
        .ok_or(ERR_BAD_CATALOG)?;
    Ok(if b.ends_with('/') { b.to_string() } else { format!("{b}/") })
}

fn find_item<'a>(cat: &'a Value, id: &str) -> Option<&'a Value> {
    cat.get("items")?
        .as_array()?
        .iter()
        .find(|i| i.get("id").and_then(Value::as_str) == Some(id))
}

fn localized(v: Option<&Value>, locale: &str) -> Option<String> {
    let v = v?;
    let (first, second) = if locale.to_lowercase().starts_with("ru") {
        ("ru", "en")
    } else {
        ("en", "ru")
    };
    [first, second]
        .iter()
        .find_map(|k| v.get(*k).and_then(Value::as_str).filter(|s| !s.trim().is_empty()))
        .map(str::to_string)
}

fn opt_str(item: &Value, key: &str) -> Option<String> {
    item.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

async fn install_core(
    lib_dir: &Path,
    catalog: &str,
    item_id: &str,
    locale: &str,
) -> Result<SchematicEntry, String> {
    if !valid_item_id(item_id) {
        return Err(ERR_BAD_PATH.into());
    }
    if let Some(e) = super::find_by_catalog_id(lib_dir, item_id) {
        return Ok(e);
    }
    let cat = parse_catalog(catalog)?;
    let item = find_item(&cat, item_id).ok_or(ERR_NO_ITEM)?;
    let file = item.get("file").and_then(Value::as_str).ok_or(ERR_BAD_CATALOG)?;
    let ext = valid_rel_path(file, &["schem", "litematic", "nbt"]).ok_or(ERR_BAD_PATH)?;
    let url = format!("{}{}", base_url(&cat)?, file);
    let data = fetch_bytes(&url, FILE_TIMEOUT, MAX_FILE_BYTES).await?;
    if let Some(n) = item.get("bytes").and_then(Value::as_u64) {
        if n != data.len() as u64 {
            return Err(ERR_SIZE.into());
        }
    }
    let want = item
        .get("sha256")
        .and_then(Value::as_str)
        .ok_or(ERR_BAD_CATALOG)?
        .to_lowercase();
    if hex(&Sha256::digest(&data)) != want {
        return Err(ERR_SUM.into());
    }
    let name = localized(item.get("name"), locale).unwrap_or_else(|| item_id.to_string());
    let meta = CatalogMeta {
        catalog_id: item_id.to_string(),
        author: opt_str(item, "author"),
        license: opt_str(item, "license"),
        source_url: opt_str(item, "sourceUrl"),
    };
    let (dir, ext) = (lib_dir.to_path_buf(), ext.to_string());
    tokio::task::spawn_blocking(move || super::import_bytes(&dir, &data, &name, &ext, Some(meta)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn schematic_catalog(app: AppHandle, force: bool) -> Result<String, String> {
    let path = cache_dir(&app)?.join("schematic-catalog.json");
    let (catalog, stale) = load_catalog(&path, force).await?;
    Ok(format!(r#"{{"stale":{stale},"catalog":{catalog}}}"#))
}

#[tauri::command]
pub async fn schematic_catalog_thumb(app: AppHandle, item_id: String) -> Result<Option<String>, String> {
    if !valid_item_id(&item_id) {
        return Err(ERR_BAD_PATH.into());
    }
    let cache = cache_dir(&app)?;
    let text = load_catalog_cached(&cache.join("schematic-catalog.json")).await?;
    let cat = parse_catalog(&text)?;
    let item = find_item(&cat, &item_id).ok_or(ERR_NO_ITEM)?;
    let Some(thumb) = item.get("thumb").and_then(Value::as_str).filter(|t| !t.is_empty()) else {
        return Ok(None);
    };
    valid_rel_path(thumb, &["png"]).ok_or(ERR_BAD_PATH)?;
    let thumbs = cache.join("schematic-thumbs");
    std::fs::create_dir_all(&thumbs).map_err(|e| e.to_string())?;
    let file = thumbs.join(format!("{item_id}.png"));
    let url = format!("{}{}", base_url(&cat)?, thumb);
    let data = match fetch_bytes(&url, CATALOG_TIMEOUT, MAX_THUMB_BYTES).await {
        Ok(d) => {
            let _ = crate::paths::write_atomic(&file, &d);
            d
        }
        Err(e) => match std::fs::read(&file) {
            Ok(d) => d,
            Err(_) => return Err(e),
        },
    };
    Ok(Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(data)
    )))
}

#[tauri::command]
pub async fn schematic_install(app: AppHandle, item_id: String, locale: String) -> Result<SchematicEntry, String> {
    let dir = super::lib_dir(&app)?;
    let cache_path = cache_dir(&app)?.join("schematic-catalog.json");
    let (mut text, stale) = load_catalog(&cache_path, false).await?;
    // Stale cache may predate the item: refresh once.
    if parse_catalog(&text).ok().and_then(|c| find_item(&c, &item_id).map(|_| ())).is_none() && !stale {
        text = load_catalog(&cache_path, true).await?.0;
    }
    match install_core(&dir, &text, &item_id, &locale).await {
        Err(e) if e == ERR_SIZE || e == ERR_SUM => {
            // The catalog may be outdated vs. the file: refresh once and retry.
            let (fresh, stale) = load_catalog(&cache_path, true).await?;
            if stale {
                return Err(e);
            }
            install_core(&dir, &fresh, &item_id, &locale).await
        }
        r => r,
    }
}

#[cfg(test)]
mod tests {
    use super::super::nbt::testutil::*;
    use super::*;

    const SAMPLE: &str = r#"{"version":1,"updatedAt":"x","baseUrl":"https://e.com/s/",
      "categories":[{"id":"houses","name":{"ru":"Дома","en":"Houses"}}],
      "items":[{"id":"cabin","category":"houses","name":{"ru":"Домик","en":"Cabin"},
      "file":"houses/cabin.schem","format":"schem","sha256":"00","bytes":1,"size":[1,1,1]}]}"#;

    #[test]
    fn id_and_path_validation() {
        assert!(valid_item_id("oak-starter_cabin1"));
        assert!(!valid_item_id(""));
        assert!(!valid_item_id("../x"));
        assert!(!valid_item_id("Cabin"));
        let ex = ["schem", "litematic", "nbt"];
        assert_eq!(valid_rel_path("houses/a-b_c.schem", &ex), Some("schem"));
        assert_eq!(valid_rel_path("a.nbt", &ex), Some("nbt"));
        assert_eq!(valid_rel_path("../a.schem", &ex), None);
        assert_eq!(valid_rel_path("/etc/a.schem", &ex), None);
        assert_eq!(valid_rel_path("a//b.schem", &ex), None);
        assert_eq!(valid_rel_path("a/..b.schem", &ex), None);
        assert_eq!(valid_rel_path("a.b.schem", &ex), None);
        assert_eq!(valid_rel_path("a.exe", &ex), None);
        assert_eq!(valid_rel_path("A.schem", &ex), None);
        assert_eq!(valid_rel_path("a/b.png", &["png"]), Some("png"));
    }

    #[test]
    fn catalog_parse() {
        let c = parse_catalog(SAMPLE).unwrap();
        assert!(find_item(&c, "cabin").is_some());
        assert!(find_item(&c, "nope").is_none());
        assert_eq!(base_url(&c).unwrap(), "https://e.com/s/");
        let item = find_item(&c, "cabin").unwrap();
        assert_eq!(localized(item.get("name"), "ru-RU").as_deref(), Some("Домик"));
        assert_eq!(localized(item.get("name"), "en").as_deref(), Some("Cabin"));
        assert!(parse_catalog(r#"{"version":2,"items":[]}"#).is_err());
        assert!(parse_catalog(r#"{"version":1}"#).is_err());
        assert!(parse_catalog("nope").is_err());
    }

    #[test]
    fn catalog_normalizes_and_drops_bad_items() {
        let c = parse_catalog(
            r#"{"version":1,"baseUrl":"https://e.com/","items":[
            {"id":"ok","category":"h","name":{"en":"A"},"file":"h/a.schem","sha256":"00","size":[1,2,3]},
            {"id":"Bad Id","category":"h","name":{"en":"A"},"file":"h/a.schem","sha256":"00","size":[1,2,3]},
            {"id":"nocat","name":{"en":"A"},"file":"h/a.schem","sha256":"00","size":[1,2,3]},
            {"id":"noname","category":"h","name":{},"file":"h/a.schem","sha256":"00","size":[1,2,3]},
            {"id":"badfile","category":"h","name":{"en":"A"},"file":"../a.schem","sha256":"00","size":[1,2,3]},
            {"id":"nosha","category":"h","name":{"en":"A"},"file":"h/a.schem","size":[1,2,3]},
            {"id":"badsize","category":"h","name":{"en":"A"},"file":"h/a.schem","sha256":"00","size":[1,0,3]},
            {"id":"ok","category":"h","name":{"en":"dup"},"file":"h/a.schem","sha256":"00","size":[1,2,3]},
            7]}"#,
        )
        .unwrap();
        let items = c["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        let i = &items[0];
        assert_eq!(i["tags"], serde_json::json!([]));
        assert_eq!(i["description"], serde_json::json!({}));
        assert_eq!(i["difficulty"], "easy");
        assert_eq!(i["author"], "");
        assert_eq!(i["license"], "");
        assert!(i["sourceUrl"].is_null());
        assert_eq!(i["blockCount"], 0);
        assert_eq!(c["categories"], serde_json::json!([]));
    }

    #[test]
    fn https_only_without_override() {
        assert!(src_allowed("https://e.com/a.json", false));
        assert!(!src_allowed("http://e.com/a.json", false));
        assert!(!src_allowed("file:///tmp/a.json", false));
        assert!(!src_allowed("/tmp/a.json", false));
        assert!(src_allowed("file:///tmp/a.json", true));
    }

    #[tokio::test]
    async fn install_from_local_catalog() {
        std::env::set_var(CATALOG_ENV, "local-test");
        let root = std::env::temp_dir().join(format!("remined-schem-test-{}", uuid::Uuid::new_v4().simple()));
        let store = root.join("store");
        let lib = root.join("lib");
        std::fs::create_dir_all(store.join("houses")).unwrap();
        std::fs::create_dir_all(&lib).unwrap();

        let mut b = Vec::new();
        compound(&mut b, "Schematic");
        short(&mut b, "Width", 2);
        short(&mut b, "Height", 1);
        short(&mut b, "Length", 1);
        compound(&mut b, "Palette");
        int(&mut b, "minecraft:air", 0);
        int(&mut b, "minecraft:stone", 1);
        end(&mut b);
        bytes(&mut b, "BlockData", &[1, 0]);
        end(&mut b);
        std::fs::write(store.join("houses/cabin.schem"), &b).unwrap();

        let catalog = |sha: &str| {
            format!(
                r#"{{"version":1,"baseUrl":"file://{}/","items":[{{"id":"cabin","name":{{"ru":"Домик","en":"Cabin"}},
                "category":"houses","size":[2,1,1],"file":"houses/cabin.schem","sha256":"{sha}","bytes":{},"author":"Remined","license":"CC0-1.0"}}]}}"#,
                store.display(),
                b.len()
            )
        };
        let bad = install_core(&lib, &catalog("00"), "cabin", "en").await;
        assert!(bad.unwrap_err().contains("Checksum"));

        let good = catalog(&hex(&Sha256::digest(&b)));
        let e = install_core(&lib, &good, "cabin", "ru-RU").await.unwrap();
        assert_eq!(e.name, "Домик");
        assert_eq!(e.catalog_id.as_deref(), Some("cabin"));
        assert_eq!(e.author.as_deref(), Some("Remined"));
        assert_eq!(e.license.as_deref(), Some("CC0-1.0"));
        assert_eq!(e.block_count, 1);
        assert_eq!(e.size, [2, 1, 1]);

        let again = install_core(&lib, &good, "cabin", "en").await.unwrap();
        assert_eq!(again.id, e.id);
        assert!(install_core(&lib, &good, "missing", "en").await.is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
