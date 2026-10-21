//! Unlim (zshare) — free P2P port tunnel.
//! Voice always uses Unlim. In `network_mode=unlim`, Open-to-LAN shares the
//! same host session (LiveKit ports + fixed LAN TCP). Hybrid keeps LAN on Porthole.

use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// Default Open-to-LAN TCP port for Unlim-only mode (mcwifipnp `port`).
pub const DEFAULT_LAN_TCP_PORT: u16 = 55666;

/// Prefer this name in call sites that still expect a constant default.
pub const LAN_TCP_PORT: u16 = DEFAULT_LAN_TCP_PORT;

pub fn normalize_lan_port(raw: Option<u16>) -> u16 {
    match raw {
        Some(p) if (1024..=65535).contains(&p) => p,
        _ => DEFAULT_LAN_TCP_PORT,
    }
}

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
    /// LAN TCP reserved in the current Unlim host (Unlim-only shared lobby).
    pub host_lan_port: Option<u16>,
    /// Background join for voice / game guest.
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
    crate::process_ext::hide_console(&mut cmd);
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

#[derive(Debug, Deserialize)]
struct ApiEndpointFile {
    host: String,
    port: u16,
}

#[derive(Debug, Deserialize)]
struct ApiStatusPort {
    port: u16,
    #[serde(default)]
    proto: String,
}

#[derive(Debug, Deserialize)]
struct ApiStatusData {
    key: Option<String>,
    #[serde(default)]
    ports: Vec<ApiStatusPort>,
}

#[derive(Debug, Deserialize)]
struct ApiStatusEnvelope {
    ok: Option<bool>,
    data: Option<ApiStatusData>,
}

#[derive(Debug, Clone)]
struct LiveStatus {
    key: String,
    /// `port/proto` e.g. `55666/tcp`
    ports: Vec<String>,
}

fn unlimited_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".unlimited"))
}

/// Local Unlim HTTP control plane (`~/.unlimited/api_endpoint` + token).
/// CLI `status` sometimes lies after unclean shutdown; the API stays truthful.
fn http_live_status() -> Option<LiveStatus> {
    let dir = unlimited_dir()?;
    let ep_raw = fs::read_to_string(dir.join("api_endpoint")).ok()?;
    let ep: ApiEndpointFile = serde_json::from_str(ep_raw.trim()).ok()?;
    let token = fs::read_to_string(dir.join("api_token"))
        .ok()?
        .trim()
        .to_string();
    if token.is_empty() || ep.host.is_empty() || ep.port == 0 {
        return None;
    }
    let url = format!("http://{}:{}/api/status", ep.host.trim(), ep.port);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
        .ok()?;
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body = resp.text().ok()?;
    let env: ApiStatusEnvelope = serde_json::from_str(&body).ok()?;
    if env.ok == Some(false) {
        return None;
    }
    let data = env.data?;
    let key = data.key.filter(|k| k.len() >= 8)?;
    let ports = data
        .ports
        .into_iter()
        .map(|p| {
            let proto = if p.proto.is_empty() {
                "tcp".into()
            } else {
                p.proto.to_ascii_lowercase()
            };
            format!("{}/{proto}", p.port)
        })
        .collect();
    Some(LiveStatus { key, ports })
}

