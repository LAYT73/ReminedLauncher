//! Persistent voice diagnostics log for support / debugging.
//! Path: `<remined_root>/.remined/voice/voice.log`

use crate::paths;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

static LOG_LOCK: Mutex<()> = Mutex::new(());

pub fn log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = paths::remined_root(app)?;
    let dir = root.join(".remined").join("voice");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("voice.log"))
}

pub fn append(app: &AppHandle, source: &str, message: &str) -> Result<(), String> {
    let path = log_path(app)?;
    let _guard = LOG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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

/// Best-effort log (never fails the caller).
pub fn append_ok(app: &AppHandle, source: &str, message: &str) {
    let _ = append(app, source, message);
}

pub fn read_tail(app: &AppHandle, max_bytes: usize) -> Result<String, String> {
    let path = log_path(app)?;
    if !path.is_file() {
        return Ok(String::new());
    }
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    if data.len() <= max_bytes {
        return Ok(String::from_utf8_lossy(&data).into_owned());
    }
    let start = data.len() - max_bytes;
    // Skip partial first line
    let slice = &data[start..];
    let text = String::from_utf8_lossy(slice);
    if let Some(i) = text.find('\n') {
        Ok(text[i + 1..].to_string())
    } else {
        Ok(text.into_owned())
    }
}
