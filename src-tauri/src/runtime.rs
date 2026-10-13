//! Cross-platform Fabric/Minecraft runtime: download libs/assets and launch Java.
//! No Python / TLauncher / host-specific scripts.

use crate::instance;
use crate::progress;
use futures::stream::{FuturesUnordered, StreamExt};
use serde_json::Value;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use uuid::Uuid;

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
}

/// Ensure libraries + assets for the pack version JSON. Emits progress events.
pub async fn prepare_runtime(app: &AppHandle, root: &Path, instance: &Path) -> Result<(), String> {
    let meta = instance::read_meta(instance);
    let version_path = instance::find_version_json(
        instance,
        meta.as_ref().and_then(|m| m.version_json.as_deref()),
    )?;
    let version: Value =
        serde_json::from_str(&fs::read_to_string(&version_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;

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
        tasks.push(async move {
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

fn build_game_args(
    version: &Value,
    instance: &Path,
    assets_dir: &Path,
    assets_index: &str,
    username: &str,
) -> Result<Vec<String>, String> {
    let player_uuid = Uuid::new_v3(
        &Uuid::NAMESPACE_DNS,
        format!("OfflinePlayer:{username}").as_bytes(),
    );
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

/// Prepare (if needed) then spawn the game process.
pub async fn launch_game(app: &AppHandle, opts: LaunchOpts) -> Result<Child, String> {
    prepare_runtime(app, &opts.root, &opts.instance).await?;

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

    let log_config = ensure_log_config(&opts.root, &version).await?;
    let log_owned = log_config.clone();
    let log_ref = log_owned.as_deref();

    let jvm = build_jvm_args(
        &version,
        &classpath,
        &natives,
        log_ref,
        opts.ram_mb.clamp(1024, 32768),
        &opts.jvm_args,
    )?;
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

    let mut cmd = Command::new(&opts.java);
    cmd.args(&jvm)
        .arg(main_class)
        .args(&game)
        .current_dir(&opts.instance)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .env("JAVA_HOME", &java_home);

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

    cmd.spawn().map_err(|e| format!("Failed to start Java: {e}"))
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
    let mut jars = Vec::new();
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
        jars.push(jar);
    }
    let client = instance::find_client_jar(instance, version, client_jar_hint)?;
    jars.push(client);
    Ok(jars)
}
