use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Install root: `.remined`, `.run`, `packs/`.
pub fn project_root() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    let candidates = [
        cwd.clone(),
        cwd.join(".."),
        cwd.join("../.."),
        cwd.join("../../.."),
    ];
    for c in candidates {
        let has_packs = c.join("packs").is_dir();
        let has_marker = c.join(".remined").is_dir();
        let has_run = c.join(".run").is_dir();
        if has_packs || has_marker || has_run {
            return c.canonicalize().ok().or(Some(c));
        }
        // Dev: repo root containing `app/src-tauri`
        if c.join("app").join("src-tauri").join("Cargo.toml").is_file() {
            return c.canonicalize().ok().or(Some(c));
        }
    }
    None
}

pub fn remined_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(root) = project_root() {
        return Ok(root);
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("remined");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn profile_path(root: &Path) -> PathBuf {
    root.join(".remined").join("profile.json")
}

pub fn onboarding_path(root: &Path) -> PathBuf {
    root.join(".remined").join("onboarding.json")
}

pub fn runtime_java_dir(root: &Path, major: u32) -> PathBuf {
    root.join(".remined").join("runtime").join(format!("jdk-{major}"))
}

pub fn pack_dir(root: &Path, pack_id: &str) -> PathBuf {
    let under_packs = root.join("packs").join(pack_id);
    if crate::instance::is_pack_installed(&under_packs) {
        return under_packs;
    }
    let direct = root.join(pack_id);
    if crate::instance::is_pack_installed(&direct) {
        return direct;
    }
    // Match by .remined-pack.json id (folder name may differ)
    for base in [root.join("packs"), root.to_path_buf()] {
        if let Ok(entries) = std::fs::read_dir(&base) {
            for e in entries.flatten() {
                let p = e.path();
                if !p.is_dir() {
                    continue;
                }
                if let Some(meta) = crate::instance::read_meta(&p) {
                    if meta.id == pack_id {
                        return p;
                    }
                }
            }
        }
    }
    under_packs
}

/// Write `contents` to `path` via a pid-suffixed temp file and rename, so readers
/// never observe a half-written file. The temp file is removed on failure.
pub fn write_atomic(path: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!("{name}.tmp-{}", std::process::id()));
    let result = std::fs::write(&tmp, contents).and_then(|_| std::fs::rename(&tmp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}
