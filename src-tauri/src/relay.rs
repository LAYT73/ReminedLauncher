//! Remined Relay — self-hosted frp (STCP/SUDP) tunnel.
//! Replaces Relay. Voice always uses this relay. In `network_mode=relay`
//! (legacy id = "relay only"), Open-to-LAN shares the same host session
//! (LiveKit ports + LAN TCP).

use crate::paths;
use crate::voice_runtime::{LK_RTC_TCP_PORT, LK_TCP_PORT, LK_UDP_MUX};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use uuid::Uuid;

/// Default Open-to-LAN TCP port (mcwifipnp `port`).
pub const DEFAULT_LAN_TCP_PORT: u16 = 55666;
pub const LAN_TCP_PORT: u16 = DEFAULT_LAN_TCP_PORT;

/// Share-code prefix: `rmd1_<id>_<sk>_<lanPortOr0>`.
const SHARE_PREFIX: &str = "rmd1_";

/// frps credentials from Supabase `relay-creds` (never baked into the binary).
#[derive(Debug, Clone)]
struct FrpsCreds {
    addr: String,
    port: u16,
    token: String,
}

fn creds_slot() -> &'static Mutex<Option<FrpsCreds>> {
    static CREDS: Mutex<Option<FrpsCreds>> = Mutex::new(None);
    &CREDS
}

/// Called by the UI after `relay-creds` edge function returns.
pub fn set_frps_creds(addr: String, port: u16, token: String) -> Result<(), String> {
    let addr = addr.trim().to_string();
    let token = token.trim().to_string();
    if addr.is_empty() || token.is_empty() || port == 0 {
        return Err("Invalid Remined Relay credentials".into());
    }
    let mut g = creds_slot()
        .lock()
        .map_err(|_| "Relay credentials lock poisoned".to_string())?;
    *g = Some(FrpsCreds { addr, port, token });
    Ok(())
}

fn frps_creds() -> Result<FrpsCreds, String> {
    creds_slot()
        .lock()
        .map_err(|_| "Relay credentials lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| {
            "Remined Relay credentials missing — sign in and retry (fetched from Supabase)"
                .into()
        })
}

