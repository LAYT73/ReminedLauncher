# Voice rooms

Local **LiveKit** SFU on the host PC, tunnelled to friends via **Remined Relay** (self-hosted **frp** STCP/SUDP on the Remined VPS). Room metadata/chat in **Supabase**.

> Legacy docs mentioned Steam Porthole for voice — **code uses Remined Relay for voice always**. Hybrid mode still uses Porthole for Open-to-LAN only.

## Ports

| Port | Proto | Role |
|---|---|---|
| 7880 | TCP | LiveKit signalling (`ws://127.0.0.1:7880`) |
| 7881 | TCP | WebRTC ICE/TCP fallback |
| 7882 | UDP | WebRTC media (single UDP mux) |

Relay expose uses **STCP** for TCP ports and **SUDP** for `7882`. Voice starts as a LiveKit-only frpc; when Minecraft publishes Open-to-LAN, a **second** frpc attaches that TCP port hot (same session id/sk) so voice guests are not reconnected. Share code updates to include the real LAN port from the game log — not a hardcoded `55666`.

## Host flow (`VoicePanel.onCreate`)

1. `voiceEnsureRuntime` — download/install LiveKit if missing (progress modal)
2. `voiceStartLivekit` — spawn `livekit-server`, wait HTTP+RTC
3. `createVoiceRoom` — Supabase row (`lk_ws_url`, ports)
4. Host `VoiceSession.connect` (mic → room.connect → publish)
5. `voiceStartPorthole` — starts **Remined Relay** host (name is legacy), store share code on room

Order matters: WebRTC must succeed **before** the relay binds the same ports.

Share codes look like `rmd:rmd1_<id>_<sk>_<lanOr0>` (stored on presence / voice room).

## Guest flow

Guests do **not** open frpc manually — the launcher drives it (`frpc` visitor config from the share code).

1. Accept invite → `voiceGuestConnect(shareCode)` → launcher runs frpc visitor
2. `VoiceSession.connect` to room `lk_ws_url` (loopback via relay)

## Key files

| Path | Notes |
|---|---|
| `src-tauri/src/relay.rs` | Remined Relay (frpc download, host/visitor, share codes) |
| `src-tauri/src/voice_runtime.rs` | LiveKit binary, spawn, UDP mux, JWT |
| `src/features/voice/ui/VoicePanel.tsx` + `model/*` | Voice state hooks |
| `src/entities/voice-room/api/` | Supabase CRUD, invites, members, messages, realtime |
| Migrations `008` / `009` / `010` | Schema, RLS, `sessions.in_voice` |

## VPN / Happ

HTTP `NO_PROXY` / spawn env stripping helps **HTTP(S) proxy** mode.  
**Happ TUN** (and similar) routes **UDP** at the kernel — loopback WebRTC still breaks until Happ exclude routes / per-app bypass include Remined, or Remined forces a TCP-friendly ICE path.

## frps (ops)

- VPS runs `frps` (`systemd` unit `frps`, config `/etc/frp/frps.toml`)
- Addr / port / auth token live in Supabase secrets and are served by Edge Function `relay-creds` (JWT required)
- Lobby access is gated by per-session `secretKey` in the share code

## Known gaps

- Happ TUN and macOS sleep/wake crash mitigations are best-effort and need verification on affected machines.
- Screen share depends on WKWebView/OS permission.
- All voice/LAN traffic for Relay mode goes through the VPS (not P2P).
