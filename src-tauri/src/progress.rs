use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct ProgressEvent {
    pub phase: String,
    pub percent: u32,
    pub message: String,
}

/// Global floor so the UI bar never jumps backwards across phases / races.
static OVERALL: AtomicU32 = AtomicU32::new(0);
/// Set by UI cancel; install/download loops poll via [`check_cancelled`].
static CANCELLED: AtomicBool = AtomicBool::new(false);

/// Map a phase-local 0..=100 into a fixed overall band.
fn map_overall(phase: &str, local: u32) -> u32 {
    let local = local.min(100) as u64;
    // Bands cover both Java-only onboarding and pack Download (pack→fabric→assets).
    let (start, end) = match phase {
        "java" => (0u64, 100u64),
        "pack" => (0, 45),
        "fabric" => (45, 75),
        "assets" => (75, 96),
        "runtime" => (96, 99),
        "done" => (100, 100),
        _ => (0, 100),
    };
    if start >= end {
        return end as u32;
    }
    (start + (end - start) * local / 100) as u32
}

fn raise_overall(target: u32) -> u32 {
    let target = target.min(100);
    loop {
        let cur = OVERALL.load(Ordering::Relaxed);
        if target <= cur {
            return cur;
        }
        if OVERALL
            .compare_exchange(cur, target, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            return target;
        }
    }
}

pub fn reset() {
    OVERALL.store(0, Ordering::Relaxed);
    CANCELLED.store(false, Ordering::SeqCst);
}

pub fn request_cancel() {
    CANCELLED.store(true, Ordering::SeqCst);
}

pub fn is_cancelled() -> bool {
    CANCELLED.load(Ordering::SeqCst)
}

pub fn check_cancelled() -> Result<(), String> {
    if is_cancelled() {
        Err(crate::i18n::tr("progress.cancelled").into())
    } else {
        Ok(())
    }
}

/// Progress target: a real Tauri app, or headless (CLI / smoke tests).
#[derive(Clone)]
pub struct Ctx(Option<AppHandle>);

impl Ctx {
    /// No UI — progress goes to stderr when `REMINED_PROGRESS=1`.
    pub fn headless() -> Self {
        Ctx(None)
    }
}

impl From<AppHandle> for Ctx {
    fn from(h: AppHandle) -> Self {
        Ctx(Some(h))
    }
}

pub fn emit(app: &Ctx, phase: &str, local_percent: u32, message: impl Into<String>) {
    let mapped = map_overall(phase, local_percent);
    let percent = raise_overall(mapped);
    let message = message.into();
    match &app.0 {
        Some(h) => {
            let _ = h.emit(
                "remined-progress",
                ProgressEvent {
                    phase: phase.into(),
                    percent,
                    message,
                },
            );
        }
        None => {
            if std::env::var_os("REMINED_PROGRESS").is_some() {
                eprintln!("[{phase} {percent}%] {message}");
            }
        }
    }
}
