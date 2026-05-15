/**
 * Agents lens — Design stage (Task #370).
 *
 * Lists agent specs awaiting Build, with intent / tools / guardrails
 * and a fork-from-library entry into Atelier (the firm IP catalogue).
 */
import { Link } from "wouter";
import { ArrowUpRight, GitFork } from "lucide-react";
import {
  PageHero,
  SectionHead,
  Card,
  MonoChip,
  Eyebrow,
  PillButton,
} from "@/components/ui/primitives";
import { useAgentSpecs, type AgentSpec } from "@/lib/agents-lens-seed";

const STATUS_TONE: Record<AgentSpec["status"], "default" | "gold" | "green"> = {
  drafting: "default",
  in_review: "gold",
  approved: "green",
};

export default function AgentsDesign() {
  const specs = useAgentSpecs();
  return (
    <div className="animate-in fade-in">
      <PageHero>
        <Eyebrow>Manage · Agents · Design</Eyebrow>
        <SectionHead
          headline="Design — agent specs"
          lede="Intent, prompt scaffolds, tools, guardrails and persona binding. Each spec is reviewed and approved before it earns a Build version."
          className="mt-3"
        />
        <div className="mt-6">
          <Link href="/atelier/ip">
            <PillButton variant="primary" data-testid="button-fork-from-library">
              <GitFork className="w-3.5 h-3.5 mr-1.5 inline" />
              Fork from Atelier library
            </PillButton>
          </Link>
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-4">
        {specs.length === 0 && (
          <Card className="p-8 text-text-mute border-dashed">No specs in flight.</Card>
        )}
        {specs.map((spec) => (
          <Card key={spec.id} className="p-5 space-y-4" data-testid={`design-spec-${spec.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-text">{spec.name}</h3>
                  <MonoChip tone={STATUS_TONE[spec.status]}>{spec.status.replace("_", " ")}</MonoChip>
                  <MonoChip>{spec.group}</MonoChip>
                </div>
                <p className="text-sm text-text-mute leading-relaxed max-w-3xl">{spec.intent}</p>
              </div>
              <div className="text-right text-xs font-mono text-text-faint space-y-0.5">
                <div>owner: {spec.owner}</div>
                <div>updated: {new Date(spec.updatedAt).toLocaleDateString()}</div>
                {spec.forkedFrom && (
                  <div className="text-gold/70">forked from {spec.forkedFrom}</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div>
                <div className="font-mono uppercase tracking-widest text-text-faint mb-1">Tools</div>
                <div className="flex flex-wrap gap-1.5">
                  {spec.tools.map((t) => (
                    <code key={t} className="px-1.5 py-0.5 rounded border border-border-soft text-gold bg-bg-deep">
                      {t}
                    </code>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-mono uppercase tracking-widest text-text-faint mb-1">Guardrails</div>
                <ul className="list-disc list-inside text-text-mute space-y-0.5">
                  {spec.guardrails.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-mono uppercase tracking-widest text-text-faint mb-1">
                  Persona binding
                </div>
                <code className="text-gold">{spec.personaBinding}</code>
              </div>
            </div>

            <div className="border-t border-border-soft pt-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-2">
                Approval log
              </div>
              <div className="space-y-1 text-xs text-text-mute">
                {spec.reviewLog.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="font-mono text-text-faint w-24 shrink-0">{r.at}</span>
                    <span className="text-text">{r.actor}</span>
                    <MonoChip
                      tone={
                        r.decision === "approve"
                          ? "green"
                          : r.decision === "request_changes"
                            ? "gold"
                            : "default"
                      }
                    >
                      {r.decision}
                    </MonoChip>
                    <span className="truncate">{r.note}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Link
                href={`/agents/design/${spec.forkedFrom ?? spec.id}`}
                className="inline-flex items-center gap-1 text-xs font-mono text-gold hover:underline"
                data-testid={`link-spec-detail-${spec.id}`}
              >
                Open spec detail <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
