export const network = {
  lan: {
    openingTunnel: "Opening Network Play tunnel…",
    hostingStopped: "Hosting stopped",
    hosting: "Hosting — friends can Join you now",
    startFailed: "Could not start Network Play — check the Relay client",
    voiceKeyMissing:
      "Voice is live but Relay key is missing — wait a moment and open LAN again",
  },
  panel: {
    title: "Network Play",
    checking: "Checking",
    ready: "Ready",
    issue: "Issue",
    missing: "Missing",
    found: "Found",
    readyForVoiceLan: "Ready for voice + LAN",
    needsAttention: "Needs attention",
    foundTitle: "Found",
    notFound: "Not found",
    checkingRelay: "Checking Relay…",
    binaryFound: "Binary found.",
    tapCheck: "Tap Check to download frpc for voice and Open-to-LAN.",
    voiceLive:
      "Voice room is live — friends hear you while you play; nothing extra to set up.",
    relayHeading: "Remined Relay",
    relayLead:
      "Voice and Open-to-LAN go through <b>Remined Relay</b> on your server. Friends only need Remined.",
    getFrpc: "Get frpc",
    check: "Check",
    checkingBtn: "Checking…",
    refresh: "Refresh",
    frpReleases: "frp releases",
    frpcBinary: "frpc binary",
    autoDetect: "Auto-detect",
    browse: "Browse for frpc binary",
    auto: "Auto",
    pathHint:
      "If auto-find misses it: point at frpc (downloaded under .remined/frp/).",
    hostingBanner: "You are hosting — friends can Join from the Friends tab.",
    hostingBannerPort:
      "You are hosting on port {port} — friends can Join from the Friends tab.",
    hostHeading: "Host",
    hostStep1: "Tap Check to install frpc (once per PC).",
    hostStep2: "Play → open a world → pause → <b>Open to LAN</b>.",
    hostStep3:
      "Remined picks up the port automatically and marks you as <b>Hosting</b>.",
    joinHeading: "Join a friend",
    joinStep1:
      "Friends tab → when they show <b>Hosting</b>, hit <b>Join</b>.",
    joinStep2: "Remined connects the relay and launches their pack into the world.",
  },
  relay: {
    signInRequired: "Sign in to use Remined Relay",
    credsFailed: "Failed to fetch Remined Relay credentials",
    credsEmpty: "Remined Relay credentials response was empty",
    installFailed: "Failed to install Remined Relay (frpc)",
  },
  toast: {
    checkPassed: "Relay check passed",
    checkFailed: "Relay check failed",
    openingReleases: "Opening frp releases (Check auto-downloads frpc)",
    pathSaved: "frpc path saved",
    autoDetect: "Using auto-detect",
  },
};
