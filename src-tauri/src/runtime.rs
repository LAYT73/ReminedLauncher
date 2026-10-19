//! Cross-platform Fabric/Minecraft runtime: download libs/assets and launch Java.
//! No Python / TLauncher / host-specific scripts.

use crate::instance;
use crate::progress;
use futures::stream::{FuturesUnordered, StreamExt};
use serde_json::Value;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use crate::progress::Ctx as AppHandle;
use uuid::Uuid;
use zip::ZipArchive;

fn current_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "osx"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn current_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "unknown"
    }
}

fn classpath_sep() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

fn rule_allows(rules: Option<&Value>) -> bool {
    let Some(rules) = rules.and_then(|v| v.as_array()) else {
        return true;
    };
    if rules.is_empty() {
        return true;
    }
    let os_name = current_os();
    let arch = current_arch();
    let mut allowed = false;
    for rule in rules {
        let action = rule.get("action").and_then(|a| a.as_str()).unwrap_or("allow");
        let features = rule.get("features");
        let os_rule = rule.get("os");
        let matched = if features.is_some() {
            // demo/is_demo_user etc. — skip for Remined offline
            false
        } else if let Some(os_rule) = os_rule {
            let mut ok = true;
            if let Some(name) = os_rule.get("name").and_then(|n| n.as_str()) {
                if name != os_name {
                    ok = false;
                }
            }
            if let Some(a) = os_rule.get("arch").and_then(|n| n.as_str()) {
                if a != arch {
                    ok = false;
                }
            }
            ok
        } else {
            true
        };
        if matched {
            allowed = action == "allow";
        }
    }
    allowed
}

fn normalize_lib_path(path: &str) -> String {
    let path = path.replace('\\', "/");
    path.strip_prefix("libraries/")
        .unwrap_or(&path)
        .to_string()
}

fn mirror_urls(url: &str, rel: &str) -> Vec<String> {
    let mut urls = Vec::new();
    if !url.is_empty() {
        if url.starts_with("http://") {
            urls.push(url.replacen("http://", "https://", 1));
        }
        urls.push(url.to_string());
    }
    if rel.starts_with("net/fabricmc/") || rel.starts_with("org/ow2/asm/") {
        for extra in [
            format!("https://maven.fabricmc.net/{rel}"),
            format!("https://repo1.maven.org/maven2/{rel}"),
        ] {
            if !urls.contains(&extra) {
                urls.push(extra);
            }
        }
    }
    urls
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("ReminedLauncher/0.1")
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())
}

async fn download_file(client: &reqwest::Client, url: &str, dest: &Path) -> Result<(), String> {
    if dest.is_file() && dest.metadata().map(|m| m.len() > 0).unwrap_or(false) {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = dest.with_extension(format!(
        "{}.part",
        dest.extension().and_then(|e| e.to_str()).unwrap_or("bin")
    ));
    let mut last_err = String::new();
    for attempt in 1..=6u32 {
        match client.get(url).send().await {
            Ok(resp) => match resp.error_for_status() {
                Ok(mut ok) => {
                    let mut file = File::create(&tmp).map_err(|e| e.to_string())?;
                    let mut empty = true;
                    while let Some(chunk) = ok.chunk().await.map_err(|e| e.to_string())? {
                        crate::progress::check_cancelled()?;
                        if !chunk.is_empty() {
                            empty = false;
                        }
                        file.write_all(&chunk).map_err(|e| e.to_string())?;
                    }
                    if empty {
                        let _ = fs::remove_file(&tmp);
                        last_err = "empty download".into();
                    } else {
                        fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
                        return Ok(());
                    }
                }
                Err(e) => last_err = e.to_string(),
            },
            Err(e) => last_err = e.to_string(),
        }
        let _ = fs::remove_file(&tmp);
        if attempt < 6 {
            tokio::time::sleep(std::time::Duration::from_millis(200 * attempt as u64)).await;
        }
    }
    Err(format!("download failed: {url} ({last_err})"))
}

async fn download_with_mirrors(
    client: &reqwest::Client,
    urls: &[String],
    dest: &Path,
) -> Result<(), String> {
    let mut last = String::new();
    for url in urls {
        match download_file(client, url, dest).await {
            Ok(()) => return Ok(()),
            Err(e) => last = e,
        }
    }
    Err(last)
}

fn global_mc_dir() -> PathBuf {
    if cfg!(target_os = "macos") {
        dirs_next_home().join("Library/Application Support/minecraft")
    } else if cfg!(windows) {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| dirs_next_home().join("AppData/Roaming"))
            .join(".minecraft")
    } else {
        dirs_next_home().join(".minecraft")
    }
}

