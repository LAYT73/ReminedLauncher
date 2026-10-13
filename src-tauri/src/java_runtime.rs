use crate::paths::runtime_java_dir;
use crate::progress;
use flate2::read::GzDecoder;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tar::Archive;
use tauri::AppHandle;
use zip::ZipArchive;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct JavaInfo {
    pub path: String,
    pub version: String,
    pub major: Option<u32>,
    pub ok: bool,
}

fn os_arch() -> Result<(&'static str, &'static str), String> {
    let os = if cfg!(target_os = "macos") {
        "mac"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        return Err("Unsupported OS".into());
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "x64"
    } else {
        return Err("Unsupported CPU arch".into());
    };
    Ok((os, arch))
}

fn parse_java_major(text: &str) -> Option<u32> {
    text.lines().find_map(|line| {
        let marker = "version \"";
        let idx = line.find(marker)?;
        let rest = &line[idx + marker.len()..];
        let ver = rest.split('"').next()?;
        ver.split('.').next()?.parse().ok()
    })
}

pub fn probe_java_bin(java: &Path) -> Option<JavaInfo> {
    if !java.is_file() {
        return None;
    }
    let output = Command::new(java)
        .arg("-version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    let text = {
        let err = String::from_utf8_lossy(&output.stderr);
        let out = String::from_utf8_lossy(&output.stdout);
        format!("{err}{out}").trim().to_string()
    };
    let first = text.lines().next().unwrap_or("unknown").to_string();
    let major = parse_java_major(&text);
    Some(JavaInfo {
        path: java.display().to_string(),
        version: first,
        major,
        ok: major == Some(25),
    })
}

pub fn find_java25(root: &Path, preferred: Option<&str>) -> JavaInfo {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = preferred.map(str::trim).filter(|s| !s.is_empty()) {
        let pb = PathBuf::from(p);
        if pb.is_dir() {
            candidates.push(pb.join("bin").join(java_exe_name()));
        } else {
            candidates.push(pb);
        }
    }
    let runtime = runtime_java_dir(root);
    candidates.push(runtime.join("bin").join(java_exe_name()));
    // nested extract (jdk-25+xx.jdk/Contents/Home on mac)
    if let Ok(entries) = fs::read_dir(&runtime) {
        for e in entries.flatten() {
            let p = e.path();
            candidates.push(p.join("bin").join(java_exe_name()));
            candidates.push(p.join("Contents/Home/bin").join(java_exe_name()));
        }
    }
    candidates.push(PathBuf::from("/opt/homebrew/opt/openjdk@25/bin/java"));
    candidates.push(PathBuf::from("/opt/homebrew/opt/openjdk/bin/java"));
    candidates.push(PathBuf::from("/usr/bin/java"));

    for java in candidates {
        if let Some(info) = probe_java_bin(&java) {
            if info.ok {
                return info;
            }
        }
    }
    // return best effort non-ok
    for java in [
        PathBuf::from("/usr/bin/java"),
        runtime_java_dir(root).join("bin").join(java_exe_name()),
    ] {
        if let Some(info) = probe_java_bin(&java) {
            return info;
        }
    }
    JavaInfo {
        path: String::new(),
        version: "Java 25 not found".into(),
        major: None,
        ok: false,
    }
}

fn java_exe_name() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

fn find_extracted_java(dir: &Path) -> Option<PathBuf> {
    let direct = dir.join("bin").join(java_exe_name());
    if direct.is_file() {
        return Some(direct);
    }
    let mut stack = vec![dir.to_path_buf()];
    while let Some(cur) = stack.pop() {
        let candidate = cur.join("bin").join(java_exe_name());
        if candidate.is_file() {
            return Some(candidate);
        }
        if let Ok(entries) = fs::read_dir(&cur) {
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                }
            }
        }
    }
    None
}

async fn download_to_file(url: &str, dest: &Path, app: &AppHandle, phase: &str) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let client = reqwest::Client::builder()
        .user_agent("ReminedLauncher/0.1")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(0);
    let mut file = File::create(dest).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let pct = ((downloaded as f64 / total as f64) * 90.0) as u32;
            progress::emit(app, phase, pct, "Downloading Java…");
        }
    }
    Ok(())
}

fn extract_archive(archive: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let name = archive.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if name.ends_with(".zip") {
        let file = File::open(archive).map_err(|e| e.to_string())?;
        let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
            let outpath = match entry.enclosed_name() {
                Some(p) => dest.join(p),
                None => continue,
            };
            if entry
                .name()
                .map(|n| n.ends_with('/'))
                .unwrap_or(false)
            {
                fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = outpath.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
            }
        }
    } else {
        // .tar.gz
        let file = File::open(archive).map_err(|e| e.to_string())?;
        let gz = GzDecoder::new(file);
        let mut archive = Archive::new(gz);
        archive.unpack(dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn ensure_java25(app: &AppHandle, root: &Path) -> Result<JavaInfo, String> {
    let existing = find_java25(root, None);
    if existing.ok {
        progress::emit(app, "java", 100, "Java 25 ready");
        return Ok(existing);
    }

    progress::emit(app, "java", 2, "Downloading OpenJDK 25…");
    let (os, arch) = os_arch()?;
    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/25/ga/{os}/{arch}/jdk/hotspot/normal/eclipse?project=jdk"
    );
    let runtime = runtime_java_dir(root);
    let _ = fs::remove_dir_all(&runtime);
    fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
    let ext = if cfg!(windows) { "zip" } else { "tar.gz" };
    let archive = root
        .join(".remined")
        .join("runtime")
        .join(format!("jdk-25-download.{ext}"));
    download_to_file(&url, &archive, app, "java").await?;
    progress::emit(app, "java", 92, "Extracting Java…");
    extract_archive(&archive, &runtime)?;
    let _ = fs::remove_file(&archive);

    let java = find_extracted_java(&runtime).ok_or_else(|| "Java binary missing after extract".to_string())?;
    // Normalize layout: if nested, leave as-is — find_java25 searches
    let info = probe_java_bin(&java).ok_or_else(|| "Failed to probe installed Java".to_string())?;
    if !info.ok {
        return Err(format!("Installed Java is not 25: {}", info.version));
    }
    progress::emit(app, "java", 100, "Java 25 installed");
    Ok(info)
}
