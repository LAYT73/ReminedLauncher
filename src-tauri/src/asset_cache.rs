//! Local disk cache for remote pack media (logo, wallpaper, gallery) and skins.
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_BYTES: usize = 6 * 1024 * 1024;

fn media_dir(root: &Path) -> PathBuf {
    root.join(".remined").join("cache").join("media")
}

fn url_key(url: &str) -> String {
    Uuid::new_v3(&Uuid::NAMESPACE_URL, url.trim().as_bytes())
        .simple()
        .to_string()
}

fn ext_for(url: &str, content_type: Option<&str>) -> &'static str {
    let path = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if path.ends_with(".png") || content_type.is_some_and(|c| c.contains("png")) {
        return "png";
    }
    if path.ends_with(".webp") || content_type.is_some_and(|c| c.contains("webp")) {
        return "webp";
    }
    if path.ends_with(".gif") || content_type.is_some_and(|c| c.contains("gif")) {
        return "gif";
    }
    if path.ends_with(".jpg")
        || path.ends_with(".jpeg")
        || content_type.is_some_and(|c| c.contains("jpeg") || c.contains("jpg"))
    {
        return "jpg";
    }
    "bin"
}

fn mime_for(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

fn find_cached(root: &Path, url: &str) -> Option<PathBuf> {
    let dir = media_dir(root);
    let key = url_key(url);
    for ext in ["png", "jpg", "webp", "gif", "bin"] {
        let p = dir.join(format!("{key}.{ext}"));
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn bytes_to_data_url(bytes: &[u8], ext: &str) -> String {
    format!("data:{};base64,{}", mime_for(ext), crate::base64_encode(bytes))
}

fn read_path_data_url(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("empty file".into());
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    Ok(bytes_to_data_url(&bytes, ext))
}

async fn download_to_cache(root: &Path, url: &str) -> Result<PathBuf, String> {
    if let Some(existing) = find_cached(root, url) {
        return Ok(existing);
    }
    let client = reqwest::Client::builder()
        .user_agent("ReminedLauncher/0.4")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url.trim())
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("empty download".into());
    }
    if bytes.len() > MAX_BYTES {
        return Err(format!("asset too large ({} bytes)", bytes.len()));
    }
    let ext = ext_for(url, ctype.as_deref());
    let dir = media_dir(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{}.{ext}", url_key(url)));
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest)
}

/// Resolve cached assets only (no network). Missing URLs omitted.
pub fn resolve_many(root: &Path, urls: &[String]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for url in urls {
        let u = url.trim();
        if u.is_empty() || !(u.starts_with("http://") || u.starts_with("https://")) {
            continue;
        }
        if let Some(path) = find_cached(root, u) {
            if let Ok(data) = read_path_data_url(&path) {
                out.insert(u.to_string(), data);
            }
        }
    }
    out
}

/// Download missing assets, then return data-URLs for everything available.
pub async fn ensure_many(root: &Path, urls: &[String]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for url in urls {
        let u = url.trim();
        if u.is_empty() || !(u.starts_with("http://") || u.starts_with("https://")) {
            continue;
        }
        match download_to_cache(root, u).await {
            Ok(path) => {
                if let Ok(data) = read_path_data_url(&path) {
                    out.insert(u.to_string(), data);
                }
            }
            Err(err) => {
                eprintln!("[remined] media cache miss {u}: {err}");
                // Still try stale cache if download failed
                if let Some(path) = find_cached(root, u) {
                    if let Ok(data) = read_path_data_url(&path) {
                        out.insert(u.to_string(), data);
                    }
                }
            }
        }
    }
    out
}
