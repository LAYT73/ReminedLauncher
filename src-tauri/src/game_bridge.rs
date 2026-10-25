//! Localhost socket bridge to the in-game companion mod.
//!
//! The mod writes `<instanceDir>/.remined/bridge.json` (`{"v":3,"port":N,"token":"hex"}`) and listens
//! on 127.0.0.1:N. Messages are line-delimited UTF-8 JSON.
//!
//! Protocol v3. The hello reply is `{"t":"hello","v":3,"strategy":...,"caps":[...]}`;
//! `caps` lists the launcher-to-mod message types the mod handles (`voice`, `head`, `notify`, `connect`,
//! `open_lan`, `battery`), so feature-detect on it. v2 messages are unchanged. New in v3:
//! - launcher to mod `open_lan` `{"t":"open_lan","port":N?,"cheats":false?}` opens the current single-player
//!   world to LAN in the player's game mode (port 0 or absent picks a free port). Answered by `open_lan_result`:
//!   `{"t":"open_lan_result","ok":true,"port":P}`, `{"ok":true,"port":P,"already":true}` when it was already
//!   published, or `{"ok":false,"error":E}` with E = `not_singleplayer`, `publish_failed`, `unsupported`,
//!   `bad port` or `client not ready` (after 10 s queued).

use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const STATUS_EVENT: &str = "game-bridge-status";
const MESSAGE_EVENT: &str = "game-bridge";
const POLL_INTERVAL: Duration = Duration::from_secs(1);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(3);
const WRITE_TIMEOUT: Duration = Duration::from_secs(2);
const LOST_GIVE_UP: Duration = Duration::from_secs(30);
const NEVER_CONNECTED_GIVE_UP: Duration = Duration::from_secs(600);
const BATTERY_CAP: &str = "battery";
const BATTERY_INTERVAL: Duration = Duration::from_secs(30);
const BATTERY_TICK: Duration = Duration::from_secs(2);

/// What the mod advertised in its hello reply (`v` and `caps`). Empty while disconnected.
#[derive(Default, Clone)]
pub struct BridgeInfo {
    pub v: u64,
    pub caps: Vec<String>,
}

#[derive(Default)]
pub struct GameBridgeState {
    writer: Mutex<Option<TcpStream>>,
    connected: AtomicBool,
    generation: AtomicU64,
    info: Mutex<BridgeInfo>,
}

fn state(app: &AppHandle) -> tauri::State<'_, GameBridgeState> {
    app.state::<GameBridgeState>()
}

