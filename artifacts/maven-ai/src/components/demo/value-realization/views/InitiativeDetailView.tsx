import { ArrowLeft, FileText, Search, Scale, RefreshCw, AlertCircle } from "lucide-react";
import { useDemoLang, tBi } from "../DemoLangContext";
import { initiative as iDict, t as tr } from "../value-realization-i18n";
import { useValueRealizationData } from "@/hooks/useValueRealizationData";
import {
  generateChaseQueue,
  formatAED,
  gap,
  realisationPct,
  CONDUCTOR_AGENTS,
} from "@/data/value-realization-agent";
import { getSponsor } from "@/data/value-realization-seed";
import { BRAND, BRAND_INK, NAVY, SEMANTIC } from "../tokens";

interface Props {
  initiativeId: string | null;
  onBack: () => void;
  onSelectInitiative: (id: string) => void;
}

export default function InitiativeDetailView({ initiativeId, onBack, onSelectInitiative }: Props) {
  const { lang } = useDemoLang();
  const data = useValueRealizationData();

  if (!initiativeId) {
    return (
      <div className="text-center py-16" data-testid="initiative-detail-empty">
        <h2 className="text-lg font-bold" style={{ color: NAVY }}>{tr(iDict, "pickPrompt", lang)}</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">{tr(iDict, "pickHelp", lang)}</p>
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-3 gap-2 max-w-3xl mx-auto">
          {data.initiatives.slice(0, 6).map((i) => (
            <button
              key={i.id}
              onClick={() => onSelectInitiative(i.id)}
              className="text-left p-3 rounded-lg border border-gray-200 hover:border-gray-400 bg-white"
              data-testid={`pick-${i.id}`}
            >
              <p className="text-xs font-semibold" style={{ color: NAVY }}>{tBi(i.name, lang)}</p>
              <p className="text-[10px] text-gray-500">{tBi(i.businessUnit, lang)}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const i = data.initiatives.find((x) => x.id === initiativeId);
  if (!i) return <div className="text-sm text-gray-500">Initiative not found.</div>;

  const sponsor = getSponsor(i.sponsorId);
  const queue = generateChaseQueue().filter((c) => c.initiativeId === i.id);
  const pct = realisationPct(i);
  const variance = Math.round(((i.realizedAnnual - i.promisedAnnual * 0.7) / Math.max(1, i.promisedAnnual)) * 100);
  const newTarget = Math.round(i.realizedAnnual * 1.2 / 1_000_000) + "M";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-xs font-semibold flex items-center gap-1 text-gray-500 hover:text-gray-800" data-testid="button-back">
          <ArrowLeft size={14} /> {tr(iDict, "backToPortfolio", lang)}
        </button>
      </div>
      <header>
        <h1 className="text-2xl font-extrabold" style={{ color: NAVY }} data-testid="text-initiative-name">{tBi(i.name, lang)}</h1>
        <p className="text-sm text-gray-500">{tBi(i.businessUnit, lang)}</p>
      </header>

      {/* Meta strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
        <Meta label={tr(iDict, "sponsorLabel", lang)} value={sponsor ? tBi(sponsor.name, lang) : "—"} />
        <Meta label={tr(iDict, "statusLabel", lang)} value={i.status} />
        <Meta label={tr(iDict, "typeLabel", lang)} value={i.type} />
        <Meta label={tr(iDict, "investedLabel", lang)} value={formatAED(i.invested)} />
        <Meta label={tr(iDict, "promisedLabel", lang)} value={formatAED(i.promisedAnnual)} />
        <Meta label={tr(iDict, "realizedLabel", lang)} value={formatAED(i.realizedAnnual)} accent />
        <Meta label={tr(iDict, "driftLabel", lang)} value={`${i.driftDays} ${tr(iDict, "days", lang)}`} critical={i.driftDays > 60} />
      </div>

      {/* 4 workspace cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <WorkspaceCard
          icon={<FileText size={14} />}
          tint={BRAND}
          title={tr(iDict, "sectionClaim", lang)}
          agent="claim-compiler"
          lang={lang}
          body={tr(iDict, "claimBody", lang)
            .replace("{realized}", formatAED(i.realizedAnnual))
            .replace("{promised}", formatAED(i.promisedAnnual))
            .replace("{pct}", String(pct))
            .replace("{confidence}", String(i.confidence))}
          testId="card-claim"
        />
        <WorkspaceCard
          icon={<Search size={14} />}
          tint="#156082"
          title={tr(iDict, "sectionEvidence", lang)}
          agent="evidence-auditor"
          lang={lang}
          body={tr(iDict, "evidenceBody", lang).replace("{variance}", String(Math.abs(variance)))}
          testId="card-evidence"
        />
        <WorkspaceCard
          icon={<Scale size={14} />}
          tint={SEMANTIC.critical}
          title={tr(iDict, "sectionAttribution", lang)}
          agent="attribution-critic"
          lang={lang}
          body={tr(iDict, "attributionBody", lang).replace("{attribPct}", String(Math.max(40, pct))).replace("{remPct}", String(100 - Math.max(40, pct)))}
          testId="card-attribution"
        />
        <WorkspaceCard
          icon={<RefreshCw size={14} />}
          tint={BRAND}
          title={tr(iDict, "sectionRebaseline", lang)}
          agent="rebaseline-drafter"
          lang={lang}
          body={tr(iDict, "rebaselineBody", lang).replace("{newTarget}", newTarget)}
          testId="card-rebaseline"
        />
      </div>

      {/* Chase running */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden" data-testid="card-chase-running">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: NAVY }}>
            <AlertCircle size={14} style={{ color: BRAND }} />
            {tr(iDict, "chaseRunningTitle", lang)}
          </h2>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">{tr(iDict, "chaseStage", lang)}</th>
              <th className="px-3 py-2 text-left">{tr(iDict, "chaseAgent", lang)}</th>
              <th className="px-3 py-2 text-left">{tr(iDict, "chaseLabel", lang)}</th>
              <th className="px-3 py-2 text-left">{tr(iDict, "chaseStatus", lang)}</th>
            </tr>
          </thead>
          <tbody>
            {queue.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">No active chase items for this initiative.</td></tr>
            )}
            {queue.map((c) => {
              const a = CONDUCTOR_AGENTS.find((x) => x.id === c.agentId);
              return (
                <tr key={c.id} className="border-t border-gray-100" data-testid={`chase-row-${c.id}`}>
                  <td className="px-3 py-2 text-gray-700">{c.stage}</td>
                  <td className="px-3 py-2 font-semibold" style={{ color: a?.color }}>{a ? tBi(a.name, lang) : c.agentId}</td>
                  <td className="px-3 py-2 text-gray-700">{tBi(c.label, lang)}</td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={statusStyle(c.status)}>{c.status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Meta({ label, value, accent, critical }: { label: string; value: string; accent?: boolean; critical?: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2">
      <p className="text-[9px] uppercase font-bold tracking-wider text-gray-500">{label}</p>
      <p className="text-sm font-bold" style={{ color: critical ? SEMANTIC.critical : accent ? BRAND_INK : NAVY }}>{value}</p>
    </div>
  );
}

function WorkspaceCard({ icon, tint, title, agent, body, lang, testId }: {
  icon: React.ReactNode; tint: string; title: string; agent: string; body: string; lang: "en" | "ar"; testId: string;
}) {
  const a = CONDUCTOR_AGENTS.find((x) => x.id === agent);
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4" data-testid={testId}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-md flex items-center justify-center text-white" style={{ background: tint }}>{icon}</div>
        <div>
          <p className="text-sm font-bold" style={{ color: NAVY }}>{title}</p>
          {a && <p className="text-[10px] text-gray-500">{tBi(a.name, lang)}</p>}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-gray-700">{body}</p>
    </section>
  );
}

function statusStyle(s: string): React.CSSProperties {
  switch (s) {
    case "running": return { background: "#DBEAFE", color: "#1D4ED8" };
    case "queued": return { background: "#F3F4F6", color: "#4B5563" };
    case "done": return { background: "#D1FAE5", color: BRAND_INK };
    case "blocked": return { background: "#FEE2E2", color: SEMANTIC.critical };
    default: return {};
  }
}
