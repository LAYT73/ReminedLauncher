//! Unlim (zshare) — free P2P port tunnel for Remined Voice.
//! Network Play / Open-to-LAN stays on Steam Porthole.

use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlimStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub message: String,
    pub custom_path: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlimCheckResult {
    pub ok: bool,
    pub installed: bool,
    pub message: String,
    pub detail: String,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Default)]
pub struct UnlimRuntime {
    /// Background host (`unlim host … --background`).
    pub host: Option<Child>,
    pub host_key: Option<String>,
    /// Background join for voice guest.
    pub join: Option<Child>,
}

pub type UnlimState = Arc<Mutex<UnlimRuntime>>;

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn custom_path_file(app: &AppHandle) -> Result<PathBuf, String> {
    let root = paths::remined_root(app)?;
    let dir = root.join(".remined");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("unlim_path.txt"))
}

pub fn get_custom_path(app: &AppHandle) -> Option<String> {
    let path = custom_path_file(app).ok()?;
    let text = fs::read_to_string(path).ok()?;
    let t = text.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

pub fn set_custom_path(app: &AppHandle, path: Option<String>) -> Result<(), String> {
    let file = custom_path_file(app)?;
    match path.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        Some(p) => fs::write(&file, format!("{p}\n")).map_err(|e| e.to_string()),
        None => {
            if file.exists() {
                fs::remove_file(&file).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
    }
}

fn candidate_binaries(app: &AppHandle) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(custom) = get_custom_path(app) {
        out.push(PathBuf::from(custom));
    }
    if let Ok(env) = std::env::var("REMINED_UNLIM_PATH") {
        let p = PathBuf::from(env.trim());
        if !p.as_os_str().is_empty() {
            out.push(p);
        }
    }
    if let Some(home) = home_dir() {
        if cfg!(target_os = "macos") {
            out.push(home.join("Library/Application Support/Unlim/bin/unlim"));
            out.push(home.join("Library/Application Support/unlim/bin/unlim"));
        } else if cfg!(target_os = "windows") {
            if let Some(appdata) = std::env::var_os("APPDATA") {
                out.push(PathBuf::from(&appdata).join(r"Unlim\bin\unlim.exe"));
                out.push(PathBuf::from(&appdata).join(r"unlim\bin\unlim.exe"));
            }
            if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                out.push(PathBuf::from(&local).join(r"Unlim\unlim.exe"));
                out.push(PathBuf::from(&local).join(r"Unlim\bin\unlim.exe"));
            }
        } else {
            out.push(home.join(".local/bin/unlim"));
        }
    }
    if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
        out.push(PathBuf::from("/usr/local/bin/unlim"));
        out.push(PathBuf::from("/opt/homebrew/bin/unlim"));
    }
    // PATH lookup
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            if cfg!(windows) {
                out.push(dir.join("unlim.exe"));
            } else {
                out.push(dir.join("unlim"));
            }
        }
    }
    out
}

pub fn find_binary(app: &AppHandle) -> Option<PathBuf> {
    for p in candidate_binaries(app) {
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn run_capture(bin: &Path, args: &[&str]) -> Result<(i32, String, String), String> {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    if let Some(dir) = bin.parent() {
        cmd.current_dir(dir);
    }
    let output = cmd.output().map_err(|e| format!("Failed to run Unlim: {e}"))?;
    let code = output.status.code().unwrap_or(-1);
    let out = String::from_utf8_lossy(&output.stdout).into_owned();
    let err = String::from_utf8_lossy(&output.stderr).into_owned();
    Ok((code, out, err))
}

fn read_version(bin: &Path) -> Option<String> {
    let (_, out, err) = run_capture(bin, &["--version"]).ok()?;
    let text = format!("{out}{err}");
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && l.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(|s| s.to_string())
        .or_else(|| {
            text.split_whitespace()
                .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()))
                .map(|s| s.to_string())
        })
}

