import { t } from "@/shared/i18n";

/**
 * User-facing copy that is reused or produced by non-UI code. Strings live in
 * `shared/i18n/en|ru`; each group below is a getter so values resolve through
 * the current locale at access time. Call sites are unchanged.
 */
export const MSG = {
  get offline() {
    return {
      packUpdates: t("common.offline.packUpdates"),
      updateCheck: t("common.offline.updateCheck"),
      install: t("common.offline.install"),
      usernameSync: t("common.offline.usernameSync"),
      skinSync: t("common.offline.skinSync"),
      signInForSkin: t("common.offline.signInForSkin"),
      friends: t("common.offline.friends"),
      friendsSignedOut: t("common.offline.friendsSignedOut"),
      network: t("common.offline.network"),
      voice: t("common.offline.voice"),
      voiceSignedOut: t("common.offline.voiceSignedOut"),
      chipHint: t("common.offline.chipHint"),
      accountNote: t("common.offline.accountNote"),
      leaveOffline: t("common.offline.leaveOffline"),
      signOut: t("common.offline.signOut"),
    };
  },
  get boot() {
    return {
      usingCache: t("auth.boot.usingCache"),
      cloudUnreachable: t("auth.boot.cloudUnreachable"),
      cloudUnreachableAfterAuth: t("auth.boot.cloudUnreachableAfterAuth"),
      offlineMode: t("auth.boot.offlineMode"),
      noCachedAccount: t("auth.boot.noCachedAccount"),
      hintOfflineCanContinue: t("auth.boot.hintOfflineCanContinue"),
      hintOfflineNeedsSignIn: t("auth.boot.hintOfflineNeedsSignIn"),
      hintCloudUnreachable: t("auth.boot.hintCloudUnreachable"),
      connectionLost: t("auth.boot.connectionLost"),
      backOnlineSignIn: t("auth.boot.backOnlineSignIn"),
      backOnlineSignInShort: t("auth.boot.backOnlineSignInShort"),
      backOnline: t("auth.boot.backOnline"),
      stillOffline: t("auth.boot.stillOffline"),
    };
  },
  get install() {
    return {
      preparing: t("pack.install.preparing"),
      updatingPack: t("pack.install.updatingPack"),
      packReady: t("pack.install.packReady"),
      readyToPlay: t("pack.install.readyToPlay"),
      cancelled: t("pack.install.cancelled"),
      deletingPack: t("pack.install.deletingPack"),
      packDeleted: t("pack.install.packDeleted"),
      installationRemoved: t("pack.install.installationRemoved"),
      checkingPackUpdate: t("pack.install.checkingPackUpdate"),
      updatingTo: (v: string) => t("pack.install.updatingTo", { v }),
      downloading: (v: string) => t("pack.install.downloading", { v }),
      installingVersion: (v: string) => t("pack.install.installingVersion", { v }),
      installingReminedVanilla: (v: string) =>
        t("pack.install.installingReminedVanilla", { v }),
      deleteConfirm: (id: string) => t("pack.install.deleteConfirm", { id }),
      deleteTitle: t("pack.install.deleteTitle"),
      deleteOk: t("pack.install.deleteOk"),
      deleteCancel: t("pack.install.deleteCancel"),
    };
  },
  get launch() {
    return {
      preparing: t("pack.launch.preparing"),
      joiningFriend: t("pack.launch.joiningFriend"),
      joined: t("pack.launch.joined"),
      usernameLength: t("pack.launch.usernameLength"),
      connectingNetwork: t("pack.launch.connectingNetwork"),
      installRelay: t("pack.launch.installRelay"),
      joining: (name: string) => t("pack.launch.joining", { name }),
      crashed: (summary: string) => t("pack.launch.crashed", { summary }),
      prepareFailed: t("pack.launch.prepareFailed"),
    };
  },
  get lan() {
    return {
      openingTunnel: t("network.lan.openingTunnel"),
      hostingStopped: t("network.lan.hostingStopped"),
      hosting: t("network.lan.hosting"),
      startFailed: t("network.lan.startFailed"),
    };
  },
  get profile() {
    return {
      usernameUpdated: t("profile.usernameUpdated"),
      skinSaved: t("profile.skinSaved"),
      capeSaved: t("profile.capeSaved"),
      copiedId: t("profile.copiedId"),
      copyIdTitle: t("profile.copyIdTitle"),
      copyFailed: t("profile.copyFailed"),
    };
  },
  get update() {
    return {
      checking: t("settings.update.checking"),
      latest: t("settings.update.latest"),
      available: (v: string) => t("settings.update.available", { v }),
      downloading: (v: string) => t("settings.update.downloading", { v }),
      restarting: t("settings.update.restarting"),
    };
  },
  get common() {
    return { somethingWentWrong: t("common.somethingWentWrong") };
  },
  get auth() {
    return { usernameTaken: t("auth.usernameTaken") };
  },
  get voice() {
    return {
      connectingVoice: t("voice.connectingVoice"),
      startingServer: t("voice.startingServer"),
      openingRelay: t("voice.openingRelay"),
      copiedShareCode: t("voice.copiedShareCode"),
      mute: t("voice.mute"),
      unmute: t("voice.unmute"),
      clickToHear: t("voice.clickToHear"),
      clickToHearHint: t("voice.clickToHearHint"),
      installRelay: t("voice.installRelay"),
      alreadyInRoom: t("voice.alreadyInRoom"),
    };
  },
};
