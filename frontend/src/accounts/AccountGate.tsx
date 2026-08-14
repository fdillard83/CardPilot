import { useEffect, useRef, useState } from "react";

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
  onRecoveryAuthenticated,
}: {
  onAuthenticated: (user: AccountUser) => void;
  onRecoveryAuthenticated: (user: AccountUser) => void;
}) {
  const recoveryHandledRef = useRef(false);
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [isCheckingRecovery, setIsCheckingRecovery] = useState(
    () => window.location.hash.includes("type=recovery"),
  );

  useEffect(() => {
    if (recoveryHandledRef.current) return;
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    if (parameters.get("type") !== "recovery") {
      return;
    }
    recoveryHandledRef.current = true;
    const accessToken = parameters.get("access_token");
    const refreshToken = parameters.get("refresh_token");
    window.history.replaceState(
      {},
      document.title,
      `${window.location.pathname}${window.location.search}`,
    );
    if (!accessToken || !refreshToken) {
      queueMicrotask(() => {
        setError("That password-reset link is incomplete or has expired.");
        setIsCheckingRecovery(false);
      });
      return;
    }
    void fetch("/api/auth/recovery-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, refreshToken }),
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | { user?: AccountUser; error?: string }
          | null;
        if (!response.ok || !payload?.user) {
          throw new Error(payload?.error ?? "That password-reset link is invalid or expired.");
        }
        onRecoveryAuthenticated(payload.user);
      })
      .catch((caughtError) => {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "That password-reset link is invalid or expired.",
        );
        setIsCheckingRecovery(false);
      });
  }, [onRecoveryAuthenticated]);

  const submit = async () => {
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "forgot") {
        const response = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;
        if (!response.ok) {
          throw new Error(payload?.error ?? "CardPilot could not send the reset email.");
        }
        setNotice(
          payload?.message ??
            "If that email belongs to a CardPilot account, a reset link has been sent.",
        );
        return;
      }
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

  if (isCheckingRecovery) {
    return (
      <main className="account-shell">
        <section className="account-card account-loading" aria-live="polite">
          <div className="account-brand">
            <span className="brand-mark">CP</span>
            <span>CardPilot</span>
          </div>
          <p>Opening your secure password reset...</p>
        </section>
      </main>
    );
  }

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
          {mode === "login"
            ? "Welcome back."
            : mode === "signup"
              ? "Create your account."
              : "Reset your password."}
        </h1>
        <p>
          {mode === "login"
            ? "Sign in to scan cards and open your securely stored collection."
            : mode === "signup"
              ? "Your collection records and card photos will be kept private to your account."
              : "Enter your account email and CardPilot will send a secure reset link."}
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
          {mode !== "forgot" && (
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
          )}
          {error && <div className="account-message account-error">{error}</div>}
          {notice && <div className="account-message account-notice">{notice}</div>}
          <button className="primary-action" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Please wait..."
              : mode === "login"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </button>
        </form>
        <div className="account-mode-actions">
          <button
            className="account-mode-button"
            type="button"
            onClick={() => {
              setMode((current) => (current === "signup" ? "login" : "signup"));
              setError(null);
              setNotice(null);
            }}
          >
            {mode === "signup"
              ? "Already have an account? Sign in"
              : "New to CardPilot? Create an account"}
          </button>
          {mode === "login" && (
            <button
              className="account-mode-button"
              type="button"
              onClick={() => {
                setMode("forgot");
                setError(null);
                setNotice(null);
              }}
            >
              Forgot password?
            </button>
          )}
          {mode === "forgot" && (
            <button
              className="account-mode-button"
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
            >
              Return to sign in
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
