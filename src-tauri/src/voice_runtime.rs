//! Local LiveKit server + JWT for Remined voice rooms (tunneled via Porthole).

use crate::paths;
use crate::porthole::{self, PortholeState};
use crate::voice_log;
use chrono::{Duration, Utc};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration as StdDuration, Instant};
use tauri::{AppHandle, Emitter};

pub const LK_API_KEY: &str = "remined";
pub const LK_API_SECRET: &str = "remined_voice_dev_secret_do_not_use_prod";
pub const LK_TCP_PORT: u16 = 7880;
/// ICE/TCP fallback (must not collide with the UDP media range start).
pub const LK_RTC_TCP_PORT: u16 = 7881;
pub const LK_UDP_START: u16 = 7882;
pub const LK_UDP_END: u16 = 7901;
const LK_VERSION: &str = "1.13.10";

#[derive(Default)]
pub struct VoiceRuntime {
    child: Option<Child>,
}

pub type VoiceRuntimeState = Arc<Mutex<VoiceRuntime>>;

#[derive(Debug, Clone, Serialize)]
pub struct VoiceHostReady {
    pub share_code: String,
    pub ws_url: String,
    pub tcp_port: u16,
    pub udp_start: u16,
    pub udp_end: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceRuntimeProgress {
    pub phase: String,
    pub message: String,
    pub percent: u8,
}

fn emit_progress(app: &AppHandle, phase: &str, message: &str, percent: u8) {
    voice_log::append_ok(app, "runtime", &format!("{phase} {percent}% — {message}"));
    let _ = app.emit(
        "voice-runtime-progress",
        VoiceRuntimeProgress {
            phase: phase.into(),
            message: message.into(),
            percent: percent.min(100),
        },
    );
}

#[derive(Debug, Serialize, Deserialize)]
struct VideoGrant {
    room: String,
    #[serde(rename = "roomJoin")]
    room_join: bool,
    #[serde(rename = "roomCreate")]
    room_create: bool,
    #[serde(rename = "canPublish")]
    can_publish: bool,
    #[serde(rename = "canSubscribe")]
    can_subscribe: bool,
    #[serde(rename = "canUpdateOwnMetadata")]
    can_update_own_metadata: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct LkClaims {
    iss: String,
    sub: String,
    nbf: i64,
    exp: i64,
    video: VideoGrant,
    name: String,
}

fn voice_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = paths::remined_root(app)?;
    let dir = root.join(".remined").join("voice").join(LK_VERSION);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn binary_name() -> &'static str {
    if cfg!(windows) {
        "livekit-server.exe"
    } else {
        "livekit-server"
    }
}

#[cfg(not(target_os = "macos"))]
fn github_download_url() -> Result<&'static str, String> {
    if cfg!(windows) {
        Ok(concat!(
            "https://github.com/livekit/livekit/releases/download/v",
            "1.13.10",
            "/livekit_",
            "1.13.10",
            "_windows_amd64.zip"
        ))
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "aarch64") {
        Ok(concat!(
            "https://github.com/livekit/livekit/releases/download/v",
            "1.13.10",
            "/livekit_",
            "1.13.10",
            "_linux_arm64.tar.gz"
        ))
    } else if cfg!(target_os = "linux") {
        Ok(concat!(
            "https://github.com/livekit/livekit/releases/download/v",
            "1.13.10",
            "/livekit_",
            "1.13.10",
            "_linux_amd64.tar.gz"
        ))
    } else {
        Err("No GitHub LiveKit build for this platform".into())
    }
}

