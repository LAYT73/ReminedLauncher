# Remined Companion

Client-side Fabric mod for the Remined launcher. It reports the local player's game state to the launcher
(`state.json`), and talks to the launcher over a localhost socket (protocol v2, below) for the voice HUD,
notifications, keybinds and connect. It runs in every Fabric instance the launcher starts, so it must never
crash the game.

Supported versions (every version the launcher ships a remined-vanilla pack for):

| Minecraft | Family (build project) | Compile pin | Java (`--release`) | In-game UI | Bridge and state.json |
|-----------|------------------------|-------------|--------------------|------------|-----------------------|
| 1.20, 1.20.1, 1.20.2, 1.20.3, 1.20.4 | `mc1201` (Mojang names, remapped) | 1.20 | 17 | yes | yes |
| 1.20.5, 1.20.6 | `mc1201` | 1.20 | 17 | yes | yes |
| 1.21, 1.21.1 | `mc121` (remapped) | 1.21 | 21 | yes | yes |
| 1.21.2, 1.21.3, 1.21.4, 1.21.5 | `mc1212` (remapped) | 1.21.2 | 21 | yes | yes |
| 1.21.6, 1.21.7, 1.21.8 | `mc1216` (remapped) | 1.21.6 | 21 | yes | yes |
| 1.21.9, 1.21.10 | `mc1219` (remapped) | 1.21.9 | 21 | yes | yes |
| 1.21.11 | `mc12111` (remapped) | 1.21.11 | 21 | yes | yes |
| 26.1, 26.1.1, 26.1.2, 26.2, 26.3 | `mc26` (official Mojang names) | 26.1 | 25 | yes | yes |
| other | none | none | none | no | yes (intermediary or Mojang names, best effort) |

Each family is compiled once against its lowest version. The other versions of the family are checked with
`-PcheckMc=<version>` (see Verify below), and their member references were compared against the lowest-version
build. Version to family mapping lives in `core/.../Companion.java` (`backendClass`).

Fabric API is recommended, not required. The UI backends use it, and it is declared as a `recommends` entry in
`fabric.mod.json`. Without it the bridge and state still work, and the UI stays off if the backend cannot load.
The core module has no Minecraft compile dependency and no mixins.

Bytecode: `core` is Java 8, `mc1201` is Java 17, the 1.21 families and `mc12111` are Java 21, `mc26` is Java 25.
A family never contains classes newer than the Java its lowest version runs on.

### Protocol v2 summary

On init the mod binds `127.0.0.1` on an ephemeral port and writes `<gameDir>/.remined/bridge.json`
(`{"v":1,"port":N,"token":"<32 hex>"}`, temp file + rename). TCP, UTF-8, one JSON object per line; a new
client that passes `hello` replaces the old one. Field details live in `core/.../Protocol.java`.

- Handshake: the client sends `{"t":"hello","token":"<token>"}`; the mod replies
  `{"t":"hello","v":2,"strategy":"intermediary"|"mojmap"|"unresolved"}`.
- Launcher to mod: `voice` (room state and members, `active:false` turns the HUD off), `head` (8x8 avatar as
  `rgba`), `notify` (card with optional `join` action and `ttl`), `connect` (answered by `connect_result`).
- Mod to launcher: `key` with `action` `mute`, `deafen` or `join` (plus `id` for join), and `connect_result`.
- Messages that arrive before the Minecraft client is ready are queued (bounded, 256, in order) and run once the
  client is ready. A `connect` that waits more than 10 s gets `{"t":"connect_result","ok":false,"error":"client not ready"}`.
- When the launcher disconnects, the mod resets voice state to off and disarms any join invite.

### Keybinds

| Action | Default key | Notes |
|--------|-------------|-------|
| Settings screen | `V` | toggles the settings screen |
| Mute | `M` | sends `key` `mute` while in a voice room, otherwise shows a notice |
| Join invite | `J` | sends `key` `join` with the armed invite id |
| Deafen | unbound | sends `key` `deafen` when bound in Controls |

Keys can be rebound in the Minecraft Controls menu.

### Build

Multi-project build: `core` (plain Java, unit tests), the version families `mc1201`, `mc121`, `mc1212`, `mc1216`,
`mc1219`, `mc12111` (Minecraft 1.20 to 1.21.11, Loom) and `mc26` (Minecraft 26.x). Version pins and the family
list are in the root `build.gradle` (`ext.families`, `ext.fabricApi`). The Gradle wrapper (9.8.2) and Loom 1.19.3
need JDK 25. Java 17 and 21 are used only as `--release` targets, so JDK 25 compiles every family.

```
cd companion-mod
JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./gradlew clean build
```

Output: `build/libs/remined-companion.jar` (merged, all families). Unit tests run as part of `gradle build`.

From the repo root, `npm run mod:build` runs this build (JDK 25 from `JAVA_HOME`, or Homebrew `openjdk@25` on
macOS) and copies the jar to `src-tauri/resources/remined-companion.jar`, which the launcher embeds. That file is
git-ignored. The release workflow builds the jar in a separate `mod` job and feeds it to the launcher build.
The mod version is read from the root `package.json`, so it matches the launcher version.

### Verify

Compile a family against another member of its family (uses that version's Fabric API pin from `ext.fabricApi`):

```
JAVA_HOME=... ./gradlew :mc1212:compileJava -PcheckMc=1.21.4
```

Then compare member references with the lowest-version build (`javap -c -p` on `build/classes/java/main`), and
check major versions (`javap -v`: 61 = Java 17, 65 = Java 21, 69 = Java 25). Intermediary names must appear in the
remapped families (no `GuiGraphics` or `ResourceLocation` strings in the final jar), and `mc26` keeps Mojang names.

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

## Test manually

1. Put the jar in `mods/` of a Fabric instance (any version in the range; no Fabric API needed).
2. Launch, join a world, then watch `<instance>/.remined/state.json` (`watch -n1 cat ...`).
3. Check: Nether/End switch changes `dim`; Esc in singleplayer sets `paused: true`; death sets
   `screen` to `class_418`/`DeathScreen`; "Open to LAN" sets `mode: lan`; a server gives `mp`;
   title screen gives `inWorld:false, mode:menu`. Look for `[remined-companion] started (...)` in the log.

