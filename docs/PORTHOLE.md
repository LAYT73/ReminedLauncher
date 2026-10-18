# Porthole (Remined Network Play)

Remined uses **[Porthole](https://store.steampowered.com/app/4963920/Porthole__Local_Port_Sharing/)** (Steam app `4963920`) to share Minecraft Open-to-LAN over the internet. No ZeroTier, no port forwarding.

## Player setup (once)

1. Install **Steam** and stay logged in.
2. In Remined → **Network** → **Install on Steam** (opens `steam://install/4963920`).
3. Install free **Porthole**, launch it once if Steam asks, then return to Remined → **Refresh**.

## Host

1. Play → load a world → pause → **Open to LAN**.
2. Remined reads `logs/latest.log` for the port, runs `porthole expose`, and sets presence to **Hosting** with a share code.
3. Friends see **Join** on your row.

## Friend (Join)

1. Same Steam + Porthole setup.
2. Friends → **Join** on the hosting friend.
3. Remined runs `porthole connect`, then launches the pack with `--quickPlayMultiplayer 127.0.0.1:<port>`.

## Supabase

Run SQL migration `006_sessions_share_code.sql` (adds `sessions.share_code`).

## CLI notes

Launcher looks for the Steam install of `porthole` (override with `REMINED_PORTHOLE_PATH`). Commands use `--json --render-backend software`.

## Voice rooms

Voice tab hosts a local **LiveKit** server and exposes `tcp/7880` + `udp/7881-7890` through the same Porthole lobby. Guests Join the room invite → Porthole connect → `ws://127.0.0.1:7880`. Chat/history live in Supabase (`008_voice_rooms.sql`). Steam + Porthole required on every PC.

- **macOS host:** LiveKit via Homebrew (`brew install livekit`) — Remined will use `livekit-server` on PATH or install via brew on first Create room.
- **Windows host:** LiveKit binary is downloaded into `.remined/voice/` on first Create room.