fn find_on_path() -> Option<PathBuf> {
    let name = binary_name();
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // Common Homebrew locations even when PATH is thin (GUI apps on macOS).
    #[cfg(target_os = "macos")]
    {
        for p in [
            "/opt/homebrew/bin/livekit-server",
            "/usr/local/bin/livekit-server",
        ] {
            let candidate = PathBuf::from(p);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn set_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        // Hardened Runtime rejects unsigned downloaded binaries; ad-hoc sign.
        let _ = Command::new("codesign")
            .args(["--force", "--sign", "-", "--timestamp=none"])
            .arg(path)
            .status();
    }
    let _ = path;
    Ok(())
}

fn extract_livekit_binary(bytes: &[u8], dest_dir: &Path) -> Result<PathBuf, String> {
    let bin_name = binary_name();
    let out = dest_dir.join(bin_name);

    if cfg!(windows) || bytes.starts_with(b"PK") {
        let cursor = std::io::Cursor::new(bytes);
        let mut zip = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = file.name().map_err(|e| e.to_string())?.to_string();
            let base = Path::new(&name)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            if base != "livekit-server.exe" && base != "livekit-server" {
                continue;
            }
            let mut f = File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut f).map_err(|e| e.to_string())?;
            set_executable(&out)?;
            return Ok(out);
        }
        return Err("livekit-server not found in zip".into());
    }

    let dec = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(dec);
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if name != "livekit-server" && name != "livekit-server.exe" {
            continue;
        }
        let mut f = File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut f).map_err(|e| e.to_string())?;
        set_executable(&out)?;
        return Ok(out);
    }
    Err("livekit-server not found in archive".into())
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(StdDuration::from_secs(240))
        .redirect(reqwest::redirect::Policy::limited(10))
        // Voice downloads must not ride a system VPN HTTP proxy.
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())
}

/// Ensure loopback is never sent through HTTP(S)/SOCKS proxies (VPNs).
pub fn apply_loopback_no_proxy() {
    const BYPASS: &str = "localhost,127.0.0.1,::1,.local";
    for key in ["NO_PROXY", "no_proxy"] {
        let merged = match std::env::var(key) {
            Ok(existing) if !existing.is_empty() => format!("{existing},{BYPASS}"),
            _ => BYPASS.to_string(),
        };
        std::env::set_var(key, merged);
    }
}

