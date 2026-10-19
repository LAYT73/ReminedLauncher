# Voice rooms

Local **LiveKit** SFU on the host PC, tunnelled to friends via **Steam Porthole**, with room metadata/chat in **Supabase**.

## Ports

| Port | Proto | Role |
|---|---|---|
| 7880 | TCP | LiveKit signalling (`ws://localhost:7880`) |
| 7881–7890 | UDP | WebRTC media (ICE host candidates) |

Porthole expose uses **per-port** targets (`udp/127.0.0.1:N`), not a range string.

## Host flow (`VoicePanel.onCreate`)

1. `voiceEnsureRuntime` — download/install LiveKit if missing (progress modal)
2. `voiceStartLivekit` — spawn `livekit-server`, wait HTTP+RTC
3. `createVoiceRoom` — Supabase row (`lk_ws_url`, ports)
4. Host `VoiceSession.connect` (mic → room.connect → publish)
5. `voiceStartPorthole` — expose TCP+UDP, store share code on room

Order matters: WebRTC must succeed **before** Porthole binds the same ports.

## Guest flow

Guests do **not** open Porthole manually — the launcher drives it (`porthole connect` with the room share code). Requirements: Steam running + the free Porthole app installed once (see [PORTHOLE.md](./PORTHOLE.md)).

1. Accept invite → `voiceGuestConnect(shareCode)` → launcher runs `porthole connect`
2. `VoiceSession.connect` to room `lk_ws_url` (loopback via Porthole)

## Key files

| Path | Notes |
|---|---|
| `src/features/voice/ui/VoicePanel.tsx` + `model/*` | Voice state hooks: lists, room data, live session, PTT, runtime modal, actions |
| `src/features/voice/ui/` | Views: `VoiceLobby`, `VoiceRoomView`, `VoiceToolbar`, `VoiceMembers`, `VoiceChat`, `VoiceBits` |
| `src/features/voice/ui/VoiceRuntimeModal.tsx` | Download/setup modal + error |
| `src/features/voice/ui/VoiceDevicesModal.tsx` | Mic / output device picker |
| `src/features/voice/lib/voiceSession.ts` | LiveKit client; empty `iceServers`; VPN hint in errors |
| `src/entities/voice-room/api/` | Supabase CRUD, invites, members, messages, realtime |
| `src/features/voice/api/voiceNative.ts` | Tauri invokes |
| `src/features/voice/lib/pushToTalk.ts` | Global PTT shortcut binding + config |
| `src-tauri/src/voice_runtime.rs` | Binary, spawn, `NO_PROXY`, `ws://localhost` |
| `src-tauri/src/voice_log.rs` | Diagnostics file |
| Migrations `008` / `009` / `010` | Schema, RLS, `sessions.in_voice` |

## VPN / Happ

HTTP `NO_PROXY` / spawn env stripping helps **HTTP(S) proxy** mode.  
**Happ TUN** (and similar) routes **UDP** at the kernel — loopback WebRTC still breaks until Happ exclude routes / per-app bypass include Remined, or Remined forces a TCP-friendly ICE path.

## Known gaps

- Happ TUN and macOS sleep/wake crash mitigations are best-effort and need verification on affected machines.
- Screen share depends on WKWebView/OS permission.

## Features (0.5.x)

- **Member grid** — Discord-style tiles with a green speaking ring, mute/deafen badges (synced through LiveKit participant attributes) and a per-person volume slider (`VoiceSession.setParticipantVolume`).
- **Push-to-talk** — `PTT` toggle in the room toolbar + key select (F8/F9/F10/Ctrl+Space/Alt+V). Registered with `tauri-plugin-global-shortcut`, so it works while Minecraft has focus. Effective mic = `muted || (ptt && !keyDown)`. Config in localStorage `remined.voice.ptt` (`src/features/voice/lib/pushToTalk.ts`).
- **Camera / screen share** — `Cam` / `Share` buttons; video tiles above the member grid. Peer-to-peer through LiveKit only; nothing is stored. Camera needs the macOS camera permission (`NSCameraUsageDescription`). Screen share inside WKWebView may be refused by the OS — the UI shows a toast instead of failing silently.
- **Persistence** — `VoicePanel` is rendered through a React portal into a detached host node (`App.tsx` → `voicePortal`; see [ARCHITECTURE.md](./ARCHITECTURE.md)), so switching tabs/rails never tears the LiveKit session down. The Voice tab shows a green dot while you are in a room.
- **Rich presence** — `sessions.in_voice` (migration `010_sessions_voice.sql`). Friends see “· in voice”. If the migration is not applied the client falls back silently (no column → no voice flag).
- **No media uploads** — chat is text only (free-tier storage). Screenshots are viewed locally from the game's `screenshots/` folder (Shots tab), never uploaded.

## Diagnostics

- `voice.log` — runtime/LiveKit/Porthole log (see the debug-log path in the Voice runtime modal).
- `voice.log` also receives `ice` lines from `installRtcDiagnostics()`: every ICE candidate type, ICE/connection state changes and the selected candidate pair. A `relay`/`srflx`-only list while a VPN is on = the tunnel is eating host candidates.
- `<root>/.remined/logs/app.log` — global panic hook output. Panic strategy is `unwind`, and session mutexes are poison-tolerant, so one failing thread no longer aborts the app.

## Happ / TUN VPN (best effort — not testable without Happ)

What the code does: LiveKit on loopback binds only the loopback interface (`lo0`/`lo`) and advertises no STUN servers, so a TUN VPN that hijacks the default route cannot capture loopback traffic. The remaining failure mode is the **browser-side** WebRTC (WKWebView) choosing a candidate through the tunnel.

If voice still fails with Happ on:
1. Add the Remined bundle id / `127.0.0.0/8` to Happ's bypass list (or switch Happ to “proxy” mode instead of TUN).
2. Reproduce, then read the `ice` lines in `voice.log`.
3. Guests joining over Porthole are unaffected — Porthole is Steam networking, not the VPN path.
