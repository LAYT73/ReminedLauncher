# Architecture

**Version:** `0.7.2` · **Stack:** Tauri 2 (Rust) + React 19 / Vite (TypeScript) + Supabase (Auth, Realtime, Postgres)

## Product surfaces

| Rail / tab | Role |
|---|---|
| Home | Brand landing, featured pack, skin preview |
| Remined / Vanilla / Remined Vanilla | Install + Play for each edition (rail buttons) |
| Friends | Remined id, friend requests, presence, Join |
| Network | Steam Porthole tunnel for Open-to-LAN |
| Voice | Local LiveKit SFU + Porthole + Supabase chat/invites |
| Shots | Local screenshots of the active pack (pack rails only) |
| Installations | Select / reveal / delete local pack folders |
| Settings / Profile | Java, RAM, theme, updates · skin, username, account |

## Frontend (`src/`) — Feature-Sliced Design

Layers, top to bottom. **Imports go only downward.**

```
src/
  app/        providers (AppGate, ToastHost, shell effects), router/, global styles/
  pages/      one slice per route screen: home, pack, installations, settings,
              profile, friends, network, voice, screenshots, loading
  widgets/    composite shell blocks: rail, top-nav, profile-chip, game-tray,
              playbar, home-video, voice-host
  features/   user actions: auth, onboarding, play-game, manage-installations,
              profile-edit, launcher-update, game-watch, lan-hosting, presence,
              voice, friends, network-play, screenshots
  entities/   domain state + API: session, skin, profile, pack, game, install,
              game-version, voice-room, friend, theme
  shared/     config/ (constants), api/ (invoke, supabase, porthole), lib/, ui/, assets/
```

Slice layout: `ui/` (components), `model/` (zustand store, hooks, actions), `api/`, `lib/`, `config/`, and a public `index.ts` barrel.

Rules (enforced by `npm run check:fsd`, which also runs in CI-style checks):

- A layer imports only from layers below it.
- `pages`, `widgets`, `features` never import sibling slices of the same layer.
- Cross-slice imports go through the slice `index.ts`; inside a slice use relative paths.
- Pragmatic exception: an entity may import another entity through its barrel (order: session < skin < profile < game-version < game < install < pack).
- `@/` is an alias for `src/`.

### Routing

`app/router` uses `react-router` with `createMemoryRouter` (a Tauri window has no URL bar). Paths are built and parsed only through `shared/config/routes.ts` (`routeFor`, `parseRoute`, `RAIL`, `TAB`):

- `/home[/friends|network|voice]`
- `/java|vanilla|remined-vanilla[/screenshots|friends|network|voice]`
- `/installations`, `/settings`, `/profile`

The shell is `ShellLayout`; the rail and top-nav use `NavLink`. Non-component code navigates via `shared/lib/navigator.ts` (`navigateTo`, `currentPathname`). A route-level `errorElement` catches render crashes.

### State

Each entity owns a `zustand` store; actions outside components use `store.getState()`. Nothing is kept in a god-component.

### Constants

No magic strings in feature code: Tauri commands (`CMD`), events (`EVENT`), Supabase tables/buckets (`TABLE`, `BUCKET`), localStorage keys (`STORAGE_KEY`), timings (`TIMING`), limits, and user-facing messages (`MSG`) all live in `shared/config`. Tauri calls go through the typed `call(CMD.x, args)`.

Things that matter when changing code:

- **Voice survives navigation.** `widgets/voice-host` renders the voice UI via `createPortal` into a detached host node; `VoiceSlot` moves it into the content area on the Voice tab. Never mount the voice view conditionally on the tab.
- **Pack ids** are `vanilla-<ver>`, `remined-vanilla-<ver>`, anything else is a Remined (Java) pack. Use `shared/lib/packIds.ts`, never string-match.
- **Offline mode** lives in the session store; online-only tabs render a notice page.
- **Adding a feature:** create `features/<name>/{ui,model,index.ts}`, expose it through the barrel, mount it from a page or widget, add constants to `shared/config`, then run `npm run check:fsd`.
- UI language: Minecraft-adjacent stone/bevel CSS, pixel display font for headings.