pub fn normalize_lan_port(raw: Option<u16>) -> u16 {
    match raw {
        Some(p) if (1024..=65535).contains(&p) => p,
        _ => DEFAULT_LAN_TCP_PORT,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub message: String,
    pub custom_path: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayCheckResult {
    pub ok: bool,
    pub installed: bool,
    pub message: String,
    pub detail: String,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Default)]
pub struct RelayRuntime {
    /// LiveKit (voice) frpc — never restarted when LAN attaches.
    pub host: Option<Child>,
    pub host_key: Option<String>,
    pub host_lan_port: Option<u16>,
    /// Extra frpc that only exposes Open-to-LAN (same session id/sk).
    lan: Option<Child>,
    lan_dir: Option<PathBuf>,
    pub join: Option<Child>,
    /// Work dir for the active host frpc (config + logs).
    host_dir: Option<PathBuf>,
    join_dir: Option<PathBuf>,
    /// Guest: extra visitor frpc for LAN while voice join stays up.
    join_lan: Option<Child>,
    join_lan_dir: Option<PathBuf>,
}

pub type RelayState = Arc<Mutex<RelayRuntime>>;

#[derive(Debug, Clone)]
struct SessionSpec {
    id: String,
    sk: String,
    lan: Option<u16>,
}

impl SessionSpec {
    fn encode(&self) -> String {
        let lan = self.lan.unwrap_or(0);
        format!("{SHARE_PREFIX}{}_{}_{lan}", self.id, self.sk)
    }

    fn parse(raw: &str) -> Result<Self, String> {
        let t = raw.trim();
        let t = t.strip_prefix("rmd:").unwrap_or(t);
        let t = t.strip_prefix("relay:").unwrap_or(t);
        let body = t.strip_prefix(SHARE_PREFIX).ok_or_else(|| {
            "Invalid Remined relay share code (expected rmd1_…)".to_string()
        })?;
        // id and sk are hex without underscores; lan is trailing number.
        let (id_sk, lan_s) = body.rsplit_once('_').ok_or_else(|| {
            "Invalid Remined relay share code".to_string()
        })?;
        let (id, sk) = id_sk.split_once('_').ok_or_else(|| {
            "Invalid Remined relay share code".to_string()
        })?;
        let lan_n: u16 = lan_s
            .trim()
            .parse()
            .map_err(|_| "Invalid LAN port in share code".to_string())?;
        if id.len() < 6 || sk.len() < 12 {
            return Err("Invalid Remined relay share code".into());
        }
        Ok(Self {
            id: id.to_string(),
            sk: sk.to_string(),
            lan: if lan_n > 0 { Some(lan_n) } else { None },
        })
    }

    fn proxy_name(&self, kind: &str) -> String {
        format!("rmd-{}-{kind}", self.id)
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn custom_path_file(app: &AppHandle) -> Result<PathBuf, String> {
    let root = paths::remined_root(app)?;
    let dir = root.join(".remined");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("frpc_path.txt"))
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

fn frp_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = paths::remined_root(app)?;
    let dir = root.join(".remined").join("frp");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn frpc_bin_name() -> &'static str {
    if cfg!(windows) {
        "frpc.exe"
    } else {
        "frpc"
    }
}

fn candidate_binaries(app: &AppHandle) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(custom) = get_custom_path(app) {
        out.push(PathBuf::from(custom));
    }
    if let Ok(env) = std::env::var("REMINED_FRPC_PATH") {
        let p = PathBuf::from(env.trim());
        if !p.as_os_str().is_empty() {
            out.push(p);
        }
    }
    if let Ok(dir) = frp_dir(app) {
        out.push(dir.join(frpc_bin_name()));
    }
    if let Some(home) = home_dir() {
        out.push(home.join(".local/bin").join(frpc_bin_name()));
    }
    out.push(PathBuf::from("/usr/local/bin").join(frpc_bin_name()));
    out.push(PathBuf::from("/opt/homebrew/bin").join(frpc_bin_name()));
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            out.push(dir.join(frpc_bin_name()));
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

fn set_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("codesign")
            .args(["--force", "--sign", "-", "--timestamp=none"])
            .arg(path)
            .status();
    }
    let _ = path;
    Ok(())
}

fn frpc_download_url() -> Result<&'static str, String> {
    if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        Ok(concat!(
            "https://github.com/fatedier/frp/releases/download/v",
            "0.71.1",
            "/frp_0.71.1_darwin_arm64.tar.gz"
        ))
    } else if cfg!(target_os = "macos") {
        Ok(concat!(
            "https://github.com/fatedier/frp/releases/download/v",
            "0.71.1",
            "/frp_0.71.1_darwin_amd64.tar.gz"
        ))
    } else if cfg!(target_os = "windows") {
        Ok(concat!(
            "https://github.com/fatedier/frp/releases/download/v",
            "0.71.1",
            "/frp_0.71.1_windows_amd64.zip"
        ))
    } else if cfg!(target_arch = "aarch64") {
        Ok(concat!(
            "https://github.com/fatedier/frp/releases/download/v",
            "0.71.1",
            "/frp_0.71.1_linux_arm64.tar.gz"
        ))
    } else {
        Ok(concat!(
            "https://github.com/fatedier/frp/releases/download/v",
            "0.71.1",
            "/frp_0.71.1_linux_amd64.tar.gz"
        ))
    }
}

fn extract_frpc(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let want = frpc_bin_name();
    if cfg!(windows) || bytes.starts_with(b"PK") {
        let cursor = std::io::Cursor::new(bytes);
        let mut zip = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = file.name().map_err(|e| e.to_string())?.to_string();
            let base = Path::new(&name)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            if base != want {
                continue;
            }
            let mut out = File::create(dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
            set_executable(dest)?;
            return Ok(());
        }
        return Err("frpc not found in zip".into());
    }
    let dec = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(dec);
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if name != want {
            continue;
        }
        let mut out = File::create(dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        set_executable(dest)?;
        return Ok(());
    }
    Err("frpc not found in archive".into())
}

