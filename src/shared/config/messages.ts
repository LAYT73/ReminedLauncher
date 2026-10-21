/**
 * User-facing copy that is reused or produced by non-UI code. Keep strings
 * here instead of inlining them, so wording stays consistent.
 */
export const MSG = {
  offline: {
    packUpdates: "Pack updates need internet",
    updateCheck: "Update check needs internet",
    install: "Install needs internet",
    usernameSync: "Username sync needs internet",
    skinSync: "Skins sync needs internet — go online and sign in",
    signInForSkin: "Sign in to save a skin",
    friends: "Friends need an internet connection. You’re in offline mode.",
    friendsSignedOut: "Sign in to see friends.",
    network:
      "Network Play needs internet and Steam. You’re in offline mode — local worlds still work from Play.",
    voice: "Voice rooms need internet and Steam. You're in offline mode.",
    voiceSignedOut: "Sign in to use voice rooms.",
    chipHint:
      "You’re offline — cached account & packs only. Friends, skins, and updates need internet.",
    accountNote:
      "Offline — playing with your cached account. Sign in when online to sync friends and skins.",
    leaveOffline: "Leave offline",
    signOut: "Sign out",
  },
  boot: {
    usingCache: "You’re offline — using cached account",
    cloudUnreachable: "Cloud unreachable — offline mode",
    cloudUnreachableAfterAuth: "Couldn’t reach cloud — offline mode",
    offlineMode: "Offline mode",
    noCachedAccount: "No cached account for offline play",
    hintOfflineCanContinue:
      "No network — you can continue offline with your last account.",
    hintOfflineNeedsSignIn:
      "No network. Sign in once online to enable offline play.",
    hintCloudUnreachable: "Cloud unreachable. Try again when you’re online.",
    connectionLost: "Connection lost — offline mode",
    backOnlineSignIn: "Back online — sign in again to sync friends & skins",
    backOnlineSignInShort: "Back online — sign in to sync",
    backOnline: "Back online",
    stillOffline: "Still can’t reach the cloud — staying offline",
  },
  install: {
    preparing: "Preparing…",
    updatingPack: "Updating pack…",
    packReady: "Pack ready",
    readyToPlay: "Ready to play",
    cancelled: "Cancelled",
    deletingPack: "Deleting pack…",
    packDeleted: "Pack deleted",
    installationRemoved: "Installation removed",
    checkingPackUpdate: "Checking pack update…",
    updatingTo: (v: string) => `Updating to ${v}…`,
    downloading: (v: string) => `Downloading ${v}…`,
    installingVersion: (v: string) => `Installing ${v}…`,
    installingReminedVanilla: (v: string) => `Installing Remined Vanilla ${v}…`,
    deleteConfirm: (id: string) =>
      `Delete installation “${id}”? Saves in that folder will be removed.`,
    deleteTitle: "Delete installation",
    deleteOk: "Delete",
    deleteCancel: "Cancel",
  },
  launch: {
    preparing: "Preparing to launch…",
    joiningFriend: "Joining friend…",
    joined: "Joined — connecting in Minecraft",
    usernameLength: "3–16 characters",
    connectingNetwork: "Connecting Network Play…",
    installPorthole: "Install Porthole from Network Play first",
    joining: (name: string) => `Joining ${name}…`,
    crashed: (summary: string) => `Minecraft crashed: ${summary}`,
  },
  lan: {
    openingTunnel: "Opening Network Play tunnel…",
    hostingStopped: "Hosting stopped",
    hosting: "Hosting — friends can Join you now",
    startFailed: "Could not start Network Play — check Steam + Porthole",
  },
  profile: {
    usernameUpdated: "Username updated",
    skinSaved: "Skin saved",
    capeSaved: "Cape saved",
    copiedId: "Copied Remined id",
    copyIdTitle: "Copy Remined id",
    copyFailed: "Couldn’t copy",
  },
  update: {
    checking: "Checking for launcher updates…",
    latest: "Already on the latest launcher",
    available: (v: string) => `Launcher ${v} is available`,
    downloading: (v: string) => `Downloading ${v}…`,
    restarting: "Restarting…",
  },
  common: {
    somethingWentWrong: "Something went wrong",
  },
  auth: {
    usernameTaken: "Username taken — try another",
  },
  voice: {
    connectingVoice: "Connecting voice…",
    startingServer: "Starting voice server…",
    openingPorthole: "Opening Unlim…",
    copiedShareCode: "Copied share code",
    mute: "Mute microphone",
    unmute: "Unmute microphone",
    clickToHear: "Click to hear",
    clickToHearHint: "Browser blocked voice audio — click to restore sound",
    installUnlim: "Install Unlim from Network settings first",
  },
} as const;
