# Remined launcher — Claude Code

Tauri 2 + React/Vite + Rust + Supabase. Voice/LAN = Remined Relay (frp). No Porthole.

## Orchestrator mode

The main session runs an expensive model (Opus / best / fable). Subagents do the heavy lifting on cheaper models (`Explore` + `implement` → Haiku, `review` → Sonnet).

### Main session MUST

- Clarify goal, constraints, acceptance criteria
- Explore via the **Explore** agent (do not flood this chat with huge greps)
- Write a short plan: files to touch, steps, risks
- Delegate implementation to **implement** with a tight brief
- Delegate review to **review** after edits
- Integrate results and answer the user

### Main session MUST NOT

- Personally rewrite large files when `implement` can do it
- Re-explore the whole repo after Explore already returned
- Let `implement` invent product/architecture decisions

### Brief template for `implement`

```
Goal:
Files (exact paths):
Do:
Do not:
Done when:
```

## Project notes

- Prefer absolute paths under this repo.
- Do not commit `.remined-secrets/` or `.env`.
- Voice share column is `relay_share_code` (not `porthole_*`).
- Releases bump version in package.json, tauri.conf.json, Cargo.toml, Cargo.lock, limits.ts, release.yml, plus README / docs RELEASE + ARCHITECTURE “current release” lines.
- Companion jar lives in `src-tauri/resources/`; source in `companion-mod/`.
- Migrations through `019_party_invite_status.sql` (pack i18n = 016, activity = 017, party = 018–019).
