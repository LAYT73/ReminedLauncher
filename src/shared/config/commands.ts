/** Names of Tauri commands exposed by the Rust backend (`src-tauri/src/lib.rs`). */
export const CMD = {
  // i18n
  setUiLocale: "set_ui_locale",
  // pack
  listPacks: "list_packs",
  getPackStatus: "get_pack_status",
  fetchPackRelease: "fetch_pack_release",
  fetchPackCatalog: "fetch_pack_catalog",
  ensurePack: "ensure_pack",
  deletePack: "delete_pack",
  openPackFolder: "open_pack_folder",
  cancelInstall: "cancel_install",
  // profile
  getProfile: "get_profile",
  saveProfile: "save_profile",
  probeJava: "probe_java",
  getAppVersion: "get_app_version",
  getRuntimeStatus: "get_runtime_status",
  runOnboarding: "run_onboarding",
  diagLogsDir: "diag_logs_dir",
  // skin
  readSkinDataUrl: "read_skin_data_url",
  materializeSkinPath: "materialize_skin_path",
  resolveMediaCache: "resolve_media_cache",
  cacheMediaUrls: "cache_media_urls",
  // game
  getGamePhase: "get_game_phase",
  launchPack: "launch_pack",
  gameLogStatus: "game_log_status",
  latestCrashReport: "latest_crash_report",
  readLanPort: "read_lan_port",
  // versions
  listVanillaVersions: "list_vanilla_versions",
  installVanillaVersion: "install_vanilla_version",
  listReminedVanillaVersions: "list_remined_vanilla_versions",
  installReminedVanillaVersion: "install_remined_vanilla_version",
  // screenshots
  listScreenshots: "list_screenshots",
  readScreenshot: "read_screenshot",
  screenshotsDir: "screenshots_dir",
  // network / LAN diagnostics (chunked under .remined/network/)
  netLogDir: "net_log_dir",
  netLogAppend: "net_log_append",
  netLogTail: "net_log_tail",
  netLogList: "net_log_list",
  showFriendToast: "show_friend_toast",
  // voice
  voiceLogPath: "voice_log_path",
  voiceLogAppend: "voice_log_append",
  voiceLogTail: "voice_log_tail",
  voiceEnsureRuntime: "voice_ensure_runtime",
  voiceStartLivekit: "voice_start_livekit",
  voiceStartRelay: "voice_start_relay",
  voiceStartHost: "voice_start_host",
  voiceStopHost: "voice_stop_host",
  voiceGuestConnect: "voice_guest_connect",
  voiceGuestDisconnect: "voice_guest_disconnect",
  voiceMintToken: "voice_mint_token",
  // relay (voice + optional LAN tunnel)
  relaySetCreds: "relay_set_creds",
  relayStatus: "relay_status",
  relayCheck: "relay_check",
  relayGetPath: "relay_get_path",
  relaySetPath: "relay_set_path",
  relayLanPort: "relay_lan_port",
  relayCurrentKey: "relay_current_key",
  relayHostState: "relay_host_state",
  relayEnsureHost: "relay_ensure_host",
  relayAttachLan: "relay_attach_lan",
  relayDetachLan: "relay_detach_lan",
  relayApplyLanPort: "relay_apply_lan_port",
  relayStartGameJoin: "relay_start_game_join",
  relayStopGameJoin: "relay_stop_game_join",
  relayStopHost: "relay_stop_host",
} as const;

export type Command = (typeof CMD)[keyof typeof CMD];
