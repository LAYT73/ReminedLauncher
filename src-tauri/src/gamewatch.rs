//! Launcher <-> running game helpers: crash detection, live game phase from
//! `logs/latest.log`, and the local screenshots folder (never uploaded anywhere).

use crate::paths::{self, pack_dir};
use base64_lite::encode as b64;
use serde::Serialize;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::AppHandle;

mod base64_lite {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    pub fn encode(data: &[u8]) -> String {
        let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
        for chunk in data.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
            out.push(T[(n >> 18) as usize & 63] as char);
            out.push(T[(n >> 12) as usize & 63] as char);
            out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
            out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
        }
        out
    }
}

fn instance_for(app: &AppHandle, pack_id: &str) -> Result<PathBuf, String> {
    let root = paths::remined_root(app)?;
    Ok(pack_dir(&root, pack_id.trim()))
}

fn mtime_ms(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------- crash detection ----------

#[derive(Debug, Serialize)]
pub struct CrashInfo {
    pub path: String,
    pub name: String,
    pub summary: String,
}

fn summarize_crash(text: &str) -> String {
    let mut desc = String::new();
    let mut exc = String::new();
    let mut lines = text.lines();
    while let Some(l) = lines.next() {
        if let Some(d) = l.strip_prefix("Description:") {
            desc = d.trim().to_string();
            // Exception is the first non-empty line after the blank separator.
            for l2 in lines.by_ref() {
                if !l2.trim().is_empty() {
                    exc = l2.trim().to_string();
                    break;
                }
            }
            break;
        }
    }
    let mut s = if exc.is_empty() { desc } else { format!("{desc}: {exc}") };
    if s.len() > 220 {
        s.truncate(220);
    }
    s
}

pub fn latest_crash(instance: &Path, since_ms: u64) -> Option<CrashInfo> {
    let mut best: Option<(u64, PathBuf)> = None;
    let dirs = [instance.join("crash-reports"), instance.to_path_buf()];
    for dir in dirs {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            let is_report = name.starts_with("crash-") && name.ends_with(".txt");
            let is_hs = name.starts_with("hs_err_pid") && name.ends_with(".log");
            if !(is_report || is_hs) {
                continue;
            }
            let t = mtime_ms(&p);
            if t >= since_ms && best.as_ref().map(|(bt, _)| t > *bt).unwrap_or(true) {
                best = Some((t, p));
            }
        }
    }
    let (_, path) = best?;
    let text = fs::read_to_string(&path).unwrap_or_default();
    let summary = if path.extension().map(|e| e == "log").unwrap_or(false) {
        "Java crashed (hs_err log)".to_string()
    } else {
        summarize_crash(&text)
    };
    Some(CrashInfo {
        name: path.file_name().and_then(|n| n.to_str()).unwrap_or("crash").into(),
        path: path.display().to_string(),
        summary,
    })
}

#[tauri::command]
pub fn latest_crash_report(
    app: AppHandle,
    pack_id: String,
    since_ms: u64,
) -> Result<Option<CrashInfo>, String> {
    Ok(latest_crash(&instance_for(&app, &pack_id)?, since_ms))
}

// ---------- live game phase ----------

#[derive(Debug, Serialize, Default, PartialEq)]
pub struct GameLogStatus {
    /// "none" | "loading" | "menu" | "world" | "server" | "lan"
    pub phase: String,
    pub world: Option<String>,
    pub server: Option<String>,
    pub lan_port: Option<u16>,
}

fn read_tail(path: &Path, max: u64) -> String {
    let Ok(mut f) = fs::File::open(path) else {
        return String::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len > max {
        let _ = f.seek(SeekFrom::Start(len - max));
    }
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

fn extract_quoted<'a>(line: &'a str, marker: &str) -> Option<&'a str> {
    let i = line.find(marker)?;
    let rest = &line[i + marker.len()..];
    let end = rest.find('"').or_else(|| rest.find('\''))?;
    Some(&rest[..end])
}

fn clear_to_menu(st: &mut GameLogStatus) {
    if matches!(
        st.phase.as_str(),
        "world" | "lan" | "server" | "loading" | "menu"
    ) {
        st.phase = "menu".into();
        st.world = None;
        st.server = None;
        st.lan_port = None;
    }
}

