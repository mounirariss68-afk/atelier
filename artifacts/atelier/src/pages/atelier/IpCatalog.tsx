// v5 — IP / Asset catalog. Extends /atelier/assets with code-asset registry,
// OSS compliance register, demo environment registry, and IP licensing log.
// IP Steward agent watches freshness and ownership; OSS Compliance Sentinel
// gates dependency additions; Demo Environment Curator (sub-agent) keeps
// demo URLs alive.
import { useRoute } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { Code2, Package, MonitorPlay, FileText } from "lucide-react";
import {
  useCodeAssets,
  useOssDependencies,
  useDemoEnvironments,
  useIpLicenseGrants,
} from "@/lib/v5-hooks";

const SUB_ROUTES = [
  { id: "code", label: "Code Assets" },
  { id: "oss", label: "OSS Compliance" },
  { id: "demos", label: "Demo Environments" },
  { id: "licensing", label: "IP Licensing Log" },
];

export default function IpCatalog() {
  const [, params] = useRoute("/atelier/ip/:section");
  const section = params?.section ?? "code";

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Atelier"
          headline="Every internal repo, OSS dep, demo URL, and IP grant — owned and tracked"
          lede="Extension of /atelier/assets. IP Steward nags owners when freshness lapses; OSS Compliance Sentinel blocks license-incompatible additions before they ship; Demo Environment Curator (a sub-agent of IP Steward) keeps demo URLs alive."
        />
      </PageHero>
      <div className="container-atelier py-6">
        <TabNav>
          {SUB_ROUTES.map((r) => (
            <TabNavLink key={r.id} href={`/atelier/ip/${r.id}`} active={section === r.id}>{r.label}</TabNavLink>
          ))}
        </TabNav>
        <div className="mt-8">
          {section === "code" && <CodeView />}
          {section === "oss" && <OssView />}
          {section === "demos" && <DemosView />}
          {section === "licensing" && <LicensingView />}
        </div>
      </div>
    </div>
  );
}

function CodeView() {
  const CODE_ASSETS = useCodeAssets();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute flex items-center gap-2"><Code2 className="w-4 h-4" />Every internal repo with license, owner, and the engagements it has been used in.</p>
      {CODE_ASSETS.map((a) => (
        <Card key={a.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="font-medium text-text">{a.name}</div>
              <div className="text-xs text-text-faint mt-1">{a.repoUrl} · owner: {a.owner} · {a.license}</div>
              <div className="text-sm text-text-mute mt-2">{a.summary}</div>
              <div className="text-xs text-text-faint mt-1">used in: {a.usedInEngagements.join(", ") || "—"}</div>
            </div>
            <MonoChip tone={a.freshness === "fresh" ? "green" : a.freshness === "stale" ? "amber" : "red"}>{a.freshness}</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

function OssView() {
  const OSS_DEPENDENCIES = useOssDependencies();
  const blocked = OSS_DEPENDENCIES.filter(d => d.compatibility === "block");
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute flex items-center gap-2"><Package className="w-4 h-4" />OSS Compliance Sentinel scans every manifest and classifies licenses against the engagement's IP grant scope.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4"><div className="text-xs text-text-faint">Tracked</div><div className="text-2xl font-mono text-text mt-1">{OSS_DEPENDENCIES.length}</div></Card>
        <Card className="p-4"><div className="text-xs text-text-faint">Blocked</div><div className="text-2xl font-mono text-red-400 mt-1">{blocked.length}</div></Card>
        <Card className="p-4"><div className="text-xs text-text-faint">Exception-approved</div><div className="text-2xl font-mono text-amber-400 mt-1">{OSS_DEPENDENCIES.filter(d => d.exceptionUntil).length}</div></Card>
      </div>
      <div className="space-y-2">
        {OSS_DEPENDENCIES.map((d) => (
          <Card key={d.id} className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-text">{d.name}@{d.version}</div>
                <div className="text-xs text-text-faint">{d.ecosystem} · {d.license} · in {d.repos.join(", ")}</div>
                {d.rationale && <div className="text-xs text-text-mute mt-1">{d.rationale}</div>}
              </div>
              <MonoChip tone={d.compatibility === "ok" ? "green" : d.compatibility === "warn" ? "amber" : "red"}>{d.compatibility}</MonoChip>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DemosView() {
  const DEMO_ENVIRONMENTS = useDemoEnvironments();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute flex items-center gap-2"><MonitorPlay className="w-4 h-4" />Live demo URLs with uptime, last-deploy, and drift from the canonical demo script. Maintained by Demo Environment Curator.</p>
      {DEMO_ENVIRONMENTS.map((d) => (
        <Card key={d.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="font-medium text-text">{d.name}</div>
              <div className="text-xs text-text-faint mt-1">{d.url} · owner {d.owner} · last deploy {d.lastDeployAt}</div>
              <div className="text-sm text-text-mute mt-2">{d.shows}</div>
              {d.scriptDrift > 0 && <div className="text-xs text-amber-400 mt-1">⚠ {d.scriptDrift} step(s) drifted from canonical script</div>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <MonoChip tone={d.freshness === "fresh" ? "green" : d.freshness === "stale" ? "amber" : "red"}>{d.freshness}</MonoChip>
              <span className="text-xs text-text-faint">uptime {(d.uptime30d * 100).toFixed(1)}%</span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function LicensingView() {
  const IP_LICENSE_GRANTS = useIpLicenseGrants();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute flex items-center gap-2"><FileText className="w-4 h-4" />Every grant of Cognirise IP into a client engagement, scope-bounded and time-bounded.</p>
      {IP_LICENSE_GRANTS.map((g) => (
        <Card key={g.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="font-medium text-text">{g.assetName}</div>
              <div className="text-xs text-text-faint mt-1">granted to {g.grantee} · engagement {g.engagementId} · grant date {g.grantedAt}</div>
              <div className="text-sm text-text-mute mt-2">scope: {g.scope}</div>
              <div className="text-xs text-text-faint mt-1">expires {g.expiresAt} · approved by {g.approvedBy}</div>
            </div>
            <MonoChip tone={g.status === "active" ? "green" : g.status === "expiring" ? "amber" : "default"}>{g.status}</MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}
