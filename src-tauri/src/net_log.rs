//! Network / Porthole / LAN diagnostics — split into small chunk files.
//!
//! Dir: `<remined_root>/.remined/network/`
//! Active: `current.log` (rotated when large or on `begin_chunk`)
//! Archives: `net-YYYYMMDD-HHMMSS.log` (oldest pruned; keeps last [`MAX_CHUNKS`])

use crate::paths;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::AppHandle;

const MAX_CHUNK_BYTES: u64 = 180_000; // ~180 KB — easy to read whole
const MAX_CHUNKS: usize = 24;
static LOCK: Mutex<()> = Mutex::new(());
/// Last `read_lan` value we logged — suppress poll spam.
static LAST_LAN: Mutex<Option<Option<u16>>> = Mutex::new(None);

pub fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = paths::remined_root(app)?;
    let dir = root.join(".remined").join("network");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn current_path(dir: &Path) -> PathBuf {
    dir.join("current.log")
}

/// Start a fresh chunk (call on host/join begin so each attempt is isolatable).
pub fn begin_chunk(app: &AppHandle, label: &str) {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Ok(dir) = dir(app) else { return };
    rotate_locked(&dir);
    let _ = append_locked(
        &dir,
        "session",
        &format!("—— chunk begin: {label} ——"),
    );
}

pub fn append_ok(app: &AppHandle, source: &str, message: &str) {
    let _ = append(app, source, message);
}

pub fn append(app: &AppHandle, source: &str, message: &str) -> Result<(), String> {
    let dir = dir(app)?;
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    maybe_rotate_by_size_locked(&dir);
    append_locked(&dir, source, message)
}

/// Log Open-to-LAN poll only when the detected port changes.
pub fn lan_poll(app: &AppHandle, pack_id: &str, port: Option<u16>) {
    let changed = {
        let mut prev = LAST_LAN.lock().unwrap_or_else(|e| e.into_inner());
        if *prev == Some(port) {
            false
        } else {
            *prev = Some(port);
            true
        }
    };
    if !changed {
        return;
    }
    match port {
        Some(p) => append_ok(app, "lan", &format!("pack={pack_id} port={p}")),
        None => append_ok(app, "lan", &format!("pack={pack_id} port=- (closed/miss)")),
    }
}

/// Tail of the active chunk (and previous archive if current is tiny).
pub fn read_tail(app: &AppHandle, max_bytes: usize) -> Result<String, String> {
    let dir = dir(app)?;
    let cur = current_path(&dir);
    let mut out = String::new();
    if cur.is_file() {
        out.push_str(&read_file_tail(&cur, max_bytes)?);
    }
    if out.len() < max_bytes / 3 {
        if let Some(prev) = newest_archive(&dir) {
            let need = max_bytes.saturating_sub(out.len());
            let older = read_file_tail(&prev, need)?;
            if !older.is_empty() {
                out = format!(
                    "—— {} ——\n{older}\n—— current.log ——\n{out}",
                    prev.file_name().and_then(|s| s.to_str()).unwrap_or("prev")
                );
            }
        }
    }
    Ok(out)
}

pub fn list_chunks(app: &AppHandle) -> Result<Vec<String>, String> {
    let dir = dir(app)?;
    let mut names: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            if n == "current.log" || (n.starts_with("net-") && n.ends_with(".log")) {
                Some(n)
            } else {
                None
            }
        })
        .collect();
    names.sort();
    Ok(names)
}

fn append_locked(dir: &Path, source: &str, message: &str) -> Result<(), String> {
    let path = current_path(dir);
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{ts}] [{source}] {message}\n");
    f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    let _ = f.flush();
    Ok(())
}

fn maybe_rotate_by_size_locked(dir: &Path) {
    let path = current_path(dir);
    let Ok(meta) = fs::metadata(&path) else { return };
    if meta.len() >= MAX_CHUNK_BYTES {
        rotate_locked(dir);
    }
}

fn rotate_locked(dir: &Path) {
    let cur = current_path(dir);
    if !cur.is_file() {
        return;
    }
    let Ok(meta) = fs::metadata(&cur) else { return };
    if meta.len() == 0 {
        return;
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let mut dest = dir.join(format!("net-{stamp}.log"));
    // Avoid clobber if two rotates in the same second.
    if dest.exists() {
        dest = dir.join(format!(
            "net-{}-{}.log",
            stamp,
            std::process::id() % 1000
        ));
    }
    let _ = fs::rename(&cur, &dest);
    prune_locked(dir);
}

fn prune_locked(dir: &Path) {
    let mut archives: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|n| n.starts_with("net-") && n.ends_with(".log"))
        })
        .collect();
    archives.sort();
    while archives.len() > MAX_CHUNKS {
        if let Some(old) = archives.first().cloned() {
            let _ = fs::remove_file(&old);
            archives.remove(0);
        } else {
            break;
        }
    }
}

fn newest_archive(dir: &Path) -> Option<PathBuf> {
    let mut archives: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|n| n.starts_with("net-") && n.ends_with(".log"))
        })
        .collect();
    archives.sort();
    archives.pop()
}

fn read_file_tail(path: &Path, max_bytes: usize) -> Result<String, String> {
    if !path.is_file() {
        return Ok(String::new());
    }
    let data = fs::read(path).map_err(|e| e.to_string())?;
    if data.len() <= max_bytes {
        return Ok(String::from_utf8_lossy(&data).into_owned());
    }
    let start = data.len() - max_bytes;
    let text = String::from_utf8_lossy(&data[start..]);
    if let Some(i) = text.find('\n') {
        Ok(text[i + 1..].to_string())
    } else {
        Ok(text.into_owned())
    }
}

/// Interesting Porthole stdout/stderr lines only (not the full firehose).
pub fn porthole_line_interesting(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    // Skip periodic link stats — they drown the signal.
    if lower.contains("\"event\":\"link\"") || lower.contains("\"event\": \"link\"") {
        return false;
    }
    lower.contains("static_code")
        || lower.contains("share_code")
        || lower.contains("lobby_ready")
        || lower.contains("port_accepted")
        || lower.contains("port_offered")
        || lower.contains("port_rejected")
        || lower.contains("session_opened")
        || lower.contains("session_closed")
        || lower.contains("peer_connected")
        || lower.contains("peer_disconnected")
        || lower.contains("member")
        || lower.contains("approv")
        || lower.contains("forward")
        || lower.contains("error")
        || lower.contains("fail")
        || lower.contains("kick")
        || lower.contains("mismatch")
        || lower.contains("steam init")
        || lower.contains("not logged")
        || lower.contains("roster")
}
