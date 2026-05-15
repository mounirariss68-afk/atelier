import { Link } from "wouter";
import { Card, MonoChip } from "@/components/ui/primitives";
import {
  useCertifications,
  useCompReview,
  useFlightRisk,
  usePeopleApprovals,
  useReviews,
  useStageStats,
  useStayInterviews,
} from "../peopleSeed";

interface ActionItem {
  id: string;
  category: string;
  title: string;
  detail?: string;
  href: string;
  priority: "high" | "medium" | "low";
}

const PRIORITY_TONE: Record<ActionItem["priority"], "red" | "amber" | "default"> = {
  high: "red",
  medium: "amber",
  low: "default",
};
const PRIORITY_RANK: Record<ActionItem["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function ActionQueue() {
  const flightRisk = useFlightRisk();
  const certs = useCertifications();
  const compReview = useCompReview();
  const reviews = useReviews();
  const approvals = usePeopleApprovals();
  const stay = useStayInterviews();
  const stages = useStageStats();

  const items: ActionItem[] = [];

  flightRisk
    .filter((r) => r.riskScore >= 0.6)
    .forEach((r) => {
      const hasRecentStay = stay.some((s) => s.personName === r.personName);
      items.push({
        id: `fr-${r.id}`,
        category: "Retain",
        title: hasRecentStay
          ? `Follow up on stay-interview commitments — ${r.personName}`
          : `Schedule stay interview with ${r.personName}`,
        detail: `${Math.round(r.riskScore * 100)}% risk · owner ${r.ownerName}`,
        href: "/people/retain/stay",
        priority: "high",
      });
    });

  certs
    .filter((c) => c.status === "expired" || c.status === "expiring")
    .forEach((c) => {
      items.push({
        id: `cert-${c.id}`,
        category: "Compliance",
        title: `${c.status === "expired" ? "Renew expired" : "Renew expiring"} cert · ${c.personName}`,
        detail: `${c.certName} · ${c.expiresOn ?? "no expiry"}`,
        href: "/people/develop/certifications",
        priority: c.status === "expired" ? "high" : "medium",
      });
    });

  compReview
    .filter((r) => r.status === "submitted")
    .forEach((r) => {
      items.push({
        id: `comp-${r.id}`,
        category: "Reward",
        title: `Approve comp change · ${r.personName}`,
        detail: `${r.deltaPct >= 0 ? "+" : ""}${r.deltaPct.toFixed(1)}% · ${r.rationale}`,
        href: "/people/reward/review",
        priority: "high",
      });
    });

  reviews
    .filter((r) => r.status === "open" || r.status === "self-done")
    .forEach((r) => {
      items.push({
        id: `rv-${r.id}`,
        category: "Perform",
        title: `Complete review · ${r.personName}`,
        detail: `${r.cycle} · due ${r.dueOn}`,
        href: "/people/perform",
        priority: "medium",
      });
    });

  approvals
    .filter((a) => a.status === "pending")
    .forEach((a) => {
      items.push({
        id: `pa-${a.id}`,
        category: "Approval",
        title: a.subject,
        detail: `${a.kind} · requested by ${a.requester}`,
        href: "/people/approvals",
        priority: a.kind === "promotion" || a.kind === "comp-change" ? "high" : "medium",
      });
    });

  // Aging open requisitions surfaced from the lifecycle stat.
  if (stages.attract && stages.attract.count > 0) {
    items.push({
      id: "stage-attract",
      category: "Attract",
      title: stages.attract.nextAction,
      detail: `${stages.attract.count} ${stages.attract.countLabel}`,
      href: stages.attract.nextActionHref,
      priority: "low",
    });
  }
  if (stages.hire && stages.hire.count > 0) {
    items.push({
      id: "stage-hire",
      category: "Hire",
      title: stages.hire.nextAction,
      detail: `${stages.hire.count} ${stages.hire.countLabel}`,
      href: stages.hire.nextActionHref,
      priority: "medium",
    });
  }

  const sorted = items
    .slice()
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, 12);

  return (
    <section className="space-y-3" data-testid="dashboard-action-queue">
      <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
        CHRO action queue
      </h3>
      <Card className="p-2">
        {sorted.length === 0 ? (
          <div className="p-6 text-center text-xs text-text-faint">
            No actions in the queue. The people function is on cruise control.
          </div>
        ) : (
          <ul className="divide-y divide-border-soft">
            {sorted.map((it) => (
              <li key={it.id}>
                <Link
                  href={it.href}
                  data-testid={`action-${it.id}`}
                  className="flex items-center gap-3 p-3 hover:bg-bg-elevate-2 transition-colors rounded"
                >
                  <MonoChip tone={PRIORITY_TONE[it.priority]}>{it.priority}</MonoChip>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint w-20 shrink-0 hidden sm:inline">
                    {it.category}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text truncate">{it.title}</div>
                    {it.detail && (
                      <div className="text-[11px] text-text-mute truncate">{it.detail}</div>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-text-faint shrink-0">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
