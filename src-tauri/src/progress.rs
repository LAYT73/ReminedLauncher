use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct ProgressEvent {
    pub phase: String,
    pub percent: u32,
    pub message: String,
}

pub fn emit(app: &AppHandle, phase: &str, percent: u32, message: impl Into<String>) {
    let _ = app.emit(
        "remined-progress",
        ProgressEvent {
            phase: phase.into(),
            percent: percent.min(100),
            message: message.into(),
        },
    );
}
