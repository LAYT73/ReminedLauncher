# Remined Launcher

Remined Launcher is a desktop launcher for Minecraft: Java Edition. It manages
Java runtimes, game installations, Remined packs, vanilla versions, player
profiles, skins, friends, LAN sessions and voice rooms.

## Product scope

- **Game editions:** vanilla, Remined Java packs and Remined Vanilla
  (Fabric-based).
- **Installation management:** version discovery, downloads, updates, removal
  and local instance folders.
- **Identity:** Supabase authentication, cached offline profile, Remined ID,
  username, skin and cape.
- **Social:** friends, presence, invitations and per-pack playtime.
- **Network play:** Open-to-LAN sessions shared through the Remined Relay.
- **Voice:** a local LiveKit server exposed through the Remined Relay.
- **Operations:** diagnostics, crash detection, updater, tray integration and
  an offline mode after the first successful online setup.

## Technology

| Area | Technology |
|---|---|
| Desktop shell | Tauri 2 |
| Frontend | React 19, TypeScript, Vite |
| State | Zustand |
| Backend | Rust |
| Cloud | Supabase Auth, Postgres, Storage and Realtime |
| Voice | LiveKit |
| Network play and voice | Remined Relay with TCP and UDP forwarding |

## Requirements

- Node.js and npm
- Rust via `rustup`
- Java 25 for local development and the Remined Vanilla smoke harness
- macOS or Windows for the supported desktop flows
- Supabase project credentials for online features

Install Java 25 on macOS with:

```bash
brew install openjdk@25
```

## Development

```bash
npm install
npm run tauri dev
```

Offline frontend mode:

```bash
npm run tauri:dev:offline
```

The launcher reads local Supabase configuration from `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-anon-key
```

The key must be the publishable anon key. Never commit `.env.local`,
`.remined-secrets/` or updater signing keys.

## Verification

```bash
npm run typecheck
npm run check:fsd
npm run build
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo run --manifest-path src-tauri/Cargo.toml --bin remined-cli -- smoke-rv
```

`check:fsd` validates frontend layer boundaries. `smoke-rv` validates the
Remined Vanilla installation and launch path for selected versions.

## Repository map

```text
src/                 React application
src-tauri/src/       Tauri commands and Rust runtime
supabase/migrations/ Database schema and RLS changes
docs/                Operational and technical documentation
assets/              Launcher-owned static assets
scripts/             Repository checks
```

Frontend boundaries and backend responsibilities are documented in
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Data and diagnostics

The application data root on macOS is:

```text
~/Library/Application Support/com.remined.launcher/remined/
```

Important logs:

- launcher: `<root>/.remined/logs/app.log`
- voice and relay: `<root>/.remined/voice/voice.log`
- game: `<instance>/logs/latest.log`
- mod inventory: `<instance>/mods-manifest.json`

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — application boundaries, runtime and
  data flows
- [Setup](./docs/SETUP.md) — local environment, Supabase and pack repository
- [Release](./docs/RELEASE.md) — versioning, CI and updater
- [Pack assets](./docs/PACK_ASSETS.md) — catalog media contract
- [Voice](./docs/VOICE.md) — LiveKit and Remined Relay operations
- [Remined Vanilla](./docs/REMINED_VANILLA.md) — mod policy and smoke testing

## Release

The current release is **0.9.5**. Release procedure and the complete version
surface are maintained in [docs/RELEASE.md](./docs/RELEASE.md).
