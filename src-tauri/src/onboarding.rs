use crate::java_runtime::{self, JavaInfo};
use crate::pack_sync::{self, PackStatus};
use crate::paths::{onboarding_path, pack_dir};
use crate::progress;
use crate::runtime;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingState {
    pub completed: bool,
    pub java_ok: bool,
    pub pack_ok: bool,
    pub runtime_ok: bool,
    pub java_path: Option<String>,
    pub pack_id: Option<String>,
    pub pack_version: Option<String>,
}

impl Default for OnboardingState {
    fn default() -> Self {
        Self {
            completed: false,
            java_ok: false,
            pack_ok: false,
            runtime_ok: false,
            java_path: None,
            pack_id: None,
            pack_version: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeStatus {
    pub onboarding: OnboardingState,
    pub java: JavaInfo,
    pub pack: Option<PackStatus>,
}

pub fn load_state(root: &Path) -> OnboardingState {
    fs::read_to_string(onboarding_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_state(root: &Path, state: &OnboardingState) -> Result<(), String> {
    let dir = root.join(".remined");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(onboarding_path(root), json).map_err(|e| e.to_string())
}

pub fn status(root: &Path) -> RuntimeStatus {
    let mut onboarding = load_state(root);
    let java = java_runtime::find_java25(root, onboarding.java_path.as_deref());
    onboarding.java_ok = java.ok;

    let pack = onboarding
        .pack_id
        .as_ref()
        .map(|id| pack_sync::pack_status(root, id))
        .or_else(|| {
            pack_sync::list_installed(root)
                .into_iter()
                .find(|p| p.installed)
        });

    onboarding.pack_ok = pack.as_ref().map(|p| p.installed).unwrap_or(false);
    if let Some(p) = &pack {
        onboarding.pack_id = Some(p.id.clone());
        onboarding.pack_version = p.local_version.clone();
    }

    let libs = root.join(".run").join("libraries");
    let runtime_present = libs.is_dir()
        && fs::read_dir(&libs)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false);
    if runtime_present {
        onboarding.runtime_ok = true;
    }
    onboarding.completed = onboarding.java_ok && onboarding.pack_ok && onboarding.runtime_ok;
    if java.ok {
        onboarding.java_path = Some(java.path.clone());
    }
    let _ = save_state(root, &onboarding);
    RuntimeStatus {
        onboarding,
        java,
        pack,
    }
}

pub async fn run_full(app: &AppHandle, root: &Path) -> Result<OnboardingState, String> {
    progress::emit(app, "java", 0, "Checking Java…");
    let java = java_runtime::ensure_java25(app, root).await?;

    progress::emit(app, "pack", 0, "Resolving pack catalog…");
    let pack_id = pack_sync::default_pack_id().await?;
    let pack = pack_sync::sync_pack(app, root, &pack_id).await?;

    let instance = pack_dir(root, &pack_id);
    progress::emit(app, "fabric", 0, "Preparing game runtime…");
    runtime::prepare_runtime(app, root, &instance).await?;

    let state = OnboardingState {
        completed: true,
        java_ok: true,
        pack_ok: pack.installed,
        runtime_ok: true,
        java_path: Some(java.path),
        pack_id: Some(pack_id),
        pack_version: pack.local_version,
    };
    save_state(root, &state)?;
    progress::emit(app, "done", 100, "All set");
    Ok(state)
}
