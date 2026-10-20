//! Remined Vanilla — Fabric + skins + performance mods on skin-compatible MC versions.

use crate::instance::{self, PackInstallMeta};
use crate::paths::pack_dir;
use crate::progress;
use crate::runtime;
use crate::vanilla;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use crate::progress::Ctx as AppHandle;

/// Intersection of SkinShuffle + CustomSkinLoader (Fabric), newest first.
const SUPPORTED_VERSIONS: &[&str] = &[
    "26.3", "26.2", "26.1.2", "26.1.1", "26.1", "1.21.11", "1.21.10", "1.21.9",
    "1.21.8", "1.21.7", "1.21.6", "1.21.5", "1.21.4", "1.21.3", "1.21.2", "1.21.1",
    "1.21", "1.20.6", "1.20.5", "1.20.4", "1.20.3", "1.20.2", "1.20.1", "1.20",
];

const MODRINTH_FABRIC_API: &str = "P7dR8mSH";
const MODRINTH_SKINSHUFFLE: &str = "skinshuffle";
const MODRINTH_CSL: &str = "customskinloader";
/// LAN World Plug-n-Play — Open to LAN can disable online-mode (required for Remined offline).
const MODRINTH_MCWIFIPNP: &str = "RTWpcTBp";

const MODRINTH_SODIUM: &str = "AANobbMI";
const MODRINTH_IRIS: &str = "YL57xq9U";
/// Required by Resourcify (and other Kotlin Fabric mods).
const MODRINTH_FLK: &str = "Ha28R6CL";
const MODRINTH_RESOURCIFY: &str = "RLzHAoZe";

/// Opti stack mirrors the two Remined optimization catalogs:
/// - **classic** (`1.20*`): ModernFix + Starlight + Memory Leak Fix
/// - **modern** (`26*`): AsyncParticles + BadOptimizations + ScalableLux + Async
/// - **hybrid** (`1.21*`): modern extras when available, else classic lighting/fix mods
///
/// Sodium + Iris are installed separately (pinned pair). Each entry is skipped if
/// Modrinth has no Fabric build for that MC version.

const MODRINTH_C2ME: &str = "VSNURh3q";
const MODRINTH_SODIUM_EXTRA: &str = "PtjYWJkn";
const MODRINTH_MORE_CULLING: &str = "51shyZVL";

/// Recommended row (both catalogs).
const OPTI_RECOMMENDED: &[(&str, &str)] = &[
    ("gvQqBUqZ", "Lithium"),
    ("uXXizFIs", "FerriteCore"),
    ("NNAgCjsB", "Entity Culling"),
    ("5ZwdcRci", "ImmediatelyFast"),
    ("fQEb0iXm", "Krypton"),
    (MODRINTH_MORE_CULLING, "More Culling"),
];

/// 1.20-catalog extras (ModernFix / Starlight).
/// Memory Leak Fix omitted — breaks mixin prepare on 1.20 (+ takes down C2ME preLaunch).
const OPTI_CLASSIC_EXTRA: &[(&str, &str)] = &[
    ("nmDcB62a", "ModernFix"),
    ("H8CaAYZC", "Starlight"),
];

/// 26.x-catalog extras (screenshot: AsyncParticles / BadOptimizations / ScalableLux / Async).
const OPTI_MODERN_EXTRA: &[(&str, &str)] = &[
    ("c3onkd5k", "AsyncParticles"),
    ("g96Z4WVZ", "BadOptimizations"),
    ("Ps1zyz6x", "ScalableLux"),
    ("vEC2jm6I", "Async"),
];

/// C2ME — only when Java 25+ (natives-math module rejects Java 21).
const OPTI_C2ME: (&str, &str) = (MODRINTH_C2ME, "C2ME");

/// Additional row shared by both catalogs + Remined extras (Resourcify).
const OPTI_ADDITIONAL: &[(&str, &str)] = &[
    ("LQ3K71Q1", "Dynamic FPS"),
    ("vE2FN5qn", "Let Me Despawn"),
    ("GNxdLCoP", "Cull Leaves"),
    (MODRINTH_SODIUM_EXTRA, "Sodium Extra"),
    (MODRINTH_FLK, "Fabric Language Kotlin"),
    (MODRINTH_RESOURCIFY, "Resourcify"),
];

/// Jar filename markers for Remined-managed mods (cleanup / presence checks).
const MANAGED_MOD_MARKERS: &[&str] = &[
    "fabric-api",
    "skinshuffle",
    "customskinloader",
    "mcwifipnp",
    "sodium",
    "iris",
    "lithium",
    "entityculling",
    "entity-culling",
    "ferritecore",
    "ferrite-core",
    "immediatelyfast",
    "immediately-fast",
    "krypton",
    "moreculling",
    "more-culling",
    "asyncparticles",
    "async-particles",
    "c2me",
    "dynamic-fps",
    "dynamicfps",
    "badoptimizations",
    "bad-optimizations",
    "letmedespawn",
    "let-me-despawn",
    "scalablelux",
    "cullleaves",
    "cull-leaves",
    // bare "async" is too broad — jar is usually `async-*.jar` / `Async-*.jar`
    "async-",
    "sodiumextra",
    "sodium-extra",
    "modernfix",
    "modern-fix",
    "starlight",
    "fabric-language-kotlin",
    "resourcify",
    "almanac",
    "cloth-config",
    "clothconfig",
];

#[derive(Clone, Copy)]
enum OptiFamily {
    /// 1.20.x catalog
    Classic,
    /// 26.x catalog
    Modern,
    /// 1.21.x — prefer modern extras, keep classic fallbacks if missing
    Hybrid,
}

fn opti_family(game: &str) -> OptiFamily {
    if game.starts_with("26") {
        OptiFamily::Modern
    } else if game.starts_with("1.20") {
        OptiFamily::Classic
    } else {
        OptiFamily::Hybrid
    }
}

fn allow_c2me(game: &str, java_major: Option<u32>) -> bool {
    match java_major {
        Some(j) => j >= 25,
        // 26.x packs expect new Java; 1.20/1.21 typically ship with 17/21.
        None => matches!(opti_family(game), OptiFamily::Modern),
    }
}

fn opti_mod_list(game: &str, java_major: Option<u32>) -> Vec<(&'static str, &'static str)> {
    let mut out = Vec::new();
    out.extend_from_slice(OPTI_RECOMMENDED);
    match opti_family(game) {
        OptiFamily::Classic => out.extend_from_slice(OPTI_CLASSIC_EXTRA),
        OptiFamily::Modern => out.extend_from_slice(OPTI_MODERN_EXTRA),
        OptiFamily::Hybrid => {
            // Prefer 26-style extras; classic ModernFix / Starlight fill gaps via skip.
            out.extend_from_slice(OPTI_MODERN_EXTRA);
            out.extend_from_slice(OPTI_CLASSIC_EXTRA);
        }
    }
    if allow_c2me(game, java_major) {
        out.push(OPTI_C2ME);
    }
    out.extend_from_slice(OPTI_ADDITIONAL);
    if moreculling_broken_on(game) {
        out.retain(|(p, _)| *p != MODRINTH_MORE_CULLING);
    }
    if letmedespawn_broken_on(game) {
        out.retain(|(p, _)| *p != "vE2FN5qn");
    }
    out
}

/// Let Me Despawn pulls Almanac 1.21.1, whose `Entity#spawnAtLocation` mixin target changed in
/// 1.21.2 → "Mixin transformation of Entity failed" (smoke-verified). Optional mod → skip.
fn letmedespawn_broken_on(game: &str) -> bool {
    game == "1.21.2"
}

/// MoreCulling 0.25.0 (the only 1.20.5/1.20.6 build) ships a mixin plugin whose
/// conditional-mixin library is missing at load time → NoClassDefFoundError; on 1.21.2 only the
/// 1.21.3 build exists and its Sodium-compat mixin fails to inject (both smoke-verified).
fn moreculling_broken_on(game: &str) -> bool {
    matches!(game, "1.20.5" | "1.20.6" | "1.21.2")
}

/// Hints for picking Modrinth builds that stay compatible with already-chosen Sodium.
#[derive(Clone, Copy, Default)]
struct ModrinthPickHints {
    sodium_maj_min: Option<(u32, u32)>,
}

/// Parse `0.X.Y` (Sodium / Sodium Extra line), ignoring Minecraft `1.21.1` style versions.
fn parse_zero_maj_min(s: &str) -> Option<(u32, u32)> {
    let n = s.to_ascii_lowercase();
    let bytes = n.as_bytes();
    let mut i = 0usize;
    while i + 2 < bytes.len() {
        if bytes[i] == b'0' && bytes[i + 1] == b'.' {
            let mut j = i + 2;
            let mut minor: u32 = 0;
            let mut saw_minor = false;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                saw_minor = true;
                minor = minor.saturating_mul(10).saturating_add((bytes[j] - b'0') as u32);
                j += 1;
            }
            if saw_minor && j < bytes.len() && bytes[j] == b'.' {
                j += 1;
                let mut patch: u32 = 0;
                let mut saw_patch = false;
                while j < bytes.len() && bytes[j].is_ascii_digit() {
                    saw_patch = true;
                    patch = patch.saturating_mul(10).saturating_add((bytes[j] - b'0') as u32);
                    j += 1;
                }
                if saw_patch {
                    let _ = patch;
                    return Some((0, minor));
                }
            }
        }
        i += 1;
    }
    None
}

