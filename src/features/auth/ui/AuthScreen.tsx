import { FormEvent, useState } from "react";
import brandLogo from "@/shared/assets/logo.png";
import {
  ensureCloudProfile,
  isUsernameAvailable,
  updateCloudUsername,
  validateUsername,
} from "@/entities/profile";
import { supabase, supabaseConfigured } from "@/shared/api/supabase";
import { canEnterOffline, useSessionStore } from "@/entities/session";
import { continueOffline, onAuthed } from "../model/session-actions";
import { MSG } from "@/shared/config/messages";
import { useT } from "@/shared/i18n";

export function AuthScreen() {
  const t = useT();
  const offlineHint = useSessionStore((s) => s.authOfflineHint);
  const canOffline = canEnterOffline();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabaseConfigured) {
      setError(t("auth.screen.supabaseMissing"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) throw err;
      } else {
        const nameErr = validateUsername(username);
        if (nameErr) throw new Error(nameErr);

        const free = await isUsernameAvailable(username);
        if (!free) throw new Error(MSG.auth.usernameTaken);

        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (err) throw err;
        const userId = data.user?.id;
        if (!userId) throw new Error(t("auth.screen.createFailed"));

        await ensureCloudProfile(userId, username.trim());
        await updateCloudUsername(userId, username.trim());
      }
      onAuthed();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : MSG.common.somethingWentWrong;
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate-screen auth-screen">
      <div className="gate-panel">
        <img className="gate-brand-logo" src={brandLogo} alt="Remined" />
        <p className="gate-kicker">Remined</p>
        <h1 className="gate-title">
          {mode === "login" ? t("auth.screen.signIn") : t("auth.screen.createAccount")}
        </h1>
        <p className="gate-sub">
          {t("auth.screen.sub")}
        </p>

        {offlineHint ? (
          <p className="gate-offline-hint" role="status">
            {offlineHint}
          </p>
        ) : null}

        <form className="gate-form" onSubmit={(e) => void submit(e)}>
          {mode === "register" ? (
            <div className="field">
              <label htmlFor="auth-user">{t("auth.screen.username")}</label>
              <input
                id="auth-user"
                type="text"
                autoComplete="username"
                required
                minLength={3}
                maxLength={16}
                spellCheck={false}
                placeholder={t("auth.screen.usernamePlaceholder")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="auth-email">{t("auth.screen.email")}</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="auth-pass">{t("auth.screen.password")}</label>
            <input
              id="auth-pass"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error ? <p className="gate-error">{error}</p> : null}

          <button
            type="submit"
            className="btn-mc ok gate-submit"
            disabled={busy}
          >
            {busy
              ? "…"
              : mode === "login"
                ? t("auth.screen.signIn")
                : t("auth.screen.register")}
          </button>
        </form>

        {canOffline ? (
          <button
            type="button"
            className="btn-mc dim gate-offline-btn"
            disabled={busy}
            onClick={() => void continueOffline()}
          >
            {t("auth.screen.continueOffline")}
          </button>
        ) : null}

        <button
          type="button"
          className="gate-switch"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login"
            ? t("auth.screen.needAccount")
            : t("auth.screen.haveAccount")}
        </button>
      </div>
    </div>
  );
}
