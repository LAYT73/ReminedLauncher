//! Vanilla block assets bundle (blockstates, models, textures, names) built from the client jar.

use base64::Engine;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::AppHandle;

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
/// Bump when the bundle shape changes so old cached bundles are ignored.
const BUNDLE_FORMAT: &str = "v3";
const RESOURCES_URL: &str = "https://resources.download.minecraft.net";

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn cache_dir(root: &Path) -> PathBuf {
    root.join(".remined").join("cache").join("schematic-assets")
}

fn valid_version(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 64
        && !v.starts_with('.')
        && v.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn mtime(p: &Path) -> Option<std::time::SystemTime> {
    fs::metadata(p).and_then(|m| m.modified()).ok()
}

fn http() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(240))
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("RemINed-Launcher")
        .build()
        .map_err(|e| e.to_string())
}

fn get_bytes(c: &reqwest::blocking::Client, url: &str) -> Result<Vec<u8>, String> {
    let r = c
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("{url}: {e}"))?;
    r.bytes().map(|b| b.to_vec()).map_err(|e| e.to_string())
}

fn get_json(c: &reqwest::blocking::Client, url: &str) -> Result<Value, String> {
    serde_json::from_slice(&get_bytes(c, url)?).map_err(|e| e.to_string())
}

fn pack_meta_matches(dir: &Path, version: &str) -> bool {
    let meta = ["\u{2e}remined-pack.json", "meta.json"]
        .iter()
        .find_map(|n| fs::read(dir.join(n)).ok())
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    let Some(Value::Object(m)) = meta else { return false };
    ["version", "mcVersion", "minecraftVersion", "gameVersion", "minecraft", "mc_version"]
        .iter()
        .any(|k| m.get(*k).and_then(|v| v.as_str()) == Some(version))
}

/// Returns (jar, dir containing it).
fn find_local_jar(root: &Path, version: &str) -> Option<(PathBuf, PathBuf)> {
    let packs = root.join("packs");
    let jar_name = format!("{version}.jar");
    let direct = packs.join(format!("vanilla-{version}"));
    if direct.join(&jar_name).is_file() {
        return Some((direct.join(&jar_name), direct));
    }
    let dirs: Vec<PathBuf> = fs::read_dir(&packs)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    for d in &dirs {
        if d.join(&jar_name).is_file() {
            return Some((d.join(&jar_name), d.clone()));
        }
    }
    for d in &dirs {
        if d.join("VanillaPro.jar").is_file() && pack_meta_matches(d, version) {
            return Some((d.join("VanillaPro.jar"), d.clone()));
        }
    }
    None
}

fn version_json_from_manifest(c: &reqwest::blocking::Client, version: &str) -> Result<Value, String> {
    let manifest = get_json(c, MANIFEST_URL)?;
    let url = manifest["versions"]
        .as_array()
        .and_then(|a| a.iter().find(|v| v["id"].as_str() == Some(version)))
        .and_then(|v| v["url"].as_str())
        .ok_or_else(|| format!("Версия {version} не найдена / Version {version} not found"))?
        .to_string();
    get_json(c, &url)
}

fn download_client_jar(cache: &Path, version: &str) -> Result<PathBuf, String> {
    let dest = cache.join(format!("{version}-client.jar"));
    if dest.is_file() {
        return Ok(dest);
    }
    let c = http()?;
    let vj = version_json_from_manifest(&c, version)?;
    let url = vj["downloads"]["client"]["url"]
        .as_str()
        .ok_or("version JSON has no client download")?;
    let bytes = get_bytes(&c, url)?;
    // sha1 verification skipped: no sha1 crate is a direct dependency.
    crate::paths::write_atomic(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest)
}

fn include_entity(rel: &str) -> bool {
    const PREFIXES: &[&str] = &[
        "entity/chest/",
        "entity/bed/",
        "entity/signs/",
        "entity/banner/",
        "entity/shulker/",
        "entity/decorated_pot/",
        "entity/conduit/",
        "entity/bell/",
    ];
    const EXACT: &[&str] = &[
        "entity/banner_base.png",
        "entity/enchanting_table_book.png",
        "entity/end_portal.png",
        "entity/skeleton/skeleton.png",
        "entity/skeleton/wither_skeleton.png",
        "entity/zombie/zombie.png",
        "entity/creeper/creeper.png",
        "entity/piglin/piglin.png",
        "entity/enderdragon/dragon.png",
        "entity/player/wide/steve.png",
    ];
    EXACT.contains(&rel) || PREFIXES.iter().any(|p| rel.starts_with(p))
}

