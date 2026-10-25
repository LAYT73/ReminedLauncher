# Voice rooms

Voice rooms run a local LiveKit server on the host and expose it through the
Remined Relay. Supabase stores room metadata, members, invitations and chat.
The same Relay carries Minecraft Open-to-LAN TCP traffic and LiveKit TCP/UDP
traffic.

## Ports

| Port | Protocol | Purpose |
|---|---|---|
| `7880` | TCP | LiveKit signalling |
| `7881` | TCP | WebRTC ICE/TCP fallback |
| `7882` | UDP | WebRTC media |

The client connects to LiveKit through loopback. The relay maps the same ports
for guests. If the host also opens a Minecraft LAN session, the LAN port is
attached to the existing relay session; LiveKit is not restarted.

## Host lifecycle

1. Ensure the LiveKit runtime is present; download it if necessary.
2. Start LiveKit and wait for its signalling and RTC endpoints.
3. Create the room record in Supabase.
4. Connect the host client and publish the selected devices.
5. Start the Remined Relay host and publish the share code.

LiveKit must be ready before the relay binds its endpoints.

## Guest lifecycle

1. Accept a room invitation.
2. Pass the share code to the native guest command.
3. The launcher starts the relay visitor locally.
4. Connect the LiveKit client to the loopback endpoint.

Guests do not run relay commands manually.

## Relay operations

The relay client obtains its endpoint and credentials from the authenticated
`relay-creds` Edge Function. The VPS runs `frps` as a systemd service. Relay
secrets are stored in Supabase secrets and are never compiled into the
launcher.

Share codes contain a session identifier and per-session secret. Treat them as
credentials: do not include them in logs, screenshots or issue reports.

## Party

A voice room doubles as a party: the room also carries the shared world.
The launcher tab, page and empty state are labelled "Party" (Пати).

Data model (migration `018_party.sql`):

| Column | Table | Meaning |
|---|---|---|
| `pack_id` | `voice_rooms` | Party pack (Remined catalog id). Null for rooms made by older launchers. |
| `game_state` | `voice_rooms` | Host world: `idle`, `launching`, `in_world`, `open`. |
| `lan_port` | `voice_rooms` | Host LAN port while `game_state = open`. |
| `max_members` | `voice_rooms` | Member cap (default 8). Enforced on insert. |
| `state` | `voice_room_members` | Own party state: `joined`, `installing`, `ready`, `in_game`, `in_world`. |
| `progress` | `voice_room_members` | Install percent while `installing` (throttled to one write per 2 s). |

Who writes what: only the host writes `pack_id`, `game_state` and `lan_port`.
Each member writes only its own `state`, `progress` and `updated_at`.

Host state machine (`game_state`):

| State | Meaning | Host sees |
|---|---|---|
| `idle` | Party game not running | Play |
| `launching` | Party game up, no world yet | Enter a world |
| `in_world` | Singleplayer world loaded, not on LAN | Open to LAN (Esc) |
| `open` | LAN published on `lan_port` | World open |

Guest primary action: `waiting` (host not `open`) → `install` (party pack
missing, progress shown) → `join` (uses the room's share code and `lan_port`
through `joinHostWorld`) → `in world`. Member chips show `joined`, `installing`,
`ready`, `in_game` and `in_world`.

Logic lives in `src/features/voice/lib/partyState.ts` (pure derivations),
`model/usePartyPublisher.ts` (writes) and `model/usePartyActions.ts`
(buttons). Play-game actions reach the feature through the `party` bridge
set by the `voice-host` widget.

### Flows

