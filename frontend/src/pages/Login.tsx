import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";

const DEMO_PASSWORD = "Password123!";
const DEMO_USERS = [
  "ada@pay2play.test",
  "grace@pay2play.test",
  "alan@pay2play.test",
  "katherine@pay2play.test",
  "margaret@pay2play.test",
  "linus@pay2play.test",
];

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  if (api.getToken()) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setHint("");
    try {
      const { accessToken, user } = await api.login(email.trim(), password);
      signIn(accessToken, user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  const simulate = () => {
    const picked = DEMO_USERS[Math.floor(Math.random() * DEMO_USERS.length)];
    setError("");
    setEmail(picked);
    setPassword(DEMO_PASSWORD);
    setHint(`Filled in ${picked}. Click “Sign in” to continue.`);
  };

  return (
    <main className="container">
      <section className="card auth-card">
        <h1>Welcome back</h1>
        <p className="muted">Sign in to your DCash account.</p>
        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary">Sign in</button>
          <button type="button" className="btn btn-secondary" onClick={simulate}>🎲 Simulate user</button>
          {hint ? <p className="muted sim-hint" role="status" aria-live="polite">{hint}</p> : null}
          {error ? <p className="error">{error}</p> : null}
        </form>
        <p className="muted demo-hint">
          Every demo user's password is <code>Password123!</code>. Use <strong>Simulate user</strong> to
          auto-fill a random one's credentials, then click <strong>Sign in</strong>.
        </p>
      </section>
    </main>
  );
}
