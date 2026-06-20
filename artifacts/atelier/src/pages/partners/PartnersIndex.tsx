/**
 * Partners lens — alliance lifecycle management (Task #371).
 *
 * Lifecycle: Identify → Qualify → Co-sell → Co-deliver → Govern → Renew.
 * The lens lives at /partners; existing /alliances/* routes redirect into
 * the matching lifecycle stage. The /partners index renders a lifecycle
 * ribbon with live counts; each stage view is a first-pass scaffold built
 * on the v5 listHook pattern.
 *
 * Re-mounted from existing Alliances:
 *   - Identify  ← Partner Firms
 *   - Co-sell   ← Joint Pipeline
 *   - Govern    ← Certifications + Conflicts
 * New scaffolds: target partners, capability matrix, MDF, joint marketing,
 * sub-contractor SOWs, framework agreements, QBRs, scorecards, renewals,
 * tier changes, off-boardings.
 */
import { useRoute, Link } from "wouter";
import {
  Card,
  MonoChip,
} from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import {
  Handshake,
  GitMerge,
  Award,
  AlertTriangle,
  Search,
  Megaphone,
  Wrench,
  Shield,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import {
  useAlliancePartnerFirms,
  useJointPipeline,
  useCertifications,
  useAllianceConflicts,
  usePartnerTargets,
  usePartnerCapabilities,
  usePartnerMdf,
  usePartnerJointMarketing,
  usePartnerSubcontracts,
  usePartnerFrameworks,
  usePartnerQbrs,
  usePartnerScorecards,
  usePartnerRenewals,
  usePartnerTierChanges,
  usePartnerOffboardings,
} from "@/lib/v5-hooks";

const STAGES = [
  { id: "identify", label: "Identify", href: "/partners/identify", icon: Search, blurb: "Map the ecosystem; surface target partners and rationale." },
  { id: "qualify", label: "Qualify", href: "/partners/qualify", icon: CheckCircle2, blurb: "Capability matrix, NDA, mutual evaluation, reference data." },
  { id: "co-sell", label: "Co-sell", href: "/partners/co-sell", icon: GitMerge, blurb: "Joint pipeline, MDF, lead exchange, joint marketing." },
  { id: "co-deliver", label: "Co-deliver", href: "/partners/co-deliver", icon: Wrench, blurb: "Engagements with partner participation, sub-SOWs, joint quality." },
  { id: "govern", label: "Govern", href: "/partners/govern", icon: Shield, blurb: "Frameworks, QBRs, certifications, scorecards, conflicts." },
  { id: "renew", label: "Renew", href: "/partners/renew", icon: RefreshCw, blurb: "Renewal pipeline, tier changes, off-boarding." },
] as const;

type StageId = (typeof STAGES)[number]["id"];

const KNOWN_SECTIONS = new Set<string>(["overview", ...STAGES.map((s) => s.id)]);

export default function PartnersIndex() {
  const [, params] = useRoute<{ section?: string }>("/partners/:section");
  const raw = params?.section ?? "overview";
  // Unknown section deep-links (typos, stale audit links, removed stage ids)
  // fall through to the lifecycle ribbon home rather than rendering a blank
  // tab body. Code-review (#371) flagged this as the only robustness gap.
  const section = (KNOWN_SECTIONS.has(raw) ? raw : "overview") as
    | StageId
    | "overview";

  return (
    <div className="animate-in fade-in">
      <LensPageHeader
        headline="Alliance lifecycle — from ecosystem map to framework renewal"
        lede="Partner management has its own lifecycle that mirrors but is distinct from the client commercial loop. Identify ecosystems, qualify partners, co-sell into joint pipeline, co-deliver shared engagements, govern the relationship, and renew the framework."
      />
      {/* The shell-level LensSectionTabs already renders the Overview/Identify/
          Qualify/Co-sell/Co-deliver/Govern/Renew strip — see lens.ts. We
          intentionally do NOT re-render it here (Task #401). */}
      <div className="container-atelier py-6">
        <div className="mt-2">
          {section === "overview" && <LifecycleRibbon />}
          {section === "identify" && <IdentifyView />}
          {section === "qualify" && <QualifyView />}
          {section === "co-sell" && <CoSellView />}
          {section === "co-deliver" && <CoDeliverView />}
          {section === "govern" && <GovernView />}
          {section === "renew" && <RenewView />}
        </div>
      </div>
    </div>
  );
}

// =============================================================
// OVERVIEW — lifecycle ribbon with live counts
// =============================================================
function LifecycleRibbon() {
  const firms = useAlliancePartnerFirms();
  const targets = usePartnerTargets();
  const caps = usePartnerCapabilities();
  const pipeline = useJointPipeline();
  const mdf = usePartnerMdf();
  const subs = usePartnerSubcontracts();
  const frameworks = usePartnerFrameworks();
  const qbrs = usePartnerQbrs();
  const certs = useCertifications();
  const conflicts = useAllianceConflicts();
  const renewals = usePartnerRenewals();
  const offboardings = usePartnerOffboardings();

  const counts: Record<StageId, { primary: string; secondary: string }> = {
    identify: {
      primary: `${firms.length} firms`,
      secondary: `${targets.length} targets in flight`,
    },
    qualify: {
      primary: `${caps.length} qualified`,
      secondary: `${caps.filter((c) => c.mutualEvalStatus !== "complete").length} eval in review`,
    },
    "co-sell": {
      primary: `${pipeline.length} joint opps`,
      secondary: `$${(mdf.reduce((s, m) => s + m.allocatedUsdK, 0) / 1).toFixed(0)}K MDF allocated`,
    },
    "co-deliver": {
      primary: `${subs.length} sub-SOWs`,
      secondary: `${subs.filter((s) => s.sowStatus !== "signed").length} unsigned`,
    },
    govern: {
      primary: `${frameworks.length} frameworks`,
      secondary: `${qbrs.filter((q) => q.status === "scheduled").length} QBRs scheduled · ${conflicts.length} conflicts · ${certs.filter((c) => c.status === "lapsing").length} certs lapsing`,
    },
    renew: {
      primary: `${renewals.length} in renewal`,
      secondary: `${offboardings.length} winding down`,
    },
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {STAGES.map((s, idx) => {
          const Icon = s.icon;
          const c = counts[s.id];
          return (
            <Link
              key={s.id}
              href={s.href}
              className="group"
              data-testid={`partners-stage-${s.id}`}
            >
              <Card hover className="p-4 h-full flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                    Stage {idx + 1}
                  </div>
                  <Icon className="w-4 h-4 text-gold/80 group-hover:text-gold transition-colors" />
                </div>
                <div className="font-medium text-text">{s.label}</div>
                <div className="text-2xl font-mono text-text">{c.primary}</div>
                <div className="text-xs text-text-faint">{c.secondary}</div>
                <div className="text-xs text-text-mute mt-2 leading-snug">{s.blurb}</div>
                <div className="mt-auto inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-widest text-gold/80 group-hover:text-gold">
                  open <ChevronRight className="w-3 h-3" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
      <p className="text-xs text-text-faint">
        Lifecycle framing draws on ASAP (Association of Strategic Alliance
        Professionals) and the SaaS/PaaS partner playbooks (AWS · Microsoft ·
        Google). Joint-pipeline and co-delivery views are read-throughs into
        the Clients lens; the underlying deals and engagements live there.
      </p>
    </div>
  );
}

// =============================================================
// IDENTIFY — partner directory + ecosystem map + targets
// =============================================================
function IdentifyView() {
  const firms = useAlliancePartnerFirms();
  const targets = usePartnerTargets();
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Partner directory</h3>
          <span className="text-xs text-text-faint inline-flex items-center gap-2">
            <Handshake className="w-3.5 h-3.5" />
            {firms.length} firms · relationship strength 1–5 (named-anchor + last-touch + joint-revenue)
          </span>
        </header>
        <div className="grid gap-3 md:grid-cols-2">
          {firms.map((f) => (
            <Card key={f.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-text">{f.name}</div>
                  <div className="text-xs text-text-faint">{f.kind} · {f.country} · {f.speciality}</div>
                </div>
                <MonoChip tone={f.relationshipStrength >= 4 ? "gold" : f.relationshipStrength >= 3 ? "green" : "amber"}>
                  strength {f.relationshipStrength}/5
                </MonoChip>
              </div>
              <div className="text-sm text-text-mute">
                Anchor · Cognirise: <span className="text-text">{f.anchorCognirise}</span> ↔ {f.name}: <span className="text-text">{f.anchorPartner}</span>
              </div>
              <div className="flex gap-1 flex-wrap text-xs">
                <MonoChip>last touch {f.lastTouchAt}</MonoChip>
                <MonoChip>{f.openJointOpps} open joint opps</MonoChip>
                <MonoChip>${f.lifetimeJointRevenueMm}M lifetime</MonoChip>
              </div>
              {f.recentMoves[0] && (
                <div className="text-xs text-text-faint border-l-2 border-l-border pl-2">
                  Recent: {f.recentMoves[0]}
                </div>
              )}
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Target partners — rationale + outreach</h3>
          <span className="text-xs text-text-faint">{targets.length} targets in flight</span>
        </header>
        <div className="space-y-2">
          {targets.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium text-text">{t.name}</div>
                  <div className="text-xs text-text-faint mt-1">{t.ecosystem} · {t.country}</div>
                  <div className="text-sm text-text-mute mt-2">{t.rationale}</div>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs">
                  <MonoChip tone={t.priority === "high" ? "gold" : "default"}>{t.priority}</MonoChip>
                  <MonoChip>{t.stage.replace("_", " ")}</MonoChip>
                  <span className="text-text-faint">last contact {t.lastContact ?? "—"}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

// =============================================================
// QUALIFY — capability matrix + NDA / mutual eval
// =============================================================
function QualifyView() {
  const caps = usePartnerCapabilities();
  const dimensions = ["delivery", "sales", "geo_gcc", "geo_eu", "regulated", "agents"] as const;
  return (
    <div className="space-y-6">
      <p className="text-sm text-text-mute">
        Capability matrix — 1–5 per dimension. NDA + mutual evaluation track
        whether a partner is cleared to enter the joint pipeline. Reference
        data (case-studies, compliance attestations) lives in the Codex; this
        view is the partner-facing lens on it.
      </p>
      <Card className="p-0 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-widest text-text-faint">
            <tr className="border-b border-border">
              <th className="px-4 py-3">Partner</th>
              {dimensions.map((d) => (
                <th key={d} className="px-3 py-3 font-mono">{d.replace("_", " ")}</th>
              ))}
              <th className="px-3 py-3">NDA</th>
              <th className="px-3 py-3">Mutual eval</th>
              <th className="px-3 py-3">Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {caps.map((c) => (
              <tr key={c.id} className="border-b border-border-soft last:border-0">
                <td className="px-4 py-3 font-medium text-text">{c.partnerFirm}</td>
                {dimensions.map((d) => {
                  const v = c.capabilities[d] ?? 0;
                  return (
                    <td key={d} className="px-3 py-3">
                      <MonoChip tone={v >= 4 ? "gold" : v >= 3 ? "green" : v >= 2 ? "amber" : "red"}>{v}</MonoChip>
                    </td>
                  );
                })}
                <td className="px-3 py-3"><MonoChip tone={c.ndaStatus === "signed" ? "green" : "amber"}>{c.ndaStatus}</MonoChip></td>
                <td className="px-3 py-3"><MonoChip tone={c.mutualEvalStatus === "complete" ? "green" : "amber"}>{c.mutualEvalStatus.replace("_", " ")}</MonoChip></td>
                <td className="px-3 py-3 text-xs text-text-faint font-mono">{c.lastReviewed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// =============================================================
// CO-SELL — joint pipeline (read), MDF, joint marketing
// =============================================================
function CoSellView() {
  const pipeline = useJointPipeline();
  const mdf = usePartnerMdf();
  const events = usePartnerJointMarketing();
  const total = pipeline.reduce((s, o) => s + o.acvUsdK, 0);
  const cogniriseShare = pipeline.reduce((s, o) => s + (o.acvUsdK * o.cognirisePct) / 100, 0);
  const mdfAllocated = mdf.reduce((s, m) => s + m.allocatedUsdK, 0);
  const mdfSpent = mdf.reduce((s, m) => s + m.spentUsdK, 0);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Joint pipeline · read-through from Clients · Opportunities</h3>
          <Link href="/opportunities" className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80">
            open clients lens →
          </Link>
        </header>
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="p-4">
            <div className="text-xs text-text-faint">Joint pipeline · ACV</div>
            <div className="text-2xl font-mono text-text mt-1">${(total / 1000).toFixed(2)}M</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-text-faint">Cognirise share</div>
            <div className="text-2xl font-mono text-gold mt-1">${(cogniriseShare / 1000).toFixed(2)}M</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-text-faint">Active joint opps</div>
            <div className="text-2xl font-mono text-text mt-1">{pipeline.length}</div>
          </Card>
        </div>
        <div className="space-y-2">
          {pipeline.map((o) => (
            <Card key={o.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium text-text">{o.opportunityName}</div>
                  <div className="text-xs text-text-faint mt-1">
                    {o.client} · with {o.partnerFirm} · {o.stage} · lead: {o.leadParty}
                  </div>
                  <div className="text-sm text-text-mute mt-2">{o.splitRationale}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-mono text-text">${o.acvUsdK}K</span>
                  <MonoChip tone="gold">Cognirise {o.cognirisePct}% · {o.partnerFirm.split(" ")[0]} {o.partnerPct}%</MonoChip>
                  <span className="text-xs text-text-faint">{o.allianceLetterStatus}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">MDF · Market Development Funds</h3>
          <span className="text-xs text-text-faint font-mono">${mdfSpent}K spent of ${mdfAllocated}K allocated</span>
        </header>
        <div className="space-y-2">
          {mdf.map((m) => {
            const pct = m.allocatedUsdK ? Math.round((m.spentUsdK / m.allocatedUsdK) * 100) : 0;
            return (
              <Card key={m.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="font-medium text-text">{m.program}</div>
                    <div className="text-xs text-text-faint mt-1">{m.partnerFirm} · ends {m.periodEnds}</div>
                    <div className="text-sm text-text-mute mt-2">{m.focus}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-xs">
                    <span className="font-mono text-text">${m.spentUsdK}K / ${m.allocatedUsdK}K</span>
                    <MonoChip tone={m.status === "active" ? "green" : "default"}>{m.status.replace("_", " ")}</MonoChip>
                    <span className="text-text-faint">{pct}% utilised</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Joint marketing & events</h3>
          <Megaphone className="w-3.5 h-3.5 text-text-faint" />
        </header>
        <div className="grid gap-3 md:grid-cols-2">
          {events.map((e) => (
            <Card key={e.id} className="p-4 space-y-1">
              <div className="font-medium text-text">{e.title}</div>
              <div className="text-xs text-text-faint">{e.kind.replace(/_/g, " ")} · with {e.partnerFirm}</div>
              <div className="flex items-center gap-2 text-xs mt-2">
                <MonoChip>{e.date}</MonoChip>
                <MonoChip tone={e.status === "confirmed" ? "green" : e.status === "in_promo" ? "gold" : "amber"}>{e.status.replace("_", " ")}</MonoChip>
                <span className="text-text-faint">~{e.expectedAttendees} attendees</span>
              </div>
              <div className="text-xs text-text-mute mt-1">Lead: {e.leadOwner}</div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

// =============================================================
// CO-DELIVER — engagements (read) + sub-SOWs + joint quality
// =============================================================
function CoDeliverView() {
  const subs = usePartnerSubcontracts();
  return (
    <div className="space-y-6">
      <p className="text-sm text-text-mute">
        Engagement workspace lives in <Link href="/clients/deliver/engagements" className="text-gold hover:underline">Clients · Engagements</Link>.
        This view tracks the partner-side of co-delivery: signed sub-SOWs,
        rate-card lock dates, monthly burn, and the joint-quality acceptance gate.
      </p>
      <div className="space-y-2">
        {subs.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="font-medium text-text">{s.engagement}</div>
                <div className="text-xs text-text-faint mt-1">with {s.partnerFirm}</div>
                <div className="text-sm text-text-mute mt-2">{s.scope}</div>
                <div className="text-xs text-text-faint mt-2 border-l-2 border-l-border pl-2">
                  Acceptance gate: {s.acceptanceGate}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 text-xs">
                <MonoChip tone={s.sowStatus === "signed" ? "green" : "amber"}>{s.sowStatus.replace("_", " ")}</MonoChip>
                <span className="font-mono text-text">${s.monthlyBurnUsdK}K/mo</span>
                <span className="text-text-faint">rate locked {s.rateCardLockedAt ?? "—"}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// =============================================================
// GOVERN — frameworks, QBRs, scorecards, certifications, conflicts
// =============================================================
function GovernView() {
  const frameworks = usePartnerFrameworks();
  const qbrs = usePartnerQbrs();
  const scorecards = usePartnerScorecards();
  const certs = useCertifications();
  const conflicts = useAllianceConflicts();
  const lapsing = certs.filter((c) => c.status === "lapsing");
  const lapsed = certs.filter((c) => c.status === "lapsed");

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="section-label">Framework / master agreements</h3>
        <div className="space-y-2">
          {frameworks.map((f) => (
            <Card key={f.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium text-text">{f.partnerFirm}</div>
                  <div className="text-xs text-text-faint mt-1">{f.agreementKind} · {f.governingLaw}</div>
                  <div className="text-sm text-text-mute mt-2">
                    {f.effectiveFrom} → {f.effectiveTo}
                  </div>
                  {f.exclusivities.length > 0 && (
                    <div className="text-xs text-gold/80 mt-2">
                      Exclusivities: {f.exclusivities.join("; ")}
                    </div>
                  )}
                </div>
                <MonoChip tone={f.status === "active" ? "green" : f.status === "expired_renewing" ? "amber" : "default"}>
                  {f.status.replace("_", " ")}
                </MonoChip>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="section-label">QBR cadence & artefacts</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {qbrs.map((q) => (
            <Card key={q.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-text">{q.partnerFirm}</div>
                  <div className="text-xs text-text-faint">{q.periodLabel} · {q.scheduledFor}</div>
                </div>
                <MonoChip tone={q.status === "completed" ? "green" : "amber"}>{q.status}</MonoChip>
              </div>
              <div className="text-xs text-text-faint">Attendees: {q.attendees.join(", ")}</div>
              {q.decisions.length > 0 && (
                <ul className="text-sm text-text-mute list-disc pl-4 space-y-1">
                  {q.decisions.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              )}
              {q.artefactsUrl && (
                <Link href={q.artefactsUrl} className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80">
                  artefacts →
                </Link>
              )}
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="section-label">Partner scorecards · trailing 12mo</h3>
        <Card className="p-0 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-text-faint">
              <tr className="border-b border-border">
                <th className="px-4 py-3">Partner</th>
                <th className="px-3 py-3 font-mono">Revenue</th>
                <th className="px-3 py-3 font-mono">Joint win-rate</th>
                <th className="px-3 py-3 font-mono">Satisfaction</th>
                <th className="px-3 py-3 font-mono">Delivery</th>
                <th className="px-3 py-3">Compliance</th>
                <th className="px-3 py-3">Trend</th>
              </tr>
            </thead>
            <tbody>
              {scorecards.map((s) => (
                <tr key={s.id} className="border-b border-border-soft last:border-0">
                  <td className="px-4 py-3 font-medium text-text">{s.partnerFirm}</td>
                  <td className="px-3 py-3 font-mono text-text">${s.revenueUsdK}K</td>
                  <td className="px-3 py-3 font-mono">{Math.round(s.jointWinRate * 100)}%</td>
                  <td className="px-3 py-3 font-mono">{s.satisfaction.toFixed(1)}/5</td>
                  <td className="px-3 py-3 font-mono">{s.deliveryQuality.toFixed(1)}/5</td>
                  <td className="px-3 py-3">
                    <MonoChip tone={s.complianceFlags === 0 ? "green" : "amber"}>{s.complianceFlags} flags</MonoChip>
                  </td>
                  <td className="px-3 py-3">
                    <MonoChip tone={s.trend === "up" ? "green" : s.trend === "down" ? "red" : "default"}>{s.trend}</MonoChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Certifications</h3>
          <span className="text-xs text-text-faint inline-flex items-center gap-2">
            <Award className="w-3.5 h-3.5" />
            {certs.filter(c => c.status === "active").length} active · {lapsing.length} lapsing 30d · {lapsed.length} lapsed
          </span>
        </header>
        <div className="space-y-1.5">
          {certs.map((c) => (
            <Card key={c.id} className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-text">{c.credential}</div>
                  <div className="text-xs text-text-faint">{c.holder} · {c.platform}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-faint">expires {c.expiresAt}</span>
                  <MonoChip tone={c.status === "active" ? "green" : c.status === "lapsing" ? "amber" : "red"}>{c.status}</MonoChip>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="section-label">Conflict & exclusivity checks</h3>
          <AlertTriangle className="w-3.5 h-3.5 text-text-faint" />
        </header>
        {conflicts.length === 0 && (
          <p className="text-sm text-text-mute">No active conflicts.</p>
        )}
        {conflicts.map((c) => (
          <Card key={c.id} className="p-4 border-l-4 border-l-amber-400">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="font-medium text-text">{c.headline}</div>
                <div className="text-xs text-text-faint mt-1">{c.partnerFirm} · {c.detectedAt}</div>
                <div className="text-sm text-text-mute mt-2">{c.detail}</div>
                <div className="text-xs text-gold mt-2">Recommended: {c.recommendation}</div>
              </div>
              <MonoChip tone={c.severity === "block" ? "red" : c.severity === "warn" ? "amber" : "default"}>
                {c.severity}
              </MonoChip>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}

// =============================================================
// RENEW — renewal pipeline + tier changes + off-boarding
// =============================================================
function RenewView() {
  const renewals = usePartnerRenewals();
  const tierChanges = usePartnerTierChanges();
  const offboardings = usePartnerOffboardings();

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="section-label">Framework renewal pipeline</h3>
        <div className="space-y-2">
          {renewals.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium text-text">{r.partnerFirm}</div>
                  <div className="text-xs text-text-faint mt-1">{r.agreementKind} · expires {r.expiresAt}</div>
                  <div className="text-sm text-text-mute mt-2">{r.recommendation}</div>
                  <div className="text-xs text-text-faint mt-1">Owner: {r.owner}</div>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs">
                  <MonoChip tone={r.daysUntil < 0 ? "red" : r.daysUntil < 90 ? "amber" : "default"}>
                    {r.daysUntil < 0 ? `${Math.abs(r.daysUntil)}d overdue` : `${r.daysUntil}d`}
                  </MonoChip>
                  <MonoChip>{r.stage.replace("_", " ")}</MonoChip>
                  <MonoChip tone={r.risk === "low" ? "green" : r.risk === "med" ? "amber" : "red"}>risk · {r.risk}</MonoChip>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="section-label">Tier changes & certification updates</h3>
        <div className="space-y-2">
          {tierChanges.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium text-text">{t.partnerFirm} · {t.platform}</div>
                  <div className="text-sm text-text-mute mt-1">
                    <span className="text-text-faint">{t.fromTier}</span> → <span className="text-gold">{t.toTier}</span>
                  </div>
                  <div className="text-xs text-text-faint mt-2">Driver: {t.driver}</div>
                  <div className="text-xs text-text-mute mt-1">Action: {t.action}</div>
                </div>
                <MonoChip>{t.effectiveAt}</MonoChip>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="section-label">Off-boarding / wind-down</h3>
        {offboardings.length === 0 && (
          <p className="text-sm text-text-mute">No partners winding down.</p>
        )}
        <div className="space-y-2">
          {offboardings.map((o) => (
            <Card key={o.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="font-medium text-text">{o.partnerFirm}</div>
                  <div className="text-xs text-text-faint mt-1">initiated {o.initiatedAt}</div>
                  <div className="text-sm text-text-mute mt-2">{o.reason}</div>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs">
                  <MonoChip tone="amber">{o.phase.replace(/_/g, " ")}</MonoChip>
                  <span className="font-mono text-text">${o.openObligationsUsdK}K open</span>
                  <span className="text-text-faint">data return {o.dataReturnDue}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
