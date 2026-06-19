import { FormEvent, useState } from "react";

import { login } from "../api/auth";
import type { CurrentUser } from "../types/auth";

type LoginPageProps = {
  onLogin: (user: CurrentUser) => void;
};

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await login(email, password);
      onLogin(response.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="forge-shell">
      <div className="mx-auto grid min-h-screen w-full max-w-md content-center px-6 py-10">
        <form
          className="forge-panel forge-panel-pad grid gap-4"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-1">
            <p className="forge-eyebrow">Dealer Recon</p>
            <h1 className="forge-page-title">Sign in</h1>
          </div>

          {error ? (
            <div className="forge-notice forge-notice-danger">
              {error}
            </div>
          ) : null}

          <label className="forge-field">
            Email
            <input
              className="forge-control"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="forge-field">
            Password
            <input
              className="forge-control"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <button
            className="forge-button-primary"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