## Backend (`src-tauri/src/`)

| Module | Responsibility |
|---|---|
| `lib.rs` | Tauri commands, app setup (`NO_PROXY` for loopback), plugin registration |
| `main.rs`, `bin/`, `cli.rs` | Entrypoints; `remined-cli` (second client, `smoke-rv`) |
| `runtime.rs`, `java_runtime.rs` | Launch Minecraft; Java probe / download |
| `pack_sync.rs` | Remined Java packs: download, sync, delete |
| `vanilla.rs`, `vanilla_skin_pack.rs` | Official vanilla versions + local skin resource pack |
| `remined_vanilla.rs`, `mod_audit.rs`, `skinshuffle_patch.rs` | Fabric + skins + opti stack; dependency audit/repair; SkinShuffle presets |
| `smoke.rs` | Headless launch smoke tests for Remined Vanilla |
| `gamewatch.rs` | `latest.log` parsing: live game status, LAN port, crash-report lookup |
| `porthole.rs` | Steam Porthole CLI (Network Play) |
| `voice_runtime.rs`, `voice_log.rs` | LiveKit binary download/spawn, Porthole expose for voice ports; `voice.log` |
| `diag.rs` | Panic hook, `app.log`, poison-tolerant session locks |
| `onboarding.rs`, `progress.rs`, `asset_cache.rs` | First-run setup, `remined-progress` events, media cache |
| `instance.rs`, `paths.rs`, `config.rs` | Install roots, profile.json |

Data root (macOS): `~/Library/Application Support/com.remined.launcher/remined/`

Tauri plugins in use: dialog, updater, process, opener, http, global-shortcut (push-to-talk).

## Cloud (Supabase)

Migrations in `supabase/migrations/` (apply in order):

| File | Adds |
|---|---|
| `001_profiles_friends` | Profiles, friendships |
| `002_packs_catalog`, `002b_packs_seed` | Packs catalog + seed |
| `003_remined_id_skins`, `004_username`, `007_skin_model` | Remined id, skins, username, skin model |
| `005_sessions_lan`, `006_sessions_share_code` | Presence sessions, LAN hosting, share code |
| `008_voice_rooms`, `009_voice_rooms_rls_fix` | Voice rooms, members, invites, messages + RLS |
| `010_sessions_voice` | `sessions.in_voice` (the client falls back silently if missing) |

## Networking model

```
Minecraft Open-to-LAN ──► Porthole expose ──► friend: porthole connect ──► 127.0.0.1:port
LiveKit (ws localhost:7880 + UDP RTC) ──► Porthole expose ──► guest connect ──► LiveKit client
```

Network Play and Voice both need **Steam logged in + Porthole installed**.

## Logs

| Area | Where |
|---|---|
| Launcher panics / startup | `<root>/.remined/logs/app.log` |
| Voice (UI + Rust + ICE) | `<root>/.remined/voice/voice.log` |
| Game | instance `logs/latest.log` |
| Remined Vanilla mods | `mods-manifest.json` in each install |

## Verification

```bash
npm run typecheck                     # types
npm run check:fsd                     # FSD layer/slice import rules
npm run build                         # tsc -b + vite build
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo run --manifest-path src-tauri/Cargo.toml --bin remined-cli -- smoke-rv   # see REMINED_VANILLA.md
```

## Docs index

- [SETUP.md](./SETUP.md) — repos, Supabase, packs repo hygiene
- [RELEASE.md](./RELEASE.md) — version bump, tag, CI, updater
- [PACK_ASSETS.md](./PACK_ASSETS.md) — pack logo / wallpaper / gallery
- [PORTHOLE.md](./PORTHOLE.md) — Network Play
- [VOICE.md](./VOICE.md) — voice rooms
- [REMINED_VANILLA.md](./REMINED_VANILLA.md) — mod stacks, compatibility, smoke matrix
- [ROADMAP_IMMERSIVE.md](./ROADMAP_IMMERSIVE.md) — shipped and backlog ideas
