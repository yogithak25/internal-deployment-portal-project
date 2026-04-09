import { FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { signIn } from "../auth/cognito";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const { authenticated, setAuthenticated } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (authenticated) {
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(username, password);
      setAuthenticated(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Deployment Portal</h1>
        <p className="login-sub">Sign in with the email address registered in your organization&apos;s user pool.</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="form-row">
            <label htmlFor="user">Email</label>
            <input
              id="user"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="form-row">
            <label htmlFor="pass">Password</label>
            <input
              id="pass"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="login-actions">
            <button
              type="submit"
              className="btn btn-gradient btn-lg btn-block"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="btn-spinner" aria-hidden />
                  Signing in…
                </>
              ) : (
                <>
                  <span className="btn-submit-icon" aria-hidden>
                    →
                  </span>
                  Sign in to dashboard
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
