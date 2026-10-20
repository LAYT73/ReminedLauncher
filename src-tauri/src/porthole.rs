//! Orchestrate Steam Porthole CLI for Minecraft LAN Join.

use crate::net_log;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// True when something accepts TCP on `127.0.0.1:port` (Porthole bind or LiveKit).
fn port_listening(port: u16) -> bool {
    if port == 0 {
        return false;
    }
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .is_ok()
}

pub(crate) fn wait_port_listening(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if port_listening(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

pub const STEAM_APP_ID: &str = "4963920";
pub const STEAM_STORE_URL: &str =
    "https://store.steampowered.com/app/4963920/Porthole__Local_Port_Sharing/";
pub const STEAM_DEEP_LINK: &str = "steam://store/4963920";
pub const STEAM_INSTALL_LINK: &str = "steam://install/4963920";

#[derive(Debug, Clone, Serialize)]
pub struct PortholeStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub steam_ok: Option<bool>,
    pub message: String,
    pub store_url: String,
    pub steam_deep_link: String,
    pub steam_install_link: String,
    pub steam_app_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortholeHostInfo {
    pub share_code: String,
    /// Primary Porthole port (LiveKit WS when voice, else LAN TCP).
    pub port: u16,
    /// Open-to-LAN TCP port when this lobby exposes Minecraft (else null).
    pub lan_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortholeCheckResult {
    pub ok: bool,
    pub installed: bool,
    pub steam_ok: bool,
    pub message: String,
    pub detail: String,
}

#[derive(Default)]
pub struct PortholeRuntime {
    host: Option<Child>,
    /// Second expose for Open-to-LAN while voice owns `host` (keeps voice peers).
    lan_host: Option<Child>,
    join: Option<Child>,
    /// Second connect for Minecraft while voice owns `join`.
    lan_join: Option<Child>,
    share_code: Option<String>,
    lan_share_code: Option<String>,
    host_port: Option<u16>,
    /// Minecraft LAN port (merged into primary or on `lan_host` sidecar).
    host_lan_port: Option<u16>,
    /// Bumped on each join start/stop so keepalive threads exit.
    join_epoch: u64,
    lan_join_epoch: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ChildSlot {
    Host,
    HostLan,
    Join,
    JoinLan,
}

impl ChildSlot {
    fn is_host(self) -> bool {
        matches!(self, ChildSlot::Host | ChildSlot::HostLan)
    }
}

pub type PortholeState = Arc<Mutex<PortholeRuntime>>;

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn candidate_binaries() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(custom) = std::env::var("REMINED_PORTHOLE_PATH") {
        let p = PathBuf::from(custom.trim());
        if !p.as_os_str().is_empty() {
            out.push(p);
        }
    }

    if cfg!(target_os = "macos") {
        if let Some(home) = home_dir() {
            out.push(
                home.join("Library/Application Support/Steam/steamapps/common/porthole/porthole"),
            );
        }
        out.push(PathBuf::from(
            "/Users/Shared/Steam/steamapps/common/porthole/porthole",
        ));
    } else if cfg!(target_os = "windows") {
        let program_files = [
            std::env::var_os("ProgramFiles(x86)"),
            std::env::var_os("ProgramFiles"),
        ];
        for pf in program_files.into_iter().flatten() {
            out.push(
                PathBuf::from(pf).join(r"Steam\steamapps\common\porthole\porthole.exe"),
            );
        }
        if let Some(home) = home_dir() {
            out.push(home.join(r"Steam\steamapps\common\porthole\porthole.exe"));
        }
    } else {
        if let Some(home) = home_dir() {
            out.push(home.join(".steam/steam/steamapps/common/porthole/porthole"));
            out.push(home.join(".local/share/Steam/steamapps/common/porthole/porthole"));
        }
    }

    // Extra libraries from libraryfolders.vdf (best-effort)
    for lib in steam_library_roots() {
        if cfg!(windows) {
            out.push(lib.join(r"steamapps\common\porthole\porthole.exe"));
        } else {
            out.push(lib.join("steamapps/common/porthole/porthole"));
        }
    }
    out
}

fn steam_library_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let vdf_paths = {
        let mut v = Vec::new();
        if let Some(home) = home_dir() {
            if cfg!(target_os = "macos") {
                v.push(home.join("Library/Application Support/Steam/steamapps/libraryfolders.vdf"));
            } else if cfg!(windows) {
                if let Some(pf) = std::env::var_os("ProgramFiles(x86)") {
                    v.push(PathBuf::from(pf).join(r"Steam\steamapps\libraryfolders.vdf"));
                }
            } else {
                v.push(home.join(".steam/steam/steamapps/libraryfolders.vdf"));
                v.push(home.join(".local/share/Steam/steamapps/libraryfolders.vdf"));
            }
        }
        v
    };
    for vdf in vdf_paths {
        let Ok(text) = fs::read_to_string(&vdf) else {
            continue;
        };
        for line in text.lines() {
            let t = line.trim();
            // "path"		"/some/steam/library"
            if let Some(rest) = t.strip_prefix("\"path\"") {
                let path = rest
                    .trim()
                    .trim_matches('"')
                    .replace("\\\\", "\\");
                if !path.is_empty() {
                    roots.push(PathBuf::from(path));
                }
            }
        }
    }
    roots
}

pub fn find_binary() -> Option<PathBuf> {
    candidate_binaries().into_iter().find(|p| p.is_file())
}

fn kill_child(child: &mut Option<Child>) {
    if let Some(mut c) = child.take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

pub fn status() -> PortholeStatus {
    let path = find_binary();
    let installed = path.is_some();
    let version = path.as_ref().and_then(|p| {
        let out = Command::new(p).arg("-V").output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        let line = s.lines().next()?.trim();
        if line.is_empty() {
            None
        } else {
            Some(line.to_string())
        }
    });
    let message = if installed {
        "Leave Steam open and logged in to host or join.".into()
    } else {
        "Install free Porthole on Steam to play with friends online.".into()
    };
    PortholeStatus {
        installed,
        path: path.map(|p| p.display().to_string()),
        version,
        steam_ok: None,
        message,
        store_url: STEAM_STORE_URL.into(),
        steam_deep_link: STEAM_DEEP_LINK.into(),
        steam_install_link: STEAM_INSTALL_LINK.into(),
        steam_app_id: STEAM_APP_ID.into(),
    }
}

/// Run `porthole selftest` — verifies CLI + Steam IPC + relays.
pub fn selftest() -> PortholeCheckResult {
    let Some(bin) = find_binary() else {
        return PortholeCheckResult {
            ok: false,
            installed: false,
            steam_ok: false,
            message: "Porthole is not installed".into(),
            detail: String::new(),
        };
    };

    let mut cmd = Command::new(&bin);
    cmd.args(["--json", "--render-backend", "software", "selftest"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    if let Some(dir) = bin.parent() {
        cmd.current_dir(dir);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return PortholeCheckResult {
                ok: false,
                installed: true,
                steam_ok: false,
                message: format!("Could not start Porthole CLI: {e}"),
                detail: String::new(),
            };
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out_handle = thread::spawn(move || {
        let mut buf = String::new();
        if let Some(s) = stdout {
            let _ = BufReader::new(s).read_to_string(&mut buf);
        }
        buf
    });
    let err_handle = thread::spawn(move || {
        let mut buf = String::new();
        if let Some(s) = stderr {
            let _ = BufReader::new(s).read_to_string(&mut buf);
        }
        buf
    });

    let deadline = Instant::now() + Duration::from_secs(45);
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let out = out_handle.join().unwrap_or_default();
                let err = err_handle.join().unwrap_or_default();
                return PortholeCheckResult {
                    ok: false,
                    installed: true,
                    steam_ok: false,
                    message: "Check timed out — is Steam running?".into(),
                    detail: trim_detail(&format!("{out}\n{err}")),
                };
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(e) => {
                return PortholeCheckResult {
                    ok: false,
                    installed: true,
                    steam_ok: false,
                    message: format!("Porthole check failed: {e}"),
                    detail: String::new(),
                };
            }
        }
    };

    let out = out_handle.join().unwrap_or_default();
    let err = err_handle.join().unwrap_or_default();
    let combined = format!("{out}\n{err}");
    let lower = combined.to_ascii_lowercase();
    let exit_ok = status.success();
    let detail = trim_detail(&combined);

    // Prefer JSON ok field when present
    let json_ok = combined.lines().find_map(|line| {
        let t = line.trim();
        let v: Value = serde_json::from_str(t).ok()?;
        v.get("ok").and_then(|x| x.as_bool()).or_else(|| {
            v.get("success")
                .and_then(|x| x.as_bool())
                .or_else(|| v.get("passed").and_then(|x| x.as_bool()))
        })
    });

    // Hard Steam failures only — do NOT match success lines like
    // "SteamAPI_Init(): Loaded '…' OK."
    let steam_fail = lower.contains("steam init failed")
        || lower.contains("[s_api fail]")
        || lower.contains("did not locate a running instance of steam")
        || lower.contains("could not determine steam client");

    let has_steam_id = combined.lines().any(|l| {
        let t = l.trim().to_ascii_lowercase();
        t.starts_with("steam id:") && t.chars().any(|c| c.is_ascii_digit())
    });
    let has_persona = combined.lines().any(|l| {
        let t = l.trim().to_ascii_lowercase();
        t.starts_with("persona:") && t.len() > "persona:".len() + 1
    });
    let steam_loaded_ok = lower.contains("steamapi_init(): loaded") && lower.contains(" ok");
    let steam_ok = !steam_fail && (has_steam_id || has_persona || steam_loaded_ok);

    let relay_ok = combined.lines().any(|l| {
        let t = l.trim().to_ascii_lowercase();
        t.starts_with("relay:") && t.contains("ok(")
    });
    let selftest_fail = lower.contains("selftest failed") || json_ok == Some(false);
    let selftest_pass_text = lower.contains("selftest ok")
        || lower.contains("selftest passed")
        || json_ok == Some(true);

    // Steam session + identity is enough for host/join; relay Ok(Waiting) is fine.
    let ok = if let Some(v) = json_ok {
        v
    } else if steam_fail || selftest_fail {
        false
    } else if selftest_pass_text || (steam_ok && (relay_ok || exit_ok)) {
        true
    } else {
        steam_ok && !selftest_fail
    };

    if ok {
        let message = if relay_ok {
            "CLI OK — Steam connected, relays reachable".into()
        } else {
            "CLI OK — Steam connected".into()
        };
        PortholeCheckResult {
            ok: true,
            installed: true,
            steam_ok: true,
            message,
            detail,
        }
    } else if steam_fail && !steam_ok {
        PortholeCheckResult {
            ok: false,
            installed: true,
            steam_ok: false,
            message: "Steam not reachable — open Steam and log in, then Check again"
                .into(),
            detail,
        }
    } else {
        let msg = combined
            .lines()
            .rev()
            .find(|l| {
                let t = l.trim().to_ascii_lowercase();
                !t.is_empty()
                    && (t.contains("fail") || t.contains("error"))
                    && !t.contains("loaded")
            })
            .map(|l| l.trim().to_string())
            .unwrap_or_else(|| "Porthole selftest failed".into());
        PortholeCheckResult {
            ok: false,
            installed: true,
            steam_ok,
            message: msg,
            detail,
        }
    }
}

fn trim_detail(s: &str) -> String {
    let mut lines: Vec<&str> = s.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    // Prefer useful summary lines first
    lines.sort_by_key(|l| {
        let t = l.to_ascii_lowercase();
        if t.starts_with("steam id:")
            || t.starts_with("persona:")
            || t.starts_with("relay:")
            || t.contains("selftest")
        {
            0u8
        } else if t.contains("[s_api") {
            2
        } else {
            1
        }
    });
    lines
        .into_iter()
        .take(12)
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(800)
        .collect()
}

fn extract_share_code(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        // Prefer Porthole's static_code event: {"code":"4XAQ0YP","event":"static_code"}
        // Note: static_code is tied to the Steam profile — two concurrent exposes
        // emit the same code. Use extract_lobby_target for a second lobby.
        let event = v.get("event").and_then(|x| x.as_str()).unwrap_or("");
        if event == "static_code" || event == "share_code" || event == "join_code" {
            if let Some(s) = v.get("code").and_then(|x| x.as_str()) {
                let c = s.trim();
                if c.len() >= 4 {
                    return Some(c.to_string());
                }
            }
        }
        for key in [
            "share_code",
            "shareCode",
            "join_code",
            "joinCode",
            "lobby_code",
        ] {
            if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
                let c = s.trim();
                if c.len() >= 4 {
                    return Some(c.to_string());
                }
            }
        }
        // Only treat bare "code" as share code when it looks like one (not a lobby id)
        if let Some(s) = v.get("code").and_then(|x| x.as_str()) {
            let c = s.trim();
            if c.len() >= 4 && c.len() <= 16 && c.chars().all(|ch| ch.is_ascii_alphanumeric()) {
                return Some(c.to_string());
            }
        }
    }
    let lower = trimmed.to_ascii_lowercase();
    for marker in ["share code", "join code", "share_code", "code:"] {
        if let Some(idx) = lower.find(marker) {
            let after = &trimmed[idx + marker.len()..];
            let code: String = after
                .chars()
                .skip_while(|c| !c.is_ascii_alphanumeric())
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if code.len() >= 4 {
                return Some(code);
            }
        }
    }
    None
}

/// `lobby:<id>` join target from `{"event":"lobby_ready","lobby_id":…}`.
/// Needed for a second concurrent expose — static_code is profile-scoped.
fn extract_lobby_target(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let v: Value = serde_json::from_str(trimmed).ok()?;
    let event = v.get("event").and_then(|x| x.as_str()).unwrap_or("");
    if event != "lobby_ready" {
        return None;
    }
    let id = v.get("lobby_id").and_then(|x| {
        x.as_u64()
            .map(|n| n.to_string())
            .or_else(|| x.as_i64().map(|n| n.to_string()))
            .or_else(|| x.as_str().map(|s| s.trim().to_string()))
    })?;
    if id.is_empty() {
        return None;
    }
    Some(format!("lobby:{id}"))
}

/// Standard Steam client install locations (macOS / Windows / Linux).
fn steam_client_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(custom) = std::env::var("REMINED_STEAM_PATH") {
        let p = PathBuf::from(custom.trim());
        if !p.as_os_str().is_empty() {
            out.push(p);
        }
    }

    if cfg!(target_os = "macos") {
        out.push(PathBuf::from("/Applications/Steam.app"));
        if let Some(home) = home_dir() {
            out.push(home.join("Applications/Steam.app"));
        }
    } else if cfg!(target_os = "windows") {
        for key in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Ok(pf) = std::env::var(key) {
                out.push(PathBuf::from(pf).join(r"Steam\Steam.exe"));
            }
        }
        if let Some(home) = home_dir() {
            out.push(home.join(r"Steam\Steam.exe"));
            out.push(home.join(r"AppData\Local\Programs\Steam\Steam.exe"));
        }
        // Common alternate drive installs
        for drive in ["D:", "E:", "F:"] {
            out.push(PathBuf::from(format!(r"{drive}\Steam\Steam.exe")));
            out.push(PathBuf::from(format!(r"{drive}\Program Files (x86)\Steam\Steam.exe")));
            out.push(PathBuf::from(format!(r"{drive}\Program Files\Steam\Steam.exe")));
        }
    } else {
        if let Some(home) = home_dir() {
            out.push(home.join(".steam/steam/steam.sh"));
            out.push(home.join(".local/share/Steam/steam.sh"));
            out.push(home.join(".steam/debian-installation/steam.sh"));
        }
        out.push(PathBuf::from("/usr/bin/steam"));
        out.push(PathBuf::from("/usr/games/steam"));
        out.push(PathBuf::from("/snap/bin/steam"));
    }

    out
}