pub fn status(app: &AppHandle) -> UnlimStatus {
    let custom = get_custom_path(app).is_some();
    match find_binary(app) {
        Some(bin) => {
            let ver = read_version(&bin);
            UnlimStatus {
                installed: true,
                path: Some(bin.display().to_string()),
                version: ver.clone(),
                message: match &ver {
                    Some(v) => format!("Unlim {v}"),
                    None => "Unlim found".into(),
                },
                custom_path: custom,
            }
        }
        None => UnlimStatus {
            installed: false,
            path: None,
            version: None,
            message: "Unlim not found — install from unlim.cc or set the binary path below"
                .into(),
            custom_path: custom,
        },
    }
}

pub fn check(app: &AppHandle) -> UnlimCheckResult {
    let st = status(app);
    if !st.installed {
        return UnlimCheckResult {
            ok: false,
            installed: false,
            message: st.message.clone(),
            detail: String::new(),
            path: None,
            version: None,
        };
    }
    let Some(bin) = find_binary(app) else {
        return UnlimCheckResult {
            ok: false,
            installed: false,
            message: "Unlim not found".into(),
            detail: String::new(),
            path: None,
            version: None,
        };
    };
    let ver = st.version.clone();
    // --version already proves the binary runs.
    let ok = ver.is_some();
    UnlimCheckResult {
        ok,
        installed: true,
        message: if ok {
            format!("Unlim ready ({})", ver.as_deref().unwrap_or("?"))
        } else {
            "Unlim binary found but --version failed".into()
        },
        detail: bin.display().to_string(),
        path: Some(bin.display().to_string()),
        version: ver,
    }
}

fn kill_child(slot: &mut Option<Child>) {
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn api_call(bin: &Path, args: &[&str]) -> Result<String, String> {
    let (code, out, err) = run_capture(bin, args)?;
    if code != 0 && code != 3 {
        // 3 = nothing running — caller may handle
        let msg = err.trim();
        let fallback = out.trim();
        if !msg.is_empty() {
            return Err(msg.to_string());
        }
        if !fallback.is_empty() {
            return Err(fallback.to_string());
        }
        return Err(format!("unlim exited {code}"));
    }
    Ok(if out.trim().is_empty() {
        err
    } else {
        out
    })
}

#[derive(Debug, Deserialize)]
struct StatusJson {
    key: Option<String>,
    mode: Option<String>,
    #[serde(default)]
    ports: Vec<serde_json::Value>,
}

fn parse_key_from_status(raw: &str) -> Option<String> {
    // Prefer JSON line / whole body
    if let Ok(v) = serde_json::from_str::<StatusJson>(raw.trim()) {
        if let Some(k) = v.key.filter(|s| !s.is_empty()) {
            return Some(k);
        }
    }
    for line in raw.lines() {
        let t = line.trim();
        if let Ok(v) = serde_json::from_str::<StatusJson>(t) {
            if let Some(k) = v.key.filter(|s| !s.is_empty()) {
                return Some(k);
            }
        }
        if let Some(rest) = t.strip_prefix("Connect with key:") {
            let k = rest
                .trim()
                .trim_matches(|c: char| c == '\u{1b}' || c.is_ascii_control());
            // strip ANSI leftovers roughly
            let cleaned: String = k
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if cleaned.len() >= 8 {
                return Some(cleaned);
            }
        }
        if t.starts_with("zshareunlim-") || t.contains("zshareunlim-") {
            for part in t.split_whitespace() {
                let p = part.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_');
                if p.starts_with("zshareunlim-") && p.len() >= 16 {
                    return Some(p.to_string());
                }
            }
        }
    }
    None
}

fn wait_for_key(bin: &Path, timeout: Duration) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let mut last_err = String::new();
    while Instant::now() < deadline {
        match api_call(bin, &["status", "--json"]) {
            Ok(raw) => {
                if let Some(k) = parse_key_from_status(&raw) {
                    return Ok(k);
                }
                last_err = "Unlim running but no share key yet".into();
            }
            Err(e) => last_err = e,
        }
        thread::sleep(Duration::from_millis(400));
    }
    Err(if last_err.is_empty() {
        "Timed out waiting for Unlim share key".into()
    } else {
        last_err
    })
}

