export const shell = {
  tabs: {
    play: "Play",
    screenshots: "Shots",
    friends: "Friends",
    network: "Network",
    voice: "Party",
  },
  rail: {
    home: "Home",
    pack: "Pack",
    vanilla: "Vanilla Minecraft",
    reminedVanilla: "Remined Vanilla",
    installations: "Installations",
    settings: "Settings",
  },
  nav: {
    pendingInvites: {
      one: "{count} pending invite",
      other: "{count} pending invites",
    },
    friendRequests: {
      one: "{count} friend request",
      other: "{count} friend requests",
    },
    friendsOnline: {
      one: "Friends, {count} online",
      other: "Friends, {count} online",
    },
  },
  chip: {
    offlineTitle: "Offline — click to check connection",
    offlineAria: "Offline mode — check connection",
    profile: "Profile",
  },
  tray: {
    launching: "Launching",
    loading: "Loading",
    inMenu: "In menu",
    hostingLan: "Hosting LAN",
    lan: "LAN",
    server: "Server",
    world: "World",
    copyPublic: "Click to copy public address (port-forward / direct connect)",
    resolvingIp: "Resolving public IP…",
    copyTunnel: "Click to copy (local tunnel is 127.0.0.1; showing public IP)",
    copyAddress: "Click to copy address",
    copy: "Click to copy",
    liveStatus: "Live game status",
    copied: "Copied address",
    copyFailed: "Could not copy",
    crashReport: "Crash report",
    crashTitle: "{summary} — click to show the crash report",
  },
  routeError: {
    title: "Something broke",
    reload: "Reload launcher",
  },
  ui: {
    dismiss: "Dismiss",
    hideHelp: "Hide help",
    showHelp: "Show help",
  },
  /** Native OS notifications (sent only while the launcher window is in the background). */
  notify: {
    packReady: {
      title: "Pack ready",
      body: "{name} is installed and ready to play.",
    },
    launcherUpdate: {
      title: "Launcher update available",
      body: "Remined {v} is ready to install.",
    },
    friendRequest: {
      title: "Friend request",
      body: "{name} wants to be your friend.",
    },
    partyInvite: {
      title: "Party invite",
    },
    partyWorld: {
      title: "{host} opened the world",
      body: "Join from the Party tab.",
    },
  },
};
