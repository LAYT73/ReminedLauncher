import { FormEvent, useState } from "react";
import brandLogo from "../assets/logo.png";
import {
  ensureCloudProfile,
  isUsernameAvailable,
  updateCloudUsername,
  validateUsername,
} from "../lib/cloudProfile";
import { supabase, supabaseConfigured } from "../lib/supabase";

type Props = {
  onAuthed: () => void;
  canOffline?: boolean;
  offlineHint?: string | null;
  onContinueOffline?: () => void;
};

export function AuthScreen({
  onAuthed,
  canOffline,
  offlineHint,
  onContinueOffline,
}: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabaseConfigured) {
      setError("Supabase env missing (VITE_SUPABASE_*)");
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
        if (!free) throw new Error("Username taken — try another");

        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (err) throw err;
        const userId = data.user?.id;
        if (!userId) throw new Error("Could not create account");

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
            : "Something went wrong";
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
          {mode === "login" ? "Sign in" : "Create account"}
        </h1>
        <p className="gate-sub">
          Friends-only launcher. Email confirmation is off — sign up and play.
        </p>

        {offlineHint ? (
          <p className="gate-offline-hint" role="status">
            {offlineHint}
          </p>
        ) : null}

        <form className="gate-form" onSubmit={(e) => void submit(e)}>
          {mode === "register" ? (
            <div className="field">
              <label htmlFor="auth-user">Username</label>
              <input
                id="auth-user"
                type="text"
                autoComplete="username"
                required
                minLength={3}
                maxLength={16}
                spellCheck={false}
                placeholder="3–16 chars"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="auth-email">Email</label>
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
            <label htmlFor="auth-pass">Password</label>
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
            {busy ? "…" : mode === "login" ? "Sign in" : "Register"}
          </button>
        </form>

        {canOffline && onContinueOffline ? (
          <button
            type="button"
            className="btn-mc dim gate-offline-btn"
            disabled={busy}
            onClick={() => onContinueOffline()}
          >
            Continue offline
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
            ? "Need an account? Register"
            : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
