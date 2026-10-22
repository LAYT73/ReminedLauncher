# Development setup

## Repositories

- Launcher: <https://github.com/LAYT73/ReminedLauncher>
- Packs: <https://github.com/LAYT73/ReminedPacks>

## Local prerequisites

Install Node.js, Rust through `rustup`, and Java 25. On macOS:

```bash
brew install openjdk@25
rustup update stable
```

Install dependencies and start the desktop app:

```bash
npm install
npm run tauri dev
```

Use `npm run tauri:dev:offline` to exercise the cached-account path without
making online requests.

## Environment

Create `.env.local` in the repository root:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-anon-key
```

Only the publishable anon key belongs in the client environment. Keep service
role keys, relay credentials and updater signing keys outside the repository.

## Supabase

Apply every file in `supabase/migrations/` in lexical order. The current
sequence ends at `017_sessions_activity.sql`.

Required product configuration:

- Email/password authentication with email confirmation disabled for the
  current onboarding flow.
- `skins` storage bucket for skin and cape objects.
- `relay-creds` Edge Function backed by the relay secrets described in
  [Release](./RELEASE.md).

Feature dependencies:

| Feature | Migrations |
|---|---|
| Friends and LAN presence | `001`, `005`, `006` |
| Voice rooms and presence | `008`, `009`, `010` |
| Playtime | `011`, `012`, `013` |
| Cape upload | `014` |
| Voice Relay share code | `015` |
| Pack catalog locale overrides | `016` |
| Friend activity codes | `017` |

## Pack repository hygiene

The launcher downloads runtime assets during onboarding. The packs repository
should contain pack content, not a user profile or a generated game directory.

Keep pack-owned content such as:

```text
mods/
config/
defaultconfigs/
data/
resourcepacks/
shaderpacks/
options.txt
<pack-specific folders and metadata>
```

Do not publish:

```text
saves/
screenshots/
logs/
crash-reports/
natives/
.cache/
.mixin.out/
.fabric/
usercache.json
TLauncherAdditional.json
downloads/
resourcify-temp/
server-resource-packs/
.run/
```

Marketing assets and their catalog fields are documented in
[Pack assets](./PACK_ASSETS.md).

## Verification

```bash
npm run typecheck
npm run check:fsd
npm run build
cargo test --lib --manifest-path src-tauri/Cargo.toml
```
