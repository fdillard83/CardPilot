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
  const [automationMode, setAutomationMode] = useState(preferences.automationMode);
  const [autopilotMinConfidence, setAutopilotMinConfidence] = useState(String(preferences.autopilotMinConfidence));
  const [autopilotApprovalAbove, setAutopilotApprovalAbove] = useState(
    preferences.autopilotApprovalAboveCents === null ? "" : (preferences.autopilotApprovalAboveCents / 100).toFixed(2),
  );
  const [autopilotMinimumPrice, setAutopilotMinimumPrice] = useState((preferences.autopilotMinimumPriceCents / 100).toFixed(2));
  const [autoRepriceEnabled, setAutoRepriceEnabled] = useState(preferences.autoRepriceEnabled);
  const [autoRepriceAfterDays, setAutoRepriceAfterDays] = useState(String(preferences.autoRepriceAfterDays));
  const [autoRepriceFloorPercent, setAutoRepriceFloorPercent] = useState(String(preferences.autoRepriceFloorPercent));
  const [autoListingOptimizationEnabled, setAutoListingOptimizationEnabled] = useState(preferences.autoListingOptimizationEnabled);
  const [exactPriceUndercutCents, setExactPriceUndercutCents] = useState(String(preferences.exactPriceUndercutCents));
  const [listingLowImpressionDays, setListingLowImpressionDays] = useState(String(preferences.listingLowImpressionDays));
  const [listingLowImpressionCount, setListingLowImpressionCount] = useState(String(preferences.listingLowImpressionCount));
  const [listingCtrMinimumImpressions, setListingCtrMinimumImpressions] = useState(String(preferences.listingCtrMinimumImpressions));
  const [listingLowCtrPercent, setListingLowCtrPercent] = useState(String(preferences.listingLowCtrPercent));
  const [listingViewsWithoutWatchers, setListingViewsWithoutWatchers] = useState(String(preferences.listingViewsWithoutWatchers));
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
  const [pricingStrategy, setPricingStrategy] = useState(preferences.ebaySellingDefaults.pricingStrategy);
  const [sellFasterBelow, setSellFasterBelow] = useState(
    preferences.ebaySellingDefaults.sellFasterBelowCents === null
      ? ""
      : (preferences.ebaySellingDefaults.sellFasterBelowCents / 100).toFixed(2),
  );
  const [promoteListings, setPromoteListings] = useState(preferences.ebaySellingDefaults.promoteListings);
  const [promotionAdRate, setPromotionAdRate] = useState(String(
    Math.min(50, Math.max(1, Math.round(preferences.ebaySellingDefaults.promotionAdRatePercent))),
  ));
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
    const approvalAboveDollars = autopilotApprovalAbove.trim() ? Number(autopilotApprovalAbove) : null;
    const minimumPriceDollars = Number(autopilotMinimumPrice);
    const minimumConfidence = Number(autopilotMinConfidence);
    const repriceDays = Number(autoRepriceAfterDays);
    const repriceFloorPercent = Number(autoRepriceFloorPercent);
    const undercutCents = Number(exactPriceUndercutCents);
    const lowImpressionDays = Number(listingLowImpressionDays);
    const lowImpressionCount = Number(listingLowImpressionCount);
    const ctrMinimumImpressions = Number(listingCtrMinimumImpressions);
    const lowCtrPercent = Number(listingLowCtrPercent);
    const viewsWithoutWatchers = Number(listingViewsWithoutWatchers);
    const fasterBelowDollars = sellFasterBelow.trim() ? Number(sellFasterBelow) : null;
    const adRate = Number(promotionAdRate);
    if (autoValueEnabled && (!Number.isFinite(dollars) || dollars <= 0)) {
      setPreferenceError("Enter a dollar limit greater than $0.");
      return;
    }
    if (fasterBelowDollars !== null && (!Number.isFinite(fasterBelowDollars) || fasterBelowDollars <= 0)) {
      setPreferenceError("Enter a valid low-value quick-sale limit or leave it blank.");
      return;
    }
    if (promoteListings && (!Number.isInteger(adRate) || adRate < 1 || adRate > 50)) {
      setPreferenceError("Choose a whole-number eBay promotion ad rate from 1% through 50%.");
      return;
    }
    if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0.8 || minimumConfidence > 1) {
      setPreferenceError("Choose a valid Autopilot confidence safeguard.");
      return;
    }
    if (!Number.isFinite(minimumPriceDollars) || minimumPriceDollars <= 0) {
      setPreferenceError("Enter the lowest price Autopilot may publish.");
      return;
    }
    if (approvalAboveDollars !== null && (!Number.isFinite(approvalAboveDollars) || approvalAboveDollars <= 0)) {
      setPreferenceError("Enter a valid approval threshold or leave it blank.");
      return;
    }
    if (autoRepriceEnabled && (!Number.isInteger(repriceDays) || repriceDays < 1 || repriceDays > 365)) {
      setPreferenceError("Choose automatic repricing after 1 through 365 days.");
      return;
    }
    if (autoRepriceEnabled && (!Number.isInteger(repriceFloorPercent) || repriceFloorPercent < 50 || repriceFloorPercent > 100)) {
      setPreferenceError("Choose a repricing floor from 50% through 100% of the original listing price.");
      return;
    }
    if (!Number.isInteger(undercutCents) || undercutCents < 1 || undercutCents > 500) {
      setPreferenceError("Choose an exact-card undercut from 1 through 500 cents.");
      return;
    }
    if (!Number.isInteger(lowImpressionDays) || lowImpressionDays < 1 || lowImpressionDays > 90 || !Number.isInteger(lowImpressionCount) || lowImpressionCount < 0 || lowImpressionCount > 100000) {
      setPreferenceError("Choose valid low-impression days and impression limits.");
      return;
    }
    if (!Number.isInteger(ctrMinimumImpressions) || ctrMinimumImpressions < 1 || ctrMinimumImpressions > 100000 || !Number.isFinite(lowCtrPercent) || lowCtrPercent < 0.1 || lowCtrPercent > 25) {
      setPreferenceError("Choose valid click-through impression and percentage limits.");
      return;
    }
    if (!Number.isInteger(viewsWithoutWatchers) || viewsWithoutWatchers < 1 || viewsWithoutWatchers > 100000) {
      setPreferenceError("Choose a valid view threshold.");
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
          automationMode,
          autopilotMinConfidence: minimumConfidence,
          autopilotApprovalAboveCents: approvalAboveDollars === null ? null : Math.round(approvalAboveDollars * 100),
          autopilotMinimumPriceCents: Math.round(minimumPriceDollars * 100),
          autoRepriceEnabled,
          autoRepriceAfterDays: repriceDays,
          autoRepriceFloorPercent: repriceFloorPercent,
          autoListingOptimizationEnabled,
          exactPriceUndercutCents: undercutCents,
          listingLowImpressionDays: lowImpressionDays,
          listingLowImpressionCount: lowImpressionCount,
          listingCtrMinimumImpressions: ctrMinimumImpressions,
          listingLowCtrPercent: lowCtrPercent,
          listingViewsWithoutWatchers: viewsWithoutWatchers,
          autoValueEnabled,
          autoValueMaxCents: autoValueEnabled ? Math.round(dollars * 100) : null,
          ebayConnectPromptDismissed: preferences.ebayConnectPromptDismissed,
          ebaySellingDefaults: {
            ...preferences.ebaySellingDefaults,
            pricingStrategy,
            sellFasterBelowCents: fasterBelowDollars === null ? null : Math.round(fasterBelowDollars * 100),
            promoteListings,
            promotionAdRatePercent: adRate,
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (AccountPreferences & { error?: string })
        | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? "CardPilot could not save this pricing rule.");
      }
      onPreferencesChange(payload);
      setPreferenceStatus("Your Autopilot and selling preferences have been saved.");
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
              <h3>CardPilot Autopilot</h3>
              <p>
                Choose whether CardPilot should automatically identify, value, and prepare high-confidence cards or let you review each step.
              </p>
              <div className="account-settings-form">
                <label>
                  After I submit a card
                  <select value={automationMode} onChange={(event) => setAutomationMode(event.target.value as typeof automationMode)}>
                    <option value="autopilot">Autopilot — identify, price, and prepare the listing</option>
                    <option value="preview">Preview — prepare the card and wait for my approval</option>
                  </select>
                </label>
                {automationMode === "autopilot" && <>
                  <label>
                    Minimum identification confidence
                    <select value={autopilotMinConfidence} onChange={(event) => setAutopilotMinConfidence(event.target.value)}>
                      <option value="0.95">95% — high confidence</option>
                      <option value="0.97">97% — stricter</option>
                      <option value="0.99">99% — strictest</option>
                    </select>
                    <small>Cards below this level go to Needs attention instead of becoming publish-ready.</small>
                  </label>
                  <small>During testing, every completed listing still requires you to press the eBay publish button.</small>
                  <label>
                    Ask for approval when a card is worth more than
                    <input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="Leave blank for no value limit" value={autopilotApprovalAbove} onChange={(event) => setAutopilotApprovalAbove(event.target.value)} />
                  </label>
                  <label>
                    Never publish below
                    <input type="number" min="0.01" step="0.01" inputMode="decimal" value={autopilotMinimumPrice} onChange={(event) => setAutopilotMinimumPrice(event.target.value)} />
                    <small>This is a hard floor even when Sell faster is selected.</small>
                  </label>
                  <label className="account-toggle-row">
                    <input type="checkbox" checked={autoRepriceEnabled} onChange={(event) => setAutoRepriceEnabled(event.target.checked)} />
                    Reprice unsold fixed-price listings automatically
                  </label>
                  {autoRepriceEnabled && <>
                    <label>
                      Recheck an unsold listing after
                      <input type="number" min="1" max="365" step="1" value={autoRepriceAfterDays} onChange={(event) => setAutoRepriceAfterDays(event.target.value)} />
                      <small>Days after publication.</small>
                    </label>
                    <label>
                      Never reduce below this percentage of its original price
                      <input type="number" min="50" max="100" step="1" value={autoRepriceFloorPercent} onChange={(event) => setAutoRepriceFloorPercent(event.target.value)} />
                    </label>
                  </>}
                </>}
                <div className="account-rule-heading">
                  <strong>Active-listing intervention rules</strong>
                  <small>Suggested defaults. CardPilot uses these to diagnose listings; automatic price changes still require the automation switch above.</small>
                </div>
                <label className="account-toggle-row">
                  <input type="checkbox" checked={autoListingOptimizationEnabled} onChange={(event) => setAutoListingOptimizationEnabled(event.target.checked)} />
                  Automatically apply safe title, card-detail, photo, and default-promotion improvements when these thresholds are reached
                </label>
                {autoListingOptimizationEnabled && <small>Only evidence-backed changes are applied. Promotion is added automatically only when “Promote new eligible listings” is enabled below.</small>}
                <label>
                  Flag low visibility after this many days
                  <input type="number" min="1" max="90" step="1" value={listingLowImpressionDays} onChange={(event) => setListingLowImpressionDays(event.target.value)} />
                </label>
                <label>
                  Low visibility means fewer than this many impressions
                  <input type="number" min="0" max="100000" step="1" value={listingLowImpressionCount} onChange={(event) => setListingLowImpressionCount(event.target.value)} />
                </label>
                <label>
                  Evaluate click-through after this many impressions
                  <input type="number" min="1" max="100000" step="1" value={listingCtrMinimumImpressions} onChange={(event) => setListingCtrMinimumImpressions(event.target.value)} />
                </label>
                <label>
                  Flag click-through below
                  <input type="number" min="0.1" max="25" step="0.1" value={listingLowCtrPercent} onChange={(event) => setListingLowCtrPercent(event.target.value)} />
                  <small>Percent of impressions that become listing views.</small>
                </label>
                <label>
                  Flag interest after this many views with no watchers
                  <input type="number" min="1" max="100000" step="1" value={listingViewsWithoutWatchers} onChange={(event) => setListingViewsWithoutWatchers(event.target.value)} />
                </label>
                <label>
                  Price below the lowest exact delivered price by
                  <div className="account-inline-unit"><input type="number" min="1" max="500" step="1" value={exactPriceUndercutCents} onChange={(event) => setExactPriceUndercutCents(event.target.value)} /><span>cents</span></div>
                  <small>CardPilot subtracts your buyer-paid shipping before calculating the live item price.</small>
                </label>
              </div>
            </section>

            <section className="account-settings-section">
              <h3>Pricing and promotion</h3>
              <p>
                Let CardPilot save its recommended value automatically for lower-value
                cards. Recommendations above your limit still wait for your review, and
                you can revise any automatically saved value later.
              </p>
              <div className="account-settings-form">
                <label>
                  Default selling goal
                  <select value={pricingStrategy} onChange={(event) => setPricingStrategy(event.target.value as typeof pricingStrategy)}>
                    <option value="sell_faster">Sell faster — price near the market floor</option>
                    <option value="balanced">Balanced — price near the market midpoint</option>
                    <option value="maximize_value">Maximize value — accept a slower sale</option>
                  </select>
                </label>
                <label>
                  Always use Sell faster for cards at or below
                  <input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="5.00" value={sellFasterBelow} onChange={(event) => setSellFasterBelow(event.target.value)} />
                  <small>Optional. This overrides the default goal for lower-value cards.</small>
                </label>
                <label className="account-toggle-row">
                  <input type="checkbox" checked={promoteListings} onChange={(event) => setPromoteListings(event.target.checked)} />
                  Promote new eligible listings on eBay by default
                </label>
                {promoteListings && <label>
                  Promoted Listings ad rate
                  <select value={promotionAdRate} onChange={(event) => setPromotionAdRate(event.target.value)}>
                    {Array.from({ length: 50 }, (_, index) => index + 1).map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
                  </select>
                  <small>Percent of the sale charged by eBay when a promoted interaction receives sale attribution.</small>
                </label>}
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
                  {isSavingPreferences ? "Saving..." : "Save Autopilot preferences"}
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