pub fn find_steam_client() -> Option<PathBuf> {
    steam_client_candidates().into_iter().find(|p| p.exists())
}

/// Launch the Steam client (or fall back to `steam://open/main`).
pub fn open_steam_client() -> Result<String, String> {
    if let Some(path) = find_steam_client() {
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg(&path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Could not open Steam: {e}"))?;
            return Ok(format!("Opening {}", path.display()));
        }
        #[cfg(target_os = "windows")]
        {
            Command::new(&path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Could not open Steam: {e}"))?;
            return Ok(format!("Opening {}", path.display()));
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            Command::new(&path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Could not open Steam: {e}"))?;
            return Ok(format!("Opening {}", path.display()));
        }
    }

    // Protocol handler (works if Steam registered itself)
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("steam://open/main")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                format!(
                    "Steam app not found in Applications, and steam:// failed: {e}"
                )
            })?;
        return Ok("Opening Steam via steam://…".into());
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", "steam://open/main"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                format!(
                    "Steam.exe not found in standard paths, and steam:// failed: {e}"
                )
            })?;
        return Ok("Opening Steam via steam://…".into());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg("steam://open/main")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                format!("Steam not found in standard paths, and steam:// failed: {e}")
            })?;
        return Ok("Opening Steam via steam://…".into());
    }

    #[allow(unreachable_code)]
    Err("Could not locate Steam".into())
}

