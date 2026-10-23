//! Launcher <-> running game helpers: crash detection, live game phase from
//! `logs/latest.log`, and the local screenshots folder (never uploaded anywhere).

use crate::paths::{self, pack_dir};
use base64_lite::encode as b64;
use chrono::{DateTime, Local, NaiveDate, NaiveTime, TimeZone};
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
        crate::i18n::tr("game.crash_hs_err").to_string()
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
pub async fn latest_crash_report(
    app: AppHandle,
    pack_id: String,
    since_ms: u64,
) -> Result<Option<CrashInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(latest_crash(&instance_for(&app, &pack_id)?, since_ms))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- live game phase ----------

#[derive(Debug, Serialize, Default, PartialEq)]
pub struct GameLogStatus {
    /// "none" | "loading" | "menu" | "world" | "server" | "lan"
    pub phase: String,
    pub world: Option<String>,
    pub server: Option<String>,
    pub lan_port: Option<u16>,
    /// Friend-safe activity code: "" | "loading" | "menu" | "sp" | "lan" | "mp" |
    /// "death" | "advancement". Never carries host/IP or world name.
    pub activity: String,
    /// Singleplayer world is still starting up (until advancements/spawn done).
    #[serde(skip)]
    loading_world: bool,
    /// Latest transient chat event: (code, unique line key).
    #[serde(skip)]
    event: Option<(&'static str, String)>,
}

/// Who/what the parser should look for in chat lines.
#[derive(Debug, Default, Clone)]
pub struct LogCtx {
    pub username: Option<String>,
    /// options.txt `lang:` is English (or missing) — death/advancement text is parseable.
    pub english: bool,
}

/// Seconds a transient activity (death / advancement) stays visible.
pub fn event_hold_secs(code: &str) -> u64 {
    if code == "death" { 30 } else { 15 }
}

// Pattern tables (English chat only).
const DEATH_VERBS: &[&str] = &[
    "was slain", "was shot", "drowned", "blew up", "was blown up", "hit the ground",
    "fell ", "burned", "went up in flames", "tried to swim in lava", "was killed",
    "starved", "suffocated", "was squashed", "was pricked", "walked into", "froze",
    "withered", "died", "was impaled", "was fireballed", "was struck by lightning",
    "experienced kinetic energy", "was poked", "was stung", "was obliterated",
    "didn't want to live",
];
const ADVANCEMENT_MARKERS: &[&str] = &[
    " has made the advancement [",
    " has completed the challenge [",
    " has reached the goal [",
];
/// Lines that mean the integrated world finished starting.
const WORLD_READY_MARKERS: &[&str] = &["Time elapsed:", "Done ("];

impl GameLogStatus {
    fn base_activity(&self) -> &'static str {
        match self.phase.as_str() {
            "loading" => "loading",
            "menu" => "menu",
            "world" if self.loading_world => "loading",
            "world" => "sp",
            "lan" => "lan",
            "server" => "mp",
            _ => "",
        }
    }

    /// Recompute `activity`; `event_live` = the transient event is still within its hold.
    pub fn finalize(&mut self, event_live: bool) {
        self.activity = match (&self.event, event_live) {
            (Some((code, _)), true) => (*code).to_string(),
            _ => self.base_activity().to_string(),
        };
    }

    /// (code, key) of the latest transient event, for hold timing.
    pub fn event_key(&self) -> Option<(&'static str, &str)> {
        self.event.as_ref().map(|(c, k)| (*c, k.as_str()))
    }
}

fn chat_event(line: &str, ctx: &LogCtx) -> Option<&'static str> {
    if !ctx.english {
        return None;
    }
    let name = ctx.username.as_deref()?.trim();
    if name.is_empty() {
        return None;
    }
    let i = line.find("[CHAT] ")?;
    let msg = line[i + "[CHAT] ".len()..].trim();
    let rest = msg.strip_prefix(name)?.strip_prefix(' ')?;
    if ADVANCEMENT_MARKERS.iter().any(|m| rest.starts_with(m.trim_start())) {
        return Some("advancement");
    }
    if DEATH_VERBS.iter().any(|v| rest.contains(v)) {
        return Some("death");
    }
    None
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
        st.loading_world = false;
        st.event = None;
    }
}

