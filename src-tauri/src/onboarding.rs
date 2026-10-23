use crate::java_runtime::{self, JavaInfo};
use crate::pack_sync::{self, PackStatus};
use crate::paths::{onboarding_path, pack_dir};
use crate::progress;
use crate::runtime;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use crate::progress::Ctx as AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingState {
    pub completed: bool,
    pub java_ok: bool,
    pub java_path: Option<String>,
}

impl Default for OnboardingState {
    fn default() -> Self {
        Self {
            completed: false,
            java_ok: false,
            java_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeStatus {
    pub onboarding: OnboardingState,
    pub java: JavaInfo,
}

pub fn load_state(root: &Path) -> OnboardingState {
    let raw = fs::read_to_string(onboarding_path(root)).ok();
    if let Some(s) = raw.as_ref() {
        if let Ok(state) = serde_json::from_str::<OnboardingState>(s) {
            return state;
        }
        // Migrate older onboarding.json that required pack/runtime
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
            let java_ok = v.get("java_ok").and_then(|x| x.as_bool()).unwrap_or(false);
            let java_path = v
                .get("java_path")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            return OnboardingState {
                completed: java_ok,
                java_ok,
                java_path,
            };
        }
    }
    OnboardingState::default()
}

pub fn save_state(root: &Path, state: &OnboardingState) -> Result<(), String> {
    let dir = root.join(".remined");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    crate::paths::write_atomic(&onboarding_path(root), json).map_err(|e| e.to_string())
}

pub fn status(root: &Path) -> RuntimeStatus {
    let mut onboarding = load_state(root);
    let java = java_runtime::find_java25(root, onboarding.java_path.as_deref());
    onboarding.java_ok = java.ok;
    onboarding.completed = java.ok;
    if java.ok {
        onboarding.java_path = Some(java.path.clone());
    }
    let _ = save_state(root, &onboarding);
    RuntimeStatus { onboarding, java }
}

/// First-run gate: Java 25 only.
pub async fn run_full(app: &AppHandle, root: &Path) -> Result<OnboardingState, String> {
    progress::reset();
    progress::emit(app, "java", 1, crate::i18n::tr("progress.checking_java"));
    let java = java_runtime::ensure_java25(app, root).await?;

    let state = OnboardingState {
        completed: true,
        java_ok: true,
        java_path: Some(java.path),
    };
    save_state(root, &state)?;
    progress::emit(app, "done", 100, crate::i18n::tr("progress.java_ready"));
    Ok(state)
}

/// Download/update pack zip, then Fabric libs + assets (needs pack version JSON).
/// Vanilla packs skip the Remined catalog and use Mojang install/prepare instead.
pub async fn ensure_pack(app: &AppHandle, root: &Path, pack_id: &str) -> Result<PackStatus, String> {
    let instance = pack_dir(root, pack_id);
    if crate::remined_vanilla::is_pack_id(pack_id) {
        return crate::remined_vanilla::ensure_installed(app, root, pack_id).await;
    }
    if crate::vanilla::is_vanilla_pack_id(pack_id) || crate::vanilla::is_vanilla_instance(&instance)
    {
        return crate::vanilla::ensure_installed(app, root, pack_id).await;
    }

    progress::reset();

    progress::emit(app, "pack", 1, crate::i18n::tr("progress.downloading_pack"));
    let pack = pack_sync::sync_pack(app, root, pack_id).await?;

    let instance = pack_dir(root, pack_id);
    progress::emit(app, "fabric", 1, crate::i18n::tr("progress.checking_fabric_runtime"));
    runtime::prepare_runtime(app, root, &instance).await?;

    progress::emit(app, "done", 100, crate::i18n::tr("progress.ready_to_play"));
    Ok(pack)
}
