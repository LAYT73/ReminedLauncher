# Architecture

**Release:** `1.0.1`
**Stack:** Tauri 2, Rust, React 19, TypeScript, Vite, Supabase

This document describes the implementation currently in the repository. The
source code is authoritative when this document and an implementation diverge.

## Runtime boundaries

```text
React UI
  ├─ Zustand entity stores
  ├─ i18n (EN / RU) + typed Tauri command adapters
  └─ Supabase API modules
        │
        ▼
Tauri commands
  ├─ Minecraft process and instance management
  ├─ Java runtime and asset installation
  ├─ Remined Relay
  ├─ LiveKit runtime
  ├─ Companion jar install + gamewatch activity
  └─ diagnostics, tray and updater integration
```

The frontend never manages Minecraft processes directly. Native operations are
exposed through Tauri commands registered in
[`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs).

## Frontend

The frontend follows Feature-Sliced Design. Imports move only from a higher
layer to a lower layer:

```text
app → pages → widgets → features → entities → shared
```

| Layer | Responsibility |
|---|---|
| `app` | Boot gate, router, shell, providers and global styles |
| `pages` | Route-level screens |
| `widgets` | Shell blocks shared by multiple screens |
| `features` | User actions and workflows |
| `entities` | Domain state, API and domain UI |
| `shared` | Configuration, native/cloud adapters, utilities and UI primitives |

Each slice may contain `ui/`, `model/`, `api/`, `lib/`, `config/` and a public
`index.ts`. Cross-slice access uses that public entry point. The repository
check is `npm run check:fsd`.

### Boot and navigation

`AppGate` transitions through:

```text
loading → auth → onboarding → app
```

The app uses a memory router because a Tauri window has no browser address bar.
Routes are declared in
[`src/app/router/routes.tsx`](../src/app/router/routes.tsx) and route values are
centralized in [`src/shared/config/routes.ts`](../src/shared/config/routes.ts).

Current rails:

```text
/home
/java
/vanilla
/remined-vanilla
/installations
/settings
/profile
```

Pack rails expose `play`, `screenshots`, `friends` and `voice` tabs. The
legacy `network` path redirects to the Network section in Settings.

The voice host remains mounted in the shell while navigation changes. Its
visual placement is controlled by `VoiceSlot`; changing tabs must not destroy
the active voice session.

## Native runtime

The Rust application is under `src-tauri/src/`.

| Module | Responsibility |
|---|---|
| `lib.rs` | Tauri setup, command registration and shared state |
| `i18n.rs` | Native locale strings for command errors |
| `runtime.rs`, `gamewatch.rs` | Minecraft launch, process state, log + Companion activity |
| `java_runtime.rs` | Java discovery and runtime downloads |
| `instance.rs`, `paths.rs`, `config.rs` | Install roots and local configuration |
| `pack_sync.rs`, `vanilla.rs` | Cloud packs and official vanilla versions |
| `remined_vanilla.rs`, `mod_audit.rs` | Fabric stack resolution and compatibility |
| `skinshuffle_patch.rs`, `vanilla_skin_pack.rs` | Skin integration and local resources |
| `relay.rs` | Remined Relay client, host/visitor sessions and share codes |
| `voice_runtime.rs`, `voice_log.rs` | LiveKit download, startup and diagnostics |
| `onboarding.rs`, `progress.rs`, `asset_cache.rs` | First run, progress events and media cache |
| `diag.rs`, `net_log.rs` | Application and network diagnostics |
| `tray.rs`, `cli.rs`, `smoke.rs` | Tray integration, CLI and smoke harness |

Bundled Companion jar: `src-tauri/resources/remined-companion.jar` (source under
`companion-mod/`). On Fabric launches the launcher installs it into the instance
`mods/` folder. The mod writes `<gameDir>/.remined/state.json`; `gamewatch`
merges that with `latest.log` into friend-visible activity codes.

The native data root is platform-specific. On macOS:

```text
~/Library/Application Support/com.remined.launcher/remined/
```

## Cloud contract

Supabase provides authentication, profiles, friendship, presence, pack
catalog, voice-room metadata, chat, invitations, storage and playtime.

Migrations are applied in filename order:

| Migration | Scope |
|---|---|
| `001`–`007` | Profiles, friends, packs, IDs, usernames, LAN and skins |
| `008`–`010` | Voice rooms, RLS and voice presence |
| `011`–`013` | Playtime and RPC correction |
| `014` | Cape storage and profile metadata |
| `015` | Voice Relay share-code column |
| `016` | Pack catalog `i18n` JSONB overrides |
| `017` | Friend-visible `sessions.activity` |

The client must tolerate offline mode and older deployments where optional
columns are not present. Credentials are supplied through `.env.local` during
development and GitHub Actions secrets during release builds.

Frontend locale lives under `src/shared/i18n/`. Settings → Language switches
UI copy; Settings → Motion controls page-transition preferences.

## Networking

Minecraft Open-to-LAN uses the Remined Relay:

```text
Minecraft LAN → Relay host → Relay visitor → localhost
```

Voice uses the Remined Relay:

```text
Local LiveKit → Relay host → Relay visitor → localhost LiveKit
```

The voice runtime uses TCP `7880`, TCP `7881` and UDP `7882`. A LAN game port
may be attached to the same relay session without restarting LiveKit.

## Operational surfaces

| Area | Location |
|---|---|
| Launcher startup and panics | `<root>/.remined/logs/app.log` |
| Voice and relay | `<root>/.remined/voice/voice.log` |
| Game state | `<instance>/logs/latest.log` |
| Companion activity | `<instance>/.remined/state.json` |
| Installed mod inventory | `<instance>/mods-manifest.json` |

## Verification

```bash
npm run typecheck
npm run check:fsd
npm run build
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo run --manifest-path src-tauri/Cargo.toml --bin remined-cli -- smoke-rv
```

## Related documents

- [Setup](./SETUP.md)
- [Release](./RELEASE.md)
- [Pack assets](./PACK_ASSETS.md)
- [Voice](./VOICE.md)
- [Remined Vanilla](./REMINED_VANILLA.md)
- [Companion](../companion-mod/README.md)
