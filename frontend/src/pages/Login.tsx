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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [simulating, setSimulating] = useState(false);

  if (api.getToken()) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const { accessToken, user } = await api.login(email.trim(), password);
      signIn(accessToken, user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  // One-click quick login: pick a random seeded Odyssey user and sign in
  // immediately — the fastest path for a live demo.
  const simulate = async () => {
    const handle = DEMO_HANDLES[Math.floor(Math.random() * DEMO_HANDLES.length)];
    const picked = `${handle}@dcash.demo`;
    setError("");
    setEmail(picked);
    setPassword(DEMO_PASSWORD);
    setSimulating(true);
    try {
      const { accessToken, user } = await api.login(picked, DEMO_PASSWORD);
      signIn(accessToken, user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulate login failed");
      setSimulating(false);
    }
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
              <span>Email</span>
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary">Sign in</button>
            <button type="button" className="btn btn-secondary" onClick={simulate} disabled={simulating}>
              {simulating ? "Signing in…" : "🎲 Simulate user"}
            </button>
            {error ? <p className="error">{error}</p> : null}
          </form>
          <p className="demo-hint">
            Baseline users are Odyssey characters (<code>@odysseus</code>, <code>@athena</code>…),
            password <code>Password123!</code>. Use <strong>Simulate user</strong> to sign in instantly.
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
