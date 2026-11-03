# Remined Companion

Client-side Fabric mod for the Remined launcher. It reports the local player's game state to the launcher
(`state.json`), and talks to the launcher over a localhost socket (protocol v3, below) for the voice HUD,
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

### Protocol v3 summary

On init the mod binds `127.0.0.1` on an ephemeral port and writes `<gameDir>/.remined/bridge.json`
(`{"v":3,"port":N,"token":"<32 hex>"}`, temp file + rename). TCP, UTF-8, one JSON object per line; a new
client that passes `hello` replaces the old one. Field details live in `core/.../Protocol.java`.

- Handshake: the client sends `{"t":"hello","token":"<token>"}`; the mod replies
  `{"t":"hello","v":3,"strategy":"intermediary"|"mojmap"|"unresolved","caps":["voice","head","notify","connect","open_lan","battery"]}`.
  `caps` lists the launcher to mod message types this mod handles. Check it before sending a newer message: an
  older mod ignores unknown types silently, so no reply arrives.
- Launcher to mod: `voice` (room state and members, `active:false` turns the HUD off), `head` (8x8 avatar as
  `rgba`), `notify` (card with optional `join` action and `ttl`), `connect` (answered by `connect_result`),
  `open_lan` (answered by `open_lan_result`, see below), `battery` (see below).
- Mod to launcher: `key` with `action` `mute`, `deafen` or `join` (plus `id` for join), `connect_result`, and
  `open_lan_result`.
- `battery`: `{"t":"battery","present":true,"level":87,"charging":false}`, sent on connect, every 30 s and when the
  charging state changes, only if `caps` has `battery`. `level` is 0 to 100. While a container screen (inventory,
  chest, crafting, furnace, ...) is open the mod draws a small badge top-left; `present:false` or no data hides it. It
  is a no-op on pause, chat and settings screens, and when the Fabric screen API is missing. No reply.
- `open_lan` (new in v3): `{"t":"open_lan","port":N,"cheats":false}`. Both fields are optional; `port` 0 or absent
  picks a free port, `cheats` defaults to false. It opens the current single-player world to LAN, the same way
  "Open to LAN" does, using the player's current game mode (on 26.3 the game takes no mode argument, so the world's
  mode applies). It never publishes twice. Replies:
  - `{"t":"open_lan_result","ok":true,"port":P}` after a new publish.
  - `{"t":"open_lan_result","ok":true,"port":P,"already":true}` when the world was already published, also by
    another mod such as mcwifipnp. Nothing is published again.
  - `{"t":"open_lan_result","ok":false,"error":E}` with E = `not_singleplayer` (no integrated server running),
    `publish_failed` (the game refused), `unsupported` (no UI backend for this version, or the game does not expose
    the members), `bad port` (outside 0 to 65535) or `client not ready` (queued for more than 10 s).
- Messages that arrive before the Minecraft client is ready are queued (bounded, 256, in order) and run once the
  client is ready. A `connect` or `open_lan` that waits more than 10 s gets `{"t":"connect_result","ok":false,"error":"client not ready"}`
  or `{"t":"open_lan_result","ok":false,"error":"client not ready"}`.
- When the launcher disconnects, the mod resets voice state to off and disarms any join invite.

### Keybinds

| Action | Default key | Notes |
|--------|-------------|-------|
| Settings screen | `V` | toggles the settings screen |
| Mute | `M` | sends `key` `mute` while in a voice room, otherwise shows a notice |
| Join invite | `J` | sends `key` `join` with the armed invite id |
| Deafen | unbound | sends `key` `deafen` when bound in Controls |

Keys can be rebound in the Minecraft Controls menu.

### Performance tab

The settings screen (key `V`) gets a second tab, "Performance", when the pack ships
`<gameDir>/config/remined-performance-profile.json` and the backend supports it (only `mc26` does; other families
simply hide the tab). It lists the profile's items with an FPS-cost badge (1 to 3 bars, green, amber, red), a preset
selector ("Custom" lights up when the pending values match no preset), and Apply / Revert / Done. Hovering a row shows its
hint. Rows for things that are not installed are greyed. Apply runs on the client thread, with one resource reload at
most; a failing item is reported in a notice and never crashes the game. After a mod change a banner offers "Quit game".

**Profile** (pack-owned, read-only; absent or invalid means no tab):

```json
{ "version": 1, "defaultPreset": "high",
  "presets": [ { "id": "ultra", "name": {"ru": "Ультра", "en": "Ultra"}, "values": { "<itemId>": true } } ],
  "sections": [ { "name": {"ru": "...", "en": "..."}, "items": [
    { "id": "shaders", "kind": "shaders", "pack": "Mellow v3.4.1a.zip", "name": {"ru": "...", "en": "..."},
      "hint": {"ru": "...", "en": "..."}, "impact": 3 } ] } ] }
```