pub fn voice_port_args() -> Vec<String> {
    let mut args = vec![
        format!("{}/tcp", crate::voice_runtime::LK_TCP_PORT),
        format!("{}/tcp", crate::voice_runtime::LK_RTC_TCP_PORT),
    ];
    for p in crate::voice_runtime::LK_UDP_START..=crate::voice_runtime::LK_UDP_END {
        args.push(format!("{p}/udp"));
    }
    args
}

/// Expose LiveKit ports via Unlim. Returns the session key for guests.
pub fn start_voice_host(app: &AppHandle, state: &UnlimState) -> Result<String, String> {
    let bin = find_binary(app).ok_or_else(|| {
        "Unlim not found — install from Network → Unlim (unlim.cc), or set the binary path"
            .to_string()
    })?;
    // Stop previous voice host session we own.
    stop_host(app, state);

    let mut args: Vec<String> = vec!["host".into()];
    args.extend(voice_port_args());
    args.extend([
        "--background".into(),
        "--no-tui".into(),
        "--yes".into(),
    ]);

    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    if let Some(dir) = bin.parent() {
        cmd.current_dir(dir);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Unlim host: {e}"))?;

    if let Ok(mut g) = state.lock() {
        g.host = Some(child);
    }

    let key = wait_for_key(&bin, Duration::from_secs(25)).map_err(|e| {
        stop_host(app, state);
        e
    })?;

    if let Ok(mut g) = state.lock() {
        g.host_key = Some(key.clone());
    }
    Ok(key)
}

pub fn stop_host(app: &AppHandle, state: &UnlimState) {
    if let Some(bin) = find_binary(app) {
        let _ = api_call(&bin, &["quit", "--yes"]);
        let _ = api_call(&bin, &["stop", "--yes"]);
    }
    if let Ok(mut g) = state.lock() {
        kill_child(&mut g.host);
        g.host_key = None;
    }
}

/// Guest: join host Unlim key and wait until LiveKit TCP is local.
pub fn start_voice_join(app: &AppHandle, state: &UnlimState, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.len() < 8 {
        return Err("Invalid Unlim share key".into());
    }
    let bin = find_binary(app).ok_or_else(|| {
        "Unlim not found — install from Network → Unlim (unlim.cc), or set the binary path"
            .to_string()
    })?;
    stop_join(app, state);

    // Already open (reconnect / leftover) — skip.
    if port_open(crate::voice_runtime::LK_TCP_PORT) {
        return Ok(());
    }

    let mut cmd = Command::new(&bin);
    cmd.args([
        "join",
        key,
        "--background",
        "--no-tui",
        "--yes",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .stdin(Stdio::null());
    if let Some(dir) = bin.parent() {
        cmd.current_dir(dir);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Unlim join: {e}"))?;
    if let Ok(mut g) = state.lock() {
        g.join = Some(child);
    }

    let deadline = Instant::now() + Duration::from_secs(45);
    while Instant::now() < deadline {
        if port_open(crate::voice_runtime::LK_TCP_PORT) {
            return Ok(());
        }
        // Bail if child died early
        let dead = state.lock().ok().is_some_and(|mut g| {
            g.join
                .as_mut()
                .and_then(|c| c.try_wait().ok().flatten())
                .is_some()
        });
        if dead {
            break;
        }
        thread::sleep(Duration::from_millis(400));
    }
    stop_join(app, state);
    Err(format!(
        "Unlim connected but localhost:{} is not open yet — is the host still in voice?",
        crate::voice_runtime::LK_TCP_PORT
    ))
}

pub fn stop_join(app: &AppHandle, state: &UnlimState) {
    // Always quit before a new join / leave — a dead child can leave ports bound
    // to an old key, and room switches must not reuse that tunnel.
    if let Some(bin) = find_binary(app) {
        let _ = api_call(&bin, &["quit", "--yes"]);
    }
    if let Ok(mut g) = state.lock() {
        kill_child(&mut g.join);
    }
}

fn port_open(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

pub const DOWNLOAD_URL: &str = "https://unlim.cc/";
