//! Orchestrate Steam Porthole CLI for Minecraft LAN Join.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

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
    pub port: u16,
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
    join: Option<Child>,
    share_code: Option<String>,
    host_port: Option<u16>,
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

fn watch_stdout_for_code(
    app: AppHandle,
    state: PortholeState,
    mut child: Child,
    port: u16,
    is_host: bool,
) -> Result<String, String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Porthole stdout missing".to_string())?;
    let stderr = child.stderr.take();

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        if is_host {
            kill_child(&mut guard.host);
            guard.host = Some(child);
            guard.host_port = Some(port);
            guard.share_code = None;
        } else {
            kill_child(&mut guard.join);
            guard.join = Some(child);
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
                let _ = app_err.emit("porthole-log", line.clone());
                // If UI already stopped waiting, just keep draining the pipe.
                let _ = tx_err.send(LineEvt::Line(line));
            }
        });
    }

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            // Ignore send errors (UI finished waiting) — keep draining.
            let _ = tx.send(LineEvt::Line(line));
        }
        let _ = tx.send(LineEvt::Eof);
    });

    let deadline = Instant::now() + Duration::from_secs(30);
    let mut last_err = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(remaining.min(Duration::from_millis(400))) {
            Ok(LineEvt::Line(line)) => {
                let _ = app.emit("porthole-log", line.clone());
                if let Some(code) = extract_share_code(&line) {
                    if is_host {
                        if let Ok(mut guard) = state.lock() {
                            guard.share_code = Some(code.clone());
                        }
                        let _ = app.emit(
                            "porthole-host",
                            PortholeHostInfo {
                                share_code: code.clone(),
                                port,
                            },
                        );
                    }
                    // Leave drain threads running; do not close pipes.
                    return Ok(code);
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
                    return Ok(String::new());
                }
            }
            Ok(LineEvt::Eof) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                let dead = state
                    .lock()
                    .ok()
                    .and_then(|mut g| {
                        let slot = if is_host {
                            g.host.as_mut()
                        } else {
                            g.join.as_mut()
                        };
                        slot.and_then(|c| c.try_wait().ok().flatten())
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
        stop_host(&state);
        Err("Timed out waiting for Porthole share code — is Steam running and logged in?".into())
    } else {
        let alive = state
            .lock()
            .ok()
            .and_then(|mut g| g.join.as_mut().and_then(|c| c.try_wait().ok()))
            .flatten()
            .is_none();
        if alive {
            Ok(String::new())
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
    let child = spawn_porthole(&[
        "expose",
        &backend,
        "--visibility",
        "friends",
        "--game-name",
        "Remined",
        "--max-peers",
        "8",
    ])?;
    let code = watch_stdout_for_code(app, state, child, port, true)?;
    if code.is_empty() {
        return Err("Porthole started but no share code was published".into());
    }
    Ok(PortholeHostInfo {
        share_code: code,
        port,
    })
}

pub fn start_join(
    app: AppHandle,
    state: PortholeState,
    share_code: &str,
    port: u16,
) -> Result<(), String> {
    let code = share_code.trim();
    if code.len() < 4 {
        return Err("Invalid share code".into());
    }
    if port == 0 {
        return Err("Invalid LAN port".into());
    }
    let approve = format!("tcp/{port}");
    let child = spawn_porthole(&[
        "connect",
        code,
        "--auto-approve-ports",
        &approve,
        "--bind",
        "127.0.0.1",
    ])?;
    let _ = watch_stdout_for_code(app, state, child, port, false)?;
    Ok(())
}

pub fn stop_all(state: &PortholeState) {
    if let Ok(mut guard) = state.lock() {
        kill_child(&mut guard.host);
        kill_child(&mut guard.join);
        guard.share_code = None;
        guard.host_port = None;
    }
}

pub fn stop_host(state: &PortholeState) {
    if let Ok(mut guard) = state.lock() {
        kill_child(&mut guard.host);
        guard.share_code = None;
        guard.host_port = None;
    }
}

pub fn stop_join(state: &PortholeState) {
    if let Ok(mut guard) = state.lock() {
        kill_child(&mut guard.join);
    }
}

pub fn current_host(state: &PortholeState) -> Option<PortholeHostInfo> {
    let guard = state.lock().ok()?;
    Some(PortholeHostInfo {
        share_code: guard.share_code.clone()?,
        port: guard.host_port?,
    })
}

/// Scan Minecraft latest.log for an *active* Open-to-LAN port.
/// Walks newest → oldest: a world/server stop after publish means LAN is over.
///
/// Publish: `Published LAN server on port 61647` / older `hosted on port`
/// Stop: `Stopping singleplayer server…` / `Stopping server` / FastQuit disconnect
pub fn read_lan_port(log_path: &Path) -> Option<u16> {
    let text = fs::read_to_string(log_path).ok()?;
    let publish_markers = [
        "published lan server on port",
        "hosted on port",
        "local game hosted on port",
    ];
    for line in text.lines().rev() {
        let lower = line.to_ascii_lowercase();
        if is_lan_stop_line(&lower) {
            return None;
        }
        for marker in publish_markers {
            if let Some(idx) = lower.find(marker) {
                if let Some(port) = parse_port_after(&line[idx + marker.len()..]) {
                    return Some(port);
                }
            }
        }
        // Chat: "… Порт: [61647]" — only count as publish if it looks like LAN open chat
        if (lower.contains("локальной сети") || lower.contains("local network") || lower.contains("open to lan"))
            && (lower.contains("порт:") || lower.contains("port:"))
        {
            for key in ["порт:", "port:"] {
                if let Some(idx) = lower.find(key) {
                    if let Some(port) = parse_port_after(&line[idx + key.len()..]) {
                        return Some(port);
                    }
                }
            }
        }
    }
    None
}

fn is_lan_stop_line(lower: &str) -> bool {
    // Avoid matching "Stopping worker threads" / JEI / mic — only world/server teardown.
    lower.contains("stopping singleplayer server")
        || lower.contains(": stopping server")
        || lower.contains("[fastquit] disconnected")
        || lower.contains(": stopping!")
}

fn parse_port_after(after: &str) -> Option<u16> {
    let digits: String = after
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let port: u16 = digits.parse().ok()?;
    (port > 0).then_some(port)
}
