export { useSessionStore, selectUserId } from "./model/store";
export type { Gate } from "./model/types";
export {
  cacheAccount,
  cacheCatalog,
  cacheOnboardingCompleted,
  canEnterOffline,
  clearOfflineAccount,
  readOfflineCache,
  type OfflineAccount,
} from "./lib/offlineCache";
export {
  setPresence,
  PRESENCE_STALE_MS,
  sessionsHaveVoiceColumn,
  markVoiceColumnMissing,
  sessionsHaveActivityColumn,
  markActivityColumnMissing,
  type PresenceStatus,
} from "./api/presence";
export { isPresenceFresh } from "./api/presence";
