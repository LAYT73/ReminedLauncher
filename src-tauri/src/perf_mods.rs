//! Applies the player's per-pack mod on/off choices before launch.
//!
//! The companion mod writes `config/remined-performance.json` with a `mods` map
//! (mod id -> enabled). Before the JVM starts, jars in `mods/` whose fabric id is in
//! that map are renamed to `.jar` (enabled) or `.jar.disabled` (disabled).
//! Nothing is deleted, and ids missing from the map are left alone.

use crate::{diag, mod_audit};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const STATE_REL: &str = "config/remined-performance.json";
const COMPANION_JAR: &str = "remined-companion.jar";
const DISABLED_SUFFIX: &str = ".disabled";

/// Renames mod jars under `<game_dir>/mods` to match the saved on/off map.
/// Returns how many files were renamed. Missing state or mods dir is a no-op.
pub fn apply_mod_toggles(game_dir: &Path) -> Result<usize, String> {
    let state_path = game_dir.join(STATE_REL);
    let Ok(text) = fs::read_to_string(&state_path) else {
        return Ok(0);
    };
    let state: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("invalid {STATE_REL}: {e}"))?;
    let Some(map) = state.get("mods").and_then(Value::as_object) else {
        return Ok(0);
    };
    let wanted: HashMap<&str, bool> = map
        .iter()
        .filter_map(|(k, v)| v.as_bool().map(|b| (k.as_str(), b)))
        .collect();
    if wanted.is_empty() {
        return Ok(0);
    }

    let mods_dir = game_dir.join("mods");
    let Ok(rd) = fs::read_dir(&mods_dir) else {
        return Ok(0);
    };
    let mut renamed = 0;
    for entry in rd.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        if name == COMPANION_JAR {
            continue;
        }
        let currently_disabled = if name.ends_with(".jar.disabled") {
            true
        } else if name.ends_with(".jar") {
            false
        } else {
            continue;
        };
        let Some(meta) = mod_audit::read_jar_meta(&path) else {
            continue;
        };
        let Some(&enabled) = wanted.get(meta.id.as_str()) else {
            continue;
        };
        if enabled != currently_disabled {
            continue;
        }
        let target_name = if enabled {
            name.strip_suffix(DISABLED_SUFFIX).unwrap_or(&name).to_string()
        } else {
            format!("{name}{DISABLED_SUFFIX}")
        };
        let target = mods_dir.join(&target_name);
        if target.exists() {
            diag::log(
                "perf-mods",
                &format!("skip {name} ({}): {target_name} already exists", meta.id),
            );
            continue;
        }
        match fs::rename(&path, &target) {
            Ok(()) => {
                renamed += 1;
                diag::log(
                    "perf-mods",
                    &format!("{} {name} -> {target_name}", if enabled { "enable" } else { "disable" }),
                );
            }
            Err(e) => diag::log("perf-mods", &format!("rename {name} failed: {e}")),
        }
    }
    Ok(renamed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn tmp_game(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "remined-perf-mods-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("mods")).unwrap();
        fs::create_dir_all(dir.join("config")).unwrap();
        dir
    }

    fn write_jar(path: &Path, id: &str) {
        let file = fs::File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        zip.start_file("fabric.mod.json", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(format!(r#"{{"schemaVersion":1,"id":"{id}","version":"1.0.0"}}"#).as_bytes())
            .unwrap();
        zip.finish().unwrap();
    }

    fn write_state(dir: &Path, mods: &str) {
        fs::write(
            dir.join(STATE_REL),
            format!(r#"{{"version":1,"preset":"low","values":{{}},"mods":{mods}}}"#),
        )
        .unwrap();
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir.join("mods"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn perf_mods_disable_renames_jar() {
        let dir = tmp_game("disable");
        write_state(&dir, r#"{"subtle_effects":false}"#);
        write_jar(&dir.join("mods/subtle.jar"), "subtle_effects");
        assert_eq!(apply_mod_toggles(&dir), Ok(1));
        assert_eq!(names(&dir), vec!["subtle.jar.disabled"]);
    }

    #[test]
    fn perf_mods_enable_renames_back() {
        let dir = tmp_game("enable");
        write_state(&dir, r#"{"lambdynlights":true}"#);
        write_jar(&dir.join("mods/lambda.jar.disabled"), "lambdynlights");
        assert_eq!(apply_mod_toggles(&dir), Ok(1));
        assert_eq!(names(&dir), vec!["lambda.jar"]);
    }

    #[test]
    fn perf_mods_unknown_id_untouched() {
        let dir = tmp_game("unknown");
        write_state(&dir, r#"{"subtle_effects":false}"#);
        write_jar(&dir.join("mods/mine.jar.disabled"), "players_own");
        write_jar(&dir.join("mods/other.jar"), "other");
        assert_eq!(apply_mod_toggles(&dir), Ok(0));
        assert_eq!(names(&dir), vec!["mine.jar.disabled", "other.jar"]);
    }

    #[test]
    fn perf_mods_matching_state_is_noop() {
        let dir = tmp_game("matching");
        write_state(&dir, r#"{"x":true}"#);
        write_jar(&dir.join("mods/x.jar"), "x");
        assert_eq!(apply_mod_toggles(&dir), Ok(0));
        assert_eq!(names(&dir), vec!["x.jar"]);
    }

    #[test]
    fn perf_mods_missing_state_is_noop() {
        let dir = tmp_game("missing");
        write_jar(&dir.join("mods/a.jar"), "a");
        assert_eq!(apply_mod_toggles(&dir), Ok(0));
        assert_eq!(names(&dir), vec!["a.jar"]);
    }

    #[test]
    fn perf_mods_invalid_state_is_error() {
        let dir = tmp_game("invalid");
        fs::write(dir.join(STATE_REL), "not json").unwrap();
        write_jar(&dir.join("mods/a.jar"), "a");
        assert!(apply_mod_toggles(&dir).is_err());
        assert_eq!(names(&dir), vec!["a.jar"]);
    }

    #[test]
    fn perf_mods_collision_is_skipped() {
        let dir = tmp_game("collision");
        write_state(&dir, r#"{"subtle_effects":false}"#);
        write_jar(&dir.join("mods/s.jar"), "subtle_effects");
        write_jar(&dir.join("mods/s.jar.disabled"), "subtle_effects");
        assert_eq!(apply_mod_toggles(&dir), Ok(0));
        assert_eq!(names(&dir), vec!["s.jar", "s.jar.disabled"]);
    }

    #[test]
    fn perf_mods_companion_jar_skipped() {
        let dir = tmp_game("companion");
        write_state(&dir, r#"{"remined_companion":false}"#);
        write_jar(&dir.join("mods/remined-companion.jar"), "remined_companion");
        assert_eq!(apply_mod_toggles(&dir), Ok(0));
        assert_eq!(names(&dir), vec!["remined-companion.jar"]);
    }
}
