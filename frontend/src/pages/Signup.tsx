import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { Brand } from "../components/ui/Brand";

export default function Signup() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (api.getToken()) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { accessToken, user } = await api.signup(username.trim(), displayName.trim() || undefined);
      signIn(accessToken, user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container">
      <div className="auth-wrap">
        <div className="auth-brand">
          <Brand />
          <div className="auth-title">Join DCash</div>
          <p className="muted">pick a username to get your wallet</p>
        </div>
        <section className="auth-card glass">
          <form onSubmit={submit}>
            <label className="field">
              <span>Username</span>
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                placeholder="e.g. penelope_23"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Display name (optional)</span>
              <input
                type="text"
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </button>
            {error ? <p className="error">{error}</p> : null}
          </form>
          <p className="demo-hint">
            3–30 characters: letters, numbers, underscore.
          </p>
        </section>
        <div className="auth-switch">
          <span className="auth-switch-label muted">Already have an account?</span>
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/login")}>
            Sign in
          </button>
        </div>
      </div>
    </main>
  );
}
