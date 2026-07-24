import * as React from "react";
import { Link } from "wouter";
import { Card, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

interface Step {
  id: string;
  code: string;
  title: string;
  ownerRole: string | null;
  deadline: string | null;
  status: string;
  isComplianceGate: boolean;
  completedAt: string | null;
  blockedReason: string | null;
}
interface Onboarding {
  id: string;
  personId: string;
  personType: string;
  personName: string;
  status: string;
  targetStartDate: string | null;
  startedAt: string;
  completedAt: string | null;
  blockedReason: string | null;
  progress: { done: number; total: number };
  steps: Step[];
}

const STATUS_TONE: Record<string, "default" | "gold" | "green" | "amber" | "red"> = {
  in_flight: "gold",
  complete: "green",
  blocked: "red",
  cancelled: "default",
  pending: "default",
  in_progress: "gold",
  done: "green",
  skipped: "default",
};

const LOGIN_STEP_CODE = "login.created";

interface LoginResult {
  personName: string;
  activationUrl: string;
  activationExpiresAt?: string;
  welcomeEmail: unknown;
}

export default function RosterOnboarding(): React.ReactElement {
  const [rows, setRows] = React.useState<Onboarding[] | null>(null);
  const [loginResult, setLoginResult] = React.useState<LoginResult | null>(null);
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [loginBusy, setLoginBusy] = React.useState<string | null>(null);
  // Task #628 — "don't create an email address" tickbox per onboarding card,
  // plus the service-profile override (employee = full bundle, contractor =
  // email-only). Empty = server default for the worker type.
  const [skipMs, setSkipMs] = React.useState<Record<string, boolean>>({});
  const [msProfile, setMsProfile] = React.useState<Record<string, "" | "employee" | "contractor">>({});
  const reload = React.useCallback(() => {
    fetch("/api/atelier/roster/onboarding", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setRows(d.onboardings ?? []))
      .catch(() => setRows([]));
  }, []);
  React.useEffect(() => {
    reload();
  }, [reload]);

  const advance = async (onbId: string, stepId: string, status: string, reason?: string) => {
    await fetch(`/api/atelier/roster/onboarding/${onbId}/steps/${stepId}/advance`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, blockedReason: reason }),
    });
    reload();
  };

  const createLogin = async (onbId: string, personName: string) => {
    setLoginBusy(onbId);
    setLoginError(null);
    try {
      const r = await fetch(`/api/atelier/roster/onboarding/${onbId}/create-login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Task #628 — the tickbox skips Microsoft 365 provisioning; the
        // account can still be created later from the person's profile.
        body: JSON.stringify({
          skipMsProvisioning: skipMs[onbId] === true,
          ...(msProfile[onbId] ? { msServiceProfile: msProfile[onbId] } : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setLoginError(d.message ?? d.error ?? "create-login failed");
        return;
      }
      setLoginResult({
        personName,
        activationUrl: d.activationUrl,
        activationExpiresAt: d.activationExpiresAt,
        welcomeEmail: d.welcomeEmail,
      });
      reload();
    } finally {
      setLoginBusy(null);
    }
  };

  return (
    <div>
      <p className="text-text-mute text-sm mb-4">
        Active onboarding sequences. The Onboarding Concierge holds the sequence open while any
        compliance gate is blocked.
      </p>

      <div className="space-y-4">
        {rows === null && <div className="text-text-mute py-8">Loading…</div>}
        {rows?.length === 0 && <div className="text-text-mute py-8 italic">No onboardings in flight.</div>}
        {rows?.map((o) => (
          <Card key={o.id} className="p-4 space-y-3" data-testid={`onb-${o.id}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Link
                  href={`/roster/people/${o.personId}`}
                  className="font-medium hover:text-gold"
                >
                  {o.personName}
                </Link>
                <div className="text-text-mute text-xs">
                  {o.personType} · started {o.startedAt.slice(0, 10)}
                  {o.targetStartDate && ` · target ${o.targetStartDate}`}
                </div>
                <div className="flex gap-1 mt-1">
                  <MonoChip tone={STATUS_TONE[o.status] ?? "default"}>{o.status}</MonoChip>
                  <MonoChip>
                    {o.progress.done}/{o.progress.total} steps
                  </MonoChip>
                </div>
                {o.blockedReason && (
                  <div className="text-red-500 text-xs mt-1 font-mono">{o.blockedReason}</div>
                )}
              </div>
            </div>
            <div className="border-t border-line pt-3 space-y-1">
              {o.steps.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-1"
                  data-testid={`onb-step-${s.code}`}
                >
                  <div className="flex-1">
                    <div className="text-sm">
                      {s.title}
                      {s.isComplianceGate && (
                        <span className="ml-2 text-[10px] font-mono text-amber-500 uppercase">
                          compliance gate
                        </span>
                      )}
                    </div>
                    <div className="text-text-mute text-[11px] font-mono">
                      {s.ownerRole} · due {s.deadline ?? "—"}
                    </div>
                  </div>
                  <MonoChip tone={STATUS_TONE[s.status] ?? "default"}>{s.status}</MonoChip>
                  {s.status !== "done" && s.status !== "skipped" && (
                    <div className="flex gap-1">
                      {s.code === LOGIN_STEP_CODE ? (
                        <div className="flex flex-col items-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={loginBusy === o.id || o.personId.startsWith("draft:")}
                            onClick={() => createLogin(o.id, o.personName)}
                            data-testid={`create-login-${o.id}`}
                          >
                            {loginBusy === o.id ? "Creating…" : "Create login"}
                          </Button>
                          <label className="flex items-center gap-1 text-[10px] text-text-mute whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={skipMs[o.id] === true}
                              onChange={(e) => setSkipMs((m) => ({ ...m, [o.id]: e.target.checked }))}
                              data-testid={`skip-ms-${o.id}`}
                            />
                            Don't create a Microsoft email address
                          </label>
                          {skipMs[o.id] !== true ? (
                            <label className="flex items-center gap-1 text-[10px] text-text-mute whitespace-nowrap">
                              Microsoft services:
                              <select
                                className="rounded border border-border bg-bg-elevate px-1 py-0.5 text-[10px] text-text"
                                value={msProfile[o.id] ?? ""}
                                onChange={(e) => setMsProfile((m) => ({ ...m, [o.id]: e.target.value as "" | "employee" | "contractor" }))}
                                data-testid={`ms-profile-${o.id}`}
                              >
                                <option value="">Default for worker type</option>
                                <option value="employee">Employee — full bundle</option>
                                <option value="contractor">Contractor — email only</option>
                              </select>
                            </label>
                          ) : null}
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => advance(o.id, s.id, "done")}>
                          Mark done
                        </Button>
                      )}
                      {s.status !== "blocked" && s.code !== LOGIN_STEP_CODE && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const r = window.prompt("Block reason?") ?? undefined;
                            if (r) advance(o.id, s.id, "blocked", r);
                          }}
                        >
                          Block
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {loginError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="p-6 max-w-md w-full space-y-4">
            <h3 className="font-medium text-red-500">Couldn’t create login</h3>
            <p className="text-sm text-text-mute font-mono">{loginError}</p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setLoginError(null)}>
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}

      {loginResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="p-6 max-w-md w-full space-y-4" data-testid="login-created-dialog">
            <h3 className="font-medium">Portal login created</h3>
            <p className="text-sm text-text-mute">
              A one-time activation link has been generated for{" "}
              <span className="text-text font-medium">{loginResult.personName}</span>. It lets them
              choose their own password — no password is ever shared. The link is single-use and
              expires in 72 hours; if the welcome email wasn't delivered, share it through a secure
              channel.
            </p>
            <div className="bg-bg-deep border border-line rounded p-3 font-mono text-xs break-all select-all" data-testid="login-activation-link">
              {loginResult.activationUrl}
            </div>
            <div className="text-xs text-text-mute font-mono">
              Welcome email:{" "}
              {(() => {
                const w = loginResult.welcomeEmail as { sent?: boolean; status?: string } | null;
                if (w && typeof w === "object") {
                  if (w.sent) return "sent";
                  if (w.status) return String(w.status);
                }
                return "not sent";
              })()}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setLoginResult(null)}>Done</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
