# Remined Companion

Tiny client-side Fabric mod. Reports the local player's game state to the Remined launcher
(via a JSON file) so friends can see Discord-like statuses ("In the Nether", "Paused", ...).

One jar for Minecraft 1.16.5 through 1.21.x (intermediary at runtime) and 26.x
(unobfuscated, official Mojang names). No Minecraft compile dependency, no Fabric API, no mixins.
Bytecode is Java 8 (class major 52).

## state.json

Path: `<gameDir>/.remined/state.json`. Written atomically (temp file + rename, direct-write fallback)
only when content (excluding `ts`) changes, or every 10 s as heartbeat. The launcher should treat a
`ts` older than ~30 s as "game not running / stale".

```json
{"v":1,"inWorld":true,"dim":"minecraft:the_nether","paused":false,"mode":"sp","screen":null,"ts":1790000000000}
```

| field   | type        | meaning |
|---------|-------------|---------|
| v       | int         | schema version (1) |
| inWorld | bool        | world != null && player != null |
| dim     | string/null | dimension id, e.g. `minecraft:overworld`; null when not in a world |
| paused  | bool        | `MinecraftClient.isPaused()` (true only in singleplayer pause) |
| mode    | string      | `sp` integrated server unpublished, `lan` integrated server opened to LAN, `mp` remote server, `menu` not in world |
| screen  | string/null | simple class name of the open screen. Intermediary: `class_433` = pause menu (GameMenuScreen), `class_418` = DeathScreen. Official names: `PauseScreen`, `DeathScreen`. Useful to detect pause in multiplayer and death |
| ts      | long        | epoch ms of the write |

## Mappings used (verified)

Verified by parsing `intermediary-<ver>-v2.jar` and `yarn-<ver>+build.N-v2.jar` tiny files for
1.16.5, 1.20.1 and 1.21.1: every name and descriptor below is identical in all three.

| Yarn | Intermediary |
|------|--------------|
| `net.minecraft.client.MinecraftClient` | `class_310` |
| `MinecraftClient.getInstance()` | `method_1551` |
| `MinecraftClient.world` (class_638) | `field_1687` |
| `MinecraftClient.player` (class_746) | `field_1724` |
| `MinecraftClient.isPaused()` | `method_1493` |
| `MinecraftClient.isInSingleplayer()` | `method_1542` |
| `MinecraftClient.getCurrentServerEntry()` | `method_1558` |
| `MinecraftClient.getServer()` -> IntegratedServer `class_1132` | `method_1576` |
| `MinecraftClient.currentScreen` (class_437) | `field_1755` |
| `World` (`class_1937`).`getRegistryKey()` | `method_27983` |
| `RegistryKey` (`class_5321`).`getValue()` -> Identifier `class_2960` | `method_29177` |
| `net.minecraft.server.MinecraftServer.isRemote()` (declared on MinecraftServer, true when LAN-published) | `method_3860` |
| `ThreadExecutor.execute(Runnable)` (`class_1255`; client implements `java.util.concurrent.Executor`, so the mod casts) | `execute` |

Note: `MinecraftServer` is not obfuscated in intermediary, and `isRemote` is declared there, not
on `class_1132`.

Official-name fallback (strategy B, 26.x): `net.minecraft.client.Minecraft` (`getInstance`, fields
`level`, `player`, `screen`, `isPaused()`, `isSingleplayer()`/`hasSingleplayerServer()`,
`getCurrentServer()`, `getSingleplayerServer()`), `Level.dimension()`,
`ResourceKey.location()` or `identifier()`, `IntegratedServer.isPublished()`.
These are best-effort (not verified against a 26.x jar).

## Behavior

- One daemon thread `remined-companion`; every 1000 ms it schedules a snapshot on the client thread.
- Everything is wrapped in try/catch; each distinct error is logged once (stdout, prefix
  `[remined-companion]`); after 5 consecutive failures it polls every 10 s.
- If neither mapping strategy resolves, the mod disables itself silently (one log line).

## Build

Needs JDK 17+ and Gradle (no wrapper, no Loom):

```
cd companion-mod
JAVA_HOME=<jdk17> gradle build
```

Output: `build/libs/remined-companion-1.0.0.jar`. Copy it to
`src-tauri/resources/remined-companion.jar` for bundling. Unit tests (JSON escaping, change
detection) run as part of `gradle build`.

## Test manually

1. Put the jar in `mods/` of a Fabric instance (any version in the range; no Fabric API needed).
2. Launch, join a world, then watch `<instance>/.remined/state.json` (`watch -n1 cat ...`).
3. Check: Nether/End switch changes `dim`; Esc in singleplayer sets `paused: true`; death sets
   `screen` to `class_418`/`DeathScreen`; "Open to LAN" sets `mode: lan`; a server gives `mp`;
   title screen gives `inWorld:false, mode:menu`. Look for `[remined-companion] started (...)` in the log.
