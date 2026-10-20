//! App-wide diagnostics: panic hook + `app.log`.
//! Path: `<remined_root>/.remined/logs/app.log`
//!
//! Release builds use `panic = "abort"`, so without a hook a panic on a Tokio
//! worker kills the process silently (see BUG-002).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};

static LOG_FILE: OnceLock<PathBuf> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Lock a mutex, recovering from poisoning instead of panicking
/// (a poisoned lock after a prior panic must not cascade into an abort).
pub fn lock_session<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// `<remined_root>/.remined/logs` — safe to reveal in Finder/Explorer.
pub fn logs_dir(root: &std::path::Path) -> PathBuf {
    root.join(".remined").join("logs")
}

/// Set the log destination once the install root is known.
pub fn set_log_dir(root: &std::path::Path) {
    let dir = logs_dir(root);
    if fs::create_dir_all(&dir).is_ok() {
        let _ = LOG_FILE.set(dir.join("app.log"));
    }
}

/// Ensure the logs folder exists and return its path (for Debug settings).
pub fn ensure_logs_dir(root: &std::path::Path) -> Result<PathBuf, String> {
    let dir = logs_dir(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn fallback_path() -> PathBuf {
    std::env::temp_dir().join("remined-app.log")
}

pub fn log(source: &str, message: &str) {
    let path = LOG_FILE.get().cloned().unwrap_or_else(fallback_path);
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(f, "[{ts}] [{source}] {message}");
        let _ = f.flush();
    }
}

/// Install the global panic hook. Call as early as possible in `run()`.
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("<unnamed>");
        let loc = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".into());
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "<non-string payload>".into()
        };
        let bt = std::backtrace::Backtrace::force_capture();
        let msg = format!("PANIC thread='{name}' at {loc}: {payload}\n{bt}");
        eprintln!("{msg}");
        log("panic", &msg);
        default(info);
    }));
}
