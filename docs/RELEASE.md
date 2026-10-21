# Release procedure

The current release is `0.9.5`.

## Version surface

Update all of the following to the same value:

- `package.json`
- `package-lock.json` root package
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` package entry
- `src-tauri/tauri.conf.json`
- `.github/workflows/release.yml`
- `src/shared/config/limits.ts` (`FALLBACK_APP_VERSION`)
- user-facing release notes in the workflow

The fallback version is shown until the native `get_app_version` command
responds.

## Pre-release checks

```bash
npm run typecheck
npm run check:fsd
npm run build
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo run --manifest-path src-tauri/Cargo.toml --bin remined-cli -- smoke-rv --all --launch
```

The smoke harness is network- and disk-intensive. Record the supported-version
matrix and investigate every failed audit or launch before publishing.

## CI and artifacts

The release workflow builds macOS arm64, macOS x64 and Windows packages,
publishes a GitHub Release and optionally uploads `latest.json` for the Tauri
updater. The updater endpoint is:

```text
https://github.com/LAYT73/ReminedLauncher/releases/latest/download/latest.json
```

## Signing and secrets

GitHub Actions requires:

| Secret | Use |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater signature |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Signing key password |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Publishable client key |

The updater private key belongs only in `.remined-secrets/` locally or GitHub
Secrets. Never commit it.

## Relay configuration

The `relay-creds` Edge Function reads:

```text
RELAY_FRPS_ADDR
RELAY_FRPS_PORT
RELAY_FRPS_TOKEN
```

Rotate the VPS `auth.token` and the Supabase secret together. Deploy the
function after changing its configuration.

## Publish

Create and push an annotated release tag after the checks pass:

```bash
git tag -a vX.Y.Z -m "Remined vX.Y.Z"
git push origin vX.Y.Z
```

The workflow is responsible for packaging and updater metadata. Verify the
GitHub Release assets and updater JSON after the workflow completes.