fn dirs_next_home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_existing_library(root: &Path, rel: &str) -> Option<PathBuf> {
    let local = root.join(".run").join("libraries").join(rel);
    if local.is_file() && local.metadata().ok()?.len() > 0 {
        return Some(local);
    }
    let global = global_mc_dir().join("libraries").join(rel);
    if global.is_file() && global.metadata().ok()?.len() > 0 {
        return Some(global);
    }
    None
}

/// Fabric packs flatten `artifact`; Mojang version JSON uses `downloads.artifact`.
fn library_artifact(entry: &Value) -> Option<&Value> {
    entry
        .get("artifact")
        .or_else(|| entry.pointer("/downloads/artifact"))
}

pub struct LaunchOpts {
    pub root: PathBuf,
    pub instance: PathBuf,
    pub java: PathBuf,
    pub username: String,
    pub ram_mb: u32,
    pub jvm_args: String,
    /// Auto-join multiplayer (`host:port`) via --quickPlayMultiplayer / --server.
    pub quick_play: Option<String>,
    /// Extra launchctl label segment so a second client does not boot out the first.
    pub launch_label_suffix: Option<String>,
}

const JNA_MIN: (u32, u32) = (5, 13);
const JNA_REPLACEMENT: &str = "5.14.0";

/// JNA < 5.13 aborts the JVM (`LOAD_ERROR` snprintf assert) on recent macOS when Sodium /
/// Iris probe IOKit via oshi (Minecraft 1.20 / 1.20.1 ship JNA 5.12.1). Swap in 5.14.0.
/// Returns true when the version JSON was modified.
fn upgrade_old_jna(version: &mut Value) -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let Some(libs) = version.get_mut("libraries").and_then(|l| l.as_array_mut()) else {
        return false;
    };
    let mut changed = false;
    for lib in libs.iter_mut() {
        let Some(name) = lib.get("name").and_then(|n| n.as_str()).map(String::from) else {
            continue;
        };
        let parts: Vec<&str> = name.split(':').collect();
        if parts.len() != 3 || parts[0] != "net.java.dev.jna" {
            continue;
        }
        let artifact = parts[1];
        if artifact != "jna" && artifact != "jna-platform" {
            continue;
        }
        let mut it = parts[2].split('.');
        let maj: u32 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        let min: u32 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        if (maj, min) >= JNA_MIN {
            continue;
        }
        let rel = format!(
            "net/java/dev/jna/{artifact}/{JNA_REPLACEMENT}/{artifact}-{JNA_REPLACEMENT}.jar"
        );
        lib["name"] = Value::String(format!("net.java.dev.jna:{artifact}:{JNA_REPLACEMENT}"));
        lib["downloads"] = serde_json::json!({
            "artifact": {
                "path": rel,
                "url": format!("https://repo1.maven.org/maven2/{rel}"),
            }
        });
        if let Some(o) = lib.as_object_mut() {
            o.remove("artifact");
        }
        changed = true;
    }
    changed
}