/// Download frpc into `.remined/frp/` if missing.
pub fn ensure_binary(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(bin) = find_binary(app) {
        return Ok(bin);
    }
    let dir = frp_dir(app)?;
    let dest = dir.join(frpc_bin_name());
    let url = frpc_download_url()?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::limited(10))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .send()
        .map_err(|e| format!("frpc download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("frpc download HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    extract_frpc(&bytes, &dest)?;
    if !dest.is_file() {
        return Err("frpc missing after extract".into());
    }
    Ok(dest)
}

fn run_capture(bin: &Path, args: &[&str]) -> Result<(i32, String, String), String> {
    let mut cmd = Command::new(bin);
    crate::process_ext::hide_console(&mut cmd);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    let output = cmd.output().map_err(|e| format!("Failed to run frpc: {e}"))?;
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
        .find(|l| !l.is_empty())
        .map(|s| s.replace("frpc version ", "").trim().to_string())
}

pub fn status(app: &AppHandle) -> RelayStatus {
    let custom = get_custom_path(app).is_some();
    match find_binary(app) {
        Some(bin) => {
            let ver = read_version(&bin);
            RelayStatus {
                installed: true,
                path: Some(bin.display().to_string()),
                version: ver.clone(),
                message: match &ver {
                    Some(v) => format!("Remined Relay (frpc {v})"),
                    None => "Remined Relay ready".into(),
                },
                custom_path: custom,
            }
        }
        None => RelayStatus {
            installed: false,
            path: None,
            version: None,
            message: "Relay client not installed — tap Check to download frpc".into(),
            custom_path: custom,
        },
    }
}

pub fn check(app: &AppHandle) -> RelayCheckResult {
    match ensure_binary(app) {
        Ok(bin) => {
            let ver = read_version(&bin);
            let ok = ver.is_some();
            RelayCheckResult {
                ok,
                installed: true,
                message: if ok {
                    format!("Relay ready (frpc {})", ver.as_deref().unwrap_or("?"))
                } else {
                    "frpc found but --version failed".into()
                },
                detail: frps_creds()
                    .map(|c| format!("{}:{}", c.addr, c.port))
                    .unwrap_or_else(|_| "credentials pending (Supabase)".into()),
                path: Some(bin.display().to_string()),
                version: ver,
            }
        }
        Err(e) => RelayCheckResult {
            ok: false,
            installed: false,
            message: e.clone(),
            detail: e,
            path: None,
            version: None,
        },
    }
}

fn kill_child(slot: &mut Option<Child>) {
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn write_host_toml(path: &Path, spec: &SessionSpec) -> Result<(), String> {
    let c = frps_creds()?;
    let mut body = format!(
        r#"serverAddr = "{addr}"
serverPort = {port}
auth.method = "token"
auth.token = "{token}"
loginFailExit = false

[[proxies]]
name = "{n0}"
type = "stcp"
secretKey = "{sk}"
localIP = "127.0.0.1"
localPort = {p0}

[[proxies]]
name = "{n1}"
type = "stcp"
secretKey = "{sk}"
localIP = "127.0.0.1"
localPort = {p1}

[[proxies]]
name = "{n2}"
type = "sudp"
secretKey = "{sk}"
localIP = "127.0.0.1"
localPort = {p2}
"#,
        addr = c.addr,
        port = c.port,
        token = c.token,
        sk = spec.sk,
        n0 = spec.proxy_name("lk7880"),
        n1 = spec.proxy_name("lk7881"),
        n2 = spec.proxy_name("lk7882"),
        p0 = LK_TCP_PORT,
        p1 = LK_RTC_TCP_PORT,
        p2 = LK_UDP_MUX,
    );
    if let Some(lan) = spec.lan {
        body.push_str(&format!(
            r#"
[[proxies]]
name = "{n}"
type = "stcp"
secretKey = "{sk}"
localIP = "127.0.0.1"
localPort = {lan}
"#,
            n = spec.proxy_name(&format!("lan{lan}")),
            sk = spec.sk,
            lan = lan,
        ));
    }
    fs::write(path, body).map_err(|e| e.to_string())
}

fn write_lan_host_toml(path: &Path, spec: &SessionSpec, lan: u16) -> Result<(), String> {
    let c = frps_creds()?;
    let body = format!(
        r#"serverAddr = "{addr}"
serverPort = {port}
auth.method = "token"
auth.token = "{token}"
loginFailExit = false

[[proxies]]
name = "{n}"
type = "stcp"
secretKey = "{sk}"
localIP = "127.0.0.1"
localPort = {lan}
"#,
        addr = c.addr,
        port = c.port,
        token = c.token,
        n = spec.proxy_name(&format!("lan{lan}")),
        sk = spec.sk,
        lan = lan,
    );
    fs::write(path, body).map_err(|e| e.to_string())
}

fn write_lan_visitor_toml(path: &Path, spec: &SessionSpec, lan: u16) -> Result<(), String> {
    let c = frps_creds()?;
    let body = format!(
        r#"serverAddr = "{addr}"
serverPort = {port}
auth.method = "token"
auth.token = "{token}"
loginFailExit = false

[[visitors]]
name = "{n}-v"
type = "stcp"
serverName = "{n}"
secretKey = "{sk}"
bindAddr = "127.0.0.1"
bindPort = {lan}
"#,
        addr = c.addr,
        port = c.port,
        token = c.token,
        n = spec.proxy_name(&format!("lan{lan}")),
        sk = spec.sk,
        lan = lan,
    );
    fs::write(path, body).map_err(|e| e.to_string())
}

fn write_visitor_toml(path: &Path, spec: &SessionSpec) -> Result<(), String> {
    let c = frps_creds()?;
    let mut body = format!(
        r#"serverAddr = "{addr}"
serverPort = {port}
auth.method = "token"
auth.token = "{token}"
loginFailExit = false

[[visitors]]
name = "{n0}-v"
type = "stcp"
serverName = "{n0}"
secretKey = "{sk}"
bindAddr = "127.0.0.1"
bindPort = {p0}

[[visitors]]
name = "{n1}-v"
type = "stcp"
serverName = "{n1}"
secretKey = "{sk}"
bindAddr = "127.0.0.1"
bindPort = {p1}

[[visitors]]
name = "{n2}-v"
type = "sudp"
serverName = "{n2}"
secretKey = "{sk}"
bindAddr = "127.0.0.1"
bindPort = {p2}
"#,
        addr = c.addr,
        port = c.port,
        token = c.token,
        sk = spec.sk,
        n0 = spec.proxy_name("lk7880"),
        n1 = spec.proxy_name("lk7881"),
        n2 = spec.proxy_name("lk7882"),
        p0 = LK_TCP_PORT,
        p1 = LK_RTC_TCP_PORT,
        p2 = LK_UDP_MUX,
    );
    if let Some(lan) = spec.lan {
        body.push_str(&format!(
            r#"
[[visitors]]
name = "{n}-v"
type = "stcp"
serverName = "{n}"
secretKey = "{sk}"
bindAddr = "127.0.0.1"
bindPort = {lan}
"#,
            n = spec.proxy_name(&format!("lan{lan}")),
            sk = spec.sk,
            lan = lan,
        ));
    }
    fs::write(path, body).map_err(|e| e.to_string())
}

fn spawn_frpc(bin: &Path, config: &Path) -> Result<Child, String> {
    let mut cmd = Command::new(bin);
    crate::process_ext::hide_console(&mut cmd);
    cmd.arg("-c")
        .arg(config)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    if let Some(dir) = config.parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn()
        .map_err(|e| format!("Failed to start frpc: {e}"))
}

fn new_session(lan_port: Option<u16>) -> SessionSpec {
    let id = Uuid::new_v4().simple().to_string()[..10].to_string();
    let sk = Uuid::new_v4().simple().to_string();
    SessionSpec {
        id,
        sk,
        lan: lan_port.filter(|p| *p > 0),
    }
}

fn reap_host_child(state: &RelayState) {
    if let Ok(mut g) = state.lock() {
        if let Some(child) = g.host.as_mut() {
            let _ = child.try_wait();
        }
    }
}

pub fn current_host_key(state: &RelayState) -> Option<String> {
    state.lock().ok()?.host_key.clone()
}

pub fn host_lan_port(state: &RelayState) -> Option<u16> {
    state.lock().ok()?.host_lan_port
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayHostState {
    pub key: Option<String>,
    pub lan_port: Option<u16>,
    pub alive: bool,
}

pub fn host_state(_app: &AppHandle, state: &RelayState) -> RelayHostState {
    reap_host_child(state);
    let mut alive = false;
    let mut key = None;
    let mut lan = None;
    if let Ok(mut g) = state.lock() {
        lan = g.host_lan_port;
        key = g.host_key.clone();
        if let Some(child) = g.host.as_mut() {
            match child.try_wait() {
                Ok(None) => alive = key.is_some(),
                Ok(Some(_)) => {
                    g.host = None;
                    g.host_key = None;
                    g.host_lan_port = None;
                    key = None;
                    lan = None;
                    alive = false;
                }
                Err(_) => alive = false,
            }
        }
    }
    RelayHostState {
        key,
        lan_port: lan,
        alive,
    }
}

/// Start or reuse Remined Relay host.
/// `lan_port`: when voice is already up, attaches LAN without restarting voice.
pub fn ensure_shared_host(
    app: &AppHandle,
    state: &RelayState,
    lan_port: Option<u16>,
) -> Result<String, String> {
    let want = lan_port.filter(|p| *p > 0);
    reap_host_child(state);

    let st = host_state(app, state);
    if st.alive {
        if let Some(key) = st.key.clone() {
            match want {
                None => return Ok(key),
                Some(w) if st.lan_port == Some(w) => return Ok(key),
                Some(w) => return attach_lan_port(app, state, w),
            }
        }
    }

    // Fresh host: voice-only first (LAN attaches later from the real MC port).
    start_shared_host(app, state, None).and_then(|key| match want {
        Some(w) => attach_lan_port(app, state, w),
        None => Ok(key),
    })
}

/// Hot-add Open-to-LAN to a live relay session without touching the voice frpc.
pub fn attach_lan_port(
    app: &AppHandle,
    state: &RelayState,
    lan_port: u16,
) -> Result<String, String> {
    let lan_port = normalize_lan_port(Some(lan_port));
    reap_host_child(state);
    let st = host_state(app, state);
    if !st.alive {
        return Err("Relay host is not running — start voice or ensure host first".into());
    }
    let key = st.key.ok_or_else(|| "Relay host key missing".to_string())?;
    if st.lan_port == Some(lan_port) {
        return Ok(key);
    }

    let mut spec = SessionSpec::parse(&key)?;
    spec.lan = Some(lan_port);
    let bin = ensure_binary(app)?;

    // Replace only the LAN frpc child.
    stop_lan_only(state);

    let work = frp_dir(app)?.join(format!("host-{}-lan", spec.id));
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let cfg = work.join("frpc.toml");
    write_lan_host_toml(&cfg, &spec, lan_port)?;

    let mut child = spawn_frpc(&bin, &cfg).map_err(|e| {
        let _ = fs::remove_dir_all(&work);
        e
    })?;
    thread::sleep(Duration::from_millis(600));
    if let Ok(Some(status)) = child.try_wait() {
        let err = read_child_stderr(&mut child);
        let _ = fs::remove_dir_all(&work);
        return Err(format!(
            "frpc LAN host exited ({status}){}",
            if err.is_empty() {
                String::new()
            } else {
                format!(": {err}")
            }
        ));
    }

    let new_key = spec.encode();
    if let Ok(mut g) = state.lock() {
        g.lan = Some(child);
        g.lan_dir = Some(work);
        g.host_lan_port = Some(lan_port);
        g.host_key = Some(new_key.clone());
    }
    Ok(new_key)
}

/// Drop LAN proxy only; voice frpc keeps running.
pub fn detach_lan_port(state: &RelayState) -> Option<String> {
    stop_lan_only(state);
    let mut out = None;
    if let Ok(mut g) = state.lock() {
        g.host_lan_port = None;
        if let Some(key) = g.host_key.clone() {
            if let Ok(mut spec) = SessionSpec::parse(&key) {
                spec.lan = None;
                let nk = spec.encode();
                g.host_key = Some(nk.clone());
                out = Some(nk);
            }
        }
    }
    out
}

fn stop_lan_only(state: &RelayState) {
    let dir = state.lock().ok().and_then(|mut g| {
        kill_child(&mut g.lan);
        g.lan_dir.take()
    });
    if let Some(dir) = dir {
        let _ = fs::remove_dir_all(dir);
    }
}

fn start_shared_host(
    app: &AppHandle,
    state: &RelayState,
    _lan_port: Option<u16>,
) -> Result<String, String> {
    let bin = ensure_binary(app)?;
    stop_host(app, state);

    // Always start voice-only; LAN is attached later via `attach_lan_port`.
    let spec = new_session(None);
    let key = spec.encode();
    let work = frp_dir(app)?.join(format!("host-{}", spec.id));
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let cfg = work.join("frpc.toml");
    write_host_toml(&cfg, &spec)?;

    let mut child = spawn_frpc(&bin, &cfg).map_err(|e| {
        let _ = fs::remove_dir_all(&work);
        e
    })?;

    // Give frpc a moment to register with frps.
    thread::sleep(Duration::from_millis(800));
    if let Ok(Some(status)) = child.try_wait() {
        let err = read_child_stderr(&mut child);
        let _ = fs::remove_dir_all(&work);
        return Err(format!(
            "frpc host exited immediately ({status}){}",
            if err.is_empty() {
                String::new()
            } else {
                format!(": {err}")
            }
        ));
    }

    if let Ok(mut g) = state.lock() {
        g.host = Some(child);
        g.host_key = Some(key.clone());
        g.host_lan_port = None;
        g.host_dir = Some(work);
    }
    Ok(key)
}

fn read_child_stderr(child: &mut Child) -> String {
    let mut buf = String::new();
    if let Some(mut err) = child.stderr.take() {
        use std::io::Read;
        let _ = err.read_to_string(&mut buf);
    }
    buf.trim().chars().take(400).collect()
}

pub fn start_voice_host(app: &AppHandle, state: &RelayState) -> Result<String, String> {
    ensure_shared_host(app, state, None)
}

pub fn stop_host(app: &AppHandle, state: &RelayState) {
    stop_lan_only(state);
    let dir = state.lock().ok().and_then(|mut g| {
        kill_child(&mut g.host);
        g.host_key = None;
        g.host_lan_port = None;
        g.host_dir.take()
    });
    if let Some(dir) = dir {
        let _ = fs::remove_dir_all(dir);
    }
    let _ = app;
}

fn same_join_session(state: &RelayState, id: &str) -> bool {
    state.lock().ok().is_some_and(|mut g| {
        let alive = g
            .join
            .as_mut()
            .map(|c| c.try_wait().ok().flatten().is_none())
            .unwrap_or(false);
        let id_ok = g
            .join_dir
            .as_ref()
            .and_then(|d| d.file_name())
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_prefix("join-"))
            == Some(id);
        alive && id_ok
    })
}

/// Guest: join relay share code and wait until `wait_port` accepts on localhost.
pub fn start_join_wait_port(
    app: &AppHandle,
    state: &RelayState,
    key: &str,
    wait_port: u16,
    purpose: &str,
) -> Result<(), String> {
    let mut spec = SessionSpec::parse(key)?;
    if port_open(wait_port) {
        return Ok(());
    }

    // Already in this voice session — add LAN visitor without dropping voice.
    if wait_port != LK_TCP_PORT && same_join_session(state, &spec.id) {
        return attach_lan_visitor(app, state, &spec, wait_port, purpose);
    }

    stop_join(app, state);

    // Voice join: LiveKit only. Game-only join: include LAN in the same visitor.
    if wait_port == LK_TCP_PORT {
        spec.lan = None;
    } else {
        spec.lan = Some(wait_port);
    }

    let bin = ensure_binary(app)?;
    let work = frp_dir(app)?.join(format!("join-{}", spec.id));
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let cfg = work.join("frpc.toml");
    write_visitor_toml(&cfg, &spec)?;

    let child = spawn_frpc(&bin, &cfg)?;
    if let Ok(mut g) = state.lock() {
        g.join = Some(child);
        g.join_dir = Some(work);
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
        "Relay connected but localhost:{wait_port} is not open yet — is the host still {purpose}?"
    ))
}

fn attach_lan_visitor(
    app: &AppHandle,
    state: &RelayState,
    spec: &SessionSpec,
    lan_port: u16,
    purpose: &str,
) -> Result<(), String> {
    if port_open(lan_port) {
        return Ok(());
    }
    let bin = ensure_binary(app)?;
    // Drop previous LAN visitor only.
    let old = state.lock().ok().and_then(|mut g| {
        kill_child(&mut g.join_lan);
        g.join_lan_dir.take()
    });
    if let Some(dir) = old {
        let _ = fs::remove_dir_all(dir);
    }

    let work = frp_dir(app)?.join(format!("join-{}-lan", spec.id));
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let cfg = work.join("frpc.toml");
    write_lan_visitor_toml(&cfg, spec, lan_port)?;
    let mut child = spawn_frpc(&bin, &cfg)?;
    thread::sleep(Duration::from_millis(500));
    if let Ok(Some(status)) = child.try_wait() {
        let err = read_child_stderr(&mut child);
        let _ = fs::remove_dir_all(&work);
        return Err(format!(
            "frpc LAN visitor exited ({status}){}",
            if err.is_empty() {
                String::new()
            } else {
                format!(": {err}")
            }
        ));
    }
    if let Ok(mut g) = state.lock() {
        g.join_lan = Some(child);
        g.join_lan_dir = Some(work);
    }
    let deadline = Instant::now() + Duration::from_secs(45);
    while Instant::now() < deadline {
        if port_open(lan_port) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(400));
    }
    Err(format!(
        "Relay LAN visitor up but localhost:{lan_port} not open — is the host still {purpose}?"
    ))
}

