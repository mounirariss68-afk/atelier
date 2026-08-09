import * as React from "react";
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
 * Task #2 — "Change password" from the avatar menu. Calls the bespoke
 * POST /api/auth/change-password route with raw fetch (auth routes are
 * not part of the OpenAPI spec, same as login/logout in lib/auth.tsx).
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Task #821 — step-up: when the server answers step-up-required we show a
  // code field and retry with totpCode in the body.
  const [needsCode, setNeedsCode] = React.useState(false);
  const [totpCode, setTotpCode] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
      setSubmitting(false);
      setNeedsCode(false);
      setTotpCode("");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 10) {
      setError("New password must be at least 10 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: current,
          newPassword: next,
          ...(needsCode && totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!r.ok) {
        if (j.error === "step-up-required") {
          setNeedsCode(true);
          setError("Enter a code from your authenticator app to confirm this change.");
          return;
        }
        setError(j.message ?? "Could not change password. Try again.");
        return;
      }
      toast({
        title: "Password changed",
        description: "Use your new password the next time you sign in.",
      });
      onOpenChange(false);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-bg-elevate border-border text-text">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Enter your current password, then choose a new one (at least 10
            characters). Other signed-in sessions will be signed out.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              data-testid="input-current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={10}
              data-testid="input-new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={10}
              data-testid="input-confirm-password"
            />
          </div>
          {needsCode ? (
            <div className="space-y-1.5">
              <Label htmlFor="stepup-code">Two-factor code</Label>
              <Input
                id="stepup-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                required
                data-testid="input-stepup-code"
              />
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-danger" data-testid="text-password-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              data-testid="button-cancel-password"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} data-testid="button-save-password">
              {submitting ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