| kind | fields | control | effect |
|------|--------|---------|--------|
| `shaders` | `pack` | switch | Iris. On: selects `pack` when the current shader pack is empty or missing, then enables shaders. Live |
| `dh` | | switch | Distant Horizons rendering (`DhApi.Delayed.configs.graphics().renderingEnabled()`). Live |
| `dh_radius` | `values` (ints) | choice | `chunkRenderDistance()`. Live |
| `option` | `option`, `values`, optional `labels` | choice, or switch when `values` is absent (booleans) | vanilla video option, saved to options.txt. `renderDistance`, `simulationDistance`, `entityDistanceScaling` (double), `particles` (`all`/`decreased`/`minimal`), `clouds` (`off`/`fast`/`fancy`), `entityShadows`, `ambientOcclusion`, `biomeBlendRadius`, `mipmapLevels` (reloads resources) |
| `packs` | `packs` (ids as in options.txt `resourcePacks`, e.g. `file/X.zip`) | switch | on = these resource packs are selected; missing ids are ignored. Order is preserved, see `packOrder` |
| `config` | `on`, `off`, optional `probe` | switch | see below: edits the mod's config file and applies it live by reflection |
| `mods` | `mods` (mod ids) | switch, marked with a restart sign | on = mods enabled. recorded in the state file; the launcher renames the jars before the next launch |

A `config` item is a switch over another mod's own config: `"on"` and `"off"` are ordered op lists, run for the new value.
Ops: `{"file": "<path under config/>", "format": "json|json5|toml|properties", "key": "a.b", "value": V}` persists a value
(json is parsed and rewritten pretty, key path nests by dots; the other formats edit the first line whose key matches and
keep everything else; strings are quoted for json/json5/toml, raw for properties; a missing file or key is skipped and
logged once); `{"set": "<path>", "value": V}` sets a field by reflection; `{"call": "<path>"}` invokes a method;
`{"packs": ["file/X.zip"], "value": true}` selects or deselects resource packs with the same order-preserving logic as the
`packs` kind (missing ids ignored, merged into the one reload); `{"reload": "resources"}` asks for the resource reload (merged with the pack and mipmap reload, so at most one per Apply).
Paths are `pkg.Class.FIELD.field`, with method segments `name(args)` anywhere (`Cls.getConfig().enabled`,
`Cls.CONFIG.enabled.set(true)`); the class is the longest prefix that loads (nested classes are tried with `$`), static
members are tried first, args are JSON literals, methods are picked by name and argument count, and values convert to the
field or parameter type (boxing, numbers, String to enum exact then case-insensitive). If a `set` or `call` fails while the
file ops succeeded, a notice says the item applies after a restart; otherwise it is a failure. The current value is read
from `"probe"` (`{"get": "<path>", "equals": V}` or a file op) or, without one, from the first file op of `on` (equal to its
value means on; a missing file or key counts as on). Config items take part in the startup re-apply.

Every item also has `id` (unique), `kind`, `name` (`{ru, en}`), optional `hint`, and `impact` 1 to 3. Preset `values` map
item ids to `true`/`false`, a number or a string; presets need not list every item. Unknown kinds are skipped.

Mods: the game never renames jars while it runs (it loads classes lazily from them). Apply only writes the wanted
`mods` map to the state file, and the Remined launcher renames `x.jar` and `x.jar.disabled` from it before the next
launch, so mod changes take effect on the next launch from the launcher. A mod is never disabled while another loaded,
still-enabled mod depends on it or on one of its `provides` aliases (a notice names the blocker). A disabled mod is not
enabled while one of its `depends` is, or stays, disabled (the notice names the dependency). A mod is recorded as `false` only when it has a top-level jar in `mods/` (`.jar` or `.jar.disabled`); a mod with no top-level jar is reported as "cannot disable" and not recorded. A `shaders` item without `pack` only
toggles shaders. `remined-companion` itself is never touched.

**Player state** (written by the mod on Apply, temp file + rename):

```json
{ "version": 1, "preset": "high" | "custom", "packVersion": "1.2.3", "values": { "<itemId>": true },
  "mods": { "<modid>": true }, "packOrder": [ "vanilla", "file/A.zip" ] }
```

`mods` lists every mod id of every `mods` item (true = enabled); the launcher reads only this key, so it is stable.
`values` is the actual state after the last Apply. `packOrder` is the selected resource pack order from before the first
removal, refreshed on every Apply by putting the currently removed packs back at their baseline positions; a pack that
is switched on again goes right after the last pack that precedes it in this baseline and is selected (or first).

**Startup re-apply**: the launcher rewrites options.txt when the pack updates. The state file stores `packVersion`, the
`version` of `<gameDir>/.remined-pack.json` (written by the launcher's pack export, `""` when the file is missing). Once the
title screen first shows, if the state file exists and its `packVersion` differs from the current one, every live item
whose actual state differs from `values` is applied again (one resource reload at most, silent on success, failures only
logged) and the new `packVersion` is saved. On a launch without a pack update the player's own changes stay. Every Apply
also writes `packVersion`. Without a state file nothing changes.

Targets verified against the jars of the VanillaPro pack: `net.irisshaders.iris.api.v0.IrisApi.getInstance().getConfig()`
(`areShadersEnabled()`, `setShadersEnabledAndApply(boolean)`), `net.irisshaders.iris.Iris.getIrisConfig()` ->
`net.irisshaders.iris.config.IrisConfig` (`Optional<String> getShaderPackName()`, `setShaderPackName(String)`, `save()`),
`com.seibel.distanthorizons.api.DhApi$Delayed.configs` -> `IDhApiConfig.graphics()` -> `IDhApiGraphicsConfig`
(`renderingEnabled()`, `chunkRenderDistance()`) -> `IDhApiConfigValue` (`getValue()`, `setValue(Object)`).

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

