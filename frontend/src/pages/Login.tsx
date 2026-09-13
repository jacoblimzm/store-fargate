import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { Brand } from "../components/ui/Brand";

const DEMO_PASSWORD = "Password123!";
// Odyssey baseline handles (seeded). Emails are `<handle>@dcash.demo`.
const DEMO_HANDLES = ["odysseus", "penelope", "athena", "hermes", "circe", "nestor"];

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  if (api.getToken()) return <Navigate to="/" replace />;

  // Accounts are keyed by handle; the email is always <handle>@dcash.demo. Let
  // people type just the handle (append the domain unless they typed a full email).
  const toEmail = (value: string) => {
    const v = value.trim();
    return v.includes("@") ? v : `${v}@dcash.demo`;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const { accessToken, user } = await api.login(toEmail(login), password);
      signIn(accessToken, user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  // Populate a random seeded Odyssey user's credentials — the user still
  // clicks "Sign in" to log in.
  const simulate = () => {
    const handle = DEMO_HANDLES[Math.floor(Math.random() * DEMO_HANDLES.length)];
    setError("");
    setLogin(handle);
    setPassword(DEMO_PASSWORD);
    setHint(`Filled in @${handle} — click “Sign in” to continue.`);
  };

  return (
    <main className="container">
      <div className="auth-wrap">
        <div className="auth-brand">
          <Brand />
          <div className="auth-title">DCash</div>
          <p className="muted">your futuristic super wallet</p>
        </div>
        <section className="auth-card glass">
          <form onSubmit={submit}>
            <label className="field">
              <span>Username</span>
              <div className="field-affix">
                <input
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="odysseus"
                  required
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                />
                <span className="field-affix-suffix" aria-hidden="true">@dcash.demo</span>
              </div>
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary">Sign in</button>
            <button type="button" className="btn btn-secondary" onClick={simulate}>🎲 Simulate user</button>
            {hint ? <p className="sim-hint" role="status" aria-live="polite">{hint}</p> : null}
            {error ? <p className="error">{error}</p> : null}
          </form>
          <p className="demo-hint">
            Baseline users are Odyssey characters (<code>@odysseus</code>, <code>@athena</code>…),
            password <code>Password123!</code>. Use <strong>Simulate user</strong> to auto-fill one, then Sign in.
          </p>
        </section>
        <div className="auth-switch">
          <span className="auth-switch-label muted">New to DCash?</span>
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/signup")}>
            Create an account
          </button>
        </div>
      </div>
    </main>
  );
}
