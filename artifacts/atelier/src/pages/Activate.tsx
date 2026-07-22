import * as React from "react";
import { SectionHead } from "@/components/ui/primitives";
import Logo from "@/components/ui/Logo";

/**
 * One-time account activation for new joiners. The create-login onboarding
 * step mints a single-use, 72-hour token; the joiner opens this page from
 * their welcome email (or a securely shared link) and chooses their own
 * password. No temporary password ever exists.
 *
 * Rendered pre-auth (the AuthGate special-cases /activate).
 */
export default function Activate() {
  const token = React.useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("token") ?? "";
    } catch {
      return "";
    }
  }, []);

  const [info, setInfo] = React.useState<{ email: string } | null>(null);
  const [invalid, setInvalid] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    if (!token) {
      setInvalid("This activation link is missing its token.");
      setLoading(false);
      return;
    }
    fetch(`/api/auth/activate-info?token=${encodeURIComponent(token)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as
          | { ok?: boolean; email?: string; message?: string }
          | null;
        if (r.ok && j?.email) setInfo({ email: j.email });
        else setInvalid(j?.message ?? "This activation link is invalid, expired, or already used.");
      })
      .catch(() => setInvalid("Could not reach the server. Please try again."))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/activate", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (r.ok && j?.ok) {
        setDone(true);
        return;
      }
      setError(
        r.status === 429
          ? "Too many attempts. Please wait a few minutes and try again."
          : (j?.message ?? "Activation failed. Ask your onboarding contact for a new link."),
      );
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full bg-bg-elevate border border-border-soft rounded px-3 py-2 text-text text-sm focus:outline-none focus:ring-1 focus:ring-gold/40";
  const labelCls = "block text-xs font-mono uppercase tracking-wider text-text-faint";

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col items-center justify-center py-20 px-4">
      <div className="w-full max-w-sm space-y-10">
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <Logo variant="mark" size="lg" />
          </div>
          <SectionHead
            headline={<>Activate your <em className="accent">Atelier</em> account</>}
            lede="Cognirise employee portal"
            className="flex flex-col items-center text-center"
          />
        </div>

        {loading && (
          <p className="text-center font-mono text-xs uppercase tracking-widest text-text-faint">
            Checking your activation link…
          </p>
        )}

        {!loading && invalid && (
          <div className="space-y-4 text-center" data-testid="activate-invalid">
            <p className="text-sm text-text-mute">{invalid}</p>
            <a href="/sign-in" className="text-sm text-gold underline underline-offset-4">
              Go to sign in
            </a>
          </div>
        )}

        {!loading && !invalid && done && (
          <div className="space-y-4 text-center" data-testid="activate-done">
            <p className="text-sm text-text-mute">
              Your account is active. Sign in with your email and the password you just chose.
            </p>
            <a
              href="/sign-in"
              className="inline-block bg-gold text-bg font-medium rounded px-6 py-2 text-sm"
              data-testid="activate-goto-signin"
            >
              Sign in
            </a>
          </div>
        )}

        {!loading && !invalid && !done && info && (
          <form onSubmit={submit} className="space-y-4" data-testid="activate-form">
            <p className="text-sm text-text-mute text-center">
              Choose a password for <span className="text-text font-medium">{info.email}</span>.
            </p>
            <div className="space-y-1.5">
              <label htmlFor="activate-password" className={labelCls}>
                New password
              </label>
              <input
                id="activate-password"
                data-testid="input-activate-password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
              <p className="text-[11px] text-text-faint">At least 10 characters.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="activate-confirm" className={labelCls}>
                Confirm password
              </label>
              <input
                id="activate-confirm"
                data-testid="input-activate-confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputCls}
              />
            </div>
            {error && (
              <p className="text-sm text-red-400" data-testid="activate-error">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-gold text-bg font-medium rounded py-2 text-sm disabled:opacity-60"
              data-testid="button-activate"
            >
              {busy ? "Activating…" : "Activate account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
