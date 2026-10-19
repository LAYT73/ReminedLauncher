# Immersion & interactivity

What shipped, and what is still an idea. Not a commitment.

## Shipped

| Feature | Where |
|---|---|
| Live game status chip (loading / menu / world / server / hosting LAN) | `gamewatch.rs` + `hooks/useGameWatch.ts` + `GameTray` |
| Crash toast + “Crash report” shortcut from the game's crash reports | `gamewatch::latest_crash_report` |
| Automatic Open-to-LAN → Porthole expose → share code | `hooks/useLanHosting.ts` |
| Rich presence: pack, hosting, “in voice” | `sessions` (+ `010`) / `usePresenceHeartbeat` |
| Per-person volume, mute/deafen badges on the member grid | `components/voice/VoiceMembers.tsx` |
| Push-to-talk (global shortcut, works over Minecraft) | `lib/pushToTalk.ts` |
| Camera and screen share (peer-to-peer via LiveKit) | `voice/VoiceToolbar.tsx` |
| Voice room ↔ Network Play link (same Porthole lobby) | “Net” button / `onOpenNetworkPlay` |
| Local screenshots viewer (Shots tab, never uploaded) | `ScreenshotsPanel.tsx` |
| Achievement-style toasts (first voice room, first Network join, …) | `lib/achievements.ts` |
| Discord-style member grid in Remined stone UI | `voice/*` |

Voice chat stays text-only and nothing is uploaded: free-tier storage limits.

## Backlog

| Idea | Notes |
|---|---|
| Noise suppression / echo (LiveKit DSP or RNNoise) | Medium value |
| Speaking pulse on Friends presence when in the same voice room | Small |
| “Now playing” ambient on Home while Minecraft runs | Small |
| Resource pack / shader quick toggle (remember last Iris pack) | Remined Vanilla already ships Iris |
| Shared waypoint / seed card posted to room chat | Needs a log parser or command bridge |
