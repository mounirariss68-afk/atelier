import * as React from "react";
import { Link } from "wouter";
import {
  PageHero,
  SectionHead,
  Card,
  MonoChip,
  PillButton,
} from "@/components/ui/primitives";
import { RosterNav } from "./RosterNav";

interface SkillWire {
  id: string;
  slug: string;
  name: string;
  kind: string;
  parentId: string | null;
  description: string | null;
}
interface MatchedTerm {
  term: string;
  matchedSkill: SkillWire;
  proficiency: number;
  source: string;
  status: string;
}
interface Result {
  personType: "employee" | "contractor";
  personId: string;
  fullName: string;
  title: string | null;
  role: string | null;
  score: number;
  matchedTerms: MatchedTerm[];
  unmatchedTerms: string[];
  evidence: Array<{ kind: string; id: string; label: string; href: string }>;
}

const SOURCE_LABEL: Record<string, string> = {
  certification: "Certification",
  partner_attested: "Partner attested",
  evidence_atelier: "Atelier evidence",
  self: "Self",
  agent_inferred: "Agent inferred",
};

export default function RosterSkillGraph(): React.ReactElement {
  const [q, setQ] = React.useState("");
  const [submitted, setSubmitted] = React.useState("");
  const [results, setResults] = React.useState<Result[] | null>(null);
  const [mode, setMode] = React.useState<"AND" | "OR">("AND");
  const [skills, setSkills] = React.useState<SkillWire[]>([]);
  const [running, setRunning] = React.useState(false);
  const [runMessage, setRunMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/atelier/roster/skill-graph/skills", {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => setSkills(d.skills ?? []));
  }, []);

  React.useEffect(() => {
    if (!submitted) return;
    fetch(
      `/api/atelier/roster/skill-graph/search?q=${encodeURIComponent(submitted)}`,
      { credentials: "include" },
    )
      .then((r) => r.json())
      .then((d) => {
        setResults(d.results ?? []);
        setMode(d.mode ?? "AND");
      });
  }, [submitted]);

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setSubmitted(q.trim());
  };

  const triggerMapper = async (): Promise<void> => {
    setRunning(true);
    setRunMessage(null);
    try {
      const r = await fetch("/api/atelier/roster/skill-graph/run", {
        method: "POST",
        credentials: "include",
      });
      const d = await r.json();
      if (!r.ok) {
        setRunMessage(d.message ?? d.error ?? "Run failed");
      } else {
        setRunMessage(
          `Skill Mapper: proposed ${d.proposalsInserted} new row(s); ${d.proposalsSkipped} skipped.`,
        );
        if (submitted) setSubmitted(submitted + " "); // re-fetch
      }
    } finally {
      setRunning(false);
    }
  };

  const skillsByKind = React.useMemo(() => {
    const m = new Map<string, SkillWire[]>();
    for (const s of skills) {
      const arr = m.get(s.kind) ?? [];
      arr.push(s);
      m.set(s.kind, arr);
    }
    return m;
  }, [skills]);

  return (
    <div className="px-4 md:px-8 py-6 max-w-screen-2xl mx-auto">
      <PageHero>
        <SectionHead
          eyebrow="The Roster"
          headline="Skill graph"
          lede="Find people by skill — verified evidence first, then inference. Use “+” for AND, “or” for OR."
        />
      </PageHero>

      <RosterNav />

      <Card className="p-4 mb-4">
        <form onSubmit={onSubmit} className="flex flex-wrap gap-2 items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. databricks + ksa public sector"
            className="flex-1 min-w-[280px] bg-bg-soft border border-line rounded px-3 py-2 text-sm"
            data-testid="skill-search-input"
          />
          <PillButton type="submit" data-testid="skill-search-submit">
            Search
          </PillButton>
          <PillButton
            type="button"
            onClick={triggerMapper}
            disabled={running}
            data-testid="skill-mapper-run"
          >
            {running ? "Running…" : "Run Skill Mapper"}
          </PillButton>
        </form>
        {runMessage && (
          <div className="text-xs text-text-mute mt-2" data-testid="skill-mapper-result">
            {runMessage}
          </div>
        )}
      </Card>

      {!submitted && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          {Array.from(skillsByKind.entries()).map(([kind, list]) => (
            <Card key={kind} className="p-3">
              <div className="text-xs font-mono uppercase text-text-mute mb-2">
                {kind} · {list.length}
              </div>
              <div className="flex flex-wrap gap-1">
                {list.slice(0, 12).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setQ(s.name);
                      setSubmitted(s.name);
                    }}
                    className="font-mono text-[10px] uppercase px-2 py-1 border border-line rounded hover:border-gold hover:text-gold"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {submitted && results && (
        <div className="space-y-3">
          <div className="text-xs text-text-mute font-mono uppercase">
            {results.length} result{results.length === 1 ? "" : "s"} · mode {mode}
          </div>
          {results.length === 0 && (
            <Card className="p-6 text-text-mute">
              No people match this query yet. Try splitting with “or” or run the
              Skill Mapper to surface inferred matches.
            </Card>
          )}
          {results.map((r) => (
            <Card key={`${r.personType}:${r.personId}`} className="p-4">
              <div className="flex flex-wrap justify-between gap-3 items-start">
                <div>
                  <Link
                    href={`/roster/people/${r.personId}/skills`}
                    className="text-base font-medium hover:text-gold"
                    data-testid={`skill-result-${r.personId}`}
                  >
                    {r.fullName}
                  </Link>
                  <div className="text-xs text-text-mute">
                    {r.title ?? r.role ?? "—"} · {r.personType}
                  </div>
                </div>
                <div className="flex gap-1 items-center flex-wrap">
                  <MonoChip>score {r.score}</MonoChip>
                  {r.unmatchedTerms.length > 0 && (
                    <MonoChip className="text-warning border-warning/40">
                      missing: {r.unmatchedTerms.join(", ")}
                    </MonoChip>
                  )}
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                {r.matchedTerms.map((m) => (
                  <div
                    key={m.term + m.matchedSkill.id}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="text-text-mute">“{m.term}” →</span>
                    <span className="text-text">{m.matchedSkill.name}</span>
                    <MonoChip>p{m.proficiency}/5</MonoChip>
                    <MonoChip
                      className={
                        m.source === "agent_inferred"
                          ? "text-warning border-warning/40"
                          : ""
                      }
                    >
                      {SOURCE_LABEL[m.source] ?? m.source}
                    </MonoChip>
                  </div>
                ))}
              </div>
              {r.evidence.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1 items-center">
                  <span className="text-xs text-text-mute font-mono uppercase">
                    Evidence:
                  </span>
                  {r.evidence.map((e) => (
                    <Link
                      key={e.id}
                      href={e.href}
                      data-testid={`evidence-${e.id}`}
                      className="font-mono text-[10px] uppercase px-2 py-1 border border-line rounded hover:border-gold hover:text-gold"
                      title={e.id}
                    >
                      {e.kind} · {e.label}
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
