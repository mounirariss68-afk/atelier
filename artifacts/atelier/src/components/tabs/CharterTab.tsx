import * as React from "react";
import {
  useAtelierListCharterVersions,
  useAtelierGetHypothesisTree,
  useAtelierRedraftCharter,
  useAtelierApproveCharterVersion,
  useAtelierGetMe,
  getAtelierListCharterVersionsQueryKey,
  getAtelierGetHypothesisTreeQueryKey,
  getAtelierGetEngagementQueryKey,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, PillButton, MonoChip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { HypothesisTree, type HypothesisTreeShape } from "@/components/HypothesisTree";
import { Wand2, Check, AlertTriangle } from "lucide-react";

export function CharterTab({ engId }: { engId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();
  const { data: versions, isLoading: vLoading } = useAtelierListCharterVersions(engId);
  const { data: tree } = useAtelierGetHypothesisTree(engId);
  const redraft = useAtelierRedraftCharter();
  const approve = useAtelierApproveCharterVersion();
  const [selectedVid, setSelectedVid] = React.useState<string | null>(null);
  const [diffMode, setDiffMode] = React.useState(false);
  const [compareVid, setCompareVid] = React.useState<string | null>(null);

  const live = versions?.find((v) => v.status === "live") ?? null;
  const latest = versions?.[0] ?? null;
  const selected = versions?.find((v) => v.id === selectedVid) ?? latest;
  const compare = versions?.find((v) => v.id === compareVid) ?? null;

  function invalidate() {
    qc.invalidateQueries({ queryKey: getAtelierListCharterVersionsQueryKey(engId) });
    qc.invalidateQueries({ queryKey: getAtelierGetHypothesisTreeQueryKey(engId) });
    qc.invalidateQueries({ queryKey: getAtelierGetEngagementQueryKey(engId) });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
  }

  async function onRedraft() {
    await redraft.mutateAsync({ engId, data: {} });
    invalidate();
    toast({ title: "Charter Architect", description: "New version drafted." });
  }

  async function onApprove(role: "lead" | "partner", vid: string) {
    await approve.mutateAsync({ engId, versionId: vid, data: { role } });
    invalidate();
    toast({ title: `Charter ${role}-approved`, description: role === "partner" ? "Now live." : "Awaiting partner sign-off." });
  }

  if (vLoading) return <Skeleton className="h-64 bg-bg-elevate" />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Versions rail */}
      <div className="lg:col-span-1 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Versions</div>
          <PillButton
            variant="primary"
            onClick={onRedraft}
            disabled={redraft.isPending}
            data-testid="btn-redraft-charter"
          >
            <Wand2 className="w-3.5 h-3.5 mr-1.5" />
            {redraft.isPending ? "Architecting…" : "Redraft"}
          </PillButton>
        </div>
        {(versions ?? []).length === 0 && (
          <Card className="p-6 text-center border-dashed bg-bg-deep">
            <p className="text-text-mute text-sm">No charter yet. Run the Architect.</p>
          </Card>
        )}
        {(versions ?? []).map((v) => (
          <button
            key={v.id}
            onClick={() => setSelectedVid(v.id)}
            data-testid={`charter-version-${v.versionNumber}`}
            className={`w-full text-left p-3 rounded-md border transition-colors ${
              (selected?.id ?? latest?.id) === v.id
                ? "border-gold bg-bg-elevate"
                : "border-border-soft bg-bg-deep hover:border-border"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-text">v{v.versionNumber}</span>
              <MonoChip
                tone={
                  v.status === "live" ? "green" : v.status === "lead_approved" ? "gold" : "default"
                }
              >
                {v.status}
              </MonoChip>
            </div>
            <div className="text-[11px] font-mono text-text-mute mt-1">
              {new Date(v.createdAt).toLocaleString()}
            </div>
            {(v.meceFlags ?? []).length > 0 && (
              <div className="mt-2 flex items-center gap-1 text-xs text-amber">
                <AlertTriangle className="w-3 h-3" />
                {v.meceFlags.length} MECE flag{v.meceFlags.length === 1 ? "" : "s"}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Detail */}
      <div className="lg:col-span-2 space-y-6">
        {selected ? (
          <>
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono uppercase text-text-mute">Charter</div>
                  <div className="text-lg font-semibold text-text mt-1">
                    v{selected.versionNumber} · {selected.status}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selected.status === "draft" && (
                    <PillButton
                      variant="ghost"
                      onClick={() => onApprove("lead", selected.id)}
                      disabled={approve.isPending}
                      data-testid="btn-charter-lead-approve"
                    >
                      <Check className="w-3.5 h-3.5 mr-1.5" /> Lead approve
                    </PillButton>
                  )}
                  {selected.status === "lead_approved" && me?.role === "partner" && (
                    <PillButton
                      variant="primary"
                      onClick={() => onApprove("partner", selected.id)}
                      disabled={approve.isPending}
                      data-testid="btn-charter-partner-approve"
                    >
                      <Check className="w-3.5 h-3.5 mr-1.5" /> Partner sign-off
                    </PillButton>
                  )}
                </div>
              </div>

              {(selected.meceFlags ?? []).length > 0 && (
                <div className="rounded-md border border-amber/40 bg-amber/5 p-3 text-sm text-amber">
                  <div className="font-medium mb-1 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> MECE concerns
                  </div>
                  <ul className="list-disc ml-5 space-y-0.5">
                    {selected.meceFlags.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 -mt-2">
                {(versions ?? []).length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDiffMode((m) => !m);
                      if (!diffMode) {
                        const other = (versions ?? []).find((v) => v.id !== selected.id);
                        setCompareVid(other?.id ?? null);
                      }
                    }}
                    data-testid="btn-toggle-diff"
                    className="text-[11px] font-mono uppercase text-text-mute hover:text-gold transition-colors"
                  >
                    {diffMode ? "Hide diff" : "Compare versions…"}
                  </button>
                )}
              </div>

              {diffMode && compare ? (
                <CharterDiff a={compare} b={selected} versions={versions ?? []} onPickA={setCompareVid} />
              ) : (
                <CharterBody body={selected.body as never} />
              )}
            </Card>

            <Card className="p-5 space-y-3">
              <div className="text-xs font-mono uppercase text-text-mute">Hypothesis tree</div>
              <HypothesisTree
                tree={
                  ((live?.hypothesisTree as HypothesisTreeShape | undefined) ??
                    (selected.hypothesisTree as HypothesisTreeShape | undefined) ??
                    (tree?.root as HypothesisTreeShape | undefined)) ?? null
                }
              />
            </Card>
          </>
        ) : (
          <Card className="p-12 text-center border-dashed bg-bg-deep">
            <p className="text-text-mute">No charter yet. Press Redraft to invoke the Architect.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function CharterBody({ body }: { body: unknown }) {
  if (!body || typeof body !== "object") {
    return <div className="text-text-mute text-sm font-mono">(empty)</div>;
  }
  const b = body as {
    objectives?: string[];
    scope?: string[];
    outOfScope?: string[];
    successMetrics?: { name: string; baseline?: string; target?: string }[];
    governance?: string;
    valueHypothesis?: string;
  };
  return (
    <div className="space-y-4 text-sm">
      {(b.objectives?.length ?? 0) > 0 && (
        <Section label="Objectives">
          <ul className="list-disc ml-5 text-text space-y-0.5">{b.objectives!.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Section>
      )}
      {(b.scope?.length ?? 0) > 0 && (
        <Section label="In scope">
          <ul className="list-disc ml-5 text-text">{b.scope!.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Section>
      )}
      {(b.outOfScope?.length ?? 0) > 0 && (
        <Section label="Out of scope">
          <ul className="list-disc ml-5 text-text-mute">{b.outOfScope!.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Section>
      )}
      {(b.successMetrics?.length ?? 0) > 0 && (
        <Section label="Success metrics">
          <ul className="space-y-1">
            {b.successMetrics!.map((m, i) => (
              <li key={i} className="font-mono text-xs">
                <span className="text-text">{m.name}</span>
                {m.baseline && <span className="text-text-mute ml-2">baseline: {m.baseline}</span>}
                {m.target && <span className="text-gold ml-2">→ {m.target}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {b.governance && (
        <Section label="Governance">
          <p className="text-text leading-relaxed">{b.governance}</p>
        </Section>
      )}
      {b.valueHypothesis && (
        <Section label="Value hypothesis">
          <p className="text-text leading-relaxed italic">{b.valueHypothesis}</p>
        </Section>
      )}
    </div>
  );
}

type CharterVersionLike = {
  id: string;
  versionNumber: number;
  body: unknown;
  meceFlags?: string[];
};

function CharterDiff({
  a,
  b,
  versions,
  onPickA,
}: {
  a: CharterVersionLike;
  b: CharterVersionLike;
  versions: CharterVersionLike[];
  onPickA: (id: string) => void;
}) {
  return (
    <div className="space-y-3" data-testid="charter-diff">
      <div className="flex items-center gap-2 text-xs font-mono text-text-mute">
        <span>Compare</span>
        <select
          value={a.id}
          onChange={(e) => onPickA(e.target.value)}
          data-testid="select-diff-base"
          className="bg-bg-elevate border border-border rounded-md px-2 py-1 text-text"
        >
          {versions
            .filter((v) => v.id !== b.id)
            .map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNumber}
              </option>
            ))}
        </select>
        <span>against current v{b.versionNumber}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="border border-border-soft rounded-md p-3 bg-bg-deep">
          <div className="text-[10px] font-mono uppercase text-text-mute mb-2">
            v{a.versionNumber} (base)
          </div>
          <CharterBody body={a.body as never} />
        </div>
        <div className="border border-gold/40 rounded-md p-3 bg-bg-deep">
          <div className="text-[10px] font-mono uppercase text-gold mb-2">
            v{b.versionNumber} (current)
          </div>
          <CharterBody body={b.body as never} />
        </div>
      </div>
      <pre
        className="text-[11px] font-mono text-text-mute bg-bg-deep border border-border-soft rounded-md p-3 overflow-auto whitespace-pre-wrap"
        data-testid="charter-diff-raw"
      >
        {renderJsonDiff(a.body, b.body)}
      </pre>
    </div>
  );
}

function renderJsonDiff(a: unknown, b: unknown): string {
  const aStr = JSON.stringify(a, null, 2).split("\n");
  const bStr = JSON.stringify(b, null, 2).split("\n");
  const out: string[] = [];
  const max = Math.max(aStr.length, bStr.length);
  for (let i = 0; i < max; i++) {
    const left = aStr[i] ?? "";
    const right = bStr[i] ?? "";
    if (left === right) out.push("  " + left);
    else {
      if (left) out.push("- " + left);
      if (right) out.push("+ " + right);
    }
  }
  return out.join("\n");
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-mute mb-1.5">{label}</div>
      {children}
    </div>
  );
}