/// macOS: LiveKit does not publish GitHub binaries — download the Homebrew bottle
/// directly from ghcr.io (no `brew` CLI / Terminal required).
#[cfg(target_os = "macos")]
fn download_macos_bottle(app: &AppHandle, dest_dir: &Path) -> Result<PathBuf, String> {
    emit_progress(app, "Voice", "Finding voice runtime…", 12);
    let client = http_client()?;
    let formula: serde_json::Value = client
        .get("https://formulae.brew.sh/api/formula/livekit.json")
        .send()
        .map_err(|e| format!("Could not reach Homebrew API: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Homebrew API error: {e}"))?
        .json()
        .map_err(|e| e.to_string())?;

    let files = formula
        .pointer("/bottle/stable/files")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "Homebrew bottle list missing for livekit".to_string())?;

    let prefer: &[&str] = if cfg!(target_arch = "aarch64") {
        &[
            "arm64_golden_gate",
            "arm64_tahoe",
            "arm64_sequoia",
            "arm64_sonoma",
            "arm64_ventura",
            "arm64_monterey",
        ]
    } else {
        &[
            "golden_gate",
            "tahoe",
            "sequoia",
            "sonoma",
            "ventura",
            "monterey",
            "catalina",
        ]
    };

    let mut bottle_url: Option<String> = None;
    for key in prefer {
        if let Some(url) = files.get(*key).and_then(|f| f.get("url")).and_then(|u| u.as_str())
        {
            bottle_url = Some(url.to_string());
            break;
        }
    }
    if bottle_url.is_none() {
        // Any arm64_* / any remaining mac bottle as last resort
        for (key, file) in files {
            let key_l = key.to_ascii_lowercase();
            let arch_ok = if cfg!(target_arch = "aarch64") {
                key_l.contains("arm64")
            } else {
                !key_l.contains("arm64") && !key_l.contains("linux")
            };
            if arch_ok {
                if let Some(url) = file.get("url").and_then(|u| u.as_str()) {
                    bottle_url = Some(url.to_string());
                    break;
                }
            }
        }
    }
    let bottle_url = bottle_url.ok_or_else(|| {
        String::from(
            "No macOS LiveKit bottle for this CPU — voice host needs Apple Silicon or a preinstalled livekit-server",
        )
    })?;

    emit_progress(app, "Voice", "Downloading voice runtime…", 35);
    let resp = client
        .get(&bottle_url)
        .header("Authorization", "Bearer QQ==")
        .header("Accept", "application/vnd.oci.image.layer.v1.tar+gzip")
        .send()
        .map_err(|e| format!("Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    emit_progress(app, "Voice", "Unpacking…", 75);
    extract_livekit_binary(&bytes, dest_dir)
}

#[cfg(not(target_os = "macos"))]
fn download_github_release(app: &AppHandle, dest_dir: &Path) -> Result<PathBuf, String> {
    let url = github_download_url()?;
    emit_progress(
        app,
        "Voice",
        &format!("Downloading voice runtime {LK_VERSION}…"),
        35,
    );
    let client = http_client()?;
    let resp = client
        .get(url)
        .send()
        .map_err(|e| format!("Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    emit_progress(app, "Voice", "Unpacking…", 75);
    extract_livekit_binary(&bytes, dest_dir)
}

pub fn ensure_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    emit_progress(app, "Voice", "Checking voice runtime…", 5);

    let dir = voice_cache_dir(app)?;
    let cached = dir.join(binary_name());
    if cached.is_file() {
        emit_progress(app, "Voice", "Voice runtime ready", 100);
        return Ok(cached);
    }

    if let Some(p) = find_on_path() {
        // Cache a copy so future launches do not depend on PATH.
        if fs::copy(&p, &cached).is_ok() {
            let _ = set_executable(&cached);
            if cached.is_file() {
                emit_progress(app, "Voice", "Voice runtime ready", 100);
                return Ok(cached);
            }
        }
        emit_progress(app, "Voice", "Voice runtime ready", 100);
        return Ok(p);
    }

    #[cfg(target_os = "macos")]
    let bin = download_macos_bottle(app, &dir)?;
    #[cfg(not(target_os = "macos"))]
    let bin = download_github_release(app, &dir)?;

    if !bin.is_file() {
        return Err("LiveKit binary missing after download".into());
    }
    emit_progress(app, "Voice", "Voice runtime ready", 100);
    Ok(bin)
}

/// Restrict ICE candidates to the loopback interface so VPN TUN adapters (Happ, etc.)
/// never contribute host candidates / source addresses (BUG-001).
fn loopback_iface_yaml() -> &'static str {
    if cfg!(target_os = "macos") {
        "\n  interfaces:\n    includes:\n      - lo0"
    } else if cfg!(target_os = "linux") {
        "\n  interfaces:\n    includes:\n      - lo"
    } else {
        ""
    }
}

fn write_config(dir: &Path) -> Result<PathBuf, String> {
    let path = dir.join("livekit.yaml");
    // Loopback-only SFU for host WebView + Porthole tunnel. No public STUN.
    let yaml = format!(
        r#"port: {tcp}
bind_addresses:
  - 127.0.0.1
rtc:
  tcp_port: {rtc_tcp}
  port_range_start: {udp_start}
  port_range_end: {udp_end}
  use_external_ip: false
  node_ip: 127.0.0.1
  stun_servers: []{ifaces}
room:
  auto_create: true
keys:
  {key}: {secret}
logging:
  level: info
"#,
        ifaces = loopback_iface_yaml(),
        tcp = LK_TCP_PORT,
        rtc_tcp = LK_RTC_TCP_PORT,
        udp_start = LK_UDP_START,
        udp_end = LK_UDP_END,
        key = LK_API_KEY,
        secret = LK_API_SECRET,
    );
    let mut f = File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(yaml.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path)
}

fn tcp_open(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        StdDuration::from_millis(200),
    )
    .is_ok()
}