/// Pure parser — walks the log in order and keeps the latest known state.
///
/// World/LAN state is sticky: we only demote to menu on explicit leave/disconnect
/// lines. Bare `Stopping server` is ignored — mods spam it mid-session and that
/// was flipping the tray to "In menu" while still in a world.
pub fn parse_game_log(text: &str) -> GameLogStatus {
    let mut st = GameLogStatus {
        phase: "none".into(),
        ..Default::default()
    };
    for line in text.lines() {
        if line.contains("Setting user:") || line.contains("Loading Minecraft") {
            // New client session in the log — clear previous world/server.
            st = GameLogStatus {
                phase: "loading".into(),
                ..Default::default()
            };
        } else if line.contains("Sound engine started") || line.contains("OpenAL initialized") {
            if st.phase == "none" || st.phase == "loading" {
                st.phase = "menu".into();
            }

        } else if let Some(name) = extract_quoted(line, "Preparing level \"")
            .or_else(|| extract_quoted(line, "Preparing level '"))
        {
            st.world = Some(name.to_string());
            st.phase = "world".into();
            st.server = None;
        } else if line.contains("Preparing start region for dimension")
            || line.contains("Preparing spawn area")
            || line.contains("Loading spawn area")
        {
            // Modern / Fabric logs often omit the world name line in the tail.
            if st.phase != "server" && st.phase != "lan" {
                st.phase = "world".into();
            }
        } else if line.contains("Loaded ") && line.contains(" advancements") {
            if st.phase != "server" && st.phase != "lan" && st.phase != "none" {
                st.phase = "world".into();
            }
        } else if let Some(i) = line.find("Connecting to ") {
            let rest = line[i + "Connecting to ".len()..].trim();
            // Ignore noise like "Connecting to 0.0.0.0" from some mods.
            if !rest.is_empty() && !rest.starts_with("0.0.0.0") {
                st.server = Some(normalize_connecting_target(rest));
                st.phase = "server".into();
                st.world = None;
            }
        } else if let Some(i) = line.find("Started serving on ") {
            if let Ok(p) = line[i + "Started serving on ".len()..].trim().parse::<u16>() {
                st.lan_port = Some(p);
                st.phase = "lan".into();
            }
        } else if let Some(i) = line.find("Published LAN server on port ") {
            // Minecraft 1.20.5+ / 26.x Open-to-LAN wording.
            let rest = line[i + "Published LAN server on port ".len()..].trim();
            let digits: String = rest
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(p) = digits.parse::<u16>() {
                if p > 0 {
                    st.lan_port = Some(p);
                    st.phase = "lan".into();
                }
            }
        } else if line.contains("Stopping singleplayer server as player logged out")
            || line.contains("Disconnected from the server")
            || line.contains("Disconnected from ")
            || line.contains("Disconnecting from ")
            || line.contains("Leaving the world")
            || line.contains("Stopped level \"")
        {
            clear_to_menu(&mut st);
        }
        // Deliberately ignore bare "Stopping server" — too many false positives.
    }
    st
}

pub fn read_lan_port(log_path: &Path) -> Option<u16> {
    let text = fs::read_to_string(log_path).ok()?;
    parse_game_log(&text).lan_port
}

/// `host, port` / `'127.0.0.1', 25565` / junk around an IP → `host:port`.
fn normalize_connecting_target(raw: &str) -> String {
    let s = raw.trim();
    if let Some(addr) = find_ipv4_port(s) {
        return addr;
    }
    let cleaned = s.replace('\'', "").replace('"', "");
    let parts: Vec<&str> = cleaned.split(',').map(str::trim).collect();
    if parts.len() >= 2 {
        if let Ok(port) = parts[1].parse::<u16>() {
            if port > 0 {
                return format!("{}:{port}", parts[0]);
            }
        }
    }
    cleaned.replace(", ", ":")
}

fn find_ipv4_port(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut i = 0usize;
    while i < b.len() {
        if b[i].is_ascii_digit() {
            if let Some(addr) = try_parse_ipv4_port(&s[i..]) {
                return Some(addr);
            }
        }
        i += 1;
    }
    None
}

fn try_parse_ipv4_port(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut dots = 0usize;
    let mut i = 0usize;
    while i < b.len() {
        let c = b[i];
        if c.is_ascii_digit() {
            i += 1;
            continue;
        }
        if c == b'.' {
            dots += 1;
            i += 1;
            continue;
        }
        break;
    }
    if dots != 3 || i == 0 || i >= b.len() || b[i] != b':' {
        return None;
    }
    let host = &s[..i];
    i += 1;
    let port_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i == port_start {
        return None;
    }
    let port: u16 = s[port_start..i].parse().ok()?;
    (port > 0).then(|| format!("{host}:{port}"))
}

#[tauri::command]
pub fn game_log_status(app: AppHandle, pack_id: String) -> Result<GameLogStatus, String> {
    let log = instance_for(&app, &pack_id)?.join("logs").join("latest.log");
    Ok(parse_game_log(&read_tail(&log, 400_000)))
}

// ---------- screenshots (local only) ----------

#[derive(Debug, Serialize)]
pub struct ScreenshotRow {
    pub name: String,
    pub path: String,
    pub modified_ms: u64,
    pub size: u64,
}

