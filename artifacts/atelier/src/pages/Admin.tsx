import * as React from "react";
import {
  useAtelierGetMe,
  useAtelierGetAdminSettings,
  useAtelierUpdateAdminSettings,
  useAtelierListAgents,
  getAtelierGetAdminSettingsQueryKey,
} from "@workspace/api-client-react";
import { SectionHead, PageHero, Card, MonoChip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldAlert, Shield, ShieldCheck, Globe, Download, Lock, KeyRound, FileCheck2, ListTodo } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Admin() {
  const { data: me, isLoading } = useAtelierGetMe();
  const { data: settings, isLoading: settingsLoading } = useAtelierGetAdminSettings({
    query: { enabled: (me?.role === "founding_partner" || me?.role === "hr"), queryKey: getAtelierGetAdminSettingsQueryKey() },
  });
  const { data: agents } = useAtelierListAgents();
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useAtelierUpdateAdminSettings({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getAtelierGetAdminSettingsQueryKey() });
        toast({ title: "Settings saved", description: "Firm configuration updated." });
      },
    },
  });

  const [piiDraft, setPiiDraft] = React.useState("");
  const [budgetDraft, setBudgetDraft] = React.useState("");
  // Task #243 — Compliance posture is persisted server-side at
  // /api/atelier/admin/compliance (raw JSON, no codegen). Founder TODOs
  // are also fetched from the server so the list is sourced from PRD §10
  // rather than hardcoded in the client.
  type Posture = {
    mfaRequired: boolean;
    encryptionAtRest: string;
    encryptionInTransit: string;
    immutableAuditEnabled: boolean;
    immutableAuditRetentionYears: number;
    ipAllowlistEnabled: boolean;
    residencyRegion: string;
    wps?: { status: "ok" | "warn" | "unknown"; message: string };
    saudization?: { status: "ok" | "warn" | "unknown"; pct: number | null };
    fxFreshness?: { status: "ok" | "warn" | "unknown"; hours: number | null };
    receiptEncryption?: { status: "ok" | "warn" | "unknown"; unencryptedCount: number | null };
    jurisdictions?: Array<{ key: string; label: string; status: "ok" | "warn" | "unknown"; detail: string }>;
  };
  const [posture, setPosture] = React.useState<Posture | null>(null);
  const [todos, setTodos] = React.useState<string[]>([]);
  React.useEffect(() => {
    // Task #292 — Admin Console gated to founding_partner + hr.
    if (me?.role !== "founding_partner" && me?.role !== "hr") return;
    void fetch("/api/atelier/admin/compliance", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setPosture(j));
    void fetch("/api/atelier/admin/founder-todos", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setTodos(j.items ?? []));
  }, [me?.role]);
  const patchPosture = (patch: Partial<Posture>) => {
    void fetch("/api/atelier/admin/compliance", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) {
          setPosture(j);
          toast({ title: "Compliance updated" });
        }
      });
  };
  React.useEffect(() => {
    if (settings) {
      setPiiDraft(settings.piiPatterns.join("\n"));
      setBudgetDraft(String(settings.perUserDailyTokenBudget));
    }
  }, [settings]);

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (!me) return null;

  if (me.role !== "founding_partner" && me.role !== "hr") {
    return (
      <div className="container-atelier py-20 flex flex-col items-center text-center animate-in fade-in">
        <div className="w-16 h-16 bg-danger/10 rounded-full flex items-center justify-center mb-6 text-danger">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-semibold text-text mb-3">Partner Access Required</h2>
        <p className="text-text-mute max-w-md">
          The administration console is restricted to firm Partners. Your current persona ({me.name},{" "}
          {me.roleLabel}) does not have sufficient privileges.
        </p>
      </div>
    );
  }

  const toggleAgent = (agentId: string) => {
    if (!settings) return;
    const next = settings.disabledAgentIds.includes(agentId)
      ? settings.disabledAgentIds.filter((x: string) => x !== agentId)
      : [...settings.disabledAgentIds, agentId];
    update.mutate({ data: { disabledAgentIds: next } });
  };

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead headline="Admin Console" lede="Firm-wide configuration, access control, and audit." />
      </PageHero>

      <div className="container-atelier py-10 max-w-3xl space-y-6">
        {settingsLoading || !settings ? (
          <Skeleton className="h-96 bg-bg-elevate" />
        ) : (
          <>
            <Card className="p-6 space-y-4 border-gold/30">
              <h3 className="font-mono text-sm tracking-widest uppercase text-gold flex items-center gap-2">
                <Shield className="w-4 h-4" /> Model & Cost Controls
              </h3>
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-text font-semibold">Disable Opus firm-wide</div>
                  <div className="text-xs text-text-mute">Forces all agents to fall back to Sonnet.</div>
                </div>
                <Switch
                  checked={settings.disableOpus}
                  onCheckedChange={(v) => update.mutate({ data: { disableOpus: v } })}
                  data-testid="switch-disable-opus"
                />
              </div>
              <div className="space-y-2 pt-3 border-t border-border-soft">
                <label className="text-text font-semibold block">Per-user daily token budget</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={1000}
                    value={budgetDraft}
                    onChange={(e) => setBudgetDraft(e.target.value)}
                    className="bg-bg-elevate border-border text-text max-w-[200px]"
                    data-testid="input-budget"
                  />
                  <Button
                    onClick={() =>
                      update.mutate({
                        data: { perUserDailyTokenBudget: parseInt(budgetDraft, 10) || 250000 },
                      })
                    }
                  >
                    Save
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-6 space-y-3">
              <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">
                Agent Access ({settings.disabledAgentIds.length} disabled)
              </h3>
              <div className="border border-border-soft rounded-md divide-y divide-border-soft max-h-72 overflow-y-auto">
                {(agents ?? []).map((a) => {
                  const disabled = settings.disabledAgentIds.includes(a.id);
                  return (
                    <div
                      key={a.id}
                      className="flex justify-between items-center px-4 py-2"
                      data-testid={`row-agent-${a.id}`}
                    >
                      <div>
                        <div className="text-text text-sm">{a.name}</div>
                        <div className="text-xs text-text-mute font-mono">{a.id}</div>
                      </div>
                      <Switch
                        checked={!disabled}
                        onCheckedChange={() => toggleAgent(a.id)}
                        data-testid={`switch-agent-${a.id}`}
                      />
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-6 space-y-3">
              <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">
                PII Redaction Patterns
              </h3>
              <p className="text-xs text-text-mute">
                One regex per line. Matched text is redacted from agent prompts before model invocation.
              </p>
              <textarea
                value={piiDraft}
                onChange={(e) => setPiiDraft(e.target.value)}
                rows={5}
                className="w-full bg-bg-elevate border border-border rounded-md p-3 text-text font-mono text-xs"
                data-testid="textarea-pii"
              />
              <Button
                onClick={() =>
                  update.mutate({
                    data: { piiPatterns: piiDraft.split("\n").map((s) => s.trim()).filter(Boolean) },
                  })
                }
              >
                Save patterns
              </Button>
            </Card>

            <Card className="p-6 space-y-3">
              <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
                <Globe className="w-4 h-4" /> Data Residency
              </h3>
              <div className="flex justify-between items-center">
                <span className="text-text">{settings.residencyRegion}</span>
                <MonoChip tone="green">enforced</MonoChip>
              </div>
              <p className="text-xs text-text-mute">
                Region is fixed for this tenant. Contact your account exec to change.
              </p>
            </Card>

            <Card className="p-6 space-y-3">
              <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
                <Download className="w-4 h-4" /> Audit Export
              </h3>
              <p className="text-sm text-text-mute">
                Full firm-wide audit log is available as PDF per engagement from the engagement page.
              </p>
            </Card>

            {/* Task #243 — Compliance posture, server-persisted via /admin/compliance.
                MFA + IP allowlist toggles round-trip to the API; encryption +
                immutable-audit indicators are platform-level guarantees rendered
                from the server's compliance posture record. */}
            {posture && (
              <Card className="p-6 space-y-4 border-border-soft" data-testid="card-compliance">
                <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
                  <Lock className="w-4 h-4" /> Compliance Posture
                </h3>
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-text font-semibold">Require MFA for Partners + Leads</div>
                    <div className="text-xs text-text-mute">Persisted server-side; enforced at IdP.</div>
                  </div>
                  <Switch
                    checked={posture.mfaRequired}
                    onCheckedChange={(v) => patchPosture({ mfaRequired: v })}
                    data-testid="switch-mfa-required"
                  />
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-border-soft">
                  <div>
                    <div className="text-text font-semibold">IP Allowlist</div>
                    <div className="text-xs text-text-mute">Restrict access to partner-approved network ranges.</div>
                  </div>
                  <Switch
                    checked={posture.ipAllowlistEnabled}
                    onCheckedChange={(v) => patchPosture({ ipAllowlistEnabled: v })}
                    data-testid="switch-ip-allowlist"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-border-soft">
                  <div className="flex items-start gap-2">
                    <KeyRound className="w-4 h-4 text-gold mt-0.5" />
                    <div>
                      <div className="text-text text-sm font-semibold">Encryption</div>
                      <div className="text-xs text-text-mute" data-testid="text-encryption">
                        {posture.encryptionAtRest} at rest · {posture.encryptionInTransit} in transit
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <FileCheck2 className="w-4 h-4 text-gold mt-0.5" />
                    <div>
                      <div className="text-text text-sm font-semibold">Immutable Audit</div>
                      <div className="text-xs text-text-mute" data-testid="text-audit-retention">
                        {posture.immutableAuditEnabled ? "Append-only" : "Disabled"} ·{" "}
                        {posture.immutableAuditRetentionYears}y retention
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Lock className="w-4 h-4 text-gold mt-0.5" />
                    <div>
                      <div className="text-text text-sm font-semibold">Data Residency</div>
                      <div className="text-xs text-text-mute" data-testid="text-residency-region">
                        {posture.residencyRegion}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Task #261 — v3 indicator chips: WPS, Saudization, FX freshness,
                    receipt encryption. Each chip's color is driven by the
                    server-side computed status. */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-border-soft">
                  {(
                    [
                      {
                        key: "wps",
                        label: "WPS",
                        status: posture.wps?.status ?? "unknown",
                        detail: posture.wps?.message ?? "—",
                      },
                      {
                        key: "saudization",
                        label: "Saudization",
                        status: posture.saudization?.status ?? "unknown",
                        detail:
                          posture.saudization?.pct == null
                            ? "no quota on file"
                            : `${posture.saudization.pct}% of required`,
                      },
                      {
                        key: "fx",
                        label: "FX Freshness",
                        status: posture.fxFreshness?.status ?? "unknown",
                        detail:
                          posture.fxFreshness?.hours == null
                            ? "no rates"
                            : `last refresh ${posture.fxFreshness.hours}h ago`,
                      },
                      {
                        key: "receipts",
                        label: "Receipt Encryption",
                        status: posture.receiptEncryption?.status ?? "unknown",
                        detail:
                          posture.receiptEncryption?.unencryptedCount == null
                            ? "no expenses"
                            : posture.receiptEncryption.unencryptedCount === 0
                              ? "all encrypted at rest"
                              : `${posture.receiptEncryption.unencryptedCount} unencrypted receipt(s)`,
                      },
                    ] as const
                  ).map((chip) => {
                    const tone =
                      chip.status === "ok"
                        ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-300"
                        : chip.status === "warn"
                          ? "border-amber-500/40 bg-amber-500/5 text-amber-300"
                          : "border-border-soft bg-surface-soft/30 text-text-mute";
                    return (
                      <div
                        key={chip.key}
                        data-testid={`chip-posture-${chip.key}`}
                        className={`rounded-md border px-2.5 py-2 ${tone}`}
                      >
                        <div className="font-mono text-[10px] uppercase tracking-widest opacity-80">
                          {chip.label}
                        </div>
                        <div className="text-xs font-semibold mt-0.5 capitalize">
                          {chip.status}
                        </div>
                        <div className="text-[11px] opacity-80 mt-0.5">{chip.detail}</div>
                      </div>
                    );
                  })}
                </div>
                {/* Task #261 — DIFC / ADGM / KSA jurisdiction registration chips. */}
                {Array.isArray(posture.jurisdictions) &&
                  posture.jurisdictions.length > 0 &&
                  typeof posture.jurisdictions[0] === "object" && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-3 border-t border-border-soft">
                      {(
                        posture.jurisdictions as Array<{
                          key: string;
                          label: string;
                          status: "ok" | "warn" | "unknown";
                          detail: string;
                        }>
                      ).map((j) => {
                        const tone =
                          j.status === "ok"
                            ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-300"
                            : j.status === "warn"
                              ? "border-amber-500/40 bg-amber-500/5 text-amber-300"
                              : "border-border-soft bg-surface-soft/30 text-text-mute";
                        return (
                          <div
                            key={j.key}
                            data-testid={`chip-jurisdiction-${j.key}`}
                            className={`rounded-md border px-2.5 py-2 ${tone}`}
                          >
                            <div className="font-mono text-[10px] uppercase tracking-widest opacity-80">
                              {j.label}
                            </div>
                            <div className="text-xs font-semibold mt-0.5 capitalize">{j.status}</div>
                            <div className="text-[11px] opacity-80 mt-0.5">{j.detail}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </Card>
            )}

            {/* Task #243 — Founder TODOs (PRD §10), sourced from the server. */}
            {todos.length > 0 && (
              <Card className="p-6 space-y-3" data-testid="card-founder-todos">
                <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
                  <ListTodo className="w-4 h-4" /> Founder TODOs
                </h3>
                <p className="text-xs text-text-mute">
                  Pre-GA founder-only items. Tracked here for partner visibility; resolution happens in
                  the operator console.
                </p>
                <ul className="space-y-2 pt-2 border-t border-border-soft">
                  {todos.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3 text-sm text-text"
                      data-testid={`founder-todo-${i}`}
                    >
                      <span className="font-mono text-xs text-text-mute mt-0.5">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        {/* Task #5 — founding-partner-only colleague password reset. */}
        {me.role === "founding_partner" && <PartnerAccessRecovery />}

        {/* Task #821 — org-wide / per-role two-factor requirement. */}
        {me.role === "founding_partner" && <TwoFactorPolicyCard />}

        {/* Task #822 — security audit console: org-wide auth trail + action trail. */}
        {me.role === "founding_partner" && <SecurityConsole />}
      </div>
    </div>
  );
}

/**
 * Task #5 / #820 — "colleague locked out" recovery. Founding partners can
 * reset a colleague's access: the server invalidates the old password,
 * revokes all their sessions, and issues a single-use 24-hour reset link.
 * The link is emailed to them when delivery is configured, and shown once
 * here so it can also be shared through a secure channel.
 */
function PartnerAccessRecovery() {
  const { toast } = useToast();
  type Target = {
    email: string;
    name: string;
    title: string;
    pendingReset: boolean;
    locked?: boolean;
    lockedUntil?: string | null;
    twoFactorEnabled?: boolean;
  };
  const [targets, setTargets] = React.useState<Target[] | null>(null);
  const [busyEmail, setBusyEmail] = React.useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = React.useState<string | null>(null);
  // Task #821 — step-up: if the server demands a fresh 2FA code for these
  // sensitive actions, we surface a code field and retry with totpCode.
  const [stepUpCode, setStepUpCode] = React.useState("");
  const [needStepUp, setNeedStepUp] = React.useState(false);
  const [confirm2faEmail, setConfirm2faEmail] = React.useState<string | null>(null);

  const stepUpBody = () =>
    stepUpCode.trim() ? { totpCode: stepUpCode.trim() } : {};

  const handleStepUp = (j: { error?: string; message?: string }) => {
    if (j.error === "step-up-required" || j.error === "step-up-invalid-code") {
      setNeedStepUp(true);
      toast({
        title: "Two-factor code needed",
        description:
          j.error === "step-up-invalid-code"
            ? "That code was incorrect or already used — enter a fresh one."
            : "Enter a code from your authenticator app below, then retry.",
        variant: "destructive",
      });
      return true;
    }
    return false;
  };
  const [result, setResult] = React.useState<{
    email: string;
    resetUrl: string;
    emailNote: string;
    emailStatus: string;
  } | null>(null);

  const loadTargets = React.useCallback(() => {
    void fetch("/api/auth/reset-targets", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { targets?: Target[] } | null) => setTargets(j?.targets ?? []));
  }, []);

  React.useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  const doReset = async (email: string) => {
    setBusyEmail(email);
    setConfirmEmail(null);
    try {
      const r = await fetch("/api/auth/reset-colleague-password", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, ...stepUpBody() }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        resetUrl?: string;
        email?: { status?: string; note?: string };
        message?: string;
        error?: string;
      };
      if (!r.ok || !j.resetUrl) {
        if (handleStepUp(j)) return;
        toast({
          title: "Reset failed",
          description: j.message ?? "Could not reset access. Try again.",
          variant: "destructive",
        });
        return;
      }
      setResult({
        email,
        resetUrl: j.resetUrl,
        emailStatus: j.email?.status ?? "not_configured",
        emailNote: j.email?.note ?? "",
      });
      loadTargets();
      toast({
        title: "Access reset",
        description: `${email} was signed out everywhere. They set a new password via the reset link.`,
      });
    } catch {
      toast({
        title: "Reset failed",
        description: "Network error. Try again.",
        variant: "destructive",
      });
    } finally {
      setBusyEmail(null);
    }
  };

  const doReset2fa = async (email: string) => {
    setBusyEmail(email);
    setConfirm2faEmail(null);
    try {
      const r = await fetch("/api/auth/reset-colleague-2fa", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, ...stepUpBody() }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!r.ok) {
        if (handleStepUp(j)) return;
        toast({
          title: "2FA reset failed",
          description: j.message ?? "Could not reset two-factor. Try again.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Two-factor reset",
        description: `${email} was signed out everywhere and can sign in with their password, then re-enrol.`,
      });
      loadTargets();
    } catch {
      toast({ title: "2FA reset failed", description: "Network error. Try again.", variant: "destructive" });
    } finally {
      setBusyEmail(null);
    }
  };

  return (
    <Card className="p-6 space-y-4 border-gold/30" data-testid="card-access-recovery">
      <h3 className="font-mono text-sm tracking-widest uppercase text-gold flex items-center gap-2">
        <KeyRound className="w-4 h-4" /> Partner Access Recovery
      </h3>
      <p className="text-xs text-text-mute">
        If a colleague is locked out, reset their access here. This signs them out everywhere and
        issues a single-use reset link (valid 24 hours) — emailed to them, and shown once below so
        you can also share it through a secure channel. No temporary passwords. Every reset is
        recorded in the audit trail.
      </p>
      {targets === null ? (
        <Skeleton className="h-14 bg-bg-elevate" />
      ) : targets.length === 0 ? (
        <p className="text-sm text-text-mute">No other partner logins found.</p>
      ) : (
        <div className="border border-border-soft rounded-md divide-y divide-border-soft">
          {targets.map((t) => (
            <div
              key={t.email}
              className="flex flex-wrap justify-between items-center gap-3 px-4 py-3"
              data-testid={`row-reset-target-${t.email}`}
            >
              <div>
                <div className="text-text text-sm font-semibold">{t.name}</div>
                <div className="text-xs text-text-mute font-mono">{t.email}</div>
                {t.pendingReset && (
                  <div className="text-[11px] text-amber-300 mt-0.5">
                    Reset pending — they haven't set a new password yet.
                  </div>
                )}
                {t.locked && (
                  <div className="text-[11px] text-danger mt-0.5" data-testid={`text-locked-${t.email}`}>
                    Temporarily locked after repeated failed sign-ins
                    {t.lockedUntil ? ` (until ${new Date(t.lockedUntil).toLocaleTimeString()})` : ""}.
                    <button
                      type="button"
                      className="ml-2 underline underline-offset-2 text-gold"
                      data-testid={`button-unlock-${t.email}`}
                      onClick={() => {
                        void fetch("/api/auth/unlock-account", {
                          method: "POST",
                          credentials: "include",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ email: t.email, ...stepUpBody() }),
                        }).then(async (r) => {
                          if (r.ok) {
                            toast({ title: "Account unlocked" });
                            loadTargets();
                          } else {
                            const j = (await r.json().catch(() => ({}))) as { error?: string };
                            if (!handleStepUp(j)) {
                              toast({ title: "Unlock failed", variant: "destructive" });
                            }
                          }
                        });
                      }}
                    >
                      Unlock now
                    </button>
                  </div>
                )}
              </div>
              {confirmEmail === t.email ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-mute">Sign them out everywhere?</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyEmail !== null}
                    onClick={() => void doReset(t.email)}
                    data-testid={`button-confirm-reset-${t.email}`}
                  >
                    {busyEmail === t.email ? "Resetting…" : "Confirm reset"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyEmail !== null}
                    onClick={() => setConfirmEmail(null)}
                    data-testid={`button-cancel-reset-${t.email}`}
                  >
                    Cancel
                  </Button>
                </div>
              ) : confirm2faEmail === t.email ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-mute">
                    Remove their authenticator? They sign in with password only until they
                    re-enrol.
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyEmail !== null}
                    onClick={() => void doReset2fa(t.email)}
                    data-testid={`button-confirm-reset-2fa-${t.email}`}
                  >
                    {busyEmail === t.email ? "Resetting…" : "Confirm 2FA reset"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyEmail !== null}
                    onClick={() => setConfirm2faEmail(null)}
                    data-testid={`button-cancel-reset-2fa-${t.email}`}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {t.twoFactorEnabled && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyEmail !== null}
                      onClick={() => setConfirm2faEmail(t.email)}
                      data-testid={`button-reset-2fa-${t.email}`}
                    >
                      Reset 2FA
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyEmail !== null}
                    onClick={() => setConfirmEmail(t.email)}
                    data-testid={`button-reset-${t.email}`}
                  >
                    Reset password
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {needStepUp && (
        <div className="flex items-center gap-2" data-testid="panel-stepup">
          <Input
            className="max-w-[180px]"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Two-factor code"
            value={stepUpCode}
            onChange={(e) => setStepUpCode(e.target.value)}
            data-testid="input-admin-stepup-code"
          />
          <span className="text-xs text-text-mute">
            Your account has 2FA — sensitive actions need a fresh code.
          </span>
        </div>
      )}
      {result && (
        <div
          className="rounded-md border border-gold/40 bg-gold/5 p-4 space-y-2"
          data-testid="panel-reset-link"
        >
          <div className="text-sm text-text font-semibold">
            Reset link for {result.email}
          </div>
          {result.emailStatus === "sent" ? (
            <p className="text-xs text-emerald-300">The link was emailed to {result.email}.</p>
          ) : (
            <p className="text-xs text-amber-300">{result.emailNote || "Email delivery is not configured — share the link through a secure channel."}</p>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <code
              className="font-mono text-xs text-gold glass-surface border border-border rounded px-2 py-1 truncate max-w-full"
              data-testid="text-reset-link"
              title={result.resetUrl}
            >
              {result.resetUrl}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(result.resetUrl).then(
                  () => toast({ title: "Copied to clipboard" }),
                  () => toast({ title: "Copy failed", variant: "destructive" }),
                );
              }}
              data-testid="button-copy-reset-link"
            >
              Copy
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setResult(null)}
              data-testid="button-dismiss-reset-link"
            >
              Dismiss
            </Button>
          </div>
          <p className="text-xs text-text-mute">
            Shown only once. Single use, valid 24 hours — it stops working as soon as they set a
            new password. Resetting again issues a fresh link and invalidates this one.
          </p>
        </div>
      )}
    </Card>
  );
}


/**
 * Task #821 — firm-wide 2FA requirement policy. "Everyone" stores ["*"];
 * otherwise a set of roles. Users covered by the policy who have not
 * enrolled see a nudge at sign-in (never a hard lockout).
 */
function TwoFactorPolicyCard() {
  const { toast } = useToast();
  const ROLE_OPTIONS: { value: string; label: string }[] = [
    { value: "founding_partner", label: "Founding partners" },
    { value: "partner", label: "Partners" },
    { value: "senior_manager", label: "Senior managers" },
    { value: "hr", label: "HR" },
    { value: "finance", label: "Finance" },
    { value: "employee", label: "Employees" },
    { value: "contractor", label: "Contractors" },
    { value: "board_observer", label: "Board observers" },
  ];
  const [roles, setRoles] = React.useState<string[] | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void fetch("/api/auth/2fa/policy", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { require2faRoles?: string[] } | null) =>
        setRoles(j?.require2faRoles ?? []),
      );
  }, []);

  const save = async (next: string[]) => {
    setRoles(next);
    setSaving(true);
    try {
      const r = await fetch("/api/auth/2fa/policy", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ require2faRoles: next }),
      });
      if (!r.ok) {
        toast({ title: "Could not save policy", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const everyone = roles?.includes("*") ?? false;

  return (
    <Card className="p-6 space-y-4" data-testid="card-2fa-policy">
      <h3 className="font-mono text-sm tracking-widest uppercase text-gold flex items-center gap-2">
        <ShieldCheck className="w-4 h-4" /> Two-Factor Requirement
      </h3>
      <p className="text-xs text-text-mute">
        People covered by this policy are prompted to set up two-factor authentication when
        they sign in (they are not locked out). The demo account is always exempt.
      </p>
      {roles === null ? (
        <Skeleton className="h-10 bg-bg-elevate" />
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={everyone}
              disabled={saving}
              onChange={(e) => void save(e.target.checked ? ["*"] : [])}
              data-testid="checkbox-2fa-everyone"
            />
            Require for everyone
          </label>
          {!everyone && (
            <div className="grid grid-cols-2 gap-1.5 pl-1">
              {ROLE_OPTIONS.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm text-text-mute">
                  <input
                    type="checkbox"
                    checked={roles.includes(o.value)}
                    disabled={saving}
                    onChange={(e) =>
                      void save(
                        e.target.checked
                          ? [...roles, o.value]
                          : roles.filter((r) => r !== o.value),
                      )
                    }
                    data-testid={`checkbox-2fa-role-${o.value}`}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}


/**
 * Task #822 — Security audit console. Founding-partner-only, read-only view
 * over the immutable audit trail: a "Sign-in Activity" tab (logins, failures,
 * lockouts, password + 2FA events, with IP) and an "Action Trail" tab (who
 * did what to which record, with deep links). Filterable by person, event
 * type and date range; paginated; CSV export of the filtered view. The
 * server audits console access itself.
 */
function SecurityConsole() {
  type Tab = "auth" | "actions";
  type SecurityEvent = {
    id: string;
    ts: string;
    action: string;
    actorType: string;
    actorId: string | null;
    actorLabel: string;
    entityType: string;
    entityId: string;
    summary: string | null;
    ip: string | null;
    targetEmail: string | null;
  };
  const PAGE = 50;
  // Task #824 — founder alert emails deep-link here with the console
  // pre-filtered to the affected person and day, e.g.
  // /admin?securityTab=auth&securityActor=jane@…&securityFrom=2026-08-09
  const deepLink = React.useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    const dateOk = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
    return {
      tab: (p.get("securityTab") === "actions" ? "actions" : "auth") as Tab,
      actor: p.get("securityActor") ?? "",
      from: dateOk(p.get("securityFrom")),
      to: dateOk(p.get("securityTo")),
    };
  }, []);
  const [tab, setTab] = React.useState<Tab>(deepLink.tab);
  const [actor, setActor] = React.useState(deepLink.actor);
  const [action, setAction] = React.useState("");
  const [from, setFrom] = React.useState(deepLink.from);
  const [to, setTo] = React.useState(deepLink.to);
  const [events, setEvents] = React.useState<SecurityEvent[]>([]);
  const [actions, setActions] = React.useState<string[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const queryString = React.useCallback(
    (offset: number) => {
      const p = new URLSearchParams({ tab, limit: String(PAGE), offset: String(offset) });
      if (actor.trim()) p.set("actor", actor.trim());
      if (action) p.set("action", action);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      return p.toString();
    },
    [tab, actor, action, from, to],
  );

  const load = React.useCallback(
    (offset: number) => {
      setLoading(true);
      setError(null);
      void fetch(`/api/auth/security-log?${queryString(offset)}`, { credentials: "include" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return (await r.json()) as {
            events: SecurityEvent[];
            total: number;
            actions?: string[];
          };
        })
        .then((j) => {
          setEvents((prev) => (offset === 0 ? j.events : [...prev, ...j.events]));
          setTotal(j.total);
          if (j.actions) setActions(j.actions);
        })
        .catch(() => setError("Failed to load the security log."))
        .finally(() => setLoading(false));
    },
    [queryString],
  );

  // Reload from the top whenever the tab or a filter changes (debounced for
  // the free-text person filter).
  React.useEffect(() => {
    const t = setTimeout(() => load(0), actor ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, actor]);

  // Reset the event-type filter when it no longer exists on the new tab.
  React.useEffect(() => {
    setAction("");
  }, [tab]);

  const recordHref = (e: SecurityEvent): string | null => {
    switch (e.entityType) {
      case "account":
        return `/accounts/${e.entityId}`;
      case "opportunity":
        return `/opportunities/${e.entityId}`;
      case "engagement":
        return `/engagements/${e.entityId}`;
      case "contract":
        return `/contracts/${e.entityId}`;
      default:
        return null;
    }
  };

  const inputCls =
    "glass-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-text";

  return (
    <Card className="p-6 space-y-4 border-gold/30" data-testid="card-security-console">
      <h3 className="font-mono text-sm tracking-widest uppercase text-gold flex items-center gap-2">
        <ShieldCheck className="w-4 h-4" /> Security Log
      </h3>
      <div className="flex gap-2">
        {(
          [
            { key: "auth", label: "Sign-in Activity" },
            { key: "actions", label: "Action Trail" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider border transition ${
              tab === t.key
                ? "border-gold/50 text-gold bg-gold/5"
                : "border-border-soft text-text-mute hover:text-text"
            }`}
            data-testid={`tab-security-${t.key}`}
          >
            {t.label}
          </button>
        ))}
        <a
          href={`/api/auth/security-log/export.csv?${queryString(0)}`}
          className="ml-auto inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-gold/40 text-gold hover:bg-gold/10 transition-colors rounded"
          data-testid="link-security-export-csv"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </a>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Filter by person (name or email)…"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className="bg-bg-elevate border-border text-text max-w-[240px]"
          data-testid="input-security-actor"
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className={inputCls}
          data-testid="select-security-action"
        >
          <option value="">All event types</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} data-testid="input-security-from" />
        <span className="text-text-mute text-xs">to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} data-testid="input-security-to" />
      </div>

      {error && <div className="text-danger text-sm">{error}</div>}
      {!error && events.length === 0 && !loading && (
        <div className="py-6 text-center text-text-mute italic text-sm">No events match these filters.</div>
      )}

      <div className="border border-border-soft rounded-md divide-y divide-border-soft max-h-[480px] overflow-y-auto">
        {events.map((e) => {
          const href = tab === "actions" ? recordHref(e) : null;
          return (
            <div key={e.id} className="px-4 py-2.5 text-sm" data-testid={`row-security-${e.id}`}>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="font-mono text-xs text-text-mute min-w-[150px]">
                  {new Date(e.ts).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <MonoChip
                  tone={
                    /failed|denied|locked/.test(e.action)
                      ? "default"
                      : e.actorType === "agent"
                        ? "gold"
                        : "green"
                  }
                >
                  {e.action}
                </MonoChip>
                <span className="text-text font-medium">{e.actorLabel}</span>
                {e.targetEmail && <span className="text-text-mute text-xs">→ {e.targetEmail}</span>}
                {tab === "auth" && e.ip && (
                  <span className="font-mono text-xs text-text-faint ml-auto">{e.ip}</span>
                )}
                {href && (
                  <a href={href} className="text-gold text-xs font-mono hover:underline ml-auto">
                    {e.entityType} ↗
                  </a>
                )}
                {tab === "actions" && !href && (
                  <span className="font-mono text-xs text-text-faint ml-auto">
                    {e.entityType}/{e.entityId.slice(0, 18)}
                  </span>
                )}
              </div>
              {e.summary && <div className="text-xs text-text-mute mt-1 pl-[162px]">{e.summary}</div>}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-text-mute font-mono">
          {events.length} of {total} events
        </span>
        {events.length < total && (
          <Button variant="outline" size="sm" disabled={loading} onClick={() => load(events.length)} data-testid="button-security-more">
            {loading ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </Card>
  );
}