fn spawn_porthole(args: &[&str]) -> Result<Child, String> {
    let bin = find_binary().ok_or_else(|| {
        "Porthole not found — install it from Steam (free), then reopen Remined".to_string()
    })?;
    let mut cmd = Command::new(&bin);
    cmd.args(["--json", "--render-backend", "software"])
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    // Help Steam API find the client when launched outside Steam
    if let Some(dir) = bin.parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn()
        .map_err(|e| format!("Failed to start Porthole: {e}"))
}

enum LineEvt {
    Line(String),
    Eof,
}

fn child_slot_mut(guard: &mut PortholeRuntime, slot: ChildSlot) -> &mut Option<Child> {
    match slot {
        ChildSlot::Host => &mut guard.host,
        ChildSlot::HostLan => &mut guard.lan_host,
        ChildSlot::Join => &mut guard.join,
        ChildSlot::JoinLan => &mut guard.lan_join,
    }
}

fn watch_stdout_for_code(
    app: AppHandle,
    state: PortholeState,
    mut child: Child,
    port: u16,
    slot: ChildSlot,
) -> Result<String, String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Porthole stdout missing".to_string())?;
    let stderr = child.stderr.take();
    let is_host = slot.is_host();

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        match slot {
            ChildSlot::Host => {
                kill_child(&mut guard.host);
                // Primary replace owns backends — drop any LAN sidecar.
                kill_child(&mut guard.lan_host);
                guard.lan_share_code = None;
                guard.host = Some(child);
                guard.host_port = Some(port);
                guard.share_code = None;
            }
            ChildSlot::HostLan => {
                kill_child(&mut guard.lan_host);
                guard.lan_host = Some(child);
                guard.lan_share_code = None;
            }
            ChildSlot::Join => {
                kill_child(&mut guard.join);
                guard.join = Some(child);
            }
            ChildSlot::JoinLan => {
                kill_child(&mut guard.lan_join);
                guard.lan_join = Some(child);
            }
        }
    }

    let (tx, rx) = std::sync::mpsc::channel::<LineEvt>();

    // Keep draining BOTH pipes for the life of the process.
    // Never stop reading after we got the share code — closing stdout
    // makes Porthole panic with Broken pipe and kills the tunnel.
    if let Some(err) = stderr {
        let tx_err = tx.clone();
        let app_err = app.clone();
        thread::spawn(move || {
            let r = BufReader::new(err);
            for line in r.lines().flatten() {
                eprintln!("[porthole] {line}");
                if net_log::porthole_line_interesting(&line) {
                    net_log::append_ok(&app_err, "ph-err", &line);
                }
                let _ = app_err.emit("porthole-log", line.clone());
                // If UI already stopped waiting, just keep draining the pipe.
                let _ = tx_err.send(LineEvt::Line(line));
            }
        });
    }

    let app_out = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if net_log::porthole_line_interesting(&line) {
                net_log::append_ok(&app_out, "ph-out", &line);
            }
            // Ignore send errors (UI finished waiting) — keep draining.
            let _ = tx.send(LineEvt::Line(line));
        }
        let _ = tx.send(LineEvt::Eof);
    });

    let deadline = Instant::now() + Duration::from_secs(45);
    let mut last_err = String::new();
    let mut guest_hint = false;
    // Prefer Steam static share code for guests. Publishing lobby:<id> alone
    // left peers connected with zero port_accepted on Minecraft LAN exposes
    // (localhost never opened). Static code historically gets port_accepted.
    // Wait for lobby_ready first so the lobby exists, then publish static.
    let mut pending_static: Option<String> = None;

    while Instant::now() < deadline {
        // Guest: local bind is the only reliable "ready" signal.
        if !is_host && port_listening(port) {
            return Ok(String::new());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(remaining.min(Duration::from_millis(400))) {
            Ok(LineEvt::Line(line)) => {
                let _ = app.emit("porthole-log", line.clone());
                if is_host {
                    if let Some(c) = extract_share_code(&line) {
                        // Keep the latest static/share code; lobby_ready finalizes.
                        pending_static = Some(c);
                    }
                }
                let host_code = if is_host {
                    extract_lobby_target(&line).map(|lobby| {
                        pending_static.take().unwrap_or(lobby)
                    })
                } else {
                    None
                };
                if let Some(code) = host_code {
                    net_log::append_ok(
                        &app,
                        "host",
                        &format!("publish join target={code}"),
                    );
                    let lan_port = if let Ok(mut guard) = state.lock() {
                        match slot {
                            ChildSlot::HostLan => {
                                guard.lan_share_code = Some(code.clone());
                                guard.host_lan_port = Some(port);
                            }
                            _ => {
                                guard.share_code = Some(code.clone());
                            }
                        }
                        guard.host_lan_port
                    } else {
                        None
                    };
                    let _ = app.emit(
                        "porthole-host",
                        PortholeHostInfo {
                            share_code: code.clone(),
                            port,
                            lan_port,
                        },
                    );
                    // Leave drain threads running; do not close pipes.
                    return Ok(code);
                }
                if !is_host {
                    if extract_share_code(&line).is_some()
                        || extract_lobby_target(&line).is_some()
                    {
                        // Guest logs often echo the lobby target before the
                        // local bind exists — ignore and keep waiting for :port.
                        guest_hint = true;
                        continue;
                    }
                }
                let lower = line.to_ascii_lowercase();
                let hard_fail = lower.contains("steam init failed")
                    || lower.contains("[s_api fail]")
                    || lower.contains("selftest failed")
                    || (lower.contains("error")
                        && !lower.contains("loaded")
                        && !lower.contains("ok"));
                if hard_fail || lower.contains("not logged") {
                    last_err = line;
                }
                if !is_host
                    && (lower.contains("connected")
                        || lower.contains("approved")
                        || lower.contains("forwarding")
                        || lower.contains("listening")
                        || lower.contains("\"event\":\"ready\"")
                        || lower.contains("lobby_ready"))
                {
                    guest_hint = true;
                    // Soft signal only — wait until localhost:port accepts TCP.
                    // Approval can lag peer_connected by several seconds on WAN.
                    if port_listening(port)
                        || wait_port_listening(port, Duration::from_secs(20))
                    {
                        return Ok(String::new());
                    }
                }
            }
            Ok(LineEvt::Eof) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                let dead = state
                    .lock()
                    .ok()
                    .and_then(|mut g| {
                        child_slot_mut(&mut g, slot)
                            .as_mut()
                            .and_then(|c| c.try_wait().ok().flatten())
                    })
                    .is_some();
                if dead {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    if !last_err.is_empty() {
        return Err(last_err);
    }
    if is_host {
        match slot {
            ChildSlot::HostLan => stop_lan_host(&state),
            _ => stop_host(&state),
        }
        Err("Timed out waiting for Porthole share code — is Steam running and logged in?".into())
    } else if port_listening(port) || wait_port_listening(port, Duration::from_secs(3)) {
        Ok(String::new())
    } else {
        let alive = state
            .lock()
            .ok()
            .and_then(|mut g| {
                child_slot_mut(&mut g, slot)
                    .as_mut()
                    .and_then(|c| c.try_wait().ok())
            })
            .flatten()
            .is_none();
        if alive && guest_hint {
            Err(format!(
                "Porthole connected but localhost:{port} is not open yet — is Steam online and the host still in the room?"
            ))
        } else if alive {
            Err(format!(
                "Timed out waiting for Porthole tunnel on localhost:{port}"
            ))
        } else {
            Err("Porthole connect exited before the tunnel was ready".into())
        }
    }
}

pub fn start_host(
    app: AppHandle,
    state: PortholeState,
    port: u16,
) -> Result<PortholeHostInfo, String> {
    if port == 0 {
        return Err("Invalid LAN port".into());
    }
    let backend = format!("tcp/127.0.0.1:{port}");
    start_host_backends(app, state, &backend, port, Some(port), "Remined")
}

/// Expose arbitrary Porthole backends (comma-separated tcp/udp specs).
pub fn start_host_backends(
    app: AppHandle,
    state: PortholeState,
    backends: &str,
    primary_port: u16,
    lan_port: Option<u16>,
    game_name: &str,
) -> Result<PortholeHostInfo, String> {
    let backends = backends.trim();
    if backends.is_empty() {
        return Err("No Porthole backends".into());
    }
    let lan = lan_port.filter(|p| *p > 0);
    net_log::begin_chunk(
        &app,
        &format!(
            "host expose primary={primary_port} lan={} name={game_name}",
            lan.map(|p| p.to_string()).unwrap_or_else(|| "-".into())
        ),
    );
    net_log::append_ok(&app, "host", &format!("backends={backends}"));
    // Steam Porthole kicks mismatched client builds by default — friends on
    // older/newer Steam updates would connect then get a dead localhost port.
    let child = spawn_porthole(&[
        "expose",
        backends,
        "--visibility",
        "friends",
        "--game-name",
        game_name,
        "--max-peers",
        "8",
        "--allow-version-mismatch",
    ])?;
    // Remember LAN before watch — watch_stdout stores the child + primary port.
    if let Ok(mut guard) = state.lock() {
        guard.host_lan_port = lan;
    }
    let code = match watch_stdout_for_code(
        app.clone(),
        state.clone(),
        child,
        primary_port,
        ChildSlot::Host,
    ) {
        Ok(c) => c,
        Err(e) => {
            net_log::append_ok(&app, "host", &format!("expose FAILED: {e}"));
            if let Ok(mut guard) = state.lock() {
                guard.host_lan_port = None;
            }
            return Err(e);
        }
    };
    if code.is_empty() {
        if let Ok(mut guard) = state.lock() {
            guard.host_lan_port = None;
        }
        net_log::append_ok(&app, "host", "expose FAILED: empty share code");
        return Err("Porthole started but no share code was published".into());
    }
    net_log::append_ok(
        &app,
        "host",
        &format!(
            "lobby ready code={code} primary={primary_port} lan={}",
            lan.map(|p| p.to_string()).unwrap_or_else(|| "-".into())
        ),
    );
    Ok(PortholeHostInfo {
        share_code: code,
        port: primary_port,
        lan_port: lan,
    })
}

/// Open-to-LAN beside an existing voice lobby — second Steam expose so voice
/// peers are not kicked when Minecraft publishes a LAN port.
pub fn start_lan_host(
    app: AppHandle,
    state: PortholeState,
    port: u16,
) -> Result<PortholeHostInfo, String> {
    if port == 0 {
        return Err("Invalid LAN port".into());
    }
    let backend = format!("tcp/127.0.0.1:{port}");
    net_log::begin_chunk(&app, &format!("host LAN sidecar port={port}"));
    net_log::append_ok(&app, "host", &format!("lan sidecar backends={backend}"));
    let child = spawn_porthole(&[
        "expose",
        &backend,
        "--visibility",
        "friends",
        "--game-name",
        "Remined LAN",
        "--max-peers",
        "8",
        "--allow-version-mismatch",
    ])?;
    if let Ok(mut guard) = state.lock() {
        guard.host_lan_port = Some(port);
    }
    let code = match watch_stdout_for_code(
        app.clone(),
        state.clone(),
        child,
        port,
        ChildSlot::HostLan,
    ) {
        Ok(c) => c,
        Err(e) => {
            net_log::append_ok(&app, "host", &format!("lan sidecar FAILED: {e}"));
            if let Ok(mut guard) = state.lock() {
                if guard.host_lan_port == Some(port) {
                    guard.host_lan_port = None;
                }
            }
            return Err(e);
        }
    };
    if code.is_empty() {
        stop_lan_host(&state);
        return Err("Porthole LAN started but no share code was published".into());
    }
    net_log::append_ok(
        &app,
        "host",
        &format!("lan sidecar ready code={code} port={port}"),
    );
    Ok(PortholeHostInfo {
        share_code: code,
        port,
        lan_port: Some(port),
    })
}

pub fn start_join(
    app: AppHandle,
    state: PortholeState,
    share_code: &str,
    port: u16,
) -> Result<(), String> {
    if port == 0 {
        return Err("Invalid LAN port".into());
    }
    // Voice+LAN merge: guest already auto-approved every offered port.
    if port_listening(port) {
        net_log::append_ok(
            &app,
            "join",
            &format!("localhost:{port} already open — skip join"),
        );
        return Ok(());
    }
    // Always --auto-approve (not a fixed port list). Listing LiveKit ports when
    // the host only exposes Minecraft left peers connected with zero
    // port_accepted — localhost never opened and Join aborted before MC.
    let voice_join = state
        .lock()
        .ok()
        .is_some_and(|g| g.join.is_some());
    if voice_join {
        net_log::append_ok(
            &app,
            "join",
            &format!("voice join active → re-join lobby for port={port}"),
        );
    }
    start_join_auto(app, state, share_code, port)
}

/// Connect and auto-approve a custom port list (e.g. `tcp/7880,udp/7881-7890`).
pub fn start_join_approve(
    app: AppHandle,
    state: PortholeState,
    share_code: &str,
    approve_ports: &str,
    primary_port: u16,
) -> Result<(), String> {
    start_join_slot(
        app,
        state,
        share_code,
        Some(approve_ports),
        primary_port,
        ChildSlot::Join,
    )
}

/// Connect and approve every offered port (voice guest / lobby rebuild).
pub fn start_join_auto(
    app: AppHandle,
    state: PortholeState,
    share_code: &str,
    primary_port: u16,
) -> Result<(), String> {
    start_join_slot(
        app,
        state,
        share_code,
        None,
        primary_port,
        ChildSlot::Join,
    )
}

fn start_join_slot(
    app: AppHandle,
    state: PortholeState,
    share_code: &str,
    approve_ports: Option<&str>,
    primary_port: u16,
    slot: ChildSlot,
) -> Result<(), String> {
    let code = share_code.trim();
    if code.len() < 4 {
        return Err("Invalid share code".into());
    }
    let tag = match slot {
        ChildSlot::JoinLan => "join-lan",
        _ => "join",
    };
    net_log::begin_chunk(
        &app,
        &format!("{tag} code={code} primary={primary_port}"),
    );
    let child = if let Some(ports) = approve_ports.map(str::trim).filter(|s| !s.is_empty()) {
        net_log::append_ok(
            &app,
            tag,
            &format!("approve-ports={ports} bind=127.0.0.1"),
        );
        spawn_porthole(&[
            "connect",
            code,
            "--auto-approve-ports",
            ports,
            "--bind",
            "127.0.0.1",
        ])?
    } else {
        net_log::append_ok(&app, tag, "approve=ALL bind=127.0.0.1");
        spawn_porthole(&[
            "connect",
            code,
            "--auto-approve",
            "--bind",
            "127.0.0.1",
        ])?
    };
    if let Err(e) = watch_stdout_for_code(app.clone(), state.clone(), child, primary_port, slot) {
        net_log::append_ok(&app, tag, &format!("connect FAILED: {e}"));
        return Err(e);
    }
    // Belt-and-suspenders: never hand control back until signaling port is up.
    if !port_listening(primary_port)
        && !wait_port_listening(primary_port, Duration::from_secs(12))
    {
        match slot {
            ChildSlot::JoinLan => stop_lan_join(&state),
            _ => stop_join(&state),
        }
        net_log::append_ok(
            &app,
            tag,
            &format!("localhost:{primary_port} never opened"),
        );
        return Err(format!(
            "Porthole join finished but localhost:{primary_port} never opened"
        ));
    }
    net_log::append_ok(
        &app,
        tag,
        &format!("ready localhost:{primary_port} listening"),
    );
    let epoch = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        match slot {
            ChildSlot::JoinLan => {
                guard.lan_join_epoch = guard.lan_join_epoch.wrapping_add(1);
                guard.lan_join_epoch
            }
            _ => {
                guard.join_epoch = guard.join_epoch.wrapping_add(1);
                guard.join_epoch
            }
        }
    };
    // Steam drops idle peers (~20s MiscTimeout) while Minecraft is still
    // booting — poke the forward so the tunnel stays warm until MC connects.
    spawn_join_keepalive(app, state, primary_port, epoch, slot);
    Ok(())
}

fn spawn_join_keepalive(
    app: AppHandle,
    state: PortholeState,
    port: u16,
    epoch: u64,
    slot: ChildSlot,
) {
    let tag = match slot {
        ChildSlot::JoinLan => "join-lan",
        _ => "join",
    };
    // Steam drops idle Porthole peers (~20s MiscTimeout / RemoteTimeout).
    // Hold a localhost TCP session open and refresh before that window —
    // brief connect/drop every 3s left ~21s gaps once the loop was interrupted.
    thread::spawn(move || {
        let mut ticks = 0u32;
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        loop {
            let alive = state.lock().ok().is_some_and(|g| match slot {
                ChildSlot::JoinLan => g.lan_join.is_some() && g.lan_join_epoch == epoch,
                _ => g.join.is_some() && g.join_epoch == epoch,
            });
            if !alive {
                break;
            }
            match TcpStream::connect_timeout(&addr, Duration::from_millis(800)) {
                Ok(stream) => {
                    ticks = ticks.saturating_add(1);
                    if ticks == 1 || ticks % 10 == 0 {
                        net_log::append_ok(
                            &app,
                            tag,
                            &format!("keepalive ok localhost:{port} n={ticks}"),
                        );
                    }
                    let _ = stream.set_nodelay(true);
                    // Keep the forward busy for most of the MiscTimeout window.
                    let mut held_ms = 0u64;
                    while held_ms < 12_000 {
                        let alive = state.lock().ok().is_some_and(|g| match slot {
                            ChildSlot::JoinLan => {
                                g.lan_join.is_some() && g.lan_join_epoch == epoch
                            }
                            _ => g.join.is_some() && g.join_epoch == epoch,
                        });
                        if !alive {
                            break;
                        }
                        thread::sleep(Duration::from_millis(500));
                        held_ms += 500;
                    }
                    drop(stream);
                }
                Err(e) => {
                    net_log::append_ok(
                        &app,
                        tag,
                        &format!("keepalive MISS localhost:{port}: {e}"),
                    );
                    thread::sleep(Duration::from_secs(1));
                }
            }
        }
    });
}

pub fn stop_all(state: &PortholeState) {
    if let Ok(mut guard) = state.lock() {
        kill_child(&mut guard.host);
        kill_child(&mut guard.lan_host);
        kill_child(&mut guard.join);
        kill_child(&mut guard.lan_join);
        guard.join_epoch = guard.join_epoch.wrapping_add(1);
        guard.lan_join_epoch = guard.lan_join_epoch.wrapping_add(1);
        guard.share_code = None;
        guard.lan_share_code = None;
        guard.host_port = None;
        guard.host_lan_port = None;
    }
}

pub fn stop_host(state: &PortholeState) {
    if let Ok(mut guard) = state.lock() {
        kill_child(&mut guard.host);
        kill_child(&mut guard.lan_host);
        guard.share_code = None;
        guard.lan_share_code = None;
        guard.host_port = None;
        guard.host_lan_port = None;
    }
}

pub fn stop_lan_host(state: &PortholeState) {
    if let Ok(mut guard) = state.lock() {
        kill_child(&mut guard.lan_host);
        guard.lan_share_code = None;
        guard.host_lan_port = None;
    }
}

/// Drop the Minecraft join tunnel without touching an active voice join.
pub fn stop_game_join(state: &PortholeState) {
    let has_lan = state.lock().ok().is_some_and(|g| g.lan_join.is_some());
    if has_lan {
        stop_lan_join(state);
    } else {
        stop_join(state);
    }
}

pub fn stop_join(state: &PortholeState) {
    if let Ok(mut guard) = state.lock() {
        kill_child(&mut guard.join);
        guard.join_epoch = guard.join_epoch.wrapping_add(1);
    }
}

pub fn stop_lan_join(state: &PortholeState) {
    if let Ok(mut guard) = state.lock() {
        kill_child(&mut guard.lan_join);
        guard.lan_join_epoch = guard.lan_join_epoch.wrapping_add(1);
    }
}

pub fn current_host(state: &PortholeState) -> Option<PortholeHostInfo> {
    let guard = state.lock().ok()?;
    Some(PortholeHostInfo {
        share_code: guard.share_code.clone()?,
        port: guard.host_port?,
        lan_port: guard.host_lan_port,
    })
}

/// Active Open-to-LAN port for the *current* client session in latest.log.
///
/// Uses the same forward parser as the game tray (`gamewatch::parse_game_log`):
/// a new `Setting user:` / `Loading Minecraft` clears a previous publish so a
/// fresh Play does not rebuild Voice Porthole from yesterday's LAN line.
pub fn read_lan_port(log_path: &Path) -> Option<u16> {
    let text = fs::read_to_string(log_path).ok()?;
    crate::gamewatch::parse_game_log(&text).lan_port
}