fn parse_key_from_status(raw: &str) -> Option<String> {
    // HTTP API envelope: { ok, data: { key, ports } }
    if let Ok(env) = serde_json::from_str::<ApiStatusEnvelope>(raw.trim()) {
        if let Some(k) = env.data.and_then(|d| d.key).filter(|s| !s.is_empty()) {
            return Some(k);
        }
    }
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

fn cli_live_status(bin: &Path) -> Option<LiveStatus> {
    let raw = api_call(bin, &["status", "--json"]).ok()?;
    let key = parse_key_from_status(&raw)?;
    // CLI JSON may list ports; keep raw for includes() fallback.
    let ports = if let Ok(v) = serde_json::from_str::<StatusJson>(raw.trim()) {
        v.ports
            .iter()
            .filter_map(|p| {
                if let Some(s) = p.as_str() {
                    return Some(s.to_string());
                }
                let port = p.get("port")?.as_u64()? as u16;
                let proto = p
                    .get("proto")
                    .and_then(|x| x.as_str())
                    .unwrap_or("tcp");
                Some(format!("{port}/{proto}"))
            })
            .collect()
    } else {
        Vec::new()
    };
    Some(LiveStatus { key, ports })
}

fn live_status(app: &AppHandle) -> Option<LiveStatus> {
    if let Some(bin) = find_binary(app) {
        if let Some(st) = cli_live_status(&bin) {
            return Some(st);
        }
    }
    http_live_status()
}

fn wait_for_key(bin: &Path, timeout: Duration) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let mut last_err = String::new();
    while Instant::now() < deadline {
        if let Some(st) = cli_live_status(bin).or_else(http_live_status) {
            return Ok(st.key);
        }
        match api_call(bin, &["status", "--json"]) {
            Ok(raw) => {
                if let Some(k) = parse_key_from_status(&raw) {
                    return Ok(k);
                }
                last_err = "Unlim running but no share key yet".into();
            }
            Err(e) => last_err = e,
        }
        // CLI often returns exit 3 with a stale-PID message while the HTTP API is fine.
        if let Some(st) = http_live_status() {
            return Ok(st.key);
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

pub fn shared_port_args(lan_port: Option<u16>) -> Vec<String> {
    let mut args = voice_port_args();
    if let Some(port) = lan_port.filter(|p| *p > 0) {
        args.push(format!("{port}/tcp"));
    }
    args
}

/// `--background` forks a daemon; the spawned CLI child often exits immediately.
/// Liveness: CLI `status` first, then local HTTP API (`~/.unlimited`).
fn status_key(app: &AppHandle) -> Option<String> {
    live_status(app).map(|s| s.key)
}

fn status_ports_include(app: &AppHandle, port: u16) -> bool {
    let Some(st) = live_status(app) else {
        return false;
    };
    let tcp = format!("{port}/tcp");
    let prefix = format!("{port}/");
    st.ports
        .iter()
        .any(|p| p == &tcp || p.starts_with(&prefix) || p == &port.to_string())
}

fn reap_host_child(state: &UnlimState) {
    if let Ok(mut g) = state.lock() {
        if let Some(child) = g.host.as_mut() {
            let _ = child.try_wait();
        }
    }
}

pub fn current_host_key(state: &UnlimState) -> Option<String> {
    state.lock().ok()?.host_key.clone()
}

pub fn host_lan_port(state: &UnlimState) -> Option<u16> {
    state.lock().ok()?.host_lan_port
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlimHostState {
    pub key: Option<String>,
    pub lan_port: Option<u16>,
    pub alive: bool,
}

pub fn host_state(app: &AppHandle, state: &UnlimState) -> UnlimHostState {
    reap_host_child(state);
    let live_key = status_key(app);
    let stored_key = current_host_key(state);
    let lan = host_lan_port(state);
    match live_key {
        Some(key) => {
            // Refresh memory from daemon so UI reuse checks stay accurate.
            if let Ok(mut g) = state.lock() {
                g.host_key = Some(key.clone());
            }
            UnlimHostState {
                key: Some(key),
                lan_port: lan,
                alive: true,
            }
        }
        None => UnlimHostState {
            key: None,
            lan_port: if stored_key.is_some() { lan } else { None },
            alive: false,
        },
    }
}

/// Start or reuse Unlim host. `lan_port` reserves Open-to-LAN TCP in the same key.
///
/// Never restart an alive session when the wanted LAN port is already exposed
/// (voice opens LiveKit + LAN together). Restart only if we must add a missing port.
pub fn ensure_shared_host(
    app: &AppHandle,
    state: &UnlimState,
    lan_port: Option<u16>,
) -> Result<String, String> {
    let want = lan_port.filter(|p| *p > 0);
    reap_host_child(state);

    if let Some(key) = status_key(app) {
        let have = host_lan_port(state);
        let ok = match want {
            None => true,
            Some(w) => have == Some(w) || status_ports_include(app, w),
        };
        if ok {
            if let Ok(mut g) = state.lock() {
                g.host_key = Some(key.clone());
                if let Some(w) = want {
                    g.host_lan_port = Some(w);
                }
            }
            return Ok(key);
        }
    }

    start_shared_host(app, state, want)
}

fn start_shared_host(
    app: &AppHandle,
    state: &UnlimState,
    lan_port: Option<u16>,
) -> Result<String, String> {
    let bin = find_binary(app).ok_or_else(|| {
        "Unlim not found — install from Network → Unlim (unlim.cc), or set the binary path"
            .to_string()
    })?;
    stop_host(app, state);

    let mut args: Vec<String> = vec!["host".into()];
    args.extend(shared_port_args(lan_port));
    args.extend([
        "--background".into(),
        "--no-tui".into(),
        "--yes".into(),
    ]);

    let mut cmd = Command::new(&bin);
    crate::process_ext::hide_console(&mut cmd);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    if let Some(dir) = bin.parent() {
        cmd.current_dir(dir);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Unlim host: {e}"))?;
    // Background mode: CLI may exit after forking — do not treat that as failure.
    let _ = child.try_wait();

    if let Ok(mut g) = state.lock() {
        g.host = Some(child);
        g.host_lan_port = lan_port;
    }

    let key = wait_for_key(&bin, Duration::from_secs(25)).map_err(|e| {
        stop_host(app, state);
        e
    })?;

    if let Ok(mut g) = state.lock() {
        g.host_key = Some(key.clone());
        g.host_lan_port = lan_port;
        // Reap again in case the child exited while waiting for the key.
        if let Some(c) = g.host.as_mut() {
            let _ = c.try_wait();
        }
    }
    Ok(key)
}

/// Expose LiveKit via Unlim (no LAN reserve). Returns the session key for guests.
pub fn start_voice_host(app: &AppHandle, state: &UnlimState) -> Result<String, String> {
    ensure_shared_host(app, state, None)
}

pub fn stop_host(app: &AppHandle, state: &UnlimState) {
    if let Some(bin) = find_binary(app) {
        let _ = api_call(&bin, &["quit", "--yes"]);
        let _ = api_call(&bin, &["stop", "--yes"]);
    }
    if let Ok(mut g) = state.lock() {
        kill_child(&mut g.host);
        g.host_key = None;
        g.host_lan_port = None;
    }
}

/// Guest: join host Unlim key and wait until `wait_port` accepts on localhost.
pub fn start_join_wait_port(
    app: &AppHandle,
    state: &UnlimState,
    key: &str,
    wait_port: u16,
    purpose: &str,
) -> Result<(), String> {
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
    if port_open(wait_port) {
        return Ok(());
    }

    let mut cmd = Command::new(&bin);
    crate::process_ext::hide_console(&mut cmd);
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
        if port_open(wait_port) {
            return Ok(());
        }
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
        "Unlim connected but localhost:{wait_port} is not open yet — is the host still {purpose}?"
    ))
}

/// Guest: join host Unlim key and wait until LiveKit TCP is local.
pub fn start_voice_join(app: &AppHandle, state: &UnlimState, key: &str) -> Result<(), String> {
    start_join_wait_port(
        app,
        state,
        key,
        crate::voice_runtime::LK_TCP_PORT,
        "in voice",
    )
}

/// Guest: join Unlim key for Minecraft Open-to-LAN.
pub fn start_game_join(app: &AppHandle, state: &UnlimState, key: &str, port: u16) -> Result<(), String> {
    let port = normalize_lan_port(Some(port));
    start_join_wait_port(app, state, key, port, "hosting LAN")
}

/// Write `port` into mcwifipnp.json for an instance (Open-to-LAN UI default).
pub fn write_mcwifipnp_lan_port(instance: &Path, port: u16) -> Result<(), String> {
    let port = normalize_lan_port(Some(port));
    let dir = instance.join("config");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("mcwifipnp.json");
    let mut value: serde_json::Value = if path.is_file() {
        serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    let Some(obj) = value.as_object_mut() else {
        return Ok(());
    };
    obj.insert("port".into(), serde_json::json!(port));
    let pretty = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&path, pretty).map_err(|e| e.to_string())?;
    Ok(())
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