fn detect_sodium_maj_min(mods_dir: &Path) -> Option<(u32, u32)> {
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return None;
    };
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_ascii_lowercase();
        if !name.ends_with(".jar")
            || !name.contains("sodium")
            || name.contains("sodium-extra")
            || name.contains("sodiumextra")
        {
            continue;
        }
        if let Some(mm) = parse_zero_maj_min(&name) {
            return Some(mm);
        }
    }
    None
}

/// First `X.Y.Z` in a string (stops at `-beta` / `+mc…`).
fn parse_first_semver(s: &str) -> Option<(u32, u32, u32)> {
    let bytes = s.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let mut j = i;
        let mut major: u32 = 0;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            major = major.saturating_mul(10).saturating_add((bytes[j] - b'0') as u32);
            j += 1;
        }
        if j >= bytes.len() || bytes[j] != b'.' {
            i += 1;
            continue;
        }
        j += 1;
        if j >= bytes.len() || !bytes[j].is_ascii_digit() {
            i += 1;
            continue;
        }
        let mut minor: u32 = 0;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            minor = minor.saturating_mul(10).saturating_add((bytes[j] - b'0') as u32);
            j += 1;
        }
        if j >= bytes.len() || bytes[j] != b'.' {
            i += 1;
            continue;
        }
        j += 1;
        if j >= bytes.len() || !bytes[j].is_ascii_digit() {
            i += 1;
            continue;
        }
        let mut patch: u32 = 0;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            patch = patch.saturating_mul(10).saturating_add((bytes[j] - b'0') as u32);
            j += 1;
        }
        return Some((major, minor, patch));
    }
    None
}

/// Iris 1.8.13+ requires Sodium 0.8; older release Iris (1.8.8) requires Sodium 0.6.x.
fn iris_needs_sodium_08(version_number: &str) -> bool {
    match parse_first_semver(version_number) {
        Some((1, 8, patch)) => patch >= 13,
        Some((1, minor, _)) => minor > 8,
        Some((major, _, _)) => major > 1,
        None => false,
    }
}

fn detect_iris_needs_sodium_08(mods_dir: &Path) -> Option<bool> {
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return None;
    };
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_ascii_lowercase();
        if !name.ends_with(".jar") || !name.contains("iris") {
            continue;
        }
        return Some(iris_needs_sodium_08(&name));
    }
    None
}

fn iris_sodium_line_mismatch(mods_dir: &Path) -> bool {
    let Some(need_08) = detect_iris_needs_sodium_08(mods_dir) else {
        return false;
    };
    let Some((0, sod_minor)) = detect_sodium_maj_min(mods_dir) else {
        return false;
    };
    if need_08 {
        sod_minor < 8
    } else {
        sod_minor >= 8
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminedVanillaVersionRow {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub release_time: String,
    pub pack_id: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminedVanillaListResponse {
    pub latest: String,
    pub versions: Vec<ReminedVanillaVersionRow>,
}

pub fn pack_id_for(version_id: &str) -> String {
    format!("remined-vanilla-{version_id}")
}

pub fn is_pack_id(pack_id: &str) -> bool {
    pack_id.starts_with("remined-vanilla-")
}

pub fn version_from_pack_id(pack_id: &str) -> Option<&str> {
    pack_id.strip_prefix("remined-vanilla-")
}

fn urlencoding_minimal(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("ReminedLauncher/0.1")
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())
}

pub async fn list_versions(root: &Path) -> Result<ReminedVanillaListResponse, String> {
    let manifest = vanilla::fetch_manifest().await?;
    let by_id: std::collections::HashMap<&str, &vanilla::VanillaVersionInfo> = manifest
        .versions
        .iter()
        .map(|v| (v.id.as_str(), v))
        .collect();

    let mut versions = Vec::new();
    for id in SUPPORTED_VERSIONS {
        let Some(info) = by_id.get(id) else {
            continue;
        };
        let pack_id = pack_id_for(id);
        let installed = instance::is_pack_installed(&pack_dir(root, &pack_id));
        versions.push(ReminedVanillaVersionRow {
            id: (*id).to_string(),
            version_type: info.version_type.clone(),
            release_time: info.release_time.clone(),
            pack_id,
            installed,
        });
    }

    let latest = versions
        .iter()
        .map(|v| v.id.clone())
        .next()
        .unwrap_or_else(|| "1.21.4".into());

    Ok(ReminedVanillaListResponse { latest, versions })
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

fn maven_name_to_path(name: &str) -> Option<String> {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let file = if parts.len() >= 4 {
        format!("{artifact}-{version}-{}.jar", parts[3])
    } else {
        format!("{artifact}-{version}.jar")
    };
    Some(format!("{group}/{artifact}/{version}/{file}"))
}

fn normalize_fabric_library(lib: &mut Value) {
    if lib.get("artifact").is_some() || lib.pointer("/downloads/artifact").is_some() {
        return;
    }
    let Some(name) = lib.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()) else {
        return;
    };
    let Some(rel) = maven_name_to_path(&name) else {
        return;
    };
    let base = lib
        .get("url")
        .and_then(|u| u.as_str())
        .unwrap_or("https://maven.fabricmc.net/");
    let base = if base.ends_with('/') {
        base.to_string()
    } else {
        format!("{base}/")
    };
    lib.as_object_mut().map(|o| {
        o.insert(
            "artifact".into(),
            json!({
                "path": rel,
                "url": format!("{base}{rel}"),
            }),
        );
    });
}

fn merge_arguments(mojang: &Value, fabric: &Value) -> Value {
    let mut out = mojang
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({ "game": [], "jvm": [] }));
    for key in ["jvm", "game"] {
        let mut merged = Vec::new();
        if let Some(arr) = fabric.pointer(&format!("/arguments/{key}")).and_then(|v| v.as_array())
        {
            merged.extend(arr.iter().cloned());
        }
        if let Some(arr) = mojang.pointer(&format!("/arguments/{key}")).and_then(|v| v.as_array())
        {
            merged.extend(arr.iter().cloned());
        }
        if let Some(obj) = out.as_object_mut() {
            obj.insert(key.into(), Value::Array(merged));
        }
    }
    out
}

fn merge_fabric_profile(mojang: Value, fabric: Value) -> Result<Value, String> {
    let mut out = mojang.clone();
    out["id"] = fabric
        .get("id")
        .cloned()
        .unwrap_or_else(|| json!("fabric-loader"));
    out["mainClass"] = fabric
        .get("mainClass")
        .cloned()
        .ok_or("Fabric profile missing mainClass")?;
    out["type"] = json!("release");

    let mut libs = Vec::new();
    if let Some(arr) = fabric.get("libraries").and_then(|v| v.as_array()) {
        for lib in arr {
            let mut lib = lib.clone();
            normalize_fabric_library(&mut lib);
            libs.push(lib);
        }
    }
    if let Some(arr) = mojang.get("libraries").and_then(|v| v.as_array()) {
        libs.extend(arr.iter().cloned());
    }
    out["libraries"] = Value::Array(libs);
    out["arguments"] = merge_arguments(&mojang, &fabric);
    Ok(out)
}

async fn pick_fabric_loader(client: &reqwest::Client, game: &str) -> Result<String, String> {
    let url = format!("https://meta.fabricmc.net/v2/versions/loader/{game}");
    let list: Vec<Value> = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if list.is_empty() {
        return Err(format!("No Fabric loader for {game}"));
    }
    let stable = list.iter().find(|e| {
        e.pointer("/loader/stable")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    });
    let entry = stable.or_else(|| list.first()).unwrap();
    entry
        .pointer("/loader/version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Fabric loader version missing".into())
}

async fn fetch_fabric_profile(
    client: &reqwest::Client,
    game: &str,
    loader: &str,
) -> Result<Value, String> {
    let url = format!("https://meta.fabricmc.net/v2/versions/loader/{game}/{loader}/profile/json");
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    resp.json().await.map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthVersionFile {
    url: String,
    filename: String,
    primary: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthDependency {
    version_id: Option<String>,
    project_id: Option<String>,
    dependency_type: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthVersion {
    #[allow(dead_code)]
    id: Option<String>,
    #[serde(default)]
    project_id: Option<String>,
    version_number: String,
    version_type: String,
    files: Vec<ModrinthVersionFile>,
    #[serde(default)]
    dependencies: Vec<ModrinthDependency>,
    #[serde(default)]
    game_versions: Vec<String>,
    #[allow(dead_code)]
    loaders: Vec<String>,
}

fn jar_name_is_managed(name_lower: &str) -> bool {
    MANAGED_MOD_MARKERS.iter().any(|m| name_lower.contains(m))
}

fn mods_dir_has_marker(mods_dir: &Path, markers: &[&str]) -> bool {
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return false;
    };
    rd.flatten().any(|e| {
        let name = e.file_name().to_string_lossy().to_ascii_lowercase();
        markers.iter().any(|m| name.contains(m))
    })
}

fn mods_dir_has_sodium(mods_dir: &Path) -> bool {
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return false;
    };
    rd.flatten().any(|e| {
        let name = e.file_name().to_string_lossy().to_ascii_lowercase();
        name.contains("sodium")
            && !name.contains("sodium-extra")
            && !name.contains("sodiumextra")
    })
}

fn clear_mod_jars_with_markers(mods_dir: &Path, markers: &[&str]) {
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return;
    };
    for ent in rd.flatten() {
        let path = ent.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if markers.iter().any(|m| name.contains(m)) {
            let _ = fs::remove_file(&path);
        }
    }
}

/// Clear Sodium jars without touching Sodium Extra.
fn clear_sodium_jars(mods_dir: &Path) {
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return;
    };
    for ent in rd.flatten() {
        let path = ent.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if name.contains("sodium")
            && !name.contains("sodium-extra")
            && !name.contains("sodiumextra")
        {
            let _ = fs::remove_file(&path);
        }
    }
}