#[tauri::command]
pub fn list_screenshots(app: AppHandle, pack_id: String) -> Result<Vec<ScreenshotRow>, String> {
    let dir = instance_for(&app, &pack_id)?.join("screenshots");
    let mut rows: Vec<ScreenshotRow> = fs::read_dir(&dir)
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let p = e.path();
                    let ext = p.extension()?.to_str()?.to_ascii_lowercase();
                    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg") {
                        return None;
                    }
                    Some(ScreenshotRow {
                        name: p.file_name()?.to_str()?.to_string(),
                        modified_ms: mtime_ms(&p),
                        size: e.metadata().map(|m| m.len()).unwrap_or(0),
                        path: p.display().to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    rows.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    rows.truncate(60);
    Ok(rows)
}

/// Read a screenshot as a data URL for the in-app viewer. Only files inside a pack's
/// `screenshots/` folder are allowed.
#[tauri::command]
pub fn read_screenshot(app: AppHandle, pack_id: String, name: String) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid screenshot name".into());
    }
    let path = instance_for(&app, &pack_id)?.join("screenshots").join(&name);
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 12 * 1024 * 1024 {
        return Err("screenshot too large to preview".into());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mime = if name.to_ascii_lowercase().ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    };
    Ok(format!("data:{mime};base64,{}", b64(&bytes)))
}

#[tauri::command]
pub fn screenshots_dir(app: AppHandle, pack_id: String) -> Result<String, String> {
    let instance = instance_for(&app, &pack_id)?;
    // Never mkdir a ghost instance — only open folders for installed packs.
    if !instance.is_dir() {
        return Err("Pack is not installed yet".into());
    }
    let dir = instance.join("screenshots");
    if !dir.is_dir() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_world_then_menu() {
        let log = "[10:00:00] [main/INFO]: Setting user: A\n\
                   [10:00:09] [Render thread/INFO]: Sound engine started\n\
                   [10:01:00] [Server thread/INFO]: Preparing level \"My World\"\n";
        let s = parse_game_log(log);
        assert_eq!(s.phase, "world");
        assert_eq!(s.world.as_deref(), Some("My World"));
        let log2 = format!(
            "{log}[10:02:00] [Server thread/INFO]: Stopping singleplayer server as player logged out\n"
        );
        assert_eq!(parse_game_log(&log2).phase, "menu");
    }

    #[test]
    fn parses_server_and_lan() {
        let s = parse_game_log("Setting user: A\nConnecting to play.example.com, 25565\n");
        assert_eq!(s.phase, "server");
        assert_eq!(s.server.as_deref(), Some("play.example.com:25565"));
        let s = parse_game_log("Setting user: A\nConnecting to '127.0.0.1', 53333\n");
        assert_eq!(s.server.as_deref(), Some("127.0.0.1:53333"));
        let s = parse_game_log("Setting user: A\nPreparing level \"W\"\nStarted serving on 54321\n");
        assert_eq!(s.phase, "lan");
        assert_eq!(s.lan_port, Some(54321));
        let s = parse_game_log(
            "Setting user: A\nPreparing level \"W\"\n\
             [Render thread/INFO]: Published LAN server on port 55678\n",
        );
        assert_eq!(s.phase, "lan");
        assert_eq!(s.lan_port, Some(55678));
        // New client boot must clear yesterday's Open-to-LAN (Play must not
        // rebuild a Relay session from a stale publish line).
        let s = parse_game_log(
            "Setting user: A\nPreparing level \"Old\"\nPublished LAN server on port 11111\n\
             Setting user: B\nSound engine started\nPreparing level \"New\"\n",
        );
        assert_eq!(s.phase, "world");
        assert_eq!(s.lan_port, None);
    }

    #[test]
    fn sticky_world_ignores_bare_stopping_server() {
        let log = "Setting user: A\nSound engine started\nPreparing level \"TestWorld\"\n\
                   [mod] Stopping server for reload\nSaving chunks for level\n";
        let s = parse_game_log(log);
        assert_eq!(s.phase, "world");
        assert_eq!(s.world.as_deref(), Some("TestWorld"));
    }

    #[test]
    fn modern_spawn_region_counts_as_world() {
        let log = "Setting user: A\nSound engine started\n\
                   Preparing start region for dimension minecraft:overworld\n\
                   Loaded 12 advancements\n";
        assert_eq!(parse_game_log(log).phase, "world");
    }

    #[test]
    fn crash_summary() {
        let t = "---- Minecraft Crash Report ----\n\nTime: x\nDescription: Initializing game\n\njava.lang.RuntimeException: boom\n\tat x";
        assert_eq!(summarize_crash(t), "Initializing game: java.lang.RuntimeException: boom");
    }
}
