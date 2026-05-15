import { useRoute, Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { PeopleShell } from "./PeopleShell";
import {
  useLearningCatalogue, useMyLearning, useCertifications, useMentoringPairs, useSkillGaps,
} from "./peopleSeed";

const SUBS = [
  { id: "catalogue",     label: "Learning catalogue" },
  { id: "my-learning",   label: "My learning" },
  { id: "certifications", label: "Certifications" },
  { id: "mentoring",     label: "Mentoring" },
  { id: "skill-gaps",    label: "Skill gaps" },
];

export default function PeopleDevelop() {
  const [, params] = useRoute("/people/develop/:section");
  const section = params?.section ?? "catalogue";

  return (
    <PeopleShell stage="develop">
      <PageHero>
        <SectionHead
          eyebrow={<MonoChip tone="gold">Develop</MonoChip>}
          headline="Learning, certifications, mentoring, skill gaps"
          lede="Where the firm grows the people it has. Skill-gap views read directly from the Skill Graph."
        />
      </PageHero>
      <div className="container-atelier py-6 space-y-6">
        <TabNav>
          {SUBS.map((s) => (
            <TabNavLink key={s.id} href={`/people/develop/${s.id}`} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-4">
          {section === "catalogue" && <CatalogueView />}
          {section === "my-learning" && <MyLearningView />}
          {section === "certifications" && <CertificationsView />}
          {section === "mentoring" && <MentoringView />}
          {section === "skill-gaps" && <SkillGapsView />}
        </div>
      </div>
    </PeopleShell>
  );
}

function CatalogueView() {
  const rows = useLearningCatalogue();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((c) => (
        <Card key={c.id} className="p-4 space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-medium text-text">{c.title}</div>
              <div className="text-xs text-text-faint">{c.provider} · {c.durationHours}h · {c.format}</div>
            </div>
            <MonoChip tone={c.level === "advanced" ? "gold" : c.level === "core" ? "green" : "default"}>{c.level}</MonoChip>
          </div>
          <div className="flex gap-1 flex-wrap">
            {c.skillTagIds.map((s) => <MonoChip key={s}>{s}</MonoChip>)}
          </div>
        </Card>
      ))}
    </div>
  );
}

function MyLearningView() {
  const rows = useMyLearning();
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Card key={r.id} className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <div className="text-text">{r.courseTitle}</div>
              <div className="text-xs text-text-faint">
                {r.status === "completed" ? `completed ${r.completedAt}` : r.dueDate ? `due ${r.dueDate}` : "—"}
              </div>
            </div>
            <div className="w-32 h-2 bg-border rounded overflow-hidden">
              <div className="h-full bg-gold" style={{ width: `${r.progressPct}%` }} />
            </div>
            <MonoChip tone={r.status === "completed" ? "green" : r.status === "in-progress" ? "gold" : "default"}>
              {r.status}
            </MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}

function CertificationsView() {
  const rows = useCertifications();
  return (
    <Card className="p-4">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-mute font-mono uppercase">
          <tr><th className="text-left py-2">Person</th><th className="text-left">Certification</th><th>Issued</th><th>Expires</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-border-soft">
              <td className="py-2 text-text">{c.personName}</td>
              <td className="text-text">{c.certName} <span className="text-text-faint text-xs">· {c.issuer}</span></td>
              <td className="text-center text-text-mute">{c.issuedOn}</td>
              <td className="text-center text-text-mute">{c.expiresOn ?? "—"}</td>
              <td className="text-center">
                <MonoChip tone={c.status === "active" ? "green" : c.status === "expiring" ? "amber" : "red"}>{c.status}</MonoChip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function MentoringView() {
  const rows = useMentoringPairs();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((p) => (
        <Card key={p.id} className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text">{p.mentor} → {p.mentee}</div>
              <div className="text-xs text-text-faint">started {p.startedOn}</div>
            </div>
            <MonoChip>{p.cadence}</MonoChip>
          </div>
          <div className="mt-2 text-sm text-text-mute">Focus: {p.focus}</div>
        </Card>
      ))}
    </div>
  );
}

function SkillGapsView() {
  const rows = useSkillGaps();
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute">
        Reads from the firm Skill Graph. <Link href="/people/skills" className="text-gold hover:underline">Open Skill graph →</Link>
      </p>
      {rows.map((g) => (
        <Card key={g.id} className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-text font-medium">{g.skill}</div>
              <div className="text-xs text-text-faint">demand {g.demandRoles} · supply {g.internalSupply}</div>
            </div>
            <MonoChip tone={g.gap >= 4 ? "red" : g.gap >= 2 ? "amber" : "default"}>gap {g.gap}</MonoChip>
          </div>
          {g.topCandidates.length > 0 && (
            <div className="mt-2 text-xs text-text-mute">Top internal candidates: {g.topCandidates.join(", ")}</div>
          )}
        </Card>
      ))}
    </div>
  );
}