fn clear_managed_mod_jars(mods_dir: &Path) -> Result<(), String> {
    if !mods_dir.is_dir() {
        return Ok(());
    }
    for ent in fs::read_dir(mods_dir).map_err(|e| e.to_string())? {
        let path = ent.map_err(|e| e.to_string())?.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if jar_name_is_managed(&name) {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

/// True when text mentions `game` exactly (so `1.20` ≠ `1.20.1`, and `1.20.x` ≠ exact).
fn version_mentions_exact_game(version_number: &str, game: &str) -> bool {
    let n = version_number.to_ascii_lowercase();
    let g = game.to_ascii_lowercase();
    let bytes = n.as_bytes();
    let mut start = 0usize;
    while start < n.len() {
        let Some(rel) = n[start..].find(&g) else {
            break;
        };
        let i = start + rel;
        let after = i + g.len();
        // Reject prefix matches like game=1.20 inside 1.20.1
        let longer_patch = matches!(bytes.get(after), Some(b'.'))
            && bytes
                .get(after + 1)
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false);
        // Reject family wildcards like 1.20.x / 1.20-x (More Culling uses these).
        let family_wildcard = matches!(bytes.get(after), Some(b'.') | Some(b'-'))
            && matches!(bytes.get(after + 1).copied(), Some(b'x') | Some(b'X'));
        if !longer_patch && !family_wildcard {
            return true;
        }
        start = i + 1;
    }
    false
}

fn modrinth_file_mentions_exact_game(ver: &ModrinthVersion, game: &str) -> bool {
    ver.files
        .iter()
        .any(|f| version_mentions_exact_game(&f.filename, game))
}

/// Higher is better: prefer jars named for this exact MC version, then tighter game_versions.
fn modrinth_game_fit_score(ver: &ModrinthVersion, game: &str) -> i32 {
    let mut score = 0i32;
    if modrinth_file_mentions_exact_game(ver, game) {
        score += 20;
    }
    if version_mentions_exact_game(&ver.version_number, game) {
        score += 8;
    }
    if ver.game_versions.iter().any(|g| g == game) {
        // Prefer narrower support ranges (1.20-only beats 1.20…1.20.4).
        score += 12_i32.saturating_sub(ver.game_versions.len() as i32);
        // Soft penalty for also supporting much newer patches in the same line.
        let newer = ver
            .game_versions
            .iter()
            .filter(|g| g.as_str() != game && g.starts_with(&format!("{game}.")))
            .count() as i32;
        score -= newer * 3;
    }
    score
}

fn pick_modrinth_file(ver: &ModrinthVersion) -> Option<&ModrinthVersionFile> {
    let primary = ver.files.iter().find(|f| f.primary).or_else(|| ver.files.first());
    // Prefer a Fabric jar that also names this exact game version when possible.
    // (Caller sorts versions; here we just pick a file within the chosen version.)
    ver.files
        .iter()
        .find(|f| {
            let n = f.filename.to_ascii_lowercase();
            n.contains("fabric") && !n.contains("forge")
        })
        .or(primary)
}

fn sort_modrinth_versions(versions: &mut [ModrinthVersion], game: &str, hints: ModrinthPickHints) {
    versions.sort_by(|a, b| {
        // Prefer dedicated Fabric builds over Universal (CSL publishes both).
        let fabric_pref = |v: &ModrinthVersion| -> i32 {
            let n = v.version_number.to_ascii_lowercase();
            let has_fabric_file = v.files.iter().any(|f| {
                let f = f.filename.to_ascii_lowercase();
                f.contains("fabric") && !f.contains("forge")
            });
            let mut score = 0i32;
            if n.contains("fabric") {
                score += 3;
            }
            if has_fabric_file {
                score += 2;
            }
            if n.contains("universal") {
                score -= 4;
            }
            score
        };
        let rank = |t: &str| match t {
            "release" => 0,
            "beta" => 1,
            _ => 2,
        };
        let prerelease_pen = |v: &ModrinthVersion| -> i32 {
            let n = v.version_number.to_ascii_lowercase();
            let mut pen = 0i32;
            if n.contains("beta") || n.contains("alpha") || n.contains("-rc") {
                pen -= 40;
            }
            if v.version_type != "release" {
                pen -= 10;
            }
            pen
        };
        // Sodium Extra tracks Sodium's 0.x line — keep them aligned (0.6 Extra with 0.6 Sodium).
        let sodium_align = |v: &ModrinthVersion| -> i32 {
            let Some(want) = hints.sodium_maj_min else {
                return 0;
            };
            let got = parse_zero_maj_min(&v.version_number).or_else(|| {
                v.files
                    .iter()
                    .find_map(|f| parse_zero_maj_min(&f.filename))
            });
            match got {
                Some(mm) if mm == want => 35,
                Some(_) => -30,
                None => 0,
            }
        };
        modrinth_game_fit_score(b, game)
            .cmp(&modrinth_game_fit_score(a, game))
            .then_with(|| sodium_align(b).cmp(&sodium_align(a)))
            .then_with(|| prerelease_pen(b).cmp(&prerelease_pen(a)))
            .then_with(|| fabric_pref(b).cmp(&fabric_pref(a)))
            .then_with(|| rank(&a.version_type).cmp(&rank(&b.version_type)))
            .then_with(|| b.version_number.cmp(&a.version_number))
    });
}

fn is_prerelease_modrinth(ver: &ModrinthVersion) -> bool {
    let n = ver.version_number.to_ascii_lowercase();
    ver.version_type != "release"
        || n.contains("beta")
        || n.contains("alpha")
        || n.contains("-rc")
        || ver.files.iter().any(|f| {
            let f = f.filename.to_ascii_lowercase();
            f.contains("beta") || f.contains("alpha") || f.contains("-rc")
        })
}

fn version_zero_maj_min(ver: &ModrinthVersion) -> Option<(u32, u32)> {
    parse_zero_maj_min(&ver.version_number).or_else(|| {
        ver.files
            .iter()
            .find_map(|f| parse_zero_maj_min(&f.filename))
    })
}

/// Drop incompatible candidates before sort (More Culling betas, wrong Sodium Extra line).
fn filter_modrinth_versions_for_project(
    project: &str,
    versions: &mut Vec<ModrinthVersion>,
    hints: ModrinthPickHints,
) {
    if project == MODRINTH_MORE_CULLING {
        let mut pool: Vec<ModrinthVersion> = versions
            .iter()
            .filter(|v| !is_prerelease_modrinth(v))
            .cloned()
            .collect();
        if pool.is_empty() {
            return;
        }
        // Sodium 0.6.9+ rejects More Culling < 1.0.4; More Culling 1.0.9+ rejects
        // Sodium ≤ 0.6.13. Sweet spot for Iris 1.8.8 + Sodium 0.6.x: 1.0.4 ..= 1.0.7.
        if hints.sodium_maj_min == Some((0, 6)) {
            let mid: Vec<ModrinthVersion> = pool
                .iter()
                .filter(|v| moreculling_ok_for_sodium_06(v))
                .cloned()
                .collect();
            if !mid.is_empty() {
                pool = mid;
            }
        }
        *versions = pool;
        return;
    }
    if project == MODRINTH_SODIUM_EXTRA || project == MODRINTH_SODIUM {
        if let Some(want) = hints.sodium_maj_min {
            let matched: Vec<ModrinthVersion> = versions
                .iter()
                .filter(|v| version_zero_maj_min(v) == Some(want))
                .cloned()
                .collect();
            if !matched.is_empty() {
                *versions = matched;
            }
        }
        // Never ship Sodium/Extra betas when a release exists on the same line.
        let releases: Vec<ModrinthVersion> = versions
            .iter()
            .filter(|v| !is_prerelease_modrinth(v))
            .cloned()
            .collect();
        if !releases.is_empty() {
            *versions = releases;
        }
    }
}

fn pick_hints_for_project(project: &str, base: ModrinthPickHints) -> ModrinthPickHints {
    // More Culling also needs the Sodium line hint (1.0.x vs 0.27.x).
    if project == MODRINTH_SODIUM_EXTRA
        || project == MODRINTH_SODIUM
        || project == MODRINTH_MORE_CULLING
    {
        base
    } else {
        ModrinthPickHints::default()
    }
}

fn sodium_jar_is_prerelease(mods_dir: &Path) -> bool {
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return false;
    };
    rd.flatten().any(|ent| {
        let name = ent.file_name().to_string_lossy().to_ascii_lowercase();
        name.ends_with(".jar")
            && name.contains("sodium")
            && !name.contains("sodium-extra")
            && !name.contains("sodiumextra")
            && (name.contains("beta") || name.contains("alpha") || name.contains("-rc"))
    })
}

/// More Culling versions that work with Sodium 0.6.x (Iris 1.8.8 stack).
fn moreculling_ok_for_sodium_06(ver: &ModrinthVersion) -> bool {
    let semver = parse_first_semver(&ver.version_number).or_else(|| {
        ver.files
            .iter()
            .find_map(|f| parse_first_semver(&f.filename))
    });
    matches!(semver, Some((1, 0, patch)) if (4..=7).contains(&patch))
}

fn moreculling_jar_wrong_for_sodium_06(mods_dir: &Path, markers: &[&str]) -> bool {
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return false;
    };
    rd.flatten().any(|ent| {
        let name = ent.file_name().to_string_lossy().to_ascii_lowercase();
        if !name.ends_with(".jar") || !markers.iter().any(|m| name.contains(m)) {
            return false;
        }
        // 0.27.x is too old for Sodium 0.6.9+; 1.0.9+ wants Sodium newer than 0.6.13.
        if name.contains("0.27") || name.contains("0.26") {
            return true;
        }
        if let Some((1, 0, patch)) = parse_first_semver(&name) {
            return !(4..=7).contains(&patch);
        }
        true
    })
}