/// Ensure libraries + assets for the pack version JSON. Emits progress events.
pub async fn prepare_runtime(app: &AppHandle, root: &Path, instance: &Path) -> Result<(), String> {
    let meta = instance::read_meta(instance);
    let version_path = instance::find_version_json(
        instance,
        meta.as_ref().and_then(|m| m.version_json.as_deref()),
    )?;
    let mut version: Value =
        serde_json::from_str(&fs::read_to_string(&version_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if upgrade_old_jna(&mut version) {
        // Persist so spawn_game() (which re-reads the JSON) sees the same classpath.
        if let Ok(bytes) = serde_json::to_vec_pretty(&version) {
            let _ = fs::write(&version_path, bytes);
        }
    }

    progress::emit(app, "fabric", 5, "Resolving Fabric libraries…");
    let jar_hint = meta.as_ref().and_then(|m| m.client_jar.as_deref());
    let jars = ensure_libraries(app, root, instance, &version, jar_hint).await?;
    progress::emit(
        app,
        "fabric",
        55,
        format!("Libraries ready ({})", jars.len()),
    );

    progress::emit(app, "assets", 60, "Checking game assets…");
    let _index = ensure_assets(app, root, &version).await?;
    progress::emit(app, "assets", 95, "Assets ready");

    ensure_log_config(root, &version).await?;
    progress::emit(app, "runtime", 100, "Runtime ready");
    Ok(())
}

async fn ensure_libraries(
    app: &AppHandle,
    root: &Path,
    instance: &Path,
    version: &Value,
    client_jar_hint: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let libs = version
        .get("libraries")
        .and_then(|v| v.as_array())
        .ok_or("version JSON missing libraries")?;
    let client = http_client()?;
    let libs_dir = root.join(".run").join("libraries");
    fs::create_dir_all(&libs_dir).map_err(|e| e.to_string())?;

    let mut todo: Vec<(String, Vec<String>, PathBuf)> = Vec::new();
    let mut ready: Vec<PathBuf> = Vec::new();

    for entry in libs {
        if !rule_allows(entry.get("rules")) {
            continue;
        }
        let Some(artifact) = library_artifact(entry) else {
            continue;
        };
        let path = artifact
            .get("path")
            .and_then(|p| p.as_str())
            .ok_or("library missing path")?;
        let rel = normalize_lib_path(path);
        if let Some(existing) = resolve_existing_library(root, &rel) {
            ready.push(existing);
            continue;
        }
        let dest = libs_dir.join(&rel);
        let url = artifact.get("url").and_then(|u| u.as_str()).unwrap_or("");
        let mut urls = mirror_urls(url, &rel);
        if urls.is_empty() {
            urls.push(format!("https://libraries.minecraft.net/{rel}"));
        }
        todo.push((rel.clone(), urls, dest));
    }

    let total = todo.len().max(1);
    let done = Arc::new(AtomicUsize::new(0));
    let mut tasks = FuturesUnordered::new();

    for (rel, urls, dest) in todo {
        let client = client.clone();
        let done = Arc::clone(&done);
        let app = app.clone();
        tasks.push(async move {
            let result = download_with_mirrors(&client, &urls, &dest).await;
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            let pct = 5 + ((n as f64 / total as f64) * 45.0) as u32;
            progress::emit(
                &app,
                "fabric",
                pct.min(50),
                format!("Library {n}/{total}: {rel}"),
            );
            result.map(|_| dest)
        });
    }

    while let Some(res) = tasks.next().await {
        ready.push(res?);
    }

    let client_jar = match instance::find_client_jar(instance, version, client_jar_hint) {
        Ok(p) => p,
        Err(_) => {
            let fallback = instance.join("client.jar");
            if let Some(dl) = version.pointer("/downloads/client") {
                let url = dl.get("url").and_then(|u| u.as_str()).unwrap_or("");
                if url.is_empty() {
                    return Err("Client jar missing and no download URL".into());
                }
                progress::emit(app, "fabric", 52, "Downloading client jar…");
                download_file(&client, url, &fallback).await?;
                fallback
            } else {
                return Err("Client jar missing".into());
            }
        }
    };
    ready.push(client_jar);
    Ok(ready)
}

async fn ensure_assets(app: &AppHandle, root: &Path, version: &Value) -> Result<String, String> {
    let index = version
        .get("assetIndex")
        .ok_or("version JSON missing assetIndex")?;
    let index_id = index
        .get("id")
        .and_then(|i| i.as_str())
        .ok_or("assetIndex.id missing")?
        .to_string();
    let index_url = index.get("url").and_then(|u| u.as_str()).unwrap_or("");
    let assets_dir = root.join(".run").join("assets");
    let index_path = assets_dir.join("indexes").join(format!("{index_id}.json"));
    let client = http_client()?;
    if !index_path.is_file() {
        if index_url.is_empty() {
            return Err("asset index URL missing".into());
        }
        download_file(&client, index_url, &index_path).await?;
    }
    let data: Value =
        serde_json::from_str(&fs::read_to_string(&index_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let objects = data
        .get("objects")
        .and_then(|o| o.as_object())
        .cloned()
        .unwrap_or_default();

    let global_assets = global_mc_dir().join("assets");
    let mut missing: Vec<(String, u64)> = Vec::new();
    for (_name, meta) in &objects {
        let hash = meta.get("hash").and_then(|h| h.as_str()).unwrap_or("");
        let size = meta.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
        if hash.len() < 2 {
            continue;
        }
        let dest = assets_dir.join("objects").join(&hash[..2]).join(hash);
        if dest.is_file() && dest.metadata().map(|m| m.len() == size).unwrap_or(false) {
            continue;
        }
        let global = global_assets.join("objects").join(&hash[..2]).join(hash);
        if global.is_file() && global.metadata().map(|m| m.len() == size).unwrap_or(false) {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let _ = fs::hard_link(&global, &dest).or_else(|_| fs::copy(&global, &dest).map(|_| ()));
            continue;
        }
        missing.push((hash.to_string(), size));
    }

    let total = missing.len();
    if total == 0 {
        return Ok(index_id);
    }

    progress::emit(app, "assets", 65, format!("Downloading {total} assets…"));
    let done = Arc::new(AtomicUsize::new(0));
    let mut tasks = FuturesUnordered::new();
    // Limit concurrency by chunking
    for (hash, size) in missing {
        let client = client.clone();
        let assets_dir = assets_dir.clone();
        let done = Arc::clone(&done);
        let app = app.clone();
        crate::progress::check_cancelled()?;
        tasks.push(async move {
            crate::progress::check_cancelled()?;
            let dest = assets_dir.join("objects").join(&hash[..2]).join(&hash);
            let url = format!("https://resources.download.minecraft.net/{}/{hash}", &hash[..2]);
            let res = download_file(&client, &url, &dest).await;
            if res.is_ok() {
                if let Ok(meta) = dest.metadata() {
                    if size > 0 && meta.len() != size {
                        let _ = fs::remove_file(&dest);
                        return Err(format!("size mismatch for {hash}"));
                    }
                }
            }
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            if n % 40 == 0 || n == total {
                let pct = 65 + ((n as f64 / total as f64) * 28.0) as u32;
                progress::emit(&app, "assets", pct.min(93), format!("Assets {n}/{total}"));
            }
            res
        });
        // Soft concurrency: drain when queue grows
        if tasks.len() >= 8 {
            if let Some(res) = tasks.next().await {
                res?;
            }
        }
    }
    while let Some(res) = tasks.next().await {
        res?;
    }
    Ok(index_id)
}

async fn ensure_log_config(root: &Path, version: &Value) -> Result<Option<PathBuf>, String> {
    let Some(file) = version.pointer("/logging/client/file") else {
        return Ok(None);
    };
    let id = file.get("id").and_then(|i| i.as_str()).unwrap_or("client.xml");
    let url = file.get("url").and_then(|u| u.as_str()).unwrap_or("");
    let dest = root.join(".run").join(id);
    if !dest.is_file() && !url.is_empty() {
        let client = http_client()?;
        download_file(&client, url, &dest).await?;
    }
    Ok(if dest.is_file() { Some(dest) } else { None })
}

/// Fabric packs use `values: []`; Mojang version JSON uses `value` as string or array.
fn argument_values(item: &Value) -> (Vec<String>, Option<&Value>) {
    if let Some(s) = item.as_str() {
        return (vec![s.to_string()], None);
    }
    let rules = item.get("rules");
    let values = item
        .get("values")
        .or_else(|| item.get("value"))
        .map(|v| {
            if let Some(s) = v.as_str() {
                vec![s.to_string()]
            } else if let Some(arr) = v.as_array() {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            } else {
                Vec::new()
            }
        })
        .unwrap_or_default();
    (values, rules)
}

fn build_jvm_args(
    version: &Value,
    classpath: &str,
    natives: &Path,
    log_config: Option<&Path>,
    ram_mb: u32,
    extra: &str,
) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let natives_s = natives.display().to_string();
    let replacements = [
        ("${natives_directory}", natives_s.as_str()),
        ("${launcher_name}", "Remined"),
        ("${launcher_version}", "0.1"),
        ("${classpath}", classpath),
    ];

    let jvm = version
        .pointer("/arguments/jvm")
        .and_then(|v| v.as_array())
        .ok_or("missing arguments.jvm")?;

    for item in jvm {
        let (values, rules) = argument_values(item);
        if !rule_allows(rules) {
            continue;
        }
        for mut value in values {
            for (key, rep) in &replacements {
                value = value.replace(key, rep);
            }
            args.push(value);
        }
    }

    if let Some(log) = log_config {
        args.push(format!("-Dlog4j.configurationFile={}", log.display()));
    }
    args.push(format!("-Xmx{ram_mb}M"));
    args.push("-Xms512M".into());
    for flag in extra.split_whitespace() {
        if !flag.is_empty() {
            args.push(flag.to_string());
        }
    }
    Ok(args)
}

/// Cursor/`tauri dev` often sets TMPDIR under the project on Desktop. JNA/LWJGL then
/// extract natives there and macOS aborts on `dlopen` (SIGABRT in Native.open).
/// Prefer a short `/tmp/...` path — JNA 5.12 asserts if LOAD_ERROR messages truncate.
fn game_temp_dir(instance: &Path) -> Result<PathBuf, String> {
    let base = if cfg!(target_os = "macos") {
        PathBuf::from("/tmp/remined-game")
    } else {
        std::env::temp_dir().join("remined-game")
    };
    let dir = base.join(
        instance
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("instance"),
    );
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// macOS GLFW/LWJGL require the JVM to start on thread 0.
fn ensure_macos_start_on_first_thread(jvm: &mut Vec<String>) {
    if !cfg!(target_os = "macos") {
        return;
    }
    if jvm.iter().any(|a| a == "-XstartOnFirstThread") {
        return;
    }
    jvm.insert(0, "-XstartOnFirstThread".into());
}

/// Extract + ad-hoc codesign `libjnidispatch` so Java's hardened runtime can `dlopen` it
/// when Remined is launched from Cursor / an unsigned `tauri dev` binary.
fn prepare_jna_boot_library(jars: &[PathBuf], dest_dir: &Path) -> Result<Option<PathBuf>, String> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    let jna_jar = jars.iter().rev().find(|p| {
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        name.starts_with("jna-") && !name.contains("platform") && name.ends_with(".jar")
    });
    let Some(jar_path) = jna_jar else {
        return Ok(None);
    };

    let resource = if cfg!(target_arch = "aarch64") {
        "com/sun/jna/darwin-aarch64/libjnidispatch.jnilib"
    } else {
        "com/sun/jna/darwin-x86-64/libjnidispatch.jnilib"
    };

    fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let out = dest_dir.join("libjnidispatch.jnilib");
    // Key the extracted dylib on the source jar (path + size). mtime is unreliable: a shared
    // global jar can be older than a stale dylib left from a previous JNA version.
    let stamp = dest_dir.join("source.stamp");
    let want_stamp = format!(
        "{}|{}",
        jar_path.display(),
        jar_path.metadata().map(|m| m.len()).unwrap_or(0)
    );
    let need_extract = out.metadata().map(|m| m.len() == 0).unwrap_or(true)
        || fs::read_to_string(&stamp).ok().as_deref() != Some(want_stamp.as_str());
    if need_extract {
        let file = File::open(jar_path).map_err(|e| format!("open JNA jar: {e}"))?;
        let mut zip = ZipArchive::new(file).map_err(|e| format!("JNA jar zip: {e}"))?;
        let mut entry = zip
            .by_name(resource)
            .map_err(|e| format!("JNA native missing ({resource}): {e}"))?;
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("read JNA native: {e}"))?;
        fs::write(&out, bytes).map_err(|e| format!("write JNA native: {e}"))?;
        let _ = fs::write(&stamp, &want_stamp);
    }

    // Ad-hoc sign so hardened-runtime Java accepts the dylib.
    let _ = Command::new("codesign")
        .args(["--force", "--sign", "-", "--timestamp=none"])
        .arg(&out)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    Ok(Some(dest_dir.to_path_buf()))
}

/// Same offline UUID Mojang clients use for `OfflinePlayer:{name}`.
pub fn offline_player_uuid(username: &str) -> Uuid {
    Uuid::new_v3(
        &Uuid::NAMESPACE_DNS,
        format!("OfflinePlayer:{username}").as_bytes(),
    )
}

fn build_game_args(
    version: &Value,
    instance: &Path,
    assets_dir: &Path,
    assets_index: &str,
    username: &str,
) -> Result<Vec<String>, String> {
    let player_uuid = offline_player_uuid(username);
    let version_name = version
        .get("id")
        .and_then(|i| i.as_str())
        .unwrap_or("pack");
    let version_type = version
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("release");

    let replacements = [
        ("${auth_player_name}", username.to_string()),
        ("${version_name}", version_name.to_string()),
        ("${game_directory}", instance.display().to_string()),
        ("${assets_root}", assets_dir.display().to_string()),
        ("${assets_index_name}", assets_index.to_string()),
        ("${auth_uuid}", player_uuid.to_string()),
        ("${auth_access_token}", "0".into()),
        ("${clientid}", "0".into()),
        ("${auth_xuid}", "0".into()),
        ("${user_type}", "legacy".into()),
        ("${version_type}", version_type.to_string()),
        ("${resolution_width}", "1280".into()),
        ("${resolution_height}", "720".into()),
    ];

    let game = version
        .pointer("/arguments/game")
        .and_then(|v| v.as_array())
        .ok_or("missing arguments.game")?;

    let mut args = Vec::new();
    for item in game {
        let (values, rules) = argument_values(item);
        if !rule_allows(rules) {
            continue;
        }
        for mut value in values {
            for (key, rep) in &replacements {
                value = value.replace(key, rep);
            }
            if value.starts_with("${") {
                continue;
            }
            args.push(value);
        }
    }
    Ok(args)
}

/// Handle for a running (or just-spawned) game process.
pub enum LaunchedGame {
    #[allow(dead_code)] // used on Windows/Linux; macOS uses Detached
    Child(Child),
    /// macOS: Java started via launchctl GUI domain (not a child of Remined/Cursor).
    #[cfg(target_os = "macos")]
    Detached { pid: u32, log_path: PathBuf },
}

impl LaunchedGame {
    pub fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        match self {
            Self::Child(child) => child.try_wait(),
            #[cfg(target_os = "macos")]
            Self::Detached { pid, .. } => {
                if unsafe { libc::kill(*pid as i32, 0) == 0 } {
                    Ok(None)
                } else {
                    use std::os::unix::process::ExitStatusExt;
                    Ok(Some(std::process::ExitStatus::from_raw(1)))
                }
            }
        }
    }

    pub fn error_tail(&mut self) -> String {
        match self {
            Self::Child(child) => {
                let mut err = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    let _ = stderr.read_to_string(&mut err);
                }
                err.chars().take(200).collect()
            }
            #[cfg(target_os = "macos")]
            Self::Detached { log_path, .. } => {
                let text = fs::read_to_string(log_path).unwrap_or_default();
                let start = text.len().saturating_sub(200);
                text[start..].to_string()
            }
        }
    }
}

