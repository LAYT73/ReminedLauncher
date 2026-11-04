//! Index cache location + jar-set fingerprint.

use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// Bump on ANY indexer change (output shape or logic) so stale cached indexes are ignored.
pub const FORMAT: &str = "v6";
/// A ru index built without Minecraft ru names is reused only this long before retrying the fetch.
pub const PARTIAL_TTL_SECS: u64 = 600;

pub fn recipes_dir(root: &Path) -> PathBuf {
    root.join(".remined").join("recipes")
}

pub fn safe_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 96
        && !s.starts_with('.')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// 16 hex chars over (file name, size, mtime) of every jar in order.
pub fn fingerprint(jars: &[PathBuf]) -> String {
    let mut h = Sha256::new();
    for j in jars {
        let name = j.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let (len, mt) = fs::metadata(j)
            .map(|m| {
                let t = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                (m.len(), t)
            })
            .unwrap_or((0, 0));
        h.update(format!("{name}|{len}|{mt}\n").as_bytes());
    }
    h.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}

pub fn cache_file(root: &Path, pack_id: &str, hash: &str, locale: &str) -> PathBuf {
    recipes_dir(root).join(format!("{pack_id}-{hash}-{locale}-{FORMAT}.json"))
}

/// Drop older indexes of the same pack/locale.
pub fn prune_old(root: &Path, pack_id: &str, locale: &str, keep: &Path) {
    let Ok(rd) = fs::read_dir(recipes_dir(root)) else { return };
    let prefix = format!("{pack_id}-");
    let suffix = format!("-{locale}-{FORMAT}.json");
    for e in rd.flatten() {
        let p = e.path();
        let n = e.file_name().to_string_lossy().into_owned();
        // `<id>-<16 hex>-<locale>-v1.json`: make sure the middle part is exactly the hash
        if p != keep && n.starts_with(&prefix) && n.ends_with(&suffix) {
            let mid = &n[prefix.len()..n.len() - suffix.len()];
            if mid.len() == 16 && mid.bytes().all(|b| b.is_ascii_hexdigit()) {
                let _ = fs::remove_file(p);
            }
        }
    }
}

/// Marker-named index written when ru names could not be fetched (never treated as a normal index).
pub fn partial_file(root: &Path, pack_id: &str, hash: &str, locale: &str) -> PathBuf {
    recipes_dir(root).join(format!("{pack_id}-{hash}-{locale}-{FORMAT}-partial.json"))
}
