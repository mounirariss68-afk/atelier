import * as React from "react";
import {
  useAtelierForgePrototype,
  useAtelierApprovePrototypeBrief,
  useAtelierApprovePrototypePrompt,
  useAtelierGetMe,
  type AtelierPrototype,
} from "@workspace/api-client-react";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Wrench, Copy, Lock, ShieldCheck } from "lucide-react";

export function PrototypeButton({ oppId, oppName }: { oppId: string; oppName: string }) {
  const [open, setOpen] = React.useState(false);
  const [proto, setProto] = React.useState<AtelierPrototype | null>(null);
  const { data: me } = useAtelierGetMe();
  // Task #292 — partner-tier + senior_manager (formerly engagement_lead).
  const isLeadOrPartner =
    me?.role === "founding_partner" ||
    me?.role === "partner" ||
    me?.role === "senior_manager";
  const isPartner = me?.role === "partner";

  const forge = useAtelierForgePrototype({
    mutation: {
      onSuccess: (resp: { prototype: AtelierPrototype }) => {
        setProto(resp.prototype);
        setOpen(true);
      },
    },
  });
  const approveBrief = useAtelierApprovePrototypeBrief({
    mutation: { onSuccess: (p: AtelierPrototype) => setProto(p) },
  });
  const approvePrompt = useAtelierApprovePrototypePrompt({
    mutation: { onSuccess: (p: AtelierPrototype) => setProto(p) },
  });

  const status = proto?.status ?? "draft";
  const briefApproved = !!proto?.leadApprovedAt || status === "lead_approved" || status === "live";
  const promptApproved = !!proto?.partnerApprovedAt || status === "live";
  const briefObj = (proto?.brief ?? {}) as Record<string, unknown>;

  return (
    <>
      <PillButton
        variant="ghost"
        data-testid="button-prototype-forge"
        onClick={() =>
          forge.mutate({
            oppId,
            data: {
              name: `Prototype — ${oppName}`,
              audience: "Client decision-maker",
              problem: "Demonstrate agentic feasibility in 1 week.",
              agenticThesis: "An agent assists; a human always decides.",
              demos: ["Headline workflow", "Audit & override"],
              constraints: ["bilingual-aware", "audit trail"],
              partnerDataApproved: false,
            },
          })
        }
        disabled={forge.isPending}
      >
        <span className="inline-flex items-center gap-1">
          <Wrench className="w-3 h-3" /> {forge.isPending ? "Forging…" : "Prototype"}
        </span>
      </PillButton>
      {open && proto && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
          onClick={() => setOpen(false)}
        >
          <Card
            className="max-w-3xl w-full p-5 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            data-testid="prototype-modal"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-text">{proto.name}</div>
                <div className="text-[10px] font-mono uppercase text-text-mute mt-0.5">
                  {oppName}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <MonoChip
                  tone={status === "live" ? "green" : status === "lead_approved" ? "amber" : "default"}
                  data-testid="prototype-status"
                >
                  {status}
                </MonoChip>
                <PillButton variant="ghost" onClick={() => setOpen(false)}>Close</PillButton>
              </div>
            </div>

            {/* Brief preview — always visible */}
            <div className="space-y-1" data-testid="prototype-brief">
              <div className="text-[11px] font-mono uppercase text-text-mute">Brief</div>
              <div className="rounded border border-border-soft bg-bg-deep p-3 text-xs text-text space-y-1">
                <div><span className="text-text-mute">Audience:</span> {String(briefObj.audience ?? "—")}</div>
                <div><span className="text-text-mute">Problem:</span> {String(briefObj.problem ?? "—")}</div>
                <div><span className="text-text-mute">Thesis:</span> {String(briefObj.agenticThesis ?? "—")}</div>
                <div>
                  <span className="text-text-mute">Demos:</span>{" "}
                  {Array.isArray(briefObj.demos) ? (briefObj.demos as string[]).join(" · ") : "—"}
                </div>
                <div>
                  <span className="text-text-mute">Data policy:</span>{" "}
                  {briefObj.partnerDataApproved
                    ? "Real client data permitted (Partner approved)"
                    : "Synthetic/watermarked data only"}
                </div>
              </div>
            </div>

            {/* Demo storyboard always visible — it's part of the brief, not the buildable prompt. */}
            <div className="space-y-1">
              <div className="text-[11px] font-mono uppercase text-text-mute">Demo storyboard</div>
              <ul className="text-xs text-text space-y-1">
                {(proto.demoStoryboard ?? []).map((s, i) => (
                  <li key={s.id ?? i} className="border-l-2 border-gold/40 pl-2">
                    <span className="font-medium">{s.title}</span>
                    {s.moment && <span className="text-text-mute"> — {s.moment}</span>}
                  </li>
                ))}
              </ul>
            </div>

            {/* Approval state machine */}
            <div className="rounded border border-border-soft bg-bg-deep p-3 space-y-2" data-testid="prototype-gates">
              <div className="text-[11px] font-mono uppercase text-text-mute">Approval gates</div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className={`w-3 h-3 ${briefApproved ? "text-gold" : "text-text-mute"}`} />
                  <span className={briefApproved ? "text-text" : "text-text-mute"}>
                    Gate 1 — Engagement Lead approves brief
                    {briefApproved && proto.leadApprovedAt && (
                      <span className="text-text-mute ml-2">
                        · {new Date(proto.leadApprovedAt).toLocaleString()}
                      </span>
                    )}
                  </span>
                </div>
                <PillButton
                  variant={briefApproved ? "ghost" : "primary"}
                  data-testid="button-approve-brief"
                  onClick={() => approveBrief.mutate({ prototypeId: proto.id })}
                  disabled={!isLeadOrPartner || briefApproved || approveBrief.isPending}
                  title={
                    !isLeadOrPartner
                      ? "Lead/Partner-only checkpoint"
                      : briefApproved
                        ? "Brief already approved"
                        : "Approve brief to unlock prompt approval"
                  }
                >
                  {briefApproved ? "Approved" : approveBrief.isPending ? "Approving…" : "Approve brief"}
                </PillButton>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className={`w-3 h-3 ${promptApproved ? "text-gold" : "text-text-mute"}`} />
                  <span className={promptApproved ? "text-text" : "text-text-mute"}>
                    Gate 2 — Partner approves generated prompt
                    {promptApproved && proto.partnerApprovedAt && (
                      <span className="text-text-mute ml-2">
                        · {new Date(proto.partnerApprovedAt).toLocaleString()}
                      </span>
                    )}
                  </span>
                </div>
                <PillButton
                  variant={promptApproved ? "ghost" : "primary"}
                  data-testid="button-approve-prompt"
                  onClick={() => approvePrompt.mutate({ prototypeId: proto.id })}
                  disabled={!isPartner || !briefApproved || promptApproved || approvePrompt.isPending}
                  title={
                    !isPartner
                      ? "Partner-only checkpoint"
                      : !briefApproved
                        ? "Lead must approve brief first"
                        : promptApproved
                          ? "Prompt already approved"
                          : "Approve prompt — unlocks copy/use"
                  }
                >
                  {promptApproved ? "Approved" : approvePrompt.isPending ? "Approving…" : "Approve prompt"}
                </PillButton>
              </div>
            </div>

            {/* Replit prompt — gated behind both approvals */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-mono uppercase text-text-mute">Replit prompt</div>
                <PillButton
                  variant="ghost"
                  data-testid="button-copy-prompt"
                  onClick={() => navigator.clipboard.writeText(proto.replitPromptMd ?? "")}
                  disabled={!promptApproved}
                  title={promptApproved ? "Copy approved prompt" : "Locked until Partner approves"}
                >
                  <span className="inline-flex items-center gap-1">
                    {promptApproved ? <Copy className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    {promptApproved ? "Copy prompt" : "Locked"}
                  </span>
                </PillButton>
              </div>
              {promptApproved ? (
                <pre
                  className="text-[11px] font-mono whitespace-pre-wrap bg-bg-deep border border-border-soft rounded p-3"
                  data-testid="prototype-prompt"
                >
                  {proto.replitPromptMd}
                </pre>
              ) : (
                <div
                  className="text-[11px] font-mono bg-bg-deep border border-dashed border-border-soft rounded p-3 text-text-mute flex items-start gap-2"
                  data-testid="prototype-prompt-locked"
                >
                  <Lock className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>
                    Prompt is locked until both gates are cleared. The Engagement Lead must approve
                    the brief and the Partner must approve the generated prompt before the
                    Replit-ready text is revealed or copyable. This protects against shipping
                    un-reviewed AI surfaces to clients.
                  </span>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
