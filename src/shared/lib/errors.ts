import { t, type TKey } from "@/shared/i18n";

/** Plain-text message for any thrown value, safe to show in the UI. */
export function errorMessage(
  err: unknown,
  fallback = t("common.somethingWentWrong"),
): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error:\s*/, "").trim() || fallback;
}

const SERVER_ERRORS: Record<string, TKey> = {
  "not authenticated": "common.server.notAuthenticated",
  "invalid pack_id": "common.server.invalidPackId",
  unauthorized: "common.server.unauthorized",
  "method not allowed": "common.server.methodNotAllowed",
  "server misconfigured": "common.server.serverMisconfigured",
  "relay secrets not configured": "common.server.relaySecretsNotConfigured",
};

/** Map known English server messages to localized text; unknown ones pass through. */
export function localizeServerError(msg: string): string {
  const key = SERVER_ERRORS[msg.trim().replace(/[.!]+$/, "").toLowerCase()];
  return key ? t(key) : msg;
}

/** True when an invoke() error is the backend reporting a user cancel. */
export function isCancelledError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // en "Cancelled" / ru "Отменено" (see src-tauri/src/i18n.rs progress.cancelled)
  return /cancelled|отмен/i.test(msg);
}