fn lang_names(
    v: &Value,
    blocks: &mut BTreeMap<String, String>,
    items: &mut BTreeMap<String, String>,
) {
    if let Some(m) = v.as_object() {
        for (k, val) in m {
            let Some(s) = val.as_str() else { continue };
            if let Some(name) = k.strip_prefix("block.minecraft.") {
                blocks.insert(name.to_string(), s.to_string());
            } else if let Some(name) = k.strip_prefix("item.minecraft.") {
                items.insert(name.to_string(), s.to_string());
            }
        }
    }
}

/// Download (or reuse cached) ru_ru.json for the version. Errors are non-fatal for callers.
fn fetch_ru_lang(cache: &Path, version: &str, pack_dir: Option<&Path>) -> Result<Value, String> {
    let dest = cache.join(format!("{version}-ru_ru.json"));
    if let Ok(b) = fs::read(&dest) {
        if let Ok(v) = serde_json::from_slice::<Value>(&b) {
            return Ok(v);
        }
    }
    let c = http()?;
    let local = pack_dir
        .map(|d| d.join(format!("{version}.json")))
        .and_then(|p| fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .filter(|v| v["assetIndex"]["url"].is_string());
    let vj = match local {
        Some(v) => v,
        None => version_json_from_manifest(&c, version)?,
    };
    let idx_url = vj["assetIndex"]["url"].as_str().ok_or("no assetIndex url")?;
    let idx = get_json(&c, idx_url)?;
    let hash = idx["objects"]["minecraft/lang/ru_ru.json"]["hash"]
        .as_str()
        .filter(|h| h.len() >= 2 && h.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or("ru_ru.json not in asset index")?;
    let bytes = get_bytes(&c, &format!("{RESOURCES_URL}/{}/{hash}", &hash[..2]))?;
    let v: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let _ = crate::paths::write_atomic(&dest, bytes);
    Ok(v)
}

fn build_bundle(root: &Path, version: &str, locale: &str) -> Result<PathBuf, String> {
    let cache = cache_dir(root);
    fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let bundle = cache.join(format!("{version}-{locale}-{BUNDLE_FORMAT}.json"));
    let partial = cache.join(format!("{version}-{locale}-{BUNDLE_FORMAT}.partial"));

    let local = find_local_jar(root, version);
    let cached_jar = cache.join(format!("{version}-client.jar"));
    let jar_for_check = local
        .as_ref()
        .map(|(j, _)| j.clone())
        .or_else(|| cached_jar.is_file().then(|| cached_jar.clone()));

    // A `.partial` marker means ru names failed to fetch; retry only every 10 minutes.
    let partial_recent = mtime(&partial)
        .and_then(|t| t.elapsed().ok())
        .map(|e| e < Duration::from_secs(600))
        .unwrap_or(false);
    if bundle.is_file() && (!partial.exists() || partial_recent) {
        let fresh = match &jar_for_check {
            Some(j) => matches!((mtime(&bundle), mtime(j)), (Some(b), Some(j)) if b >= j),
            None => true,
        };
        if fresh {
            return Ok(bundle);
        }
    }

    let (jar, pack_dir) = match local {
        Some((j, d)) => (j, Some(d)),
        None => (download_client_jar(&cache, version)?, None),
    };

    let file = fs::File::open(&jar).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("jar: {e}"))?;

    let mut blockstates = Map::new();
    let mut models = Map::new();
    let mut textures = Map::new();
    let mut animated: Vec<String> = Vec::new();
    let mut colormaps = Map::new();
    let mut en_lang: Option<Value> = None;

    const BS: &str = "assets/minecraft/blockstates/";
    const MD: &str = "assets/minecraft/models/block/";
    const TX: &str = "assets/minecraft/textures/";

    for i in 0..zip.len() {
        let mut f = match zip.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        if !f.is_file() {
            continue;
        }
        let name = match f.name() {
            Ok(n) => n.into_owned(),
            Err(_) => continue,
        };
        let read = |f: &mut zip::read::ZipFile<'_, fs::File>| -> Option<Vec<u8>> {
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).ok()?;
            Some(buf)
        };
        if let Some(rest) = name.strip_prefix(BS).and_then(|r| r.strip_suffix(".json")) {
            if let Some(v) = read(&mut f).and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
                blockstates.insert(rest.to_string(), v);
            }
        } else if let Some(rest) = name.strip_prefix(MD).and_then(|r| r.strip_suffix(".json")) {
            if let Some(v) = read(&mut f).and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
                models.insert(format!("block/{rest}"), v);
            }
        } else if let Some(rel) = name.strip_prefix(TX) {
            if let Some(key) = rel.strip_suffix(".png.mcmeta") {
                if key.starts_with("block/") || include_entity(&format!("{key}.png")) {
                    animated.push(key.to_string());
                }
            } else if let Some(key) = rel.strip_suffix(".png") {
                if key.starts_with("block/") || key.starts_with("item/") || include_entity(rel) {
                    if let Some(b) = read(&mut f) {
                        textures.insert(key.to_string(), Value::String(b64(&b)));
                    }
                } else if key == "colormap/grass" || key == "colormap/foliage" {
                    if let Some(b) = read(&mut f) {
                        colormaps.insert(key["colormap/".len()..].to_string(), Value::String(b64(&b)));
                    }
                }
            }
        } else if name == "assets/minecraft/lang/en_us.json" {
            en_lang = read(&mut f).and_then(|b| serde_json::from_slice::<Value>(&b).ok());
        }
    }

    animated.sort();
    animated.dedup();
    // Keep only animated entries whose texture exists.
    animated.retain(|k| textures.contains_key(k));

    let mut names: BTreeMap<String, String> = BTreeMap::new();
    let mut item_names: BTreeMap<String, String> = BTreeMap::new();
    if let Some(v) = &en_lang {
        lang_names(v, &mut names, &mut item_names);
    }
    let mut ru_failed = false;
    if locale == "ru" {
        match fetch_ru_lang(&cache, version, pack_dir.as_deref()) {
            Ok(v) => lang_names(&v, &mut names, &mut item_names),
            Err(_) => ru_failed = true,
        }
    }

    let out = json!({
        "version": version,
        "blockstates": blockstates,
        "models": models,
        "textures": textures,
        "animated": animated,
        "colormaps": colormaps,
        "names": names,
        "itemNames": item_names,
    });
    let bytes = serde_json::to_vec(&out).map_err(|e| e.to_string())?;
    crate::paths::write_atomic(&bundle, bytes).map_err(|e| e.to_string())?;
    if ru_failed {
        // Retry the network on the next request.
        let _ = fs::write(&partial, b"");
    } else {
        let _ = fs::remove_file(&partial);
    }
    Ok(bundle)
}

/// Builds (or reuses) the assets bundle and returns the path of the cached JSON file.
#[tauri::command]
pub async fn schematic_assets(app: AppHandle, version: String, locale: String) -> Result<String, String> {
    if !valid_version(&version) {
        return Err("Bad version".into());
    }
    let locale = if locale.to_lowercase().starts_with("ru") { "ru" } else { "en" };
    let root = crate::paths::remined_root(&app)?;
    let p = tokio::task::spawn_blocking(move || build_bundle(&root, &version, locale))
        .await
        .map_err(|e| e.to_string())??;
    Ok(p.to_string_lossy().into_owned())
}

/// Reads a bundle file produced by `schematic_assets` (path must be inside the cache dir).
#[tauri::command]
pub async fn schematic_read_assets(app: AppHandle, path: String) -> Result<String, String> {
    let root = crate::paths::remined_root(&app)?;
    tokio::task::spawn_blocking(move || {
        let dir = cache_dir(&root).canonicalize().map_err(|e| e.to_string())?;
        let p = PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?;
        if !p.starts_with(&dir) {
            return Err("Path is outside the assets cache".to_string());
        }
        fs::read_to_string(&p).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