async fn fetch_modrinth_versions(
    client: &reqwest::Client,
    project: &str,
    game: &str,
) -> Result<Vec<ModrinthVersion>, String> {
    let games = serde_json::to_string(&vec![game]).map_err(|e| e.to_string())?;
    let loaders = serde_json::to_string(&vec!["fabric"]).map_err(|e| e.to_string())?;
    let games_q = urlencoding_minimal(&games);
    let loaders_q = urlencoding_minimal(&loaders);
    let url = format!(
        "https://api.modrinth.com/v2/project/{project}/version?game_versions={games_q}&loaders={loaders_q}"
    );
    client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

async fn download_modrinth_version_file(
    client: &reqwest::Client,
    ver: &ModrinthVersion,
    mods_dir: &Path,
) -> Result<String, String> {
    let file = pick_modrinth_file(ver).ok_or_else(|| "Modrinth version has no files".to_string())?;
    fs::create_dir_all(mods_dir).map_err(|e| e.to_string())?;
    let dest = mods_dir.join(&file.filename);
    download_to_file(client, &file.url, &dest).await?;
    Ok(file.filename.clone())
}

async fn fetch_modrinth_version_by_id(
    client: &reqwest::Client,
    version_id: &str,
) -> Result<ModrinthVersion, String> {
    let url = format!("https://api.modrinth.com/v2/version/{version_id}");
    client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

async fn download_modrinth_version_id(
    client: &reqwest::Client,
    version_id: &str,
    mods_dir: &Path,
) -> Result<String, String> {
    let ver = fetch_modrinth_version_by_id(client, version_id).await?;
    download_modrinth_version_file(client, &ver, mods_dir).await
}

fn skip_auto_dep_project(project: &str) -> bool {
    matches!(
        project,
        MODRINTH_FABRIC_API
            | MODRINTH_SODIUM
            | MODRINTH_IRIS
            | MODRINTH_SKINSHUFFLE
            | MODRINTH_CSL
            | MODRINTH_MCWIFIPNP
            // Mod Menu is optional UI; don't force it into Remined Vanilla.
            | "mOgUt4GM"
    )
}

/// Shared across one install/ensure pass so the same required project is fetched once.
fn new_modrinth_resolved_set() -> HashSet<String> {
    HashSet::new()
}

/// Pull Modrinth `required` dependencies only; skip projects already in `resolved`.
async fn install_required_modrinth_deps(
    client: &reqwest::Client,
    ver: &ModrinthVersion,
    game: &str,
    mods_dir: &Path,
    resolved: &mut HashSet<String>,
    depth: u8,
) -> Result<(), String> {
    if depth >= 3 {
        return Ok(());
    }
    for dep in &ver.dependencies {
        if dep.dependency_type != "required" {
            continue;
        }
        let Some(project) = dep.project_id.as_deref() else {
            continue;
        };
        if skip_auto_dep_project(project) {
            continue;
        }
        // Two mods requiring cloth-config → download once.
        if resolved.contains(project) {
            continue;
        }
        if let Some(version_id) = dep.version_id.as_deref().filter(|s| !s.is_empty()) {
            match fetch_modrinth_version_by_id(client, version_id).await {
                Ok(dep_ver) => {
                    let pid = dep_ver
                        .project_id
                        .clone()
                        .unwrap_or_else(|| project.to_string());
                    if !resolved.insert(pid) {
                        continue;
                    }
                    let _ = download_modrinth_version_file(client, &dep_ver, mods_dir).await;
                    let _ = Box::pin(install_required_modrinth_deps(
                        client, &dep_ver, game, mods_dir, resolved, depth + 1,
                    ))
                    .await;
                }
                Err(_) => {
                    let _ = Box::pin(try_download_modrinth_mod_with_deps(
                        client,
                        project,
                        game,
                        mods_dir,
                        resolved,
                        ModrinthPickHints::default(),
                        depth + 1,
                    ))
                    .await;
                }
            }
        } else {
            let _ = Box::pin(try_download_modrinth_mod_with_deps(
                client,
                project,
                game,
                mods_dir,
                resolved,
                ModrinthPickHints::default(),
                depth + 1,
            ))
            .await;
        }
    }
    Ok(())
}

async fn download_modrinth_mod(
    client: &reqwest::Client,
    project: &str,
    game: &str,
    mods_dir: &Path,
) -> Result<String, String> {
    match try_download_modrinth_mod(client, project, game, mods_dir).await? {
        Some(name) => Ok(name),
        None => Err(format!("No Modrinth Fabric build of {project} for {game}")),
    }
}

/// Like [`download_modrinth_mod`], but returns `Ok(None)` when no Fabric build exists.
async fn try_download_modrinth_mod(
    client: &reqwest::Client,
    project: &str,
    game: &str,
    mods_dir: &Path,
) -> Result<Option<String>, String> {
    let mut resolved = new_modrinth_resolved_set();
    try_download_modrinth_mod_with_deps(
        client,
        project,
        game,
        mods_dir,
        &mut resolved,
        ModrinthPickHints::default(),
        0,
    )
    .await
}

/// Download a Fabric build and its required Modrinth dependencies (deduped via `resolved`).
async fn try_download_modrinth_mod_with_deps(
    client: &reqwest::Client,
    project: &str,
    game: &str,
    mods_dir: &Path,
    resolved: &mut HashSet<String>,
    hints: ModrinthPickHints,
    depth: u8,
) -> Result<Option<String>, String> {
    if !resolved.insert(project.to_string()) {
        return Ok(None);
    }
    let mut versions = fetch_modrinth_versions(client, project, game).await?;
    if versions.is_empty() {
        // Allow a later attempt if this project shows up again with a pin, etc.
        resolved.remove(project);
        return Ok(None);
    }
    let project_hints = pick_hints_for_project(project, hints);
    filter_modrinth_versions_for_project(project, &mut versions, project_hints);
    sort_modrinth_versions(&mut versions, game, project_hints);
    let ver = versions.swap_remove(0);
    // Replace prior jars for this project so 1.20.4 builds don't stack beside 1.20.
    let markers = markers_for_perf_project(project);
    if !markers.is_empty() {
        clear_mod_jars_with_markers(mods_dir, markers);
    }
    let name = download_modrinth_version_file(client, &ver, mods_dir).await?;
    let _ = install_required_modrinth_deps(client, &ver, game, mods_dir, resolved, depth).await;
    Ok(Some(name))
}

/// For an already-installed opti mod, still pull any missing required deps.
async fn ensure_modrinth_required_deps(
    client: &reqwest::Client,
    project: &str,
    game: &str,
    mods_dir: &Path,
    resolved: &mut HashSet<String>,
    hints: ModrinthPickHints,
) -> Result<(), String> {
    resolved.insert(project.to_string());
    let mut versions = fetch_modrinth_versions(client, project, game).await?;
    if versions.is_empty() {
        return Ok(());
    }
    let project_hints = pick_hints_for_project(project, hints);
    filter_modrinth_versions_for_project(project, &mut versions, project_hints);
    sort_modrinth_versions(&mut versions, game, project_hints);
    install_required_modrinth_deps(client, &versions[0], game, mods_dir, resolved, 0).await
}

/// Install Iris + matching Sodium. Prefers exact MC tags (1.20 ≠ 1.20.1) and honors
/// Iris→Sodium `version_id` pins from Modrinth so loader deps stay compatible.
async fn install_sodium_iris(
    app: &AppHandle,
    client: &reqwest::Client,
    game: &str,
    mods_dir: &Path,
) -> Result<(), String> {
    progress::emit(app, "pack", 52, "Downloading Iris…");
    let mut iris_versions = fetch_modrinth_versions(client, MODRINTH_IRIS, game).await?;
    if iris_versions.is_empty() {
        progress::emit(app, "pack", 52, format!("Iris unavailable for {game} — skipped"));
        // Still try Sodium alone for rendering wins.
        progress::emit(app, "pack", 54, "Downloading Sodium…");
        clear_sodium_jars(mods_dir);
        let _ = try_download_modrinth_mod(client, MODRINTH_SODIUM, game, mods_dir).await;
        return Ok(());
    }
    sort_modrinth_versions(&mut iris_versions, game, ModrinthPickHints::default());
    // Prefer exact MC + release Iris. (Iris 1.8.8 = Sodium 0.6.x; only 1.8.13+ wants 0.8.x,
    // and on 1.21.1 that line is still beta — stay on the stable release pair.)
    iris_versions.sort_by(|a, b| {
        let exact = |v: &ModrinthVersion| {
            (version_mentions_exact_game(&v.version_number, game)
                || modrinth_file_mentions_exact_game(v, game)) as i32
        };
        let release = |v: &ModrinthVersion| (v.version_type == "release") as i32;
        exact(b)
            .cmp(&exact(a))
            .then_with(|| release(b).cmp(&release(a)))
            .then_with(|| b.version_number.cmp(&a.version_number))
    });
    // Pair search: take the newest Iris whose own `fabric.mod.json` Sodium requirement is
    // satisfied by a Sodium build that exists for this Minecraft version. (Iris 1.11 wants
    // Sodium 0.9.x, which only exists for 26.1.2; 26.1.1 needs Iris 1.10.x + Sodium 0.8.9.)
    if let Some(pair) = find_iris_sodium_pair(client, game, mods_dir, &iris_versions).await {
        progress::check_cancelled()?;
        return pair;
    }
    let iris = iris_versions.swap_remove(0);
    clear_mod_jars_with_markers(mods_dir, &["iris"]);
    download_modrinth_version_file(client, &iris, mods_dir).await?;
    progress::check_cancelled()?;

    let sodium_pin = iris.dependencies.iter().find_map(|d| {
        if d.dependency_type == "required" && d.project_id.as_deref() == Some(MODRINTH_SODIUM) {
            d.version_id.clone().filter(|id| !id.is_empty())
        } else {
            None
        }
    });
    let sodium_line = if iris_needs_sodium_08(&iris.version_number) {
        (0, 8)
    } else {
        (0, 6)
    };

    progress::emit(app, "pack", 56, "Downloading Sodium…");
    clear_sodium_jars(mods_dir);
    // Prefer a Modrinth pin only when it already matches the Iris Sodium line.
    // Otherwise pick newest Sodium on that line (Iris 1.8.8 → 0.6.13, not latest 0.8.13).
    let mut used_pin = false;
    if let Some(version_id) = sodium_pin {
        if let Ok(pinned) = fetch_modrinth_version_by_id(client, &version_id).await {
            let pin_line = parse_zero_maj_min(&pinned.version_number).or_else(|| {
                pinned
                    .files
                    .iter()
                    .find_map(|f| parse_zero_maj_min(&f.filename))
            });
            if pin_line == Some(sodium_line) {
                download_modrinth_version_file(client, &pinned, mods_dir).await?;
                used_pin = true;
            }
        }
    }
    if !used_pin {
        let hints = ModrinthPickHints {
            sodium_maj_min: Some(sodium_line),
        };
        let mut resolved = new_modrinth_resolved_set();
        let _ = try_download_modrinth_mod_with_deps(
            client,
            MODRINTH_SODIUM,
            game,
            mods_dir,
            &mut resolved,
            hints,
            0,
        )
        .await?;
    }
    progress::check_cancelled()?;
    Ok(())
}

/// Returns `Some(result)` when a consistent Iris + Sodium pair was installed.
async fn find_iris_sodium_pair(
    client: &reqwest::Client,
    game: &str,
    mods_dir: &Path,
    iris_versions: &[ModrinthVersion],
) -> Option<Result<(), String>> {
    use crate::mod_audit::{read_jar_meta, version_matches};
    let mut sodium_versions = fetch_modrinth_versions(client, MODRINTH_SODIUM, game)
        .await
        .ok()?;
    sort_modrinth_versions(&mut sodium_versions, game, ModrinthPickHints::default());
    sodium_versions.retain(|v| !is_prerelease_modrinth(v));
    if sodium_versions.is_empty() {
        return None;
    }
    let sodium_semver = |v: &ModrinthVersion| -> Option<String> {
        let f = pick_modrinth_file(v)?;
        // Drop `mc1.20.2` style Minecraft tokens so the mod's own version is parsed.
        let lower = f.filename.to_ascii_lowercase();
        let mut cleaned = String::new();
        let mut it = lower.chars().peekable();
        while let Some(c) = it.next() {
            if c == 'm' && it.peek() == Some(&'c') {
                let mut look = it.clone();
                look.next();
                if look.peek().map(|d| d.is_ascii_digit()).unwrap_or(false) {
                    it.next();
                    while it.peek().map(|d| d.is_ascii_digit() || *d == '.').unwrap_or(false) {
                        it.next();
                    }
                    continue;
                }
            }
            cleaned.push(c);
        }
        let (a, b, c) = parse_first_semver(&cleaned)?;
        Some(format!("{a}.{b}.{c}"))
    };
    for iris in iris_versions.iter().take(8) {
        if iris.version_type != "release" {
            continue;
        }
        clear_mod_jars_with_markers(mods_dir, &["iris"]);
        let Ok(file) = download_modrinth_version_file(client, iris, mods_dir).await else {
            continue;
        };
        let Some(meta) = read_jar_meta(&mods_dir.join(&file)) else {
            continue;
        };
        let preds: Vec<String> = meta
            .depends
            .iter()
            .find(|(id, _)| id == "sodium")
            .map(|(_, p)| p.clone())
            .unwrap_or_default();
        let candidates: Vec<&ModrinthVersion> = sodium_versions
            .iter()
            .filter(|sv| {
                preds.is_empty()
                    || sodium_semver(sv)
                        .map(|ver| version_matches(&preds, &ver))
                        .unwrap_or(false)
            })
            .take(4)
            .collect();
        for sv in candidates {
            clear_sodium_jars(mods_dir);
            let Ok(sfile) = download_modrinth_version_file(client, sv, mods_dir).await else {
                continue;
            };
            // Verify the pair for real: no missing/wrong-version/breaks between iris & sodium.
            let mods = crate::mod_audit::read_mods_dir(mods_dir);
            let issues = crate::mod_audit::audit_issues(
                &mods,
                &crate::mod_audit::AuditEnv {
                    minecraft: game,
                    loader: None,
                    java_major: None,
                },
            );
            let bad = issues.iter().any(|i| {
                let involved = |id: &str| id == "iris" || id == "sodium";
                involved(&i.owner_id) && (involved(&i.dep) || i.dep.is_empty())
                    && !matches!(i.dep.as_str(), "minecraft" | "fabricloader" | "java")
            });
            if !bad {
                return Some(Ok(()));
            }
            let _ = fs::remove_file(mods_dir.join(&sfile));
        }
        let _ = fs::remove_file(mods_dir.join(&file));
    }
    clear_mod_jars_with_markers(mods_dir, &["iris"]);
    None
}

async fn download_optional_mod_list(
    app: &AppHandle,
    client: &reqwest::Client,
    game: &str,
    mods_dir: &Path,
    mods: &[(&str, &str)],
    hints: ModrinthPickHints,
    progress_start: u32,
    progress_end: u32,
) -> Result<(), String> {
    let mut resolved = new_modrinth_resolved_set();
    // Already handled outside this list (Sodium/Iris pair + core Remined jars).
    for id in [
        MODRINTH_FABRIC_API,
        MODRINTH_SODIUM,
        MODRINTH_IRIS,
        MODRINTH_SKINSHUFFLE,
        MODRINTH_CSL,
        MODRINTH_MCWIFIPNP,
    ] {
        resolved.insert(id.to_string());
    }

    let n = mods.len().max(1) as u32;
    for (i, (project, label)) in mods.iter().enumerate() {
        let pct = progress_start
            + ((progress_end.saturating_sub(progress_start)) * (i as u32)) / n;
        if resolved.contains(*project) {
            continue;
        }
        progress::emit(app, "pack", pct, format!("Downloading {label}…"));
        match try_download_modrinth_mod_with_deps(
            client, project, game, mods_dir, &mut resolved, hints, 0,
        )
        .await
        {
            Ok(Some(_)) => {}
            Ok(None) => {
                progress::emit(
                    app,
                    "pack",
                    pct,
                    format!("{label} unavailable for {game} — skipped"),
                );
            }
            Err(err) => {
                progress::emit(app, "pack", pct, format!("{label} skipped ({err})"));
            }
        }
        progress::check_cancelled()?;
    }
    Ok(())
}

async fn download_perf_mods(
    app: &AppHandle,
    client: &reqwest::Client,
    game: &str,
    mods_dir: &Path,
    java_major: Option<u32>,
    progress_start: u32,
    progress_end: u32,
) -> Result<(), String> {
    let _ = progress_start;
    install_sodium_iris(app, client, game, mods_dir).await?;
    let hints = ModrinthPickHints {
        sodium_maj_min: detect_sodium_maj_min(mods_dir),
    };
    let mods = opti_mod_list(game, java_major);
    download_optional_mod_list(app, client, game, mods_dir, &mods, hints, 58, progress_end)
        .await?;
    for removed in reconcile_stacks(mods_dir) {
        progress::emit(app, "pack", progress_end, format!("Dropped conflicting {removed}"));
    }
    Ok(())
}

fn markers_for_perf_project(project: &str) -> &'static [&'static str] {
    match project {
        "gvQqBUqZ" => &["lithium"],
        "NNAgCjsB" => &["entityculling", "entity-culling"],
        "uXXizFIs" => &["ferritecore", "ferrite-core"],
        "5ZwdcRci" => &["immediatelyfast", "immediately-fast"],
        "fQEb0iXm" => &["krypton"],
        MODRINTH_MORE_CULLING => &["moreculling", "more-culling"],
        "c3onkd5k" => &["asyncparticles", "async-particles"],
        MODRINTH_C2ME => &["c2me"],
        "LQ3K71Q1" => &["dynamic-fps", "dynamicfps"],
        "g96Z4WVZ" => &["badoptimizations", "bad-optimizations"],
        "vE2FN5qn" => &["letmedespawn", "let-me-despawn"],
        "Ps1zyz6x" => &["scalablelux"],
        "GNxdLCoP" => &["cullleaves", "cull-leaves"],
        "vEC2jm6I" => &["async-"],
        MODRINTH_SODIUM_EXTRA => &["sodiumextra", "sodium-extra"],
        "nmDcB62a" => &["modernfix", "modern-fix"],
        "H8CaAYZC" => &["starlight"],
        MODRINTH_FLK => &["fabric-language-kotlin"],
        MODRINTH_RESOURCIFY => &["resourcify"],
        _ => &[],
    }
}

fn iris_jar_mismatched_for_game(mods_dir: &Path, game: &str) -> bool {
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return true;
    };
    let mut found = false;
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_ascii_lowercase();
        if !name.contains("iris") || !name.ends_with(".jar") {
            continue;
        }
        found = true;
        // e.g. iris-mc1.20.1 on game 1.20 → incompatible Sodium pin risk
        if !version_mentions_exact_game(&name, game) {
            // Jar name can lag behind (Iris mc26.1.1 also runs on 26.1) — trust the
            // jar's own `minecraft` dependency range instead.
            let ok = crate::mod_audit::read_jar_meta(&ent.path())
                .and_then(|m| {
                    m.depends
                        .iter()
                        .find(|(id, _)| id == "minecraft")
                        .map(|(_, p)| crate::mod_audit::version_matches(p, game))
                })
                // No `minecraft` constraint declared: Modrinth listed this jar for `game`.
                .unwrap_or(true);
            if !ok {
                return true;
            }
        }
    }
    !found
}

