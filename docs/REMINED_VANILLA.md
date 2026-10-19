# Remined Vanilla — mod stacks & compatibility

Source of truth: `src-tauri/src/remined_vanilla.rs`.

## Goal

Fabric + Remined skins (SkinShuffle + CustomSkinLoader) + LAN helper (mcwifipnp) + performance stack, only on versions where skins work.

## Version families

| Family | MC versions | Opti extras |
|---|---|---|
| Classic | `1.20*` | ModernFix, Starlight |
| Hybrid | `1.21*` | Modern extras + classic fallbacks |
| Modern | `26*` | AsyncParticles, BadOptimizations, ScalableLux, Async |

## Always attempted (when Modrinth has a Fabric build)

**Core:** Fabric API, SkinShuffle, CustomSkinLoader, mcwifipnp  
**Render:** Sodium + Iris (pinned pair with line checks)  
**Recommended:** Lithium, FerriteCore, Entity Culling, ImmediatelyFast, Krypton, More Culling  
**Additional:** Dynamic FPS, Let Me Despawn, Cull Leaves, Sodium Extra, Fabric Language Kotlin, Resourcify  
**Conditional:** C2ME only if Java ≥ 25 (or Modern family when Java unknown)

Each mod is **skipped** (not fatal) if Modrinth has no matching Fabric file for that game version. Required Modrinth deps (e.g. cloth-config) are pulled recursively (depth ≤ 3).

## Hardening in code

| Check | Why |
|---|---|
| **Dependency audit** (`mod_audit.rs`) — reads every jar's `fabric.mod.json` (incl. jar-in-jar), checks `depends` / `breaks` with Fabric semver, duplicate ids | Catches “Incompatible mods found” *before* launch instead of in-game |
| **`repair_with_audit`** — fetches missing / wrong-version deps from Modrinth, otherwise drops the non-core owner mod (max 5 rounds); Sodium/Iris are never bumped for a side mod | Self-healing installs |
| **Iris ↔ Sodium pair search** (`find_iris_sodium_pair`) — newest Iris whose own Sodium requirement is satisfied by a Sodium build that exists for this MC version, verified with the audit (incl. `breaks`) | Replaced the old 0.6 / 0.8 jar-name heuristic |
| Stack conflicts (`stack_conflict_removals`): Starlight vs ScalableLux, ModernFix vs BadOptimizations, Resourcify without FLK, ImmediatelyFast 1.2.x with Iris 1.7.x | One consistent stack |
| Known-bad per version: MoreCulling on 1.20.5 / 1.20.6 / 1.21.2, Let Me Despawn (+Almanac) on 1.21.2, C2ME below Java 25, Memory Leak Fix | Found by the smoke harness |
| `skinshuffle_patch`: widens `depends.minecraft` of SkinShuffle and its nested libs when Modrinth tags a patch the jar omits (1.20.3), seeds `presets.json` on 1.20 / 1.20.1 (otherwise NPE at client init) | Smoke-verified |
| Duplicate-library dedupe on the classpath (`collect_classpath_paths`) — newest version of each `group:artifact` wins | Fabric Loader aborts on two ASM jars (1.21.2–1.21.5) |
| JNA ≥ 5.13 on macOS (`upgrade_old_jna`) + stamp-keyed native extraction | JNA 5.12.1 aborts the JVM on macOS 26 during Sodium's GPU probe |
| `validate_mods_dir` + `mods-manifest.json` after every install | Final gate + inventory for bug reports |

## Smoke harness (`remined-cli smoke-rv`)

Installs a version, runs the static audit, and (with `--launch`) starts the real game and waits for the sound engine (`Sound engine started` / `OpenAL initialized`) in `latest.log`; fails on `Incompatible mod`, `Mixin apply failed`, `NoClassDefFoundError`, crash reports.

```
cd src-tauri && cargo build --bin remined-cli
remined-cli smoke-rv --all --launch            # every supported version (opens + kills a MC window each)
remined-cli smoke-rv 1.20.1 1.21.4 --launch    # specific versions
remined-cli smoke-rv 26.1 --keep --reuse       # keep / reuse the pack dir to bisect
flags: --timeout 180  --root <dir> (default /tmp/rs)  --keep  --reuse
env:   REMINED_PROGRESS=1 (stream progress), REMINED_SMOKE_JVM="-Dfoo" (extra JVM args)
```

Output: markdown table + `smoke-report.json` in the root. Budget ~1 GB of disk per concurrent version; passing packs are deleted unless `--keep`.

### Last full run (macOS 26, Apple Silicon) — all 24 versions launch to the sound engine

| MC | install | audit | launch |
|---|---|---|---|
| 26.3 | ok | ok (24 mods) | ok |
| 26.2 | ok | ok (25 mods) | ok |
| 26.1.2 | ok | ok (25 mods) | ok |
| 26.1.1 | ok | ok (25 mods) | ok |
| 26.1 | ok | ok (24 mods) | ok |
| 1.21.11 | ok | ok (25 mods) | ok |
| 1.21.10 | ok | ok (25 mods) | ok |
| 1.21.9 | ok | ok (25 mods) | ok |
| 1.21.8 | ok | ok (25 mods) | ok |
| 1.21.7 | ok | ok (24 mods) | ok |
| 1.21.6 | ok | ok (25 mods) | ok |
| 1.21.5 | ok | ok (25 mods) | ok |
| 1.21.4 | ok | ok (24 mods) | ok |
| 1.21.3 | ok | ok (23 mods) | ok |
| 1.21.2 | ok | ok (16 mods) | ok |
| 1.21.1 | ok | ok (25 mods) | ok |
| 1.21 | ok | ok (22 mods) | ok |
| 1.20.6 | ok | ok (17 mods) | ok |
| 1.20.5 | ok | ok (17 mods) | ok |
| 1.20.4 | ok | ok (22 mods) | ok |
| 1.20.3 | ok | ok (17 mods) | ok |
| 1.20.2 | ok | ok (21 mods) | ok |
| 1.20.1 | ok | ok (21 mods) | ok |
| 1.20 | ok | ok (22 mods) | ok |

The 1.21.2 row was re-run alone after its last fix (the other rows come from the full run just before; no code touching them changed). “Launch ok” = reached the title-screen sound engine, not a played world. Re-run after any change to the mod lists or Modrinth resolution — Modrinth publishes new builds constantly.

## Remaining risk

1. Modrinth ships new builds → re-run the harness before each release.
2. Smoke only covers macOS/Apple Silicon. Windows/Linux (different natives, no JNA issue) are untested here.
3. Optional mods get dropped silently when they can't be made compatible (see `mods-manifest.json` of the install for what is actually present).

## Related bug

