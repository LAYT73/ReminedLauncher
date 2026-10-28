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
- **Social:** friends, presence, Discord-style friend activity, invitations and
  per-pack playtime.
- **Network play:** Open-to-LAN sessions shared through the Remined Relay.
- **Voice:** a local LiveKit server exposed through the Remined Relay.
- **Party:** voice + shared world: a voice room that also runs one pack for the
  host's single-player world, opened to LAN for the party, with invites, a member
  cap and `remined://party/<id>` invite links.
- **Localization:** English and Russian UI; pack catalog strings can override
  per locale.
- **Companion:** a Fabric mod (Minecraft 1.20–26.x) that reports in-game activity
  for friends and adds an in-game voice HUD, notifications, mic/deafen/join keys
  and a settings screen (V).
- **Operations:** diagnostics, crash detection, updater, tray integration and
  an offline mode after the first successful online setup.
- **Desktop integration:** `remined://pack/<id>` and `remined://party/<id>` deep links (the macOS scheme
  only works from the bundled app), a single
  running instance, optional launch at system startup minimized to the tray,
  remembered window size and position, and native system notifications while
  the launcher is in the background.

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

A fresh clone must run `npm run mod:build` (JDK 25) once before `npm run tauri dev`, because the companion jar is git-ignored and built from `companion-mod/`.

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
src-tauri/resources/ Bundled Remined Companion jar
companion-mod/       Companion Fabric mod source
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
- [Companion](./companion-mod/README.md) — friend activity mod (`state.json`)

## Release

The current release is **1.0.5**. Release procedure and the complete version
surface are maintained in [docs/RELEASE.md](./docs/RELEASE.md).