/// True when a jar name targets a *newer patch* of `game` (e.g. `…1.20.4…` on game `1.20`).
fn jar_targets_newer_patch_of_game(name: &str, game: &str) -> bool {
    let n = name.to_ascii_lowercase();
    let g = game.to_ascii_lowercase();
    let bytes = n.as_bytes();
    let mut start = 0usize;
    while start < n.len() {
        let Some(rel) = n[start..].find(&g) else {
            break;
        };
        let i = start + rel;
        let after = i + g.len();
        if matches!(bytes.get(after), Some(b'.'))
            && bytes
                .get(after + 1)
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false)
        {
            return true;
        }
        start = i + 1;
    }
    false
}

/// True when an installed opti jar is clearly for a newer patch (More Culling 1.20.4 on 1.20).
fn opti_jars_mismatched_for_game(mods_dir: &Path, markers: &[&str], game: &str) -> bool {
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return false;
    };
    rd.flatten().any(|ent| {
        let name = ent.file_name().to_string_lossy().to_ascii_lowercase();
        name.ends_with(".jar")
            && markers.iter().any(|m| name.contains(m))
            && jar_targets_newer_patch_of_game(&name, game)
    })
}

/// Strip jars we used to ship but that crash certain MC lines (e.g. Memory Leak Fix on 1.20).
fn remove_known_bad_opti_jars(mods_dir: &Path, game: &str, java_major: Option<u32>) {
    clear_mod_jars_with_markers(mods_dir, &["memoryleakfix", "memory-leak-fix"]);
    if moreculling_broken_on(game) {
        clear_mod_jars_with_markers(mods_dir, &["moreculling", "more-culling"]);
    }
    if letmedespawn_broken_on(game) {
        clear_mod_jars_with_markers(mods_dir, &["letmedespawn", "let-me-despawn", "almanac"]);
    }
    // C2ME natives-math requires Java 25 — drop on Java 17/21 packs.
    if !allow_c2me(game, java_major) {
        clear_mod_jars_with_markers(mods_dir, &["c2me"]);
    }
}