/// Drop version-json tmp/extract props so Desktop `natives/` cannot win over `/tmp/remined-game`.
fn scrub_native_tmpdir_props(jvm: &mut Vec<String>) {
    jvm.retain(|a| {
        !(a.starts_with("-Djna.tmpdir=")
            || a.starts_with("-Djava.io.tmpdir=")
            || a.starts_with("-Djna.boot.library.path=")
            || a.starts_with("-Dorg.lwjgl.system.SharedLibraryExtractPath=")
            || a.starts_with("-Dorg.lwjgl.system.SharedLibraryExtractDirectory="))
    });
}

/// Launch via a tiny `.app` + LaunchServices (`open`).
///
/// - Not a child of Remined/Cursor (avoids JNA `Native.open` SIGABRT).
/// - Proper Aqua activation policy so GLFW gets mouse/keyboard focus
///   (launchctl agents often leave the window "focused" but dead to input).
#[cfg(target_os = "macos")]
fn spawn_detached_macos(
    java: &Path,
    java_home: &Path,
    jvm: &[String],
    main_class: &str,
    game: &[String],
    instance: &Path,
    game_tmp: &Path,
    label_suffix: Option<&str>,
) -> Result<LaunchedGame, String> {
    let _ = label_suffix; // reserved for unique bundle ids if needed later
    let launch_dir = game_tmp.join("launch-app");
    let app = launch_dir.join("ReminedGame.app");
    let contents = app.join("Contents");
    let macos = contents.join("MacOS");
    fs::create_dir_all(&macos).map_err(|e| e.to_string())?;

    let pid_path = game_tmp.join("game.pid");
    let log_path = game_tmp.join("game-stdout.log");
    let _ = fs::remove_file(&pid_path);
    let _ = fs::remove_file(&log_path);

    let mut argv = String::new();
    for arg in jvm
        .iter()
        .cloned()
        .chain(std::iter::once(main_class.to_string()))
        .chain(game.iter().cloned())
    {
        argv.push(' ');
        argv.push_str(&shell_single_quote(&arg));
    }

    // Not LSUIElement — must be a real app so Cocoa/GLFW receive input focus.
    let plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>remined-launch</string>
	<key>CFBundleIdentifier</key>
	<string>com.remined.launcher.game</string>
	<key>CFBundleName</key>
	<string>Remined Game</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>LSMinimumSystemVersion</key>
	<string>11.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
"#;
    fs::write(contents.join("Info.plist"), plist).map_err(|e| e.to_string())?;

    let exe = macos.join("remined-launch");
    let script = format!(
        r#"#!/bin/zsh
cd {instance}
export JAVA_HOME={java_home}
export TMPDIR={game_tmp}
export TEMP={game_tmp}
export TMP={game_tmp}
export PATH={java_bin}":$PATH"
print -r -- $$ > {pid}
exec {java}{argv} >{log} 2>&1
"#,
        instance = shell_single_quote(&instance.display().to_string()),
        java_home = shell_single_quote(&java_home.display().to_string()),
        game_tmp = shell_single_quote(&game_tmp.display().to_string()),
        java_bin = shell_single_quote(
            &java
                .parent()
                .unwrap_or(java)
                .display()
                .to_string()
        ),
        pid = shell_single_quote(&pid_path.display().to_string()),
        java = shell_single_quote(&java.display().to_string()),
        argv = argv,
        log = shell_single_quote(&log_path.display().to_string()),
    );
    fs::write(&exe, script).map_err(|e| e.to_string())?;
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&exe).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&exe, perms).map_err(|e| e.to_string())?;
    }
    let _ = Command::new("/usr/bin/xattr")
        .args(["-cr"])
        .arg(&app)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = Command::new("/usr/bin/codesign")
        .args(["--force", "--deep", "--sign", "-", "--timestamp=none"])
        .arg(&app)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    // Bring to front (-g would hide activation and break mouse for a while).
    let open_out = Command::new("/usr/bin/open")
        .args(["-n"])
        .arg(&app)
        .output()
        .map_err(|e| format!("open LaunchServices: {e}"))?;
    if !open_out.status.success() {
        let err = String::from_utf8_lossy(&open_out.stderr);
        return Err(format!(
            "open failed with {}: {}",
            open_out.status,
            err.trim()
        ));
    }

    let mut pid = None;
    for _ in 0..50 {
        if let Ok(s) = fs::read_to_string(&pid_path) {
            if let Ok(p) = s.trim().parse::<u32>() {
                pid = Some(p);
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let pid = pid.ok_or_else(|| {
        let tail = fs::read_to_string(&log_path).unwrap_or_default();
        if tail.is_empty() {
            "Game did not start (no pid)".into()
        } else {
            format!(
                "Game did not start: {}",
                tail.chars().take(200).collect::<String>()
            )
        }
    })?;

    // Nudge focus after the JVM window exists (best-effort; ignores Accessibility denials).
    let _ = Command::new("/usr/bin/osascript")
        .args([
            "-e",
            &format!(
                "delay 1.2\n\
                 tell application \"System Events\"\n\
                   try\n\
                     set frontmost of (first process whose unix id is {pid}) to true\n\
                   end try\n\
                 end tell"
            ),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    Ok(LaunchedGame::Detached { pid, log_path })
}

#[cfg(target_os = "macos")]
fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Prepare (if needed) then spawn the game process.
pub async fn launch_game(app: &AppHandle, opts: LaunchOpts) -> Result<LaunchedGame, String> {
    prepare_runtime(app, &opts.root, &opts.instance).await?;
    spawn_game(opts).await
}

/// Spawn using libraries/assets already on disk (no Tauri UI / no downloads).
pub async fn spawn_game(opts: LaunchOpts) -> Result<LaunchedGame, String> {
    let meta = instance::read_meta(&opts.instance);
    let version_path = instance::find_version_json(
        &opts.instance,
        meta.as_ref().and_then(|m| m.version_json.as_deref()),
    )?;
    let version: Value =
        serde_json::from_str(&fs::read_to_string(&version_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;

    let jars = collect_classpath_paths(
        &opts.root,
        &opts.instance,
        &version,
        meta.as_ref().and_then(|m| m.client_jar.as_deref()),
    )?;
    let classpath = jars
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(classpath_sep());

    let assets_dir = opts.root.join(".run").join("assets");
    let assets_index = version
        .pointer("/assetIndex/id")
        .and_then(|i| i.as_str())
        .unwrap_or("legacy")
        .to_string();

    let natives = opts.instance.join("natives");
    for sub in ["java", "jna", "lwjgl", "netty"] {
        fs::create_dir_all(natives.join(sub)).map_err(|e| e.to_string())?;
    }
    let game_tmp = game_temp_dir(&opts.instance)?;
    let jna_tmp = game_tmp.join("jna");
    fs::create_dir_all(&jna_tmp).map_err(|e| e.to_string())?;

    let log_config = ensure_log_config(&opts.root, &version).await?;
    let log_owned = log_config.clone();
    let log_ref = log_owned.as_deref();

    let mut jvm = build_jvm_args(
        &version,
        &classpath,
        &natives,
        log_ref,
        opts.ram_mb.clamp(1024, 32768),
        &opts.jvm_args,
    )?;
    ensure_macos_start_on_first_thread(&mut jvm);
    // Version JSON often sets jna.tmpdir / LWJGL extract to instance `natives/` (Desktop path).
    scrub_native_tmpdir_props(&mut jvm);

    // Force JNA/LWJGL onto a short /tmp path (JNA 5.12 aborts if LOAD_ERROR truncates).
    jvm.push(format!("-Djna.tmpdir={}", jna_tmp.display()));
    jvm.push(format!("-Djava.io.tmpdir={}", game_tmp.display()));
    jvm.push(format!(
        "-Dorg.lwjgl.system.SharedLibraryExtractDirectory={}",
        game_tmp.join("lwjgl").display()
    ));
    fs::create_dir_all(game_tmp.join("lwjgl")).map_err(|e| e.to_string())?;

    let jna_boot = game_tmp.join("jna-boot");
    if let Some(boot) = prepare_jna_boot_library(&jars, &jna_boot)? {
        jvm.push(format!("-Djna.boot.library.path={}", boot.display()));
    }

    let mut game = build_game_args(
        &version,
        &opts.instance,
        &assets_dir,
        &assets_index,
        &opts.username,
    )?;
    if let Some(addr) = opts.quick_play.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        game.push("--quickPlayMultiplayer".into());
        game.push(addr.to_string());
        // Compatibility fallback for older argument parsers
        if let Some((host, port)) = addr.rsplit_once(':') {
            if !host.is_empty() && port.parse::<u16>().is_ok() {
                game.push("--server".into());
                game.push(host.to_string());
                game.push("--port".into());
                game.push(port.to_string());
            }
        }
    }
    let main_class = version
        .get("mainClass")
        .and_then(|m| m.as_str())
        .ok_or("missing mainClass")?;

    let java_home = opts
        .java
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| opts.java.clone());

    // Put -XstartOnFirstThread first if present (GLFW on macOS is picky about order).
    if let Some(idx) = jvm.iter().position(|a| a == "-XstartOnFirstThread") {
        if idx != 0 {
            let flag = jvm.remove(idx);
            jvm.insert(0, flag);
        }
    }

    // CLI second-client needs a detached process so it does not share Remined's session lock /
    // launchctl label. Normal Play: spawn as a child so GLFW gets real input focus on macOS.
    #[cfg(target_os = "macos")]
    if opts.launch_label_suffix.is_some() {
        return spawn_detached_macos(
            &opts.java,
            &java_home,
            &jvm,
            main_class,
            &game,
            &opts.instance,
            &game_tmp,
            opts.launch_label_suffix.as_deref(),
        );
    }

    // Match pre-0.4.2 spawn: plain child of Remined (no process_group).
    // `process_group(0)` broke GLFW mouse/keyboard focus on macOS.
    let mut cmd = Command::new(&opts.java);
    cmd.args(&jvm)
        .arg(main_class)
        .args(&game)
        .current_dir(&opts.instance)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .env("JAVA_HOME", &java_home)
        // Keep short tmp for JNA/LWJGL; does not affect Cocoa focus.
        .env("TMPDIR", &game_tmp)
        .env("TEMP", &game_tmp)
        .env("TMP", &game_tmp);

    let path_sep = if cfg!(windows) { ";" } else { ":" };
    if let Some(bin) = opts.java.parent() {
        cmd.env(
            "PATH",
            format!(
                "{}{}{}",
                bin.display(),
                path_sep,
                std::env::var("PATH").unwrap_or_default()
            ),
        );
    }

    cmd.spawn()
        .map(LaunchedGame::Child)
        .map_err(|e| format!("Failed to start Java: {e}"))
}

/// `org/ow2/asm/asm/9.6/asm-9.6.jar` -> (`org/ow2/asm/asm|`, `9.6`);
/// classifier jars (natives-macos) get their own key.
fn maven_key_and_version(rel: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() < 4 {
        return None;
    }
    let file = parts[parts.len() - 1];
    let version = parts[parts.len() - 2];
    let artifact = parts[parts.len() - 3];
    let stem = file.strip_suffix(".jar")?;
    let prefix = format!("{artifact}-{version}");
    let classifier = stem.strip_prefix(&prefix).unwrap_or("");
    Some((
        format!("{}|{}", parts[..parts.len() - 2].join("/"), classifier),
        version.to_string(),
    ))
}

fn version_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let nums = |s: &str| -> Vec<u64> {
        s.split(|c: char| !c.is_ascii_digit())
            .filter(|p| !p.is_empty())
            .map(|p| p.parse().unwrap_or(0))
            .collect()
    };
    nums(a).cmp(&nums(b))
}

fn collect_classpath_paths(
    root: &Path,
    instance: &Path,
    version: &Value,
    client_jar_hint: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let libs = version
        .get("libraries")
        .and_then(|v| v.as_array())
        .ok_or("missing libraries")?;
    let mut jars: Vec<PathBuf> = Vec::new();
    // group/artifact[:classifier] -> (index in `jars`, version) so a Fabric profile's newer
    // ASM replaces Mojang's older one (Fabric Loader aborts on duplicate ASM classes).
    let mut seen: std::collections::HashMap<String, (usize, String)> =
        std::collections::HashMap::new();
    for entry in libs {
        if !rule_allows(entry.get("rules")) {
            continue;
        }
        let Some(artifact) = library_artifact(entry) else {
            continue;
        };
        let path = artifact
            .get("path")
            .and_then(|p| p.as_str())
            .ok_or("library missing path")?;
        let rel = normalize_lib_path(path);
        let jar = resolve_existing_library(root, &rel)
            .ok_or_else(|| format!("Missing library after prepare: {rel}"))?;
        if let Some((key, ver)) = maven_key_and_version(&rel) {
            if let Some((idx, old_ver)) = seen.get(&key).cloned() {
                if version_cmp(&ver, &old_ver) == std::cmp::Ordering::Greater {
                    jars[idx] = jar;
                    seen.insert(key, (idx, ver));
                }
                continue;
            }
            seen.insert(key, (jars.len(), ver));
        }
        jars.push(jar);
    }
    let client = instance::find_client_jar(instance, version, client_jar_hint)?;
    jars.push(client);
    Ok(jars)
}
