import { useRoute, Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { Users, ClipboardCheck, MessageSquare, FileText, UserPlus } from "lucide-react";
import {
  useOpenRoles,
  useCandidates,
  useInterviewPanels,
  useReferenceChecks,
  useOffers,
  useReferrals,
} from "@/lib/v5-hooks";

const SUB_ROUTES = [
  { id: "roles", label: "Open Roles" },
  { id: "candidates", label: "Candidate CRM" },
  { id: "interviews", label: "Panels & Scorecards" },
  { id: "references", label: "References" },
  { id: "offers", label: "Offers" },
  { id: "referrals", label: "Referrals" },
];

export default function StudioIndex() {
  const [, params] = useRoute("/studio/:section");
  const section = params?.section ?? "roles";

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow="The Studio"
          headline="Talent funnel · sourced → offered, structured"
          lede="Candidate CRM in the same shape as the client CRM. Pursuit Scout (Recruiting mode) sources; Interview Designer drafts the panel + scorecard; Reference Caller produces structured summaries; Offer Composer drafts the letter. The Recruiter persona owns the workspace; client engagements stay invisible to it."
        />
      </PageHero>
      <div className="container-atelier py-6">
        <TabNav>
          {SUB_ROUTES.map((r) => (
            <TabNavLink key={r.id} href={`/studio/${r.id}`} active={section === r.id}>
              {r.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-8">
          {section === "roles" && <RolesView />}
          {section === "candidates" && <CandidatesView />}
          {section === "interviews" && <InterviewsView />}
          {section === "references" && <ReferencesView />}
          {section === "offers" && <OffersView />}
          {section === "referrals" && <ReferralsView />}
        </div>
      </div>
    </div>
  );
}

export function RolesView() {
  const OPEN_ROLES = useOpenRoles();
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute flex items-center gap-2"><Users className="w-4 h-4" />{OPEN_ROLES.length} open roles. Each is bound to a scorecard, a panel template, and (if technical) a take-home.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {OPEN_ROLES.map((r) => (
          <Card key={r.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-text">{r.title}</div>
                <div className="text-xs text-text-faint">{r.level} · {r.location} · target start {r.targetStart}</div>
              </div>
              <MonoChip tone={r.urgency === "high" ? "red" : r.urgency === "medium" ? "amber" : "default"}>{r.urgency} urgency</MonoChip>
            </div>
            <div className="text-sm text-text-mute">{r.summary}</div>
            <div className="flex gap-1 flex-wrap text-xs">
              <MonoChip>{r.activeCandidates} active candidates</MonoChip>
              <MonoChip>panel · {r.panelTemplate}</MonoChip>
              <MonoChip>scorecard · {r.scorecardId}</MonoChip>
              {r.takeHomeId && <MonoChip>take-home · {r.takeHomeId}</MonoChip>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function CandidatesView() {
  const CANDIDATE_PIPELINE = useCandidates();
  const stages = ["sourced", "screening", "interview", "reference", "offer"] as const;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        {stages.map((st) => (
          <Card key={st} className="p-3">
            <div className="text-xs text-text-faint capitalize">{st}</div>
            <div className="text-2xl font-mono text-text mt-1">{CANDIDATE_PIPELINE.filter(c => c.stage === st).length}</div>
          </Card>
        ))}
      </div>
      <div className="space-y-2">
        {CANDIDATE_PIPELINE.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="font-medium text-text">{c.name}</div>
                <div className="text-xs text-text-faint mt-1">{c.currentRole} · {c.currentEmployer} · sourced via {c.source}</div>
                <div className="text-sm text-text-mute mt-2">For role: <span className="text-gold">{c.roleTitle}</span></div>
                {c.outreachHook && <div className="text-xs text-text-faint mt-1 italic">"{c.outreachHook}"</div>}
              </div>
              <div className="flex flex-col items-end gap-1">
                <MonoChip tone="gold">{c.stage}</MonoChip>
                <MonoChip>{c.activeOrPassive}</MonoChip>
                <span className="text-xs text-text-faint">match {Math.round(c.roleMatchScore * 100)}%</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function InterviewsView() {
  const INTERVIEW_PANELS = useInterviewPanels();
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute flex items-center gap-2"><ClipboardCheck className="w-4 h-4" />Panels are generated by Interview Designer per (role, candidate). Same role + level always produces the same question bank — calibration depends on it.</p>
      {INTERVIEW_PANELS.map((p) => (
        <Card key={p.id} className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-text">{p.candidateName}</div>
              <div className="text-xs text-text-faint">{p.roleTitle} · scheduled {p.scheduledFor}</div>
            </div>
            <MonoChip tone={p.status === "completed" ? "green" : p.status === "scheduled" ? "gold" : "amber"}>{p.status}</MonoChip>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {p.stages.map((s) => (
              <div key={s.stage} className="text-sm border-l-2 border-l-border pl-3">
                <div className="text-text font-medium">{s.stage} · {s.interviewer}</div>
                <div className="text-xs text-text-faint">{s.durationMin} min · focus: {s.focus}</div>
                {s.score !== null && <div className="text-xs text-gold mt-1">score {s.score}/5</div>}
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function ReferencesView() {
  const REFERENCE_CHECKS = useReferenceChecks();
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute flex items-center gap-2"><MessageSquare className="w-4 h-4" />Reference Caller runs scheduled-live or async-video reference checks and produces a structured summary attached to the candidate file.</p>
      {REFERENCE_CHECKS.map((r) => (
        <Card key={r.id} className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-text">{r.candidateName} ← {r.refererName}</div>
              <div className="text-xs text-text-faint">{r.relationship} · {r.callMode} · {r.completedAt ?? "scheduled " + r.scheduledFor}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <MonoChip tone={r.wouldRehire === "yes" ? "green" : r.wouldRehire === "no" ? "red" : "amber"}>rehire: {r.wouldRehire ?? "—"}</MonoChip>
              <MonoChip tone={r.fitForLevel === "above" ? "gold" : r.fitForLevel === "at" ? "green" : r.fitForLevel === "below" ? "red" : "default"}>fit: {r.fitForLevel ?? "—"}</MonoChip>
            </div>
          </div>
          {r.headlineQuote && <div className="text-sm italic text-text-mute border-l-2 border-l-gold/40 pl-2">"{r.headlineQuote}"</div>}
          {r.inconsistencies.length > 0 && (
            <div className="text-xs text-amber-400">⚠ {r.inconsistencies.length} inconsistency vs. resume</div>
          )}
        </Card>
      ))}
    </div>
  );
}

export function OffersView() {
  const OFFER_QUEUE = useOffers();
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute flex items-center gap-2"><FileText className="w-4 h-4" />Offer Composer drafts the letter + comp narrative within the approved band. Partner offers carry partner-economics narrative (carry, vesting, draw).</p>
      {OFFER_QUEUE.map((o) => (
        <Card key={o.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="font-medium text-text">{o.candidateName}</div>
              <div className="text-xs text-text-faint mt-1">{o.roleTitle} · {o.jurisdiction} · start {o.startDate}</div>
              <div className="text-sm text-text-mute mt-2">Total at target: <span className="text-text">${o.totalAtTargetUsdK}K</span> · band p25–p75 ${o.marketP25}–${o.marketP75}K</div>
              {o.bandFlag && <div className="text-xs text-amber-400 mt-1">⚠ {o.bandFlag}</div>}
            </div>
            <MonoChip tone={o.status === "accepted" ? "green" : o.status === "sent" ? "gold" : o.status === "draft" ? "amber" : "default"}>{o.status}</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function ReferralsView() {
  const REFERRALS = useReferrals();
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute flex items-center gap-2"><UserPlus className="w-4 h-4" />Internal referrals seeded by the Pursuit Scout's referral-path detector (Recruiting mode).</p>
      {REFERRALS.map((r) => (
        <Card key={r.id} className="p-3">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-text">{r.referrer} → {r.candidate}</div>
              <div className="text-xs text-text-faint">{r.via} · for {r.roleTitle}</div>
            </div>
            <MonoChip tone={r.status === "hired" ? "gold" : r.status === "interviewing" ? "green" : "default"}>{r.status}</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}