fn names_have(names: &[String], markers: &[&str]) -> bool {
    names
        .iter()
        .any(|n| n.ends_with(".jar") && markers.iter().any(|m| n.contains(m)))
}

/// Marker groups to delete so one consistent stack remains (BUG-005).
/// Input: lowercase jar file names. Pure → unit-testable.
fn stack_conflict_removals(names: &[String]) -> Vec<&'static [&'static str]> {
    const STARLIGHT: &[&str] = &["starlight"];
    const MODERNFIX: &[&str] = &["modernfix", "modern-fix"];
    const RESOURCIFY: &[&str] = &["resourcify"];
    let mut out: Vec<&'static [&'static str]> = Vec::new();
    let has_scalable = names_have(names, &["scalablelux"]);
    let has_bad_opt = names_have(names, &["badoptimizations", "bad-optimizations"]);
    // Two lighting engines never coexist: prefer ScalableLux (modern) over Starlight.
    if has_scalable && names_have(names, STARLIGHT) {
        out.push(STARLIGHT);
    }
    // ModernFix and BadOptimizations overlap heavily → prefer the modern pick.
    if has_bad_opt && names_have(names, MODERNFIX) {
        out.push(MODERNFIX);
    }
    // ImmediatelyFast 1.2.x (the only 1.20.1 build) hooks Iris' old `net.coderbot.iris` package;
    // with Iris 1.7.x (`net.irisshaders`) the JVM dies right after window creation (smoke 1.20.1).
    if names_have(names, &["immediatelyfast-1.2.", "immediatelyfast-1.1.", "immediatelyfast-1.0."])
        && names_have(names, &["iris-1.7."])
    {
        out.push(&["immediatelyfast"]);
    }
    // Resourcify is a Kotlin mod.
    if names_have(names, RESOURCIFY) && !names_have(names, &["fabric-language-kotlin"]) {
        out.push(RESOURCIFY);
    }
    out
}

fn lower_jar_names(mods_dir: &Path) -> Vec<String> {
    fs::read_dir(mods_dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.file_name().to_string_lossy().to_ascii_lowercase())
                .collect()
        })
        .unwrap_or_default()
}

/// Apply [`stack_conflict_removals`] on disk. Returns removed marker labels.
fn reconcile_stacks(mods_dir: &Path) -> Vec<String> {
    let names = lower_jar_names(mods_dir);
    let mut removed = Vec::new();
    for markers in stack_conflict_removals(&names) {
        clear_mod_jars_with_markers(mods_dir, markers);
        removed.push(markers[0].to_string());
    }
    removed
}

/// Final gate: structural checks on the mods folder. Err = do not ship this install.
fn validate_mods_dir(mods_dir: &Path, game: &str) -> Result<(), String> {
    let names = lower_jar_names(mods_dir);
    let mut errs: Vec<String> = Vec::new();
    for (label, markers) in [
        ("Fabric API", &["fabric-api"][..]),
        ("SkinShuffle", &["skinshuffle"][..]),
        ("CustomSkinLoader", &["customskinloader"][..]),
    ] {
        if !names_have(&names, markers) {
            errs.push(format!("{label} jar is missing"));
        }
    }
    let has_iris = names_have(&names, &["iris"]);
    if has_iris && !mods_dir_has_sodium(mods_dir) {
        errs.push("Iris is installed without Sodium".into());
    }
    // Iris/Sodium compatibility is decided by the real dependency audit (fabric.mod.json),
    // not by jar-name heuristics.
    if has_iris && iris_jar_mismatched_for_game(mods_dir, game) {
        errs.push(format!("Iris jar does not target Minecraft {game}"));
    }
    if sodium_extra_line_mismatched(mods_dir, detect_sodium_maj_min(mods_dir)) {
        errs.push("Sodium Extra is on a different line than Sodium".into());
    }
    if !stack_conflict_removals(&names).is_empty() {
        errs.push("conflicting optimization stacks are still present".into());
    }
    if errs.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Remined Vanilla {game}: mod set is not safe to launch — {}. Reinstall, or report this version.",
            errs.join("; ")
        ))
    }
}

fn slug_for_mod_id(id: &str) -> String {
    match id {
        "yet_another_config_lib_v3" => "yacl".into(),
        "cloth-config" | "cloth-config2" => "cloth-config".into(),
        "owo" => "owo-lib".into(),
        "fabric" | "fabric-api" => "fabric-api".into(),
        other => other.replace('_', "-"),
    }
}

/// Mods we must never auto-drop (the launcher's identity).
fn is_core_mod_id(id: &str) -> bool {
    matches!(
        id,
        "fabric-api"
            | "fabric"
            | "skinshuffle"
            | "customskinloader"
            | "mcwifipnp"
            | "sodium"
            | "iris"
    ) || id.starts_with("fabric-")
}