fn lock_writer(m: &Mutex<Option<TcpStream>>) -> std::sync::MutexGuard<'_, Option<TcpStream>> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn lock_info(m: &Mutex<BridgeInfo>) -> std::sync::MutexGuard<'_, BridgeInfo> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Reads `v` and `caps` from the hello reply. Missing or malformed fields become `0` / empty.
fn parse_hello(reply: &Value) -> BridgeInfo {
    let v = reply.get("v").and_then(|v| v.as_u64()).unwrap_or(0);
    let caps = reply
        .get("caps")
        .and_then(|c| c.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|c| c.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    BridgeInfo { v, caps }
}

fn status_payload(connected: bool, info: &BridgeInfo) -> Value {
    json!({"connected": connected, "v": info.v, "caps": info.caps})
}

/// Clear the advertised info and tell the frontend the bridge is gone.
fn mark_disconnected(app: &AppHandle, st: &GameBridgeState) {
    *lock_info(&st.info) = BridgeInfo::default();
    if st.connected.swap(false, Ordering::SeqCst) {
        let _ = app.emit(STATUS_EVENT, status_payload(false, &BridgeInfo::default()));
    }
}

/// Start (or restart) the bridge loop for a freshly launched game in `instance_dir`.
/// Any previous loop exits on its next iteration because the generation changed.
pub fn start(app: AppHandle, instance_dir: PathBuf) {
    let gen = {
        let st = state(&app);
        let gen = st.generation.fetch_add(1, Ordering::SeqCst) + 1;
        // Shut the socket down (not just drop our clone) so the old reader thread
        // gets EOF and exits instead of lingering on a dead connection.
        if let Some(old) = lock_writer(&st.writer).take() {
            let _ = old.shutdown(Shutdown::Both);
        }
        mark_disconnected(&app, &st);
        gen
    };
    thread::spawn(move || run(app, instance_dir, gen));
}

fn is_current(app: &AppHandle, gen: u64) -> bool {
    state(app).generation.load(Ordering::SeqCst) == gen
}

fn run(app: AppHandle, dir: PathBuf, gen: u64) {
    let started = Instant::now();
    let mut ever_connected = false;
    let mut lost_since: Option<Instant> = None;

    while is_current(&app, gen) {
        match session(&app, &dir, gen) {
            Ok(()) => {
                ever_connected = true;
                lost_since = None;
            }
            Err(_) => {
                if ever_connected {
                    let since = *lost_since.get_or_insert_with(Instant::now);
                    if since.elapsed() >= LOST_GIVE_UP {
                        break;
                    }
                } else if started.elapsed() >= NEVER_CONNECTED_GIVE_UP {
                    break;
                }
            }
        }
        thread::sleep(POLL_INTERVAL);
    }
}

/// One connection lifetime: connect, handshake, then pump incoming lines until EOF or error.
/// Returns Err only when the connection could not be established.
fn session(app: &AppHandle, dir: &Path, gen: u64) -> Result<(), String> {
    let (port, token) = read_descriptor(dir)?;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).map_err(|e| e.to_string())?;
    let _ = stream.set_nodelay(true);
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    stream
        .set_read_timeout(Some(HANDSHAKE_TIMEOUT))
        .map_err(|e| e.to_string())?;

    let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);

    let hello = json!({"t": "hello", "token": token});
    write_line(&mut writer, &hello)?;

    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    let reply: Value = serde_json::from_str(line.trim()).map_err(|e| e.to_string())?;
    if reply.get("t").and_then(|t| t.as_str()) != Some("hello") {
        return Err("bad hello reply".into());
    }
    let info = parse_hello(&reply);

    let _ = reader.get_ref().set_read_timeout(None);
    {
        let st = state(app);
        *lock_info(&st.info) = info.clone();
        *lock_writer(&st.writer) = Some(writer);
        st.connected.store(true, Ordering::SeqCst);
    }
    let _ = app.emit(STATUS_EVENT, status_payload(true, &info));

    // Dropped (and the sampler stopped) when this connection ends.
    let battery_stop = Arc::new(AtomicBool::new(false));
    if info.caps.iter().any(|c| c == BATTERY_CAP) {
        let (app, stop) = (app.clone(), battery_stop.clone());
        thread::spawn(move || battery_loop(&app, gen, &stop));
    }

    loop {
        let mut buf = String::new();
        match reader.read_line(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let text = buf.trim();
        if text.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            continue;
        };
        if value.get("t").and_then(|t| t.as_str()) == Some("hello") {
            continue;
        }
        let _ = app.emit(MESSAGE_EVENT, value);
    }

    battery_stop.store(true, Ordering::SeqCst);
    // Only clear shared state if this loop still owns it (a newer launch may have replaced it).
    if is_current(app, gen) {
        let st = state(app);
        *lock_writer(&st.writer) = None;
        mark_disconnected(app, &st);
    }
    Ok(())
}

/// Battery charge percent (0-100) and whether it is charging, or `None` without a battery.
fn read_battery() -> Option<(u8, bool)> {
    use starship_battery::units::ratio::percent;
    let manager = starship_battery::Manager::new().ok()?;
    let battery = manager.batteries().ok()?.flatten().next()?;
    let level = battery.state_of_charge().get::<percent>().round().clamp(0.0, 100.0) as u8;
    Some((level, battery.state() == starship_battery::State::Charging))
}

fn battery_message(sample: Option<(u8, bool)>) -> Value {
    match sample {
        Some((level, charging)) => json!({"t": "battery", "present": true, "level": level, "charging": charging}),
        None => json!({"t": "battery", "present": false, "level": 0, "charging": false}),
    }
}

