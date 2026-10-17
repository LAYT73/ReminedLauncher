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
        Err("Cancelled".into())
    } else {
        Ok(())
    }
}

pub fn emit(app: &AppHandle, phase: &str, local_percent: u32, message: impl Into<String>) {
    let mapped = map_overall(phase, local_percent);
    let percent = raise_overall(mapped);
    let _ = app.emit(
        "remined-progress",
        ProgressEvent {
            phase: phase.into(),
            percent,
            message: message.into(),
        },
    );
}