/// Read every jar's `fabric.mod.json`, then fetch missing / too-old dependencies from Modrinth
/// or drop optional (non-core) mods that cannot be satisfied. Returns what was changed.
async fn repair_with_audit(
    app: &AppHandle,
    client: &reqwest::Client,
    game: &str,
    mods_dir: &Path,
    loader: &str,
    java_major: Option<u32>,
) -> Vec<String> {
    use crate::mod_audit::{self, AuditEnv, IssueKind};
    let mut notes: Vec<String> = Vec::new();
    let mut tried: HashSet<String> = HashSet::new();
    let env_loader = if loader.is_empty() { None } else { Some(loader) };
    for _round in 0..5 {
        let mods = mod_audit::read_mods_dir(mods_dir);
        let issues = mod_audit::audit_issues(
            &mods,
            &AuditEnv {
                minecraft: game,
                loader: env_loader,
                java_major,
            },
        );
        if issues.is_empty() {
            break;
        }
        let mut changed = false;
        for issue in issues {
            let owner_core = is_core_mod_id(&issue.owner_id);
            let drop_owner = |notes: &mut Vec<String>, why: &str| -> bool {
                if owner_core {
                    return false;
                }
                let path = mods_dir.join(&issue.owner_top_file);
                if path.is_file() && fs::remove_file(&path).is_ok() {
                    let msg = format!("dropped {} ({why})", issue.owner_top_file);
                    progress::emit(app, "pack", 31, format!("Removing {} — {why}", issue.owner_top_file));
                    notes.push(msg);
                    return true;
                }
                false
            };
            match issue.kind {
                IssueKind::Missing | IssueKind::WrongVersion => {
                    let builtin = matches!(
                        issue.dep.as_str(),
                        "minecraft" | "fabricloader" | "fabric-loader" | "java"
                    );
                    let key = format!("{:?}:{}", issue.kind, issue.dep);
                    if builtin || !tried.insert(key) {
                        changed |= drop_owner(&mut notes, &format!("needs {}", issue.dep));
                        continue;
                    }
                    // Sodium is pinned by the Iris pair chosen earlier — never bump it for a
                    // side mod (Sodium Extra); drop that side mod instead.
                    if issue.kind == IssueKind::WrongVersion
                        && matches!(issue.dep.as_str(), "sodium" | "iris")
                        && !owner_core
                    {
                        changed |= drop_owner(
                            &mut notes,
                            &format!("needs a different {}", issue.dep),
                        );
                        continue;
                    }
                    if issue.kind == IssueKind::WrongVersion {
                        match mods.iter().find(|m| m.id == issue.dep) {
                            Some(provider) => {
                                let _ = fs::remove_file(mods_dir.join(&provider.file));
                            }
                            None => {
                                changed |= drop_owner(&mut notes, &format!("needs {}", issue.dep));
                                continue;
                            }
                        }
                    }
                    let slug = slug_for_mod_id(&issue.dep);
                    let mut resolved = new_modrinth_resolved_set();
                    progress::emit(app, "pack", 31, format!("Resolving dependency {slug}…"));
                    match try_download_modrinth_mod_with_deps(
                        client,
                        &slug,
                        game,
                        mods_dir,
                        &mut resolved,
                        ModrinthPickHints::default(),
                        0,
                    )
                    .await
                    {
                        Ok(Some(name)) => {
                            notes.push(format!("installed {name} for {}", issue.owner_id));
                            changed = true;
                        }
                        _ => {
                            changed |=
                                drop_owner(&mut notes, &format!("{} unavailable for {game}", issue.dep));
                        }
                    }
                }
                IssueKind::Breaks | IssueKind::Duplicate => {
                    changed |= drop_owner(&mut notes, &format!("conflicts with {}", issue.dep));
                }
            }
        }
        if !changed {
            break;
        }
    }
    notes
}

