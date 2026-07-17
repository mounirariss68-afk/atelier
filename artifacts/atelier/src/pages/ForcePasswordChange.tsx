import * as React from "react";
import { SectionHead } from "@/components/ui/primitives";
import Logo from "@/components/ui/Logo";
import { useAuth } from "@/lib/auth";

/**
 * Task #5 — shown instead of the app when the signed-in user holds a
 * temporary password. The API's global gate blocks every data route until
 * it is changed, so this screen is not skippable.
 *
 * Task #59 — copy varies by why the change is forced: a brand-new joiner on
 * their first-ever login gets a welcome framing; a partner-reset colleague
 * gets the reset framing.
 */
export default function ForcePasswordChange() {
  const { user, mustChangeReason, clearMustChangePassword, logout } = useAuth();
  const isFirstLogin = mustChangeReason === "joiner";
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (next.length < 10) {
      setError("New password must be at least 10 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) {
        setError(j.message ?? "Could not change password. Try again.");
        return;
      }
      clearMustChangePassword();
      // Full reload so every query starts fresh with the unblocked session.
      window.location.replace("/");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-md border border-border bg-bg-elevate px-3 py-2.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-gold";
  const label =
    "block text-xs font-mono uppercase tracking-wider text-text-faint";

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col items-center justify-center py-20 px-4">
      <div className="w-full max-w-sm space-y-10">
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <Logo variant="mark" size="lg" />
          </div>
          <SectionHead
            headline={
              isFirstLogin ? (
                <>Welcome — set <em className="accent">your password</em></>
              ) : (
                <>Set a <em className="accent">new password</em></>
              )
            }
            lede={
              isFirstLogin
                ? `${user?.name ?? "Welcome"} — before you start, choose a password only you know. Enter the temporary password from your welcome note, then pick your own.`
                : `${user?.name ?? "Your account"} — your password was reset by a partner. Enter the temporary password you were given, then choose a new one.`
            }
            className="flex flex-col items-center text-center"
          />
        </div>

        <form onSubmit={submit} className="space-y-4" data-testid="force-password-form">
          <div className="space-y-1.5">
            <label htmlFor="temp-password" className={label}>
              Temporary password
            </label>
            <input
              id="temp-password"
              data-testid="input-temp-password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={field}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="forced-new-password" className={label}>
              New password
            </label>
            <input
              id="forced-new-password"
              data-testid="input-forced-new-password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={field}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="forced-confirm-password" className={label}>
              Confirm new password
            </label>
            <input
              id="forced-confirm-password"
              data-testid="input-forced-confirm-password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={field}
            />
          </div>

          {error && (
            <p data-testid="force-password-error" className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            data-testid="button-force-password"
            disabled={busy}
            className="w-full rounded-md bg-gold text-bg font-semibold text-sm py-2.5 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : isFirstLogin ? "Set my password" : "Set new password"}
          </button>
        </form>

        <p className="text-center text-xs text-text-faint">
          Not you?{" "}
          <button
            type="button"
            onClick={() => void logout()}
            className="underline hover:text-text"
            data-testid="button-force-password-signout"
          >
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}
