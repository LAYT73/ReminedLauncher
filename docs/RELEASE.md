# Remined launcher releases

## Version

Bump together:

- `package.json` → `version`
- `package-lock.json` → root `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/Cargo.lock` → `name = "remined"` package version
- `.github/workflows/release.yml` → `tagName` / `releaseName` / body
- `src/App.tsx` → fallback version strings (UI before `get_app_version`)

Tag and push:

```bash
git tag v0.5.0
git push origin v0.5.0
```

GitHub Actions (`.github/workflows/release.yml`) builds **macOS** (arm64 + x64) and **Windows**, uploads a Release, and publishes `latest.json` for the updater.

## Secrets (GitHub → ReminedLauncher → Settings → Secrets)

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `.remined-secrets/remined.key` (updater signatures) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Empty if key has no password |
| `VITE_SUPABASE_URL` | Same as local `VITE_SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Publishable anon key only |

Private key lives only in `.remined-secrets/` (gitignored) and GitHub Secrets — never commit it.

## Updater

Configured endpoint:

`https://github.com/LAYT73/ReminedLauncher/releases/latest/download/latest.json`

In Settings → **Check for updates**.
