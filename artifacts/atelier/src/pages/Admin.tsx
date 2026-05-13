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
import { ShieldAlert, Shield, Globe, Download, Lock, KeyRound, FileCheck2, ListTodo } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Admin() {
  const { data: me, isLoading } = useAtelierGetMe();
  const { data: settings, isLoading: settingsLoading } = useAtelierGetAdminSettings({
    query: { enabled: me?.role === "partner", queryKey: getAtelierGetAdminSettingsQueryKey() },
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
  };
  const [posture, setPosture] = React.useState<Posture | null>(null);
  const [todos, setTodos] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (me?.role !== "partner") return;
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

  if (me.role !== "partner") {
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
      </div>
    </div>
  );
}