/// Feeds the mod's battery badge for one connection: on connect, every 30 s, and when the charging state
/// changes. A machine without a battery gets a single `present:false`. Ends when `stop` is set or the send fails.
fn battery_loop(app: &AppHandle, gen: u64, stop: &AtomicBool) {
    let mut last: Option<Option<(u8, bool)>> = None;
    let mut sent_at = Instant::now();
    while !stop.load(Ordering::SeqCst) && is_current(app, gen) {
        let sample = read_battery();
        let due = match last {
            None => true,
            Some(prev) => sample.is_some() && (sent_at.elapsed() >= BATTERY_INTERVAL || prev.map(|p| p.1) != sample.map(|s| s.1)),
        };
        if due {
            if !matches!(send(app, &battery_message(sample)), Ok(true)) || sample.is_none() {
                return;
            }
            last = Some(sample);
            sent_at = Instant::now();
        }
        thread::sleep(BATTERY_TICK);
    }
}

fn read_descriptor(dir: &Path) -> Result<(u16, String), String> {
    let raw = fs::read_to_string(dir.join(".remined").join("bridge.json")).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let port = v
        .get("port")
        .and_then(|p| p.as_u64())
        .and_then(|p| u16::try_from(p).ok())
        .ok_or("missing port")?;
    let token = v
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or("missing token")?
        .to_string();
    Ok((port, token))
}

fn write_line(stream: &mut TcpStream, msg: &Value) -> Result<(), String> {
    let mut line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    line.push('\n');
    stream
        .write_all(line.as_bytes())
        .and_then(|_| stream.flush())
        .map_err(|e| e.to_string())
}

/// Send one message to the mod. `Ok(false)` when not connected.
fn send(app: &AppHandle, msg: &Value) -> Result<bool, String> {
    let st = state(app);
    let mut guard = lock_writer(&st.writer);
    let Some(stream) = guard.as_mut() else {
        return Ok(false);
    };
    match write_line(stream, msg) {
        Ok(()) => Ok(true),
        Err(_) => {
            // Shut the socket so the reader loop sees EOF and reports the disconnect.
            let _ = stream.shutdown(Shutdown::Both);
            *guard = None;
            mark_disconnected(app, &st);
            Ok(false)
        }
    }
}

#[tauri::command]
pub async fn game_bridge_send(app: AppHandle, msg: Value) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || send(&app, &msg))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn game_bridge_status(app: AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(state(&app).connected.load(Ordering::SeqCst)))
        .await
        .map_err(|e| e.to_string())?
}

/// `{connected, v, caps}`: the same payload as the `game-bridge-status` event.
#[tauri::command]
pub async fn game_bridge_info(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let st = state(&app);
        let connected = st.connected.load(Ordering::SeqCst);
        let info = lock_info(&st.info).clone();
        Ok(status_payload(connected, &info))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_reads_version_and_caps() {
        let info = parse_hello(&json!({"t":"hello","v":3,"caps":["voice","open_lan", 7]}));
        assert_eq!(info.v, 3);
        assert_eq!(info.caps, vec!["voice".to_string(), "open_lan".to_string()]);
    }

    #[test]
    fn hello_without_caps_is_empty() {
        let info = parse_hello(&json!({"t":"hello","v":2}));
        assert_eq!(info.v, 2);
        assert!(info.caps.is_empty());
        let none = parse_hello(&json!({"t":"hello"}));
        assert_eq!(none.v, 0);
    }

    #[test]
    fn battery_message_shapes() {
        assert_eq!(
            battery_message(Some((87, true))),
            json!({"t":"battery","present":true,"level":87,"charging":true})
        );
        assert_eq!(battery_message(None)["present"], json!(false));
    }

    #[test]
    fn descriptor_parses_port_and_token() {
        let dir = std::env::temp_dir().join(format!("remined-bridge-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".remined")).unwrap();
        fs::write(
            dir.join(".remined").join("bridge.json"),
            r#"{"v":1,"port":4321,"token":"abcd"}"#,
        )
        .unwrap();
        let (port, token) = read_descriptor(&dir).unwrap();
        assert_eq!(port, 4321);
        assert_eq!(token, "abcd");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn descriptor_rejects_missing_file() {
        let dir = std::env::temp_dir().join("remined-bridge-test-missing-does-not-exist");
        assert!(read_descriptor(&dir).is_err());
    }
}
