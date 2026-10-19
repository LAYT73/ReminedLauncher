# Setup notes

## Repositories

- Launcher: <https://github.com/LAYT73/ReminedLauncher>
- Packs: <https://github.com/LAYT73/ReminedPacks> (see [PACK_ASSETS.md](./PACK_ASSETS.md))

## Environment

Copy the Supabase URL and the publishable **anon** key into `.env.local` (gitignored):

```
VITE_SUPABASE_URL=…
VITE_SUPABASE_ANON_KEY=…
```

Never commit keys or `.remined-secrets/`.

## Supabase

- Auth: email/password with **email confirmation off** (Dashboard → Authentication → Providers → Email).
- Apply `supabase/migrations/` in order (list in [ARCHITECTURE.md](./ARCHITECTURE.md#cloud-supabase)). Network Play needs `005`/`006`, Voice needs `008`/`009`, and voice presence needs `010`.

## Network Play

Free Steam app `4963920` (Porthole) — see [PORTHOLE.md](./PORTHOLE.md).

## Keeping the packs repo clean

When importing a pack folder into ReminedPacks, **keep**:

- `mods/`, `config/`, `defaultconfigs/` (if present), `data/`
- `resourcepacks/`, `shaderpacks/`
- `options.txt` (+ graphics / keybind settings)
- pack-specific folders and the pack jar/json (e.g. `VanillaPro.jar`, `VanillaPro.json`, `Notebook/`, `bivrik/`, `frozenlib/`)

**Remove** (runtime or personal data): `saves/`, `screenshots/`, `logs/`, `crash-reports/`, `natives/`, `.cache/`, `.mixin.out/`, `.fabric/`, `usercache.json`, `TLauncherAdditional.json`, and empty temp folders (`downloads/`, `resourcify-temp/`, `server-resource-packs/`).

`.run/` assets and libraries are not stored in the packs repo — the launcher's onboarding downloads them.
