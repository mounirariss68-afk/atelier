import { useRoute, Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { Handshake, GitMerge, Award, AlertTriangle } from "lucide-react";
import {
  useAlliancePartnerFirms,
  useJointPipeline,
  useCertifications,
  useAllianceConflicts,
} from "@/lib/v5-hooks";

const SUB_ROUTES = [
  { id: "firms", label: "Partner Firms" },
  { id: "joint-pipeline", label: "Joint Pipeline" },
  { id: "certifications", label: "Certifications" },
  { id: "conflicts", label: "Conflicts" },
];

export default function AlliancesIndex() {
  const [, params] = useRoute("/alliances/:section");
  const section = params?.section ?? "firms";

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Partners · Alliances"
          headline="Partner-firm leverage, named per opportunity"
          lede="Joint pipeline parallel to the client pipeline, with split economics named on every deal. Account Cartographer (Partner mode) backfills relationship strength; Alliance Choreographer drives the joint pursuit; Certification Tracker keeps the platform partner tiers defended."
        />
      </PageHero>
      <div className="container-atelier py-6">
        <TabNav>
          {SUB_ROUTES.map((r) => (
            <TabNavLink key={r.id} href={`/alliances/${r.id}`} active={section === r.id}>
              {r.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-8">
          {section === "firms" && <FirmsView />}
          {section === "joint-pipeline" && <JointPipelineView />}
          {section === "certifications" && <CertificationsView />}
          {section === "conflicts" && <ConflictsView />}
        </div>
      </div>
    </div>
  );
}

function FirmsView() {
  const PARTNER_FIRMS = useAlliancePartnerFirms();
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute flex items-center gap-2">
        <Handshake className="w-4 h-4" />
        {PARTNER_FIRMS.length} partner firms tracked. Relationship strength is
        scored 1–5 on named-anchor + last-touch + joint-revenue signal.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {PARTNER_FIRMS.map((f) => (
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
              Anchor · AICo: <span className="text-text">{f.anchorAico}</span> ↔ {f.name}: <span className="text-text">{f.anchorPartner}</span>
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
    </div>
  );
}

function JointPipelineView() {
  const JOINT_PIPELINE = useJointPipeline();
  const total = JOINT_PIPELINE.reduce((s, o) => s + o.acvUsdK, 0);
  const aicoShare = JOINT_PIPELINE.reduce((s, o) => s + (o.acvUsdK * o.aicoPct) / 100, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-text-faint">Joint pipeline · ACV</div>
          <div className="text-2xl font-mono text-text mt-1">${(total / 1000).toFixed(2)}M</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-faint">AICo share</div>
          <div className="text-2xl font-mono text-gold mt-1">${(aicoShare / 1000).toFixed(2)}M</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-faint">Active opportunities</div>
          <div className="text-2xl font-mono text-text mt-1">{JOINT_PIPELINE.length}</div>
        </Card>
      </div>
      <div className="space-y-2">
        {JOINT_PIPELINE.map((o) => (
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
                <MonoChip tone="gold">AICo {o.aicoPct}% · {o.partnerFirm.split(" ")[0]} {o.partnerPct}%</MonoChip>
                <span className="text-xs text-text-faint">{o.allianceLetterStatus}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CertificationsView() {
  const CERTIFICATIONS = useCertifications();
  const lapsing = CERTIFICATIONS.filter((c) => c.status === "lapsing");
  const lapsed = CERTIFICATIONS.filter((c) => c.status === "lapsed");
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-mute flex items-center gap-2">
        <Award className="w-4 h-4" />
        Certification Tracker · daily scan. Partner-tier on each platform
        depends on N current certifications across the firm.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-text-faint">Active</div>
          <div className="text-2xl font-mono text-text mt-1">{CERTIFICATIONS.filter(c => c.status === "active").length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-faint">Lapsing 30d</div>
          <div className="text-2xl font-mono text-amber-400 mt-1">{lapsing.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-faint">Lapsed</div>
          <div className="text-2xl font-mono text-red-400 mt-1">{lapsed.length}</div>
        </Card>
      </div>
      <div className="space-y-2">
        {CERTIFICATIONS.map((c) => (
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
    </div>
  );
}

function ConflictsView() {
  const ALLIANCE_CONFLICTS = useAllianceConflicts();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        Alliance Choreographer surfaces conflicts before AICo proposes joint
        action. Resolve or override; nothing ships uncleared.
      </p>
      {ALLIANCE_CONFLICTS.map((c) => (
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
    </div>
  );
}
