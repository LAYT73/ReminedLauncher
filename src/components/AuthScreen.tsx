import { FormEvent, useState } from "react";
import { supabase, supabaseConfigured } from "../lib/supabase";

type Props = {
  onAuthed: () => void;
};

export function AuthScreen({ onAuthed }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        const { error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (err) throw err;
      }
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate-screen auth-screen">
      <div className="gate-panel">
        <p className="gate-kicker">Remined</p>
        <h1 className="gate-title">{mode === "login" ? "Sign in" : "Create account"}</h1>
        <p className="gate-sub">
          Friends-only launcher. Email confirmation is off — sign up and play.
        </p>

        <form className="gate-form" onSubmit={(e) => void submit(e)}>
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
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error ? <p className="gate-error">{error}</p> : null}

          <button type="submit" className="btn-mc gate-submit" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Register"}
          </button>
        </form>

        <button
          type="button"
          className="gate-switch"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
