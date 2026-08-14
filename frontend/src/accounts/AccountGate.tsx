import { useState } from "react";

export type AccountUser = {
  id: string;
  email: string | null;
};

export type AccountSession = {
  mode: "local" | "supabase";
  user: AccountUser | null;
};

export function AccountGate({
  onAuthenticated,
}: {
  onAuthenticated: (user: AccountUser) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  const submit = async () => {
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        mode === "login" ? "/api/auth/login" : "/api/auth/signup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            user?: AccountUser | null;
            confirmationRequired?: boolean;
            error?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "CardPilot could not continue.");
      }
      if (payload?.confirmationRequired) {
        setConfirmationEmail(email.trim());
        setPassword("");
        return;
      }
      if (!payload?.user) {
        throw new Error("CardPilot did not receive an account session.");
      }
      onAuthenticated(payload.user);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not continue.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (confirmationEmail) {
    return (
      <main className="account-shell">
        <section className="account-card account-confirmation" aria-labelledby="confirmation-title">
          <div className="account-brand">
            <span className="brand-mark">CP</span>
            <span>CardPilot</span>
          </div>
          <span className="account-confirmation-icon" aria-hidden="true">✓</span>
          <span className="account-eyebrow">Registration received</span>
          <h1 id="confirmation-title">Check your email.</h1>
          <p>
            CardPilot sent a confirmation link to <strong>{confirmationEmail}</strong>.
            Open that email and confirm your account before signing in.
          </p>
          <div className="account-confirmation-help">
            <strong>Didn't receive it?</strong>
            <span>Wait a few minutes, then check your spam or junk folder.</span>
          </div>
          <button
            className="primary-action"
            type="button"
            onClick={() => {
              setConfirmationEmail(null);
              setMode("login");
              setNotice("After confirming the email, sign in below.");
            }}
          >
            Return to sign in
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="account-shell">
      <section className="account-card" aria-labelledby="account-title">
        <div className="account-brand">
          <span className="brand-mark">CP</span>
          <span>CardPilot</span>
        </div>
        <span className="account-eyebrow">Private collection cloud</span>
        <h1 id="account-title">
          {mode === "login" ? "Welcome back." : "Create your account."}
        </h1>
        <p>
          {mode === "login"
            ? "Sign in to scan cards and open your securely stored collection."
            : "Your collection records and card photos will be kept private to your account."}
        </p>
        <form
          className="account-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {mode === "signup" && <small>Use at least 8 characters.</small>}
          </label>
          {error && <div className="account-message account-error">{error}</div>}
          {notice && <div className="account-message account-notice">{notice}</div>}
          <button className="primary-action" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Please wait..."
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
        <button
          className="account-mode-button"
          type="button"
          onClick={() => {
            setMode((current) => (current === "login" ? "signup" : "login"));
            setError(null);
            setNotice(null);
          }}
        >
          {mode === "login"
            ? "New to CardPilot? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}
