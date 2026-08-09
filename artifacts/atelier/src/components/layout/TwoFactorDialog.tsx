import * as React from "react";
import QRCode from "qrcode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

/**
 * Task #821 — Two-factor authentication management from the avatar menu.
 * Enrolment: current password → QR code + manual key → confirm first code →
 * one-time backup codes. Disable requires password + a fresh code.
 */
export function TwoFactorDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  type Status = { enabled: boolean; backupCodesRemaining: number; required: boolean };
  const [status, setStatus] = React.useState<Status | null>(null);
  const [phase, setPhase] = React.useState<
    "overview" | "password" | "scan" | "backup" | "disable"
  >("overview");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [manualKey, setManualKey] = React.useState<string | null>(null);
  const [backupCodes, setBackupCodes] = React.useState<string[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const loadStatus = React.useCallback(() => {
    void fetch("/api/auth/2fa/status", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Status | null) => j && setStatus(j));
  }, []);

  React.useEffect(() => {
    if (open) {
      loadStatus();
    } else {
      setPhase("overview");
      setPassword("");
      setCode("");
      setQrDataUrl(null);
      setManualKey(null);
      setBackupCodes(null);
      setError(null);
      setBusy(false);
    }
  }, [open, loadStatus]);

  const post = async (path: string, body: Record<string, unknown>) => {
    const r = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & {
      message?: string;
    };
    return { ok: r.ok, j };
  };

  const startEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ok, j } = await post("/api/auth/2fa/enroll", { currentPassword: password });
      if (!ok) {
        setError(j.message ?? "Could not start enrolment.");
        return;
      }
      const otpauth = String(j.otpauthUrl ?? "");
      setManualKey(String(j.manualKey ?? ""));
      setQrDataUrl(await QRCode.toDataURL(otpauth, { margin: 1, width: 220 }));
      setPhase("scan");
      setCode("");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirmEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ok, j } = await post("/api/auth/2fa/confirm", { code: code.trim() });
      if (!ok) {
        setError(j.message ?? "That code is incorrect.");
        return;
      }
      setBackupCodes((j.backupCodes as string[]) ?? []);
      setPhase("backup");
      loadStatus();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ok, j } = await post("/api/auth/2fa/disable", {
        currentPassword: password,
        totpCode: code.trim(),
      });
      if (!ok) {
        setError(j.message ?? "Could not disable two-factor authentication.");
        return;
      }
      toast({ title: "Two-factor disabled" });
      onOpenChange(false);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-bg-elevate border-border text-text">
        <DialogHeader>
          <DialogTitle>Two-factor authentication</DialogTitle>
          <DialogDescription>
            {phase === "backup"
              ? "Save these backup codes now — they are shown only once."
              : "Protect your account with a 6-digit code from an authenticator app."}
          </DialogDescription>
        </DialogHeader>

        {phase === "overview" && (
          <div className="space-y-4">
            {status ? (
              <p className="text-sm" data-testid="text-2fa-status">
                {status.enabled ? (
                  <>
                    Two-factor is <span className="text-success font-semibold">enabled</span> ·{" "}
                    {status.backupCodesRemaining} backup code
                    {status.backupCodesRemaining === 1 ? "" : "s"} left.
                  </>
                ) : (
                  <>
                    Two-factor is <span className="text-danger font-semibold">off</span>
                    {status.required ? " — your firm requires it for your role." : "."}
                  </>
                )}
              </p>
            ) : (
              <p className="text-sm text-text-mute">Loading…</p>
            )}
            {status && !status.enabled && (
              <p className="text-xs text-text-mute" data-testid="text-2fa-app-recommendations">
                You'll need an authenticator app. We recommend Microsoft Authenticator (the firm
                runs on Microsoft 365) — Google Authenticator, Apple Passwords (built into
                iPhone), 1Password and Bitwarden work just as well. Any standard authenticator
                app will do.
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {status?.enabled ? (
                <Button
                  variant="destructive"
                  onClick={() => {
                    setPhase("disable");
                    setPassword("");
                    setCode("");
                  }}
                  data-testid="button-2fa-start-disable"
                >
                  Disable 2FA
                </Button>
              ) : (
                <Button
                  onClick={() => setPhase("password")}
                  data-testid="button-2fa-start-enroll"
                >
                  Set up 2FA
                </Button>
              )}
            </DialogFooter>
          </div>
        )}

        {phase === "password" && (
          <form onSubmit={startEnroll} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="twofa-password">Confirm your password</Label>
              <Input
                id="twofa-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                data-testid="input-2fa-password"
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPhase("overview")}>
                Back
              </Button>
              <Button type="submit" disabled={busy} data-testid="button-2fa-continue">
                {busy ? "Preparing…" : "Continue"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {phase === "scan" && (
          <form onSubmit={confirmEnroll} className="space-y-4">
            <div className="flex flex-col items-center gap-3">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="Scan this QR code with your authenticator app"
                  className="rounded-md bg-white p-2"
                  data-testid="img-2fa-qr"
                />
              )}
              <p className="text-xs text-text-mute text-center">
                Scan with Microsoft Authenticator, Google Authenticator, Apple Passwords,
                1Password or Bitwarden — any authenticator app works. Or enter the key manually:
              </p>
              <code
                className="text-xs font-mono bg-bg px-2 py-1 rounded border border-border-soft break-all"
                data-testid="text-2fa-manual-key"
              >
                {manualKey}
              </code>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="twofa-code">Enter the 6-digit code</Label>
              <Input
                id="twofa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
                data-testid="input-2fa-code"
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPhase("overview")}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy} data-testid="button-2fa-confirm">
                {busy ? "Verifying…" : "Turn on 2FA"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {phase === "backup" && (
          <div className="space-y-4">
            <div
              className="grid grid-cols-2 gap-2 font-mono text-sm bg-bg rounded-md border border-border-soft p-4"
              data-testid="list-2fa-backup-codes"
            >
              {(backupCodes ?? []).map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <p className="text-xs text-text-mute">
              Each code works once, for when you lose access to your authenticator app. Store
              them somewhere safe — they will not be shown again.
            </p>
            <DialogFooter>
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText((backupCodes ?? []).join("\n"));
                  toast({ title: "Backup codes copied" });
                }}
                variant="ghost"
              >
                Copy codes
              </Button>
              <Button onClick={() => onOpenChange(false)} data-testid="button-2fa-done">
                Done
              </Button>
            </DialogFooter>
          </div>
        )}

        {phase === "disable" && (
          <form onSubmit={disable} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="twofa-disable-password">Current password</Label>
              <Input
                id="twofa-disable-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                data-testid="input-2fa-disable-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="twofa-disable-code">Authenticator or backup code</Label>
              <Input
                id="twofa-disable-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                data-testid="input-2fa-disable-code"
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPhase("overview")}>
                Back
              </Button>
              <Button type="submit" variant="destructive" disabled={busy} data-testid="button-2fa-disable">
                {busy ? "Disabling…" : "Disable 2FA"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