fn write_mods_manifest(
    instance: &Path,
    game: &str,
    loader: &str,
    java_major: Option<u32>,
) -> Result<(), String> {
    let mods_dir = instance.join("mods");
    let mods = crate::mod_audit::read_mods_dir(&mods_dir);
    let manifest = json!({
        "game": game,
        "loader": loader,
        "java_major": java_major,
        "mods": crate::mod_audit::manifest_json(&mods, &mods_dir),
    });
    fs::write(
        instance.join("mods-manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn opti_jars_look_prerelease(mods_dir: &Path, markers: &[&str]) -> bool {
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return false;
    };
    rd.flatten().any(|ent| {
        let name = ent.file_name().to_string_lossy().to_ascii_lowercase();
        name.ends_with(".jar")
            && markers.iter().any(|m| name.contains(m))
            && (name.contains("beta") || name.contains("alpha") || name.contains("-rc"))
    })
}

fn sodium_extra_line_mismatched(mods_dir: &Path, want: Option<(u32, u32)>) -> bool {
    let Some(want) = want else {
        return false;
    };
    let Ok(rd) = fs::read_dir(mods_dir) else {
        return false;
    };
    rd.flatten().any(|ent| {
        let name = ent.file_name().to_string_lossy().to_ascii_lowercase();
        if !name.ends_with(".jar")
            || !(name.contains("sodium-extra") || name.contains("sodiumextra"))
        {
            return false;
        }
        match parse_zero_maj_min(&name) {
            Some(got) => got != want,
            None => false,
        }
    })
}

/// Retrofit / repair performance jars (incl. broken Sodium↔Iris pairs on older installs).
async fn ensure_perf_mods(
    app: &AppHandle,
    client: &reqwest::Client,
    game: &str,
    mods_dir: &Path,
    java_major: Option<u32>,
) -> Result<(), String> {
    if game.is_empty() {
        return Ok(());
    }
    remove_known_bad_opti_jars(mods_dir, game, java_major);
    let needs_pair = !mods_dir_has_sodium(mods_dir)
        || iris_jar_mismatched_for_game(mods_dir, game)
        || iris_sodium_line_mismatch(mods_dir)
        || sodium_jar_is_prerelease(mods_dir);
    if needs_pair {
        progress::emit(app, "pack", 42, "Fixing Sodium / Iris…");
        let _ = install_sodium_iris(app, client, game, mods_dir).await;
    }

    let hints = ModrinthPickHints {
        sodium_maj_min: detect_sodium_maj_min(mods_dir),
    };

    let mut resolved = new_modrinth_resolved_set();
    for id in [
        MODRINTH_FABRIC_API,
        MODRINTH_SODIUM,
        MODRINTH_IRIS,
        MODRINTH_SKINSHUFFLE,
        MODRINTH_CSL,
        MODRINTH_MCWIFIPNP,
    ] {
        resolved.insert(id.to_string());
    }

    for (project, label) in opti_mod_list(game, java_major) {
        let markers = markers_for_perf_project(project);
        if markers.is_empty() {
            continue;
        }
        let moreculling_wrong_gen = project == MODRINTH_MORE_CULLING
            && hints.sodium_maj_min == Some((0, 6))
            && moreculling_jar_wrong_for_sodium_06(mods_dir, markers);
        let mismatched = opti_jars_mismatched_for_game(mods_dir, markers, game)
            || (project == MODRINTH_MORE_CULLING && opti_jars_look_prerelease(mods_dir, markers))
            || moreculling_wrong_gen
            || (project == MODRINTH_SODIUM_EXTRA
                && sodium_extra_line_mismatched(mods_dir, hints.sodium_maj_min));
        if mods_dir_has_marker(mods_dir, markers) && !mismatched {
            // e.g. More Culling present but cloth-config missing after an older install.
            let _ = ensure_modrinth_required_deps(
                client, project, game, mods_dir, &mut resolved, hints,
            )
            .await;
            continue;
        }
        if resolved.contains(project) {
            continue;
        }
        if mismatched {
            progress::emit(app, "pack", 50, format!("Replacing {label} for {game}…"));
            resolved.remove(project);
        } else {
            progress::emit(app, "pack", 50, format!("Installing {label}…"));
        }
        let _ = try_download_modrinth_mod_with_deps(
            client, project, game, mods_dir, &mut resolved, hints, 0,
        )
        .await;
    }
    reconcile_stacks(mods_dir);
    Ok(())
}

/// Install Fabric runtime + skin mods into `packs/remined-vanilla-{id}`.
pub async fn install_version(
    app: &AppHandle,
    root: &Path,
    version_id: &str,
) -> Result<crate::pack_sync::PackStatus, String> {
    let version_id = version_id.trim();
    if version_id.is_empty() {
        return Err("No version selected".into());
    }
    if !SUPPORTED_VERSIONS.contains(&version_id) {
        return Err(format!(
            "{version_id} is not in the Remined Vanilla skin-compatible set"
        ));
    }

    progress::reset();
    progress::emit(app, "pack", 2, format!("Looking up {version_id}…"));

    let manifest = vanilla::fetch_manifest().await?;
    let entry = manifest
        .versions
        .iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| format!("Unknown Minecraft version: {version_id}"))?;

    let pack_id = pack_id_for(version_id);
    let dest = pack_dir(root, &pack_id);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let client = http_client()?;
    progress::emit(app, "pack", 8, "Downloading Mojang version…");
    let mojang_bytes = download_bytes(&client, &entry.url).await?;
    let mojang: Value =
        serde_json::from_slice(&mojang_bytes).map_err(|e| format!("Invalid version JSON: {e}"))?;
    if mojang.pointer("/arguments/jvm").is_none() {
        return Err(format!("{version_id} uses an unsupported launch format"));
    }

    let client_jar_name = format!("{version_id}.jar");
    let client_jar_path = dest.join(&client_jar_name);
    let client_url = mojang
        .pointer("/downloads/client/url")
        .and_then(|u| u.as_str())
        .ok_or("version JSON missing downloads.client.url")?;
    progress::emit(app, "pack", 18, "Downloading client…");
    download_to_file(&client, client_url, &client_jar_path).await?;
    progress::check_cancelled()?;

    progress::emit(app, "pack", 35, "Resolving Fabric loader…");
    let loader = pick_fabric_loader(&client, version_id).await?;
    let fabric_profile = fetch_fabric_profile(&client, version_id, &loader).await?;
    let merged = merge_fabric_profile(mojang, fabric_profile)?;
    let version_json_name = format!("fabric-loader-{loader}-{version_id}.json");
    fs::write(
        dest.join(&version_json_name),
        serde_json::to_vec_pretty(&merged).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let java_major = merged
        .pointer("/javaVersion/majorVersion")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

    let mods_dir = dest.join("mods");
    // Clear previous Remined-managed mod jars so versions don't stack.
    clear_managed_mod_jars(&mods_dir)?;

    progress::emit(app, "pack", 48, "Downloading Fabric API…");
    download_modrinth_mod(&client, MODRINTH_FABRIC_API, version_id, &mods_dir).await?;
    progress::check_cancelled()?;
    download_perf_mods(app, &client, version_id, &mods_dir, java_major, 52, 70).await?;
    progress::emit(app, "pack", 72, "Downloading SkinShuffle…");
    download_modrinth_mod(&client, MODRINTH_SKINSHUFFLE, version_id, &mods_dir).await?;
    progress::check_cancelled()?;
    progress::emit(app, "pack", 76, "Patching SkinShuffle…");
    crate::skinshuffle_patch::prepare_instance(&dest, version_id)?;
    progress::check_cancelled()?;
    progress::emit(app, "pack", 80, "Downloading CustomSkinLoader…");
    download_modrinth_mod(&client, MODRINTH_CSL, version_id, &mods_dir).await?;
    progress::check_cancelled()?;
    progress::emit(app, "pack", 84, "Downloading LAN (offline) helper…");
    download_modrinth_mod(&client, MODRINTH_MCWIFIPNP, version_id, &mods_dir).await?;
    write_mcwifipnp_offline_defaults(&dest)?;
    progress::check_cancelled()?;

    reconcile_stacks(&mods_dir);
    let repaired = repair_with_audit(app, &client, version_id, &mods_dir, &loader, java_major).await;
    reconcile_stacks(&mods_dir);
    for n in &repaired {
        progress::emit(app, "pack", 38, format!("Dependency fix: {n}"));
    }
    let final_issues = crate::mod_audit::audit(
        &crate::mod_audit::read_mods_dir(&mods_dir),
        &crate::mod_audit::AuditEnv {
            minecraft: version_id,
            loader: Some(&loader),
            java_major,
        },
    );
    if !final_issues.is_empty() {
        let _ = clear_managed_mod_jars(&mods_dir);
        return Err(format!(
            "Remined Vanilla {version_id}: unresolved mod dependencies — {}",
            final_issues.join("; ")
        ));
    }
    if let Err(e) = validate_mods_dir(&mods_dir, version_id) {
        let _ = clear_managed_mod_jars(&mods_dir);
        return Err(e);
    }
    write_mods_manifest(&dest, version_id, &loader, java_major)?;

    let meta = PackInstallMeta {
        id: pack_id.clone(),
        name: format!("Remined Vanilla {version_id}"),
        version: version_id.to_string(),
        version_json: Some(version_json_name),
        client_jar: Some(client_jar_name),
        java_major,
        kind: Some("remined-vanilla".into()),
    };
    instance::write_meta(&dest, &meta)?;

    progress::emit(app, "fabric", 1, "Checking Fabric libraries…");
    runtime::prepare_runtime(app, root, &dest).await?;
    progress::emit(app, "done", 100, "Remined Vanilla ready");

    Ok(crate::pack_sync::pack_status(root, &pack_id))
}

pub async fn ensure_installed(
    app: &AppHandle,
    root: &Path,
    pack_id: &str,
) -> Result<crate::pack_sync::PackStatus, String> {
    let instance = pack_dir(root, pack_id);
    if !instance::is_pack_installed(&instance) {
        let version_id = version_from_pack_id(pack_id)
            .ok_or_else(|| format!("Not a Remined Vanilla pack: {pack_id}"))?
            .to_string();
        return install_version(app, root, &version_id).await;
    }
    progress::reset();
    // Idempotent: hide Skin Presets chrome, mute offline toast, relax JiJ deps.
    let game_raw = version_from_pack_id(pack_id).unwrap_or("");
    // CLI copies use `…-b` suffix; Modrinth wants the real MC version id.
    let game = game_raw.strip_suffix("-b").unwrap_or(game_raw);
    let _ = crate::skinshuffle_patch::prepare_instance(&instance, game);
    // Existing installs may predate mcwifipnp / perf stack — pull them in.
    let mods_dir = instance.join("mods");
    let client = http_client()?;
    let java_major = instance::read_meta(&instance).and_then(|m| m.java_major);
    let has_lan = mods_dir_has_marker(&mods_dir, &["mcwifipnp"]);
    if !has_lan && !game.is_empty() {
        progress::emit(app, "pack", 40, "Installing LAN offline helper…");
        let _ = download_modrinth_mod(&client, MODRINTH_MCWIFIPNP, game, &mods_dir).await;
    }
    let _ = ensure_perf_mods(app, &client, game, &mods_dir, java_major).await;
    let loader_name = instance::read_meta(&instance)
        .and_then(|m| m.version_json)
        .and_then(|j| {
            j.strip_prefix("fabric-loader-")
                .and_then(|r| r.strip_suffix(&format!("-{game}.json")))
                .map(String::from)
        })
        .unwrap_or_default();
    let _ = repair_with_audit(app, &client, game, &mods_dir, &loader_name, java_major).await;
    reconcile_stacks(&mods_dir);
    if let Err(e) = validate_mods_dir(&mods_dir, game) {
        progress::emit(app, "pack", 50, format!("Warning: {e}"));
    }
    let _ = write_mods_manifest(&instance, game, &loader_name, java_major);
    let _ = write_mcwifipnp_offline_defaults(&instance);
    progress::emit(app, "fabric", 1, "Checking Fabric runtime…");
    runtime::prepare_runtime(app, root, &instance).await?;
    progress::emit(app, "done", 100, "Ready to play");
    Ok(crate::pack_sync::pack_status(root, pack_id))
}

/// Default Open-to-LAN to offline auth so Remined (no Microsoft session) can join.
fn write_mcwifipnp_offline_defaults(instance: &Path) -> Result<(), String> {
    let dir = instance.join("config");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("mcwifipnp.json");
    let mut value: Value = if path.is_file() {
        serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };
    let Some(obj) = value.as_object_mut() else {
        return Ok(());
    };
    obj.insert("online-mode".into(), json!(false));
    obj.insert("onlineMode".into(), json!(false));
    obj.insert("apply-for-all-world".into(), json!(true));
    obj.insert("applyforallworld".into(), json!(true));
    // Offline UUID fixer helps inventory stay stable across offline joins.
    obj.insert("enable-uuid-fixer".into(), json!(true));
    obj.insert("enableUUIDFixer".into(), json!(true));
    // Fixed LAN port so Unlim-only mode can pre-open the tunnel with voice.
    let lan = crate::unlim::LAN_TCP_PORT;
    obj.insert("port".into(), json!(lan));
    let pretty = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&path, pretty).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn supported_versions() -> &'static [&'static str] {
    SUPPORTED_VERSIONS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn iris_sodium_lines() {
        assert!(!iris_needs_sodium_08("1.8.8+mc1.21.1"));
        assert!(iris_needs_sodium_08("1.8.13+mc1.21.1"));
        assert!(iris_needs_sodium_08("1.9.0"));
        assert_eq!(parse_zero_maj_min("sodium-fabric-0.6.13+mc1.21.1.jar"), Some((0, 6)));
        assert_eq!(parse_zero_maj_min("1.21.1"), None);
    }

    #[test]
    fn lighting_stack_is_never_doubled() {
        let n = names(&["starlight-1.1.jar", "scalablelux-0.1.jar"]);
        assert_eq!(stack_conflict_removals(&n).len(), 1);
        let n = names(&["modernfix-5.jar", "badoptimizations-2.jar"]);
        assert_eq!(stack_conflict_removals(&n).len(), 1);
        let n = names(&["starlight-1.1.jar", "modernfix-5.jar"]);
        assert!(stack_conflict_removals(&n).is_empty());
    }

    #[test]
    fn old_immediatelyfast_dropped_with_iris_17() {
        let names: Vec<String> = [
            "immediatelyfast-1.2.4+1.20.1.jar",
            "iris-1.7.6+mc1.20.1.jar",
            "sodium-fabric-0.5.13+mc1.20.1.jar",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(stack_conflict_removals(&names), vec![&["immediatelyfast"][..]]);
        let ok: Vec<String> = ["immediatelyfast-1.2.4+1.20.1.jar", "iris-mc1.20.1-1.6.17.jar"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert!(stack_conflict_removals(&ok).is_empty());
    }

    #[test]
    fn resourcify_needs_flk() {
        let n = names(&["resourcify-1.jar"]);
        assert_eq!(stack_conflict_removals(&n).len(), 1);
        let n = names(&["resourcify-1.jar", "fabric-language-kotlin-1.13.jar"]);
        assert!(stack_conflict_removals(&n).is_empty());
    }

    #[test]
    fn c2me_only_on_java_25() {
        assert!(!allow_c2me("1.21.1", Some(21)));
        assert!(allow_c2me("1.21.1", Some(25)));
    }
}
