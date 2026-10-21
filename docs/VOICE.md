# Voice rooms

Voice rooms run a local LiveKit server on the host and expose it through the
Remined Relay. Supabase stores room metadata, members, invitations and chat.
The same Relay carries Minecraft Open-to-LAN TCP traffic and LiveKit TCP/UDP
traffic.

## Ports

| Port | Protocol | Purpose |
|---|---|---|
| `7880` | TCP | LiveKit signalling |
| `7881` | TCP | WebRTC ICE/TCP fallback |
| `7882` | UDP | WebRTC media |

The client connects to LiveKit through loopback. The relay maps the same ports
for guests. If the host also opens a Minecraft LAN session, the LAN port is
attached to the existing relay session; LiveKit is not restarted.

## Host lifecycle

1. Ensure the LiveKit runtime is present; download it if necessary.
2. Start LiveKit and wait for its signalling and RTC endpoints.
3. Create the room record in Supabase.
4. Connect the host client and publish the selected devices.
5. Start the Remined Relay host and publish the share code.

LiveKit must be ready before the relay binds its endpoints.

## Guest lifecycle

1. Accept a room invitation.
2. Pass the share code to the native guest command.
3. The launcher starts the relay visitor locally.
4. Connect the LiveKit client to the loopback endpoint.

Guests do not run relay commands manually.

## Relay operations

The relay client obtains its endpoint and credentials from the authenticated
`relay-creds` Edge Function. The VPS runs `frps` as a systemd service. Relay
secrets are stored in Supabase secrets and are never compiled into the
launcher.

Share codes contain a session identifier and per-session secret. Treat them as
credentials: do not include them in logs, screenshots or issue reports.

## Implementation

| Path | Responsibility |
|---|---|
| `src-tauri/src/relay.rs` | Relay download, host/visitor lifecycle and share codes |
| `src-tauri/src/voice_runtime.rs` | LiveKit runtime, process and port handling |
| `src-tauri/src/voice_log.rs` | Voice diagnostics |
| `src/features/voice/` | UI and client state |
| `src/entities/voice-room/` | Supabase room, member, invite and message APIs |
| `008`–`010`, `015` migrations | Voice schema, RLS, presence and Relay share codes |

## Diagnostics and known limitations

Voice diagnostics:

```text
<root>/.remined/voice/voice.log
```

Relay traffic is routed through the VPS. UDP behavior may be affected by
system-wide TUN products; users may need to exclude Remined from those routes.
Camera and screen sharing additionally depend on operating-system and
WebView permissions.