- **Create (host):** Play on the party pack (or the picker's pack) → the room
  is created with `pack_id` = the selected pack. Pack choices: the Remined
  catalog, installed Vanilla / Remined Vanilla versions, and the current pick.
  The host may change the pack only while nothing runs for the party.
- **Invite:** on the friends list the host sees "Invite to party" for online
  friends (offline friends get no button: a pending invite to someone offline
  usually goes stale before they open the launcher). Without a party the button
  is "Start party": it creates the room and invites that friend once the Relay
  code is ready. Full parties disable invites ("Party is full"); a party still
  starting disables them too. Invites are `voice_invites` rows (same as voice
  room invites), so the banner, toast, desktop notification and in-game notify
  all say "{name} invites you to a party" plus the pack name when known.
- **Open world (host, automatic):** while the party pack runs a single-player
  world (`activity` = `sp`) and the host is not on LAN, the launcher sends
  `open_lan` to the companion mod once per world entry (port = the Relay's
  preferred LAN port). The mod answers `open_lan_result`. On success the game log
  prints "Published LAN server on port N", the existing log watcher attaches the
  Relay LAN tunnel, and `game_state` becomes `open`. The host gets an in-game note
  "World is open for your party". On failure, a missing `open_lan` capability (old
  mod, protocol < 3 or no `caps`) or no reply within 15 s, PartyCard and the
  in-game note show the reason and the manual path (Esc → Open to LAN). Nothing
  is retried until the player leaves and re-enters the world. Guests and
  non-party play never send it.
- **Join (member):** the member card button is "Join {host}" once the host is
  `open`. Install comes first when the party pack is missing; progress shows only
  for the party pack's own install ("Installing…" when the percent is unknown).
  Join uses `joinPartyWorld` → `joinHostWorld` (relay tunnel, then launch or
  in-game connect). A failure toasts the reason and the button returns to Join.
  A member whose other game is running sees "Close the game to join".
- **Member told the world opened:** when `game_state` turns `open` and the
  member is not in that world, the member gets a desktop notification and an
  in-game note "{host} opened the world" with a `[J] Join` action (`party:<roomId>`).
- **Host ended:** guests see "{host} ended the party".
- **Deep link `remined://party/<roomId>`:** `roomId` must be a UUID. If the
  player is already in that party, the voice tab comes forward. Otherwise the
  player joins as a guest: allowed for invitees and the host's accepted
  friends (RLS `voice_room_join_allowed`). A denial shows "You need an invite
  from {host} or to be their friend"; a full or closed party says so. If the
  player is in another party, a banner asks "Leave current party?" first.
- **Invite link:** PartyCard "Copy invite link" copies `remined://party/<roomId>`
  (host and members). It works for the host's friends only.

### Bridge

Protocol v3 adds `open_lan`. The hello reply lists `caps` (`voice`, `head`,
`notify`, `connect`, `open_lan`). The launcher reads `v` and `caps` in
`src-tauri/src/game_bridge.rs` and emits them with the status event
(`{connected, v, caps}`); `game_bridge_info` returns the same payload. Feature
checks use `hasBridgeCap("open_lan")` (`src/shared/lib/gameBridgeStore.ts`).

### Party code map

| Path | Responsibility |
|---|---|
| `src/entities/voice-room/model/party-store.ts` | Party snapshot for the friends list, invited pairs, command queue (`start`, `join`) |
| `src/features/voice/model/usePartyCommands.ts` | Runs queued party commands in the voice feature (it owns the session) |
| `src/features/voice/model/usePartyAutoOpen.ts` | Host auto Open-to-LAN (`open_lan`) and its outcome |
| `src/features/voice/model/usePartyWorldWatch.ts` | Member "host opened the world" notice |
| `src/features/voice/model/usePartyInstall.ts` | Install progress scoped to the party pack |
| `src/features/voice/lib/partyPack.ts` | Pack picker options, pack labels, invite wording |
| `src/features/friends/ui/FriendPartyButton.tsx` | Invite / Start party button on friend rows |
| `src/app/providers/useGameBridgeEffects.ts` | In-game `party:<roomId>` join key → command queue |
| `src/app/providers/useDeepLinkEffects.ts` | `remined://party/<id>` → command queue |

## Implementation

| Path | Responsibility |
|---|---|
| `src-tauri/src/relay.rs` | Relay download, host/visitor lifecycle and share codes |
| `src-tauri/src/voice_runtime.rs` | LiveKit runtime, process and port handling |
| `src-tauri/src/voice_log.rs` | Voice diagnostics |
| `src/features/voice/` | UI and client state |
| `src/entities/voice-room/` | Supabase room, member, invite and message APIs |
| `008`–`010`, `015`, `018`, `019` migrations | Voice schema, RLS, presence, Relay share codes and party state |

## Diagnostics and known limitations

Voice diagnostics:

```text
<root>/.remined/voice/voice.log
```

Relay traffic is routed through the VPS. UDP behavior may be affected by
system-wide TUN products; users may need to exclude Remined from those routes.
Camera and screen sharing additionally depend on operating-system and
WebView permissions.
