import { Link } from "wouter";
import { Card, MonoChip } from "@/components/ui/primitives";
import { useCertifications, useMentoringPairs, useMyLearning } from "../peopleSeed";

export function LearningCompliance() {
  const certs = useCertifications();
  const mentoring = useMentoringPairs();
  const myLearning = useMyLearning();

  const expiring = certs
    .filter((c) => c.status === "expiring" || c.status === "expired")
    .slice()
    .sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? ""));

  const inFlight = myLearning.filter((r) => r.status === "in-progress" || r.status === "enrolled");
  const completion = myLearning.length
    ? Math.round(
        (myLearning.filter((r) => r.status === "completed").length / myLearning.length) * 100,
      )
    : 0;

  return (
    <section className="space-y-3" data-testid="dashboard-learning">
      <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
        Learning &amp; compliance
      </h3>
      <div className="grid gap-3 lg:grid-cols-3">
        <Link href="/people/develop/certifications" data-testid="learning-certs">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="flex items-baseline justify-between mb-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                Certifications · attention
              </div>
              <MonoChip tone={expiring.length > 0 ? "amber" : "green"}>
                {expiring.length}
              </MonoChip>
            </div>
            {expiring.length === 0 ? (
              <div className="text-xs text-text-faint">All certifications current.</div>
            ) : (
              <div className="space-y-1.5">
                {expiring.slice(0, 5).map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-xs">
                    <div className="min-w-0">
                      <div className="text-text truncate">{c.personName}</div>
                      <div className="text-text-faint truncate">{c.certName}</div>
                    </div>
                    <MonoChip tone={c.status === "expired" ? "red" : "amber"}>
                      {c.expiresOn ?? "n/a"}
                    </MonoChip>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Link>

        <Link href="/people/develop" data-testid="learning-progress">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              Learning · in flight
            </div>
            <div className="text-3xl font-light text-gold leading-none">{inFlight.length}</div>
            <div className="mt-2 text-xs text-text-mute">
              {completion}% of tracked items completed
            </div>
            <div className="mt-3 space-y-1.5 text-xs">
              {inFlight.slice(0, 3).map((r) => (
                <div key={r.id}>
                  <div className="flex justify-between text-text-mute">
                    <span className="truncate">{r.courseTitle}</span>
                    <span className="font-mono text-text-faint">{r.progressPct}%</span>
                  </div>
                  <div className="h-1 mt-0.5 bg-bg-deep rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-gold/70"
                      style={{ width: `${r.progressPct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Link>

        <Link href="/people/develop" data-testid="learning-mentoring">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              Mentoring program
            </div>
            <div className="text-3xl font-light text-gold leading-none">{mentoring.length}</div>
            <div className="mt-1 text-xs text-text-mute">active pairings</div>
            <div className="mt-3 space-y-1 text-xs text-text-mute">
              {mentoring.slice(0, 3).map((m) => (
                <div key={m.id} className="flex justify-between">
                  <span className="truncate">
                    {m.mentor} → {m.mentee}
                  </span>
                  <span className="font-mono text-text-faint">{m.cadence}</span>
                </div>
              ))}
            </div>
          </Card>
        </Link>
      </div>
    </section>
  );
}