pub fn start_voice_join(app: &AppHandle, state: &RelayState, key: &str) -> Result<(), String> {
    start_join_wait_port(app, state, key, LK_TCP_PORT, "in voice")
}

pub fn start_game_join(
    app: &AppHandle,
    state: &RelayState,
    key: &str,
    port: u16,
) -> Result<(), String> {
    let port = normalize_lan_port(Some(port));
    // Prefer LAN from share code when present.
    let mut spec = SessionSpec::parse(key)?;
    if spec.lan.is_none() {
        spec.lan = Some(port);
    }
    let wait = spec.lan.unwrap_or(port);
    start_join_wait_port(app, state, &spec.encode(), wait, "hosting LAN")
}

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

pub fn stop_join(app: &AppHandle, state: &RelayState) {
    let lan_dir = state.lock().ok().and_then(|mut g| {
        kill_child(&mut g.join_lan);
        g.join_lan_dir.take()
    });
    if let Some(dir) = lan_dir {
        let _ = fs::remove_dir_all(dir);
    }
    let dir = state.lock().ok().and_then(|mut g| {
        kill_child(&mut g.join);
        g.join_dir.take()
    });
    if let Some(dir) = dir {
        let _ = fs::remove_dir_all(dir);
    }
    let _ = app;
}

fn port_open(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

/// Legacy name — opens frp releases (frpc auto-downloads on Check).
pub const DOWNLOAD_URL: &str = "https://github.com/fatedier/frp/releases";

/// Kept for call sites that built Relay CLI port args; unused by FRP host.
pub fn voice_port_args() -> Vec<String> {
    vec![
        format!("{LK_TCP_PORT}/tcp"),
        format!("{LK_RTC_TCP_PORT}/tcp"),
        format!("{LK_UDP_MUX}/udp"),
    ]
}

pub fn shared_port_args(lan_port: Option<u16>) -> Vec<String> {
    let mut args = voice_port_args();
    if let Some(port) = lan_port.filter(|p| *p > 0) {
        args.push(format!("{port}/tcp"));
    }
    args
}
