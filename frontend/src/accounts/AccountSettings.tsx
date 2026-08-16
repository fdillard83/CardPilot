import { useEffect, useState } from "react";
import type { AccountUser } from "./AccountGate";
import type { AccountPreferences } from "./preferences";

type EbayConnectionStatus = {
  configured: boolean;
  connected: boolean;
  environment: "sandbox" | "production";
  reconnectRequired?: boolean;
};

export function AccountSettings({
  user,
  recoveryMode,
  onRecoveryComplete,
  onClose,
  onAccountDeleted,
  preferences,
  onPreferencesChange,
}: {
  user: AccountUser;
  recoveryMode: boolean;
  onRecoveryComplete: () => void;
  onClose: () => void;
  onAccountDeleted: () => void;
  preferences: AccountPreferences;
  onPreferencesChange: (preferences: AccountPreferences) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [autoValueEnabled, setAutoValueEnabled] = useState(
    preferences.autoValueEnabled,
  );
  const [autoValueLimit, setAutoValueLimit] = useState(
    preferences.autoValueMaxCents === null
      ? ""
      : (preferences.autoValueMaxCents / 100).toFixed(2),
  );
  const [preferenceStatus, setPreferenceStatus] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [ebayStatus, setEbayStatus] = useState<EbayConnectionStatus | null>(null);
  const [ebayBusy, setEbayBusy] = useState(false);
  const [ebayError, setEbayError] = useState<string | null>(null);

  useEffect(() => {
    if (recoveryMode) return;
    void fetch("/api/ebay/selling/status").then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setEbayStatus(payload);
    }).catch((caught) => setEbayError(caught instanceof Error ? caught.message : "CardPilot could not check the eBay connection."));
  }, [recoveryMode]);

  const connectEbay = async () => {
    setEbayBusy(true); setEbayError(null);
    try {
      const response = await fetch("/api/ebay/selling/authorize", { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error ?? "CardPilot could not start eBay sign-in.");
      window.location.assign(payload.authorizationUrl);
    } catch (caught) {
      setEbayError(caught instanceof Error ? caught.message : "CardPilot could not start eBay sign-in.");
      setEbayBusy(false);
    }
  };

  const disconnectEbay = async () => {
    if (!window.confirm("Disconnect eBay from CardPilot? Existing listings and drafts will not be deleted.")) return;
    setEbayBusy(true); setEbayError(null);
    try {
      const response = await fetch("/api/ebay/selling/connection", { method: "DELETE" });
      if (!response.ok) throw new Error("CardPilot could not disconnect eBay.");
      setEbayStatus((current) => current ? { ...current, connected: false } : current);
    } catch (caught) { setEbayError(caught instanceof Error ? caught.message : "CardPilot could not disconnect eBay."); }
    finally { setEbayBusy(false); }
  };

  const savePreferences = async () => {
    const dollars = Number(autoValueLimit);
    if (autoValueEnabled && (!Number.isFinite(dollars) || dollars <= 0)) {
      setPreferenceError("Enter a dollar limit greater than $0.");
      return;
    }
    setIsSavingPreferences(true);
    setPreferenceError(null);
    setPreferenceStatus(null);
    try {
      const response = await fetch("/api/account/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoValueEnabled,
          autoValueMaxCents: autoValueEnabled ? Math.round(dollars * 100) : null,
          ebayConnectPromptDismissed: preferences.ebayConnectPromptDismissed,
          ebaySellingDefaults: preferences.ebaySellingDefaults,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (AccountPreferences & { error?: string })
        | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? "CardPilot could not save this pricing rule.");
      }
      onPreferencesChange(payload);
      setPreferenceStatus("Your automatic pricing rule has been saved.");
    } catch (caughtError) {
      setPreferenceError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not save this pricing rule.",
      );
    } finally {
      setIsSavingPreferences(false);
    }
  };

  const savePassword = async () => {
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords do not match.");
      return;
    }
    setIsSavingPassword(true);
    setPasswordError(null);
    setPasswordStatus(null);
    try {
      const response = await fetch("/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(!recoveryMode ? { currentPassword } : {}),
          newPassword,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "CardPilot could not update the password.");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordStatus("Your password has been updated.");
      onRecoveryComplete();
    } catch (caughtError) {
      setPasswordError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not update the password.",
      );
    } finally {
      setIsSavingPassword(false);
    }
  };

  const downloadBackup = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const response = await fetch("/api/account/export");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "CardPilot could not prepare the backup.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = match?.[1] ?? "cardpilot-backup.json";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caughtError) {
      setExportError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not prepare the backup.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const deleteAccount = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: deletePassword,
          confirmation: deleteConfirmation,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "CardPilot could not delete the account.");
      }
      onAccountDeleted();
    } catch (caughtError) {
      setDeleteError(
        caughtError instanceof Error
          ? caughtError.message
          : "CardPilot could not delete the account.",
      );
      setIsDeleting(false);
    }
  };

  return (
    <div className="account-settings-backdrop" role="presentation">
      <section
        className="account-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-settings-title"
      >
        <header className="account-settings-heading">
          <div>
            <span className="account-eyebrow">
              {recoveryMode ? "Password recovery" : "Private cloud account"}
            </span>
            <h2 id="account-settings-title">
              {recoveryMode ? "Choose a new password" : "Account settings"}
            </h2>
          </div>
          {!recoveryMode && (
            <button type="button" onClick={onClose} aria-label="Close account settings">
              Close
            </button>
          )}
        </header>

        {!recoveryMode && (
          <div className="account-status-grid">
            <div><span>Email</span><strong>{user.email}</strong></div>
            <div><span>Session</span><strong>Signed in</strong></div>
            <div><span>Storage</span><strong>Private Supabase cloud</strong></div>
          </div>
        )}

        {!recoveryMode && (
          <section className="account-settings-section">
            <h3>eBay seller account</h3>
            <p>Connect eBay to create and manage listings, synchronize paid sales, and update shipment tracking. Connecting eBay is optional.</p>
            {ebayError && <small className="account-inline-error">{ebayError}</small>}
            {ebayStatus?.connected ? <>
              <small className="account-inline-success">Connected to eBay {ebayStatus.environment}.</small>
              <button type="button" disabled={ebayBusy} onClick={() => void disconnectEbay()}>{ebayBusy ? "Working..." : "Disconnect eBay"}</button>
            </> : <button className="primary-action" type="button" disabled={ebayBusy || ebayStatus?.configured === false} onClick={() => void connectEbay()}>{ebayBusy ? "Opening eBay..." : "Connect eBay account"}</button>}
          </section>
        )}

        <section className="account-settings-section">
          <h3>{recoveryMode ? "Reset password" : "Change password"}</h3>
          <div className="account-settings-form">
            {!recoveryMode && (
              <label>
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </label>
            )}
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {passwordError && <small className="account-inline-error">{passwordError}</small>}
            {passwordStatus && <small className="account-inline-success">{passwordStatus}</small>}
            <button
              className="primary-action"
              type="button"
              disabled={
                isSavingPassword ||
                newPassword.length < 8 ||
                confirmPassword.length < 8 ||
                (!recoveryMode && currentPassword.length < 8)
              }
              onClick={() => void savePassword()}
            >
              {isSavingPassword ? "Saving..." : "Save new password"}
            </button>
          </div>
        </section>

        {!recoveryMode && (
          <>
            <section className="account-settings-section">
              <h3>Automatic values</h3>
              <p>
                Let CardPilot save its recommended value automatically for lower-value
                cards. Recommendations above your limit still wait for your review.
              </p>
              <div className="account-settings-form">
                <label className="account-toggle-row">
                  <input
                    type="checkbox"
                    checked={autoValueEnabled}
                    onChange={(event) => setAutoValueEnabled(event.target.checked)}
                  />
                  Automatically save lower card values
                </label>
                {autoValueEnabled && (
                  <label>
                    Automatically save recommendations at or below
                    <input
                      type="number"
                      min="0.01"
                      max="1000000"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="25.00"
                      value={autoValueLimit}
                      onChange={(event) => setAutoValueLimit(event.target.value)}
                    />
                  </label>
                )}
                {preferenceError && <small className="account-inline-error">{preferenceError}</small>}
                {preferenceStatus && <small className="account-inline-success">{preferenceStatus}</small>}
                <button
                  className="primary-action"
                  type="button"
                  disabled={isSavingPreferences}
                  onClick={() => void savePreferences()}
                >
                  {isSavingPreferences ? "Saving..." : "Save pricing rule"}
                </button>
              </div>
            </section>

            <section className="account-settings-section">
              <h3>Personal backup</h3>
              <p>Download your card details and original private images in one JSON backup file.</p>
              {exportError && <small className="account-inline-error">{exportError}</small>}
              <button type="button" disabled={isExporting} onClick={() => void downloadBackup()}>
                {isExporting ? "Preparing backup..." : "Download collection backup"}
              </button>
            </section>

            <section className="account-settings-section account-danger-zone">
              <h3>Delete account</h3>
              <p>This permanently removes the account, its collection records, and every private card image.</p>
              <div className="account-settings-form">
                <label>
                  Current password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={deletePassword}
                    onChange={(event) => setDeletePassword(event.target.value)}
                  />
                </label>
                <label>
                  Type DELETE to confirm
                  <input
                    value={deleteConfirmation}
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                  />
                </label>
                {deleteError && <small className="account-inline-error">{deleteError}</small>}
                <button
                  className="account-delete-button"
                  type="button"
                  disabled={
                    isDeleting ||
                    deletePassword.length < 8 ||
                    deleteConfirmation !== "DELETE"
                  }
                  onClick={() => void deleteAccount()}
                >
                  {isDeleting ? "Deleting account..." : "Permanently delete account"}
                </button>
              </div>
            </section>
          </>
        )}
      </section>
    </div>
  );
}
