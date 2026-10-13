# Remined prep notes

## GitHub
- Launcher: https://github.com/LAYT73/ReminedLauncher
- Packs: https://github.com/LAYT73/ReminedPacks
- Local git identity (repo only): LAYT73 / nsshipilov@gmail.com
- Global git left unchanged (Simbirsoft)

## Supabase
- URL: https://ymfggtkgthknizugadoi.supabase.co
- Keys live in `.env.local` (gitignored)
- Auth: email/password, **confirm email OFF** (Dashboard → Authentication → Providers → Email)

## Network Play (Porthole)
- See `docs/PORTHOLE.md`
- Free Steam app `4963920` — deep link from Network tab
- SQL: `migrations/005_sessions_lan.sql` + `006_sessions_share_code.sql`

## VanillaPro → ReminedPacks cleanup

### Remove
- `saves/`
- `screenshots/`
- `logs/`, `crash-reports/`
- `natives/`
- `.cache/`, `.mixin.out/`, `.fabric/`, `usercache.json`
- `TLauncherAdditional.json`
- empty temps: `downloads/`, `resourcify-temp/`, `server-resource-packs/`

### Keep
- `mods/`, `config/`
- `resourcepacks/`, `shaderpacks/`
- `options.txt` (+ graphics / keybinds settings)
- `Notebook/`, `bivrik/`
- `data/`, `frozenlib/`
- `VanillaPro.jar`, `VanillaPro.json`
- `defaultconfigs/` (if present)

### Not in packs repo
- `.run/` assets/libraries — launcher onboarding downloads