/// Pure parser — walks the log in order and keeps the latest known state.
///
/// World/LAN state is sticky: we only demote to menu on explicit leave/disconnect
/// lines. Bare `Stopping server` is ignored — mods spam it mid-session and that
/// was flipping the tray to "In menu" while still in a world.
#[cfg(test)]
pub fn parse_game_log(text: &str) -> GameLogStatus {
    parse_game_log_ctx(text, &LogCtx::default())
}

pub fn parse_game_log_ctx(text: &str, ctx: &LogCtx) -> GameLogStatus {
    let mut st = GameLogStatus {
        phase: "none".into(),
        ..Default::default()
    };
    for line in text.lines() {
        if let Some(code) = chat_event(line, ctx) {
            st.event = Some((code, line.trim().to_string()));
            continue;
        }
        if line.contains("Starting integrated minecraft server version") {
            st.phase = "world".into();
            st.world = None;
            st.server = None;
            st.lan_port = None;
            st.loading_world = true;
            st.event = None;
        } else if st.loading_world
            && WORLD_READY_MARKERS.iter().any(|m| line.contains(m))
        {
            st.loading_world = false;
        } else if line.contains("Setting user:") || line.contains("Loading Minecraft") {
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
            st.event = None;
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
            st.loading_world = false;
        } else if let Some(i) = line.find("Connecting to ") {
            let rest = line[i + "Connecting to ".len()..].trim();
            // Ignore noise like "Connecting to 0.0.0.0" from some mods.
            if !rest.is_empty() && !rest.starts_with("0.0.0.0") {
                st.server = Some(normalize_connecting_target(rest));
                st.phase = "server".into();
                st.world = None;
                st.loading_world = false;
                st.event = None;
            }
        } else if let Some(i) = line.find("Started serving on ") {
            if let Ok(p) = line[i + "Started serving on ".len()..].trim().parse::<u16>() {
                st.lan_port = Some(p);
                st.phase = "lan".into();
                st.loading_world = false;
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
                    st.loading_world = false;
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
    st.finalize(true);
    st
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

/// `lang:` from options.txt — English (or unset) means chat text is parseable.
fn options_lang_is_english(instance: &Path) -> bool {
    let Ok(text) = fs::read_to_string(instance.join("options.txt")) else {
        return true;
    };
    match text.lines().find_map(|l| l.strip_prefix("lang:")) {
        Some(v) => v.trim().to_ascii_lowercase().starts_with("en"),
        None => true,
    }
}

/// First time we saw the current transient event (so it can expire after its hold).
static EVENT_SEEN: std::sync::Mutex<Option<(String, std::time::Instant)>> =
    std::sync::Mutex::new(None);

/// Parses the `[...]` stamp at the start of a log line. `[HH:MM:SS]` gives only a
/// time of day; `[DDMonYYYY HH:MM:SS(.mmm)]` gives the date too.
fn log_line_stamp(line: &str) -> Option<(Option<NaiveDate>, NaiveTime)> {
    let inner = line.trim_start().strip_prefix('[')?;
    let inner = &inner[..inner.find(']')?];
    let (date, time) = match inner.split_once(' ') {
        Some((d, t)) => (Some(NaiveDate::parse_from_str(d, "%d%b%Y").ok()?), t),
        None => (None, inner),
    };
    let time = time.split('.').next()?;
    Some((date, NaiveTime::parse_from_str(time, "%H:%M:%S").ok()?))
}

/// Whether a transient event line is still inside its hold window at `now`.
/// `mtime` (the log's last write) supplies the day for `[HH:MM:SS]` stamps, rolled
/// back one day when that time of day is after the write. If the stamp can't be
/// read, only the log's write time is used.
fn event_within_hold(code: &str, line: &str, mtime: DateTime<Local>, now: DateTime<Local>) -> bool {
    let hold = event_hold_secs(code) as i64;
    let at = match log_line_stamp(line) {
        Some((Some(date), time)) => Local.from_local_datetime(&date.and_time(time)).earliest(),
        Some((None, time)) => {
            let day = mtime.date_naive();
            Local
                .from_local_datetime(&day.and_time(time))
                .earliest()
                .filter(|t| *t <= mtime)
                .or_else(|| {
                    let prev = day.pred_opt()?;
                    Local.from_local_datetime(&prev.and_time(time)).earliest()
                })
        }
        None => None,
    };
    match at {
        Some(at) => now.signed_duration_since(at).num_seconds() < hold,
        None => now.signed_duration_since(mtime).num_seconds() < hold,
    }
}

fn event_still_live(st: &GameLogStatus, log_mtime: Option<std::time::SystemTime>) -> bool {
    let Some((code, key)) = st.event_key() else {
        return false;
    };
    let within = log_mtime
        .map(|m| event_within_hold(code, key, m.into(), Local::now()))
        .unwrap_or(false);
    let mut seen = EVENT_SEEN.lock().unwrap_or_else(|e| e.into_inner());
    let now = std::time::Instant::now();
    let first = match seen.as_ref() {
        Some((k, t)) if k == key => *t,
        _ => {
            *seen = Some((key.to_string(), now));
            now
        }
    };
    within && now.duration_since(first).as_secs() < event_hold_secs(code)
}

#[tauri::command]
pub async fn game_log_status(app: AppHandle, pack_id: String) -> Result<GameLogStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let instance = instance_for(&app, &pack_id)?;
        let log = instance.join("logs").join("latest.log");
        let username = paths::remined_root(&app)
            .ok()
            .map(|r| crate::load_profile(&r).username);
        let ctx = LogCtx {
            username,
            english: options_lang_is_english(&instance),
        };
        let mut st = parse_game_log_ctx(&read_tail(&log, 400_000), &ctx);
        let log_mtime = fs::metadata(&log).and_then(|m| m.modified()).ok();
        let live = event_still_live(&st, log_mtime);
        st.finalize(live);
        let state = read_companion_state(&instance);
        merge_companion(&mut st, state.as_ref(), now_ms());
        Ok(st)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- companion mod state (<gameDir>/.remined/state.json) ----------

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CompanionState {
    #[serde(default, rename = "inWorld")]
    pub in_world: bool,
    #[serde(default)]
    pub dim: Option<String>,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub screen: Option<String>,
    #[serde(default)]
    pub ts: u64,
}

const COMPANION_MAX_AGE_MS: u64 = 30_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_companion_state(instance: &Path) -> Option<CompanionState> {
    let raw = fs::read_to_string(instance.join(".remined").join("state.json")).ok()?;
    serde_json::from_str(&raw).ok()
}

fn dim_short(dim: Option<&str>) -> &'static str {
    match dim {
        Some("minecraft:overworld") => "overworld",
        Some("minecraft:the_nether") => "nether",
        Some("minecraft:the_end") => "end",
        _ => "other",
    }
}

/// Override the log-derived activity with fresh companion data. Stale/missing = no change.
pub fn merge_companion(st: &mut GameLogStatus, state: Option<&CompanionState>, now_ms: u64) {
    let Some(c) = state else { return };
    if c.ts == 0 || now_ms.saturating_sub(c.ts) > COMPANION_MAX_AGE_MS {
        return;
    }
    if !c.in_world {
        if c.mode == "menu" || c.mode.is_empty() {
            st.activity = "menu".into();
        }
        return;
    }
    let screen = c.screen.as_deref().unwrap_or("");
    let is_death = matches!(screen, "class_418" | "DeathScreen");
    let is_pause_screen = matches!(screen, "class_433" | "GameMenuScreen" | "PauseScreen");
    let base = match c.mode.as_str() {
        "sp" | "lan" | "mp" => c.mode.as_str(),
        _ => {
            // Unknown mode: keep the log's base when it is a world kind, else singleplayer.
            match st.activity.split('|').next().unwrap_or("") {
                b @ ("sp" | "lan" | "mp") => b,
                _ => "sp",
            }
        }
    };
    let dim = dim_short(c.dim.as_deref());
    let mut out = if is_death {
        format!("death|{dim}")
    } else {
        format!("{base}|{dim}")
    };
    if !is_death && (is_pause_screen || (c.paused && c.mode == "sp")) {
        out.push_str("|paused");
    }
    st.activity = out;
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
pub async fn list_screenshots(
    app: AppHandle,
    pack_id: String,
) -> Result<Vec<ScreenshotRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read a screenshot as a data URL for the in-app viewer. Only files inside a pack's
/// `screenshots/` folder are allowed.
#[tauri::command]
pub async fn read_screenshot(
    app: AppHandle,
    pack_id: String,
    name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err(crate::i18n::tr("game.screenshot_bad_name").into());
        }
        let path = instance_for(&app, &pack_id)?.join("screenshots").join(&name);
        let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
        if meta.len() > 12 * 1024 * 1024 {
            return Err(crate::i18n::tr("game.screenshot_too_large").into());
        }
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let mime = if name.to_ascii_lowercase().ends_with(".png") {
            "image/png"
        } else {
            "image/jpeg"
        };
        Ok(format!("data:{mime};base64,{}", b64(&bytes)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn screenshots_dir(app: AppHandle, pack_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let instance = instance_for(&app, &pack_id)?;
        // Never mkdir a ghost instance — only open folders for installed packs.
        if !instance.is_dir() {
            return Err(crate::i18n::tr("game.pack_not_installed_yet").into());
        }
        let dir = instance.join("screenshots");
        if !dir.is_dir() {
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        Ok(dir.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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

    fn ctx(name: &str) -> LogCtx {
        LogCtx { username: Some(name.into()), english: true }
    }

    #[test]
    fn activity_transitions_1_16_5() {
        let boot = "[10:00:00] [main/INFO]: Setting user: Steve\n";
        assert_eq!(parse_game_log(boot).activity, "loading");
        let menu = format!("{boot}[10:00:09] [Render thread/INFO]: OpenAL initialized.\n");
        assert_eq!(parse_game_log(&menu).activity, "menu");
        let loading = format!(
            "{menu}[10:01:00] [Render thread/INFO]: Starting integrated minecraft server version 1.16.5\n\
             [10:01:01] [Server thread/INFO]: Preparing level \"New World\"\n"
        );
        let s = parse_game_log(&loading);
        assert_eq!((s.phase.as_str(), s.activity.as_str()), ("world", "loading"));
        assert_eq!(s.world.as_deref(), Some("New World"));
        let ready = format!(
            "{loading}[10:01:05] [Server thread/INFO]: Time elapsed: 3000 ms\n\
             [10:01:06] [Render thread/INFO]: Loaded 7 recipes\n\
             [10:01:06] [Render thread/INFO]: Loaded 1179 advancements\n"
        );
        assert_eq!(parse_game_log(&ready).activity, "sp");
        let lan = format!(
            "{ready}[10:02:00] [Server thread/INFO]: Started serving on 51234\n"
        );
        let s = parse_game_log(&lan);
        assert_eq!((s.activity.as_str(), s.lan_port), ("lan", Some(51234)));
        let left = format!(
            "{lan}[10:03:00] [Server thread/INFO]: Stopping singleplayer server as player logged out\n"
        );
        assert_eq!(parse_game_log(&left).activity, "menu");
    }

    #[test]
    fn activity_multiplayer_1_20_1() {
        let log = "[10:00:00] [main/INFO]: Setting user: Steve\n\
                   [10:00:09] [Render thread/INFO]: Sound engine started\n\
                   [10:01:00] [Render thread/INFO]: Connecting to mc.example.net, 25565\n";
        let s = parse_game_log(log);
        assert_eq!(s.activity, "mp");
        let log = format!("{log}[10:05:00] [Render thread/INFO]: Disconnected from the server\n");
        assert_eq!(parse_game_log(&log).activity, "menu");
    }

    #[test]
    fn activity_lan_1_21() {
        let log = "[10:00:00] [main/INFO]: Setting user: Steve\n\
                   [10:00:09] [Render thread/INFO]: Sound engine started\n\
                   [10:01:00] [Render thread/INFO]: Starting integrated minecraft server version 1.21.4\n\
                   [10:01:03] [Server thread/INFO]: Preparing level \"W\"\n\
                   [10:01:06] [Render thread/INFO]: Loaded 1370 advancements\n\
                   [10:02:00] [Server thread/INFO]: [System] [CHAT] Local game hosted on port 50001\n\
                   [10:02:00] [Server thread/INFO]: Published LAN server on port 50001\n";
        let s = parse_game_log(log);
        assert_eq!((s.activity.as_str(), s.lan_port), ("lan", Some(50001)));
        // Bare "Stopping server" must not demote.
        let log = format!("{log}[10:03:00] [Server thread/INFO]: Stopping server\n");
        assert_eq!(parse_game_log(&log).activity, "lan");
    }

    #[test]
    fn death_and_advancement_local_player_only() {
        let base = "Setting user: Steve\nSound engine started\n\
                    Preparing level \"W\"\nLoaded 10 advancements\n";
        let death = format!("{base}[10:05:00] [Render thread/INFO]: [CHAT] Steve was slain by Zombie\n");
        assert_eq!(parse_game_log_ctx(&death, &ctx("Steve")).activity, "death");
        // 1.19+ prefix.
        let death = format!("{base}[10:05:00] [Render thread/INFO]: [System] [CHAT] Steve fell from a high place\n");
        assert_eq!(parse_game_log_ctx(&death, &ctx("Steve")).activity, "death");
        // Someone else / player chat is ignored.
        let other = format!(
            "{base}[CHAT] Alex was slain by Zombie\n[CHAT] <Alex> Steve died lol\n[CHAT] Steve2 died\n"
        );
        assert_eq!(parse_game_log_ctx(&other, &ctx("Steve")).activity, "sp");
        let adv = format!("{base}[System] [CHAT] Steve has made the advancement [Stone Age]\n");
        assert_eq!(parse_game_log_ctx(&adv, &ctx("Steve")).activity, "advancement");
        let adv = format!("{base}[CHAT] Steve has completed the challenge [Postmortal]\n");
        assert_eq!(parse_game_log_ctx(&adv, &ctx("Steve")).activity, "advancement");
        // Non-English client: skipped.
        let ru = LogCtx { username: Some("Steve".into()), english: false };
        assert_eq!(parse_game_log_ctx(&death, &ru).activity, "sp");
        // Event expiry falls back to the base activity; leaving clears it.
        let mut s = parse_game_log_ctx(&death, &ctx("Steve"));
        s.finalize(false);
        assert_eq!(s.activity, "sp");
        let left = format!("{death}Disconnecting from world\n");
        assert_eq!(parse_game_log_ctx(&left, &ctx("Steve")).activity, "menu");
    }

    #[test]
    fn log_line_stamp_formats() {
        assert_eq!(
            log_line_stamp("[10:05:00] [Render thread/INFO]: [CHAT] x"),
            Some((None, NaiveTime::from_hms_opt(10, 5, 0).unwrap()))
        );
        assert_eq!(
            log_line_stamp("[14Jan2026 10:05:00.123] [CHAT] x"),
            Some((
                NaiveDate::from_ymd_opt(2026, 1, 14),
                NaiveTime::from_hms_opt(10, 5, 0).unwrap()
            ))
        );
        assert_eq!(log_line_stamp("Steve was slain by Zombie"), None);
        assert_eq!(log_line_stamp("[CHAT] Steve was slain"), None);
    }

    #[test]
    fn event_hold_uses_line_time_not_launch_time() {
        let at = |d: u32, h: u32, m: u32, s: u32| Local.with_ymd_and_hms(2026, 1, d, h, m, s).unwrap();
        let death = "[10:05:00] [Render thread/INFO]: [CHAT] Steve was slain by Zombie";
        // Log written at 10:05:20, event at 10:05:00: live for 30s from the event.
        assert!(event_within_hold("death", death, at(10, 10, 5, 20), at(10, 10, 5, 25)));
        assert!(!event_within_hold("death", death, at(10, 10, 5, 20), at(10, 10, 5, 31)));
        // Game still running, log written an hour after the event: stale.
        assert!(!event_within_hold("death", death, at(10, 11, 0, 0), at(10, 11, 0, 5)));
        // Advancement holds 15s.
        let adv = "[10:05:00] [Render thread/INFO]: [CHAT] Steve has made the advancement [Stone Age]";
        assert!(event_within_hold("advancement", adv, at(10, 10, 5, 14), at(10, 10, 5, 14)));
        assert!(!event_within_hold("advancement", adv, at(10, 10, 5, 15), at(10, 10, 5, 15)));
        // Midnight rollover: 23:59:50 event, log written 00:00:10 the next day.
        let late = "[23:59:50] [Render thread/INFO]: [CHAT] Steve was slain by Zombie";
        assert!(event_within_hold("death", late, at(11, 0, 0, 10), at(11, 0, 0, 12)));
        // Explicit date stamp ignores the write time.
        let dated = "[09Jan2026 10:05:00.500] [CHAT] Steve was slain by Zombie";
        assert!(!event_within_hold("death", dated, at(10, 10, 5, 20), at(10, 10, 5, 20)));
        // Unparseable stamp: falls back to log write time.
        let plain = "[CHAT] Steve was slain by Zombie";
        assert!(event_within_hold("death", plain, at(10, 10, 5, 0), at(10, 10, 5, 20)));
        assert!(!event_within_hold("death", plain, at(10, 10, 5, 0), at(10, 10, 5, 40)));
    }

    #[test]
    fn crash_summary() {
        let t = "---- Minecraft Crash Report ----\n\nTime: x\nDescription: Initializing game\n\njava.lang.RuntimeException: boom\n\tat x";
        assert_eq!(summarize_crash(t), "Initializing game: java.lang.RuntimeException: boom");
    }

    fn cs(mode: &str, dim: &str, paused: bool, screen: Option<&str>, ts: u64) -> CompanionState {
        CompanionState {
            in_world: mode != "menu",
            dim: if mode == "menu" { None } else { Some(dim.into()) },
            paused,
            mode: mode.into(),
            screen: screen.map(String::from),
            ts,
        }
    }

    fn merged(log_act: &str, c: Option<CompanionState>, now: u64) -> String {
        let mut st = GameLogStatus { activity: log_act.into(), ..Default::default() };
        merge_companion(&mut st, c.as_ref(), now);
        st.activity
    }

    #[test]
    fn companion_merge() {
        let now = 1_000_000;
        // missing / stale -> log unchanged
        assert_eq!(merged("sp", None, now), "sp");
        assert_eq!(merged("sp", Some(cs("mp", "minecraft:overworld", false, None, now - 31_000)), now), "sp");
        // fresh dims
        assert_eq!(merged("sp", Some(cs("sp", "minecraft:the_nether", false, None, now - 1000)), now), "sp|nether");
        assert_eq!(merged("sp", Some(cs("mp", "minecraft:the_end", false, None, now)), now), "mp|end");
        assert_eq!(merged("sp", Some(cs("lan", "minecraft:overworld", false, None, now)), now), "lan|overworld");
        assert_eq!(merged("sp", Some(cs("sp", "mod:x", false, None, now)), now), "sp|other");
        // mode overrides log
        assert_eq!(merged("mp", Some(cs("sp", "minecraft:overworld", false, None, now)), now), "sp|overworld");
        // pause
        assert_eq!(merged("sp", Some(cs("sp", "minecraft:the_nether", true, None, now)), now), "sp|nether|paused");
        assert_eq!(merged("sp", Some(cs("mp", "minecraft:overworld", false, Some("class_433"), now)), now), "mp|overworld|paused");
        assert_eq!(merged("sp", Some(cs("mp", "minecraft:overworld", false, Some("PauseScreen"), now)), now), "mp|overworld|paused");
        // paused flag only counts in singleplayer
        assert_eq!(merged("mp", Some(cs("mp", "minecraft:overworld", true, None, now)), now), "mp|overworld");
        // death overrides chat-based and pause
        assert_eq!(merged("advancement", Some(cs("sp", "minecraft:the_nether", true, Some("class_418"), now)), now), "death|nether");
        assert_eq!(merged("sp", Some(cs("sp", "minecraft:overworld", false, Some("DeathScreen"), now)), now), "death|overworld");
        // menu
        assert_eq!(merged("sp", Some(cs("menu", "", false, None, now)), now), "menu");
    }
}