fn wait_healthy(timeout: StdDuration) -> Result<(), String> {
    let start = Instant::now();
    let client = reqwest::blocking::Client::builder()
        .timeout(StdDuration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    while start.elapsed() < timeout {
        let http_ok = client
            .get(format!("http://127.0.0.1:{LK_TCP_PORT}"))
            .send()
            .map(|resp| resp.status().as_u16() < 500)
            .unwrap_or(false);
        // Signaling + ICE/TCP must both be up; HTTP alone is not enough for WebRTC.
        if http_ok && tcp_open(LK_RTC_TCP_PORT) {
            return Ok(());
        }
        thread::sleep(StdDuration::from_millis(250));
    }
    Err("LiveKit did not become ready in time (HTTP/RTC)".into())
}

pub fn stop_host(state: &VoiceRuntimeState) {
    if let Ok(mut guard) = state.lock() {
        if let Some(mut child) = guard.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn start_host_server(app: &AppHandle, state: &VoiceRuntimeState) -> Result<(), String> {
    stop_host(state);
    let bin = ensure_runtime(app)?;
    // Re-apply exec bit + ad-hoc sign for cached downloads under Hardened Runtime.
    let _ = set_executable(&bin);
    let dir = voice_cache_dir(app)?;
    let config = write_config(&dir)?;

    emit_progress(app, "Voice", "Starting voice server…", 88);
    apply_loopback_no_proxy();
    let mut cmd = Command::new(&bin);
    cmd.arg("--config")
        .arg(&config)
        .current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("NO_PROXY", "localhost,127.0.0.1,::1,.local")
        .env("no_proxy", "localhost,127.0.0.1,::1,.local");
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "SOCKS_PROXY",
        "socks_proxy",
    ] {
        cmd.env_remove(key);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Failed to start LiveKit: {e}"))?;

    // Drain LiveKit logs into voice.log + UI events
    if let Some(stdout) = child.stdout.take() {
        let app2 = app.clone();
        thread::spawn(move || {
            let mut reader = std::io::BufReader::new(stdout);
            let mut buf = String::new();
            loop {
                buf.clear();
                match std::io::BufRead::read_line(&mut reader, &mut buf) {
                    Ok(0) => break,
                    Ok(_) => {
                        let line = buf.trim();
                        if !line.is_empty() {
                            voice_log::append_ok(&app2, "livekit", line);
                            let _ = app2.emit("voice-runtime", line.to_string());
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app2 = app.clone();
        thread::spawn(move || {
            let mut reader = std::io::BufReader::new(stderr);
            let mut buf = String::new();
            loop {
                buf.clear();
                match std::io::BufRead::read_line(&mut reader, &mut buf) {
                    Ok(0) => break,
                    Ok(_) => {
                        let line = buf.trim();
                        if !line.is_empty() {
                            voice_log::append_ok(&app2, "livekit", line);
                            let _ = app2.emit("voice-runtime", line.to_string());
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    if let Ok(mut guard) = state.lock() {
        guard.child = Some(child);
    }

    wait_healthy(StdDuration::from_secs(20))?;
    emit_progress(app, "Voice", "Voice server ready", 100);
    Ok(())
}

/// Porthole `expose` backends: each UDP port must be listed (ranges like
/// `udp/127.0.0.1:7881-7890` are rejected with "bad port").
pub fn porthole_backends() -> String {
    let mut parts = vec![
        format!("tcp/127.0.0.1:{LK_TCP_PORT}"),
        format!("tcp/127.0.0.1:{LK_RTC_TCP_PORT}"),
    ];
    for port in LK_UDP_START..=LK_UDP_END {
        parts.push(format!("udp/127.0.0.1:{port}"));
    }
    parts.join(",")
}

/// Guest `--auto-approve-ports` accepts TCP lists + UDP ranges.
pub fn porthole_approve() -> String {
    format!(
        "tcp/{LK_TCP_PORT},tcp/{LK_RTC_TCP_PORT},udp/{LK_UDP_START}-{LK_UDP_END}"
    )
}

/// Start local LiveKit only (no Porthole). Host WebRTC should connect before expose.
pub fn start_voice_livekit(app: &AppHandle, voice: &VoiceRuntimeState) -> Result<VoiceHostReady, String> {
    match start_host_server(app, voice) {
        Ok(()) => {
            voice_log::append_ok(
                app,
                "host",
                &format!(
                    "LiveKit up ws=127.0.0.1:{LK_TCP_PORT} rtc_tcp={LK_RTC_TCP_PORT} udp={LK_UDP_START}-{LK_UDP_END}"
                ),
            );
                    // Prefer hostname `localhost` — many VPNs proxy 127.0.0.1 but bypass localhost.
            Ok(VoiceHostReady {
                share_code: String::new(),
                ws_url: format!("ws://localhost:{LK_TCP_PORT}"),
                tcp_port: LK_TCP_PORT,
                udp_start: LK_UDP_START,
                udp_end: LK_UDP_END,
            })
        }
        Err(e) => {
            voice_log::append_ok(app, "host", &format!("LiveKit start FAILED: {e}"));
            Err(e)
        }
    }
}

/// Expose LiveKit ports over Steam Porthole after the host has joined locally.
pub fn start_voice_porthole(
    app: AppHandle,
    porthole: PortholeState,
) -> Result<VoiceHostReady, String> {
    emit_progress(&app, "Voice", "Opening Porthole tunnel…", 92);
    let backends = porthole_backends();
    voice_log::append_ok(&app, "porthole", &format!("expose backends={backends}"));
    match porthole::start_host_backends(
        app.clone(),
        porthole,
        &backends,
        LK_TCP_PORT,
        "Remined Voice",
    ) {
        Ok(info) => {
            voice_log::append_ok(
                &app,
                "porthole",
                &format!("lobby ready code={}", info.share_code),
            );
            Ok(VoiceHostReady {
                share_code: info.share_code,
                ws_url: format!("ws://localhost:{LK_TCP_PORT}"),
                tcp_port: LK_TCP_PORT,
                udp_start: LK_UDP_START,
                udp_end: LK_UDP_END,
            })
        }
        Err(e) => {
            voice_log::append_ok(&app, "porthole", &format!("expose FAILED: {e}"));
            Err(e)
        }
    }
}

pub fn start_voice_host(
    app: AppHandle,
    voice: VoiceRuntimeState,
    porthole: PortholeState,
) -> Result<VoiceHostReady, String> {
    start_voice_livekit(&app, &voice)?;
    start_voice_porthole(app, porthole)
}

pub fn stop_voice_host(voice: &VoiceRuntimeState, porthole: &PortholeState) {
    porthole::stop_host(porthole);
    stop_host(voice);
}

pub fn guest_connect(
    app: AppHandle,
    porthole: PortholeState,
    share_code: &str,
) -> Result<(), String> {
    porthole::start_join_approve(
        app,
        porthole,
        share_code,
        &porthole_approve(),
        LK_TCP_PORT,
    )
}

pub fn mint_token(room: &str, identity: &str, name: &str) -> Result<String, String> {
    let room = room.trim();
    let identity = identity.trim();
    if room.is_empty() || identity.is_empty() {
        return Err("room and identity required".into());
    }
    let now = Utc::now();
    let claims = LkClaims {
        iss: LK_API_KEY.into(),
        sub: identity.into(),
        nbf: now.timestamp(),
        exp: (now + Duration::hours(6)).timestamp(),
        name: if name.trim().is_empty() {
            identity.into()
        } else {
            name.trim().into()
        },
        video: VideoGrant {
            room: room.into(),
            room_join: true,
            room_create: true,
            can_publish: true,
            can_subscribe: true,
            can_update_own_metadata: true,
        },
    };
    let mut header = Header::new(Algorithm::HS256);
    header.typ = Some("JWT".into());
    encode(
        &header,
        &claims,
        &EncodingKey::from_secret(LK_API_SECRET.as_bytes()),
    )
    .map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub fn read_child_alive(state: &VoiceRuntimeState) -> bool {
    let Ok(mut guard) = state.lock() else {
        return false;
    };
    match guard.child.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => false,
    }
}

/// Touch unused import for Read trait in some toolchains.
#[allow(dead_code)]
fn _read_touch(mut r: impl Read) {
    let mut b = [0u8; 1];
    let _ = r.read(&mut b);
}
