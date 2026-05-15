import * as React from "react";
import { Link, useLocation } from "wouter";
import {
  Card,
  PageHero,
  SectionHead,
  MonoChip,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Win/Loss intake — debriefs-in-flight workbench.
 *
 * Mounted at the standalone `/win-loss` route (the flat-IA Clients
 * lens has no dedicated Win section, so the intake stays reachable
 * for dossier / report deep-links). The reference surface
 * (`/clients/references`) is the curated themes library, while this
 * page is the operator workbench for late-stage closes
 * that need debriefing: open / pending intake, synthesized debriefs
 * awaiting partner approval, and a tail of recently approved ones.
 *
 * Sort is due-date forward (overdue first, no-due last) so the
 * workbench reads top-down by urgency. Each row deep-links into the
 * per-opp debrief workspace at `/opportunities/:id/win-loss`.
 */

interface DebriefRow {
  id: string;
  opportunityId: string;
  opportunityName: string;
  outcome: string;
  status: "pending" | "ingested" | "synthesized" | "approved" | string;
  hiddenCompetitor: string | null;
  themeCount: number;
  dueAt: string | null;
  synthesizedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
}

type Bucket = "open" | "synthesized" | "approved";

function bucketOf(d: DebriefRow): Bucket {
  if (d.status === "approved") return "approved";
  if (d.status === "synthesized") return "synthesized";
  return "open";
}

function dueRank(d: DebriefRow): number {
  // Overdue / soonest due first; null due dates last.
  if (!d.dueAt) return Number.POSITIVE_INFINITY;
  return new Date(d.dueAt).getTime();
}

function dueLabel(d: DebriefRow): {
  text: string;
  tone: "overdue" | "soon" | "scheduled" | "approved" | "open";
} {
  if (d.approvedAt) {
    return {
      text: `Approved ${new Date(d.approvedAt).toLocaleDateString()}`,
      tone: "approved",
    };
  }
  if (!d.dueAt) {
    return { text: "No due date", tone: "open" };
  }
  const due = new Date(d.dueAt);
  const now = Date.now();
  const days = Math.round((due.getTime() - now) / 86_400_000);
  if (days < 0) return { text: `Overdue · ${-days}d`, tone: "overdue" };
  if (days <= 3) return { text: `Due in ${days}d`, tone: "soon" };
  return { text: `Due ${due.toLocaleDateString()}`, tone: "scheduled" };
}

const TONE_CLASS: Record<ReturnType<typeof dueLabel>["tone"], string> = {
  overdue: "text-danger",
  soon: "text-gold",
  scheduled: "text-text-mute",
  approved: "text-success",
  open: "text-text-faint",
};

export default function WinLossIntake() {
  const [items, setItems] = React.useState<DebriefRow[] | null>(null);
  const [, setLocation] = useLocation();

  React.useEffect(() => {
    fetch("/api/atelier/win-loss/debriefs", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setItems((d.items as DebriefRow[]) ?? []))
      .catch(() => setItems([]));
  }, []);

  const referenceHref = "/clients/references";

  if (!items) {
    return (
      <div className="p-6 md:p-10 space-y-6 max-w-6xl">
        <PageHero
          eyebrow="WIN/LOSS · INTAKE"
          title="Debriefs in flight"
          subtitle="Late-stage closes that need debriefing — open, pending, and awaiting approval."
        />
        <Skeleton className="h-32 bg-bg-elevate" />
      </div>
    );
  }

  const sorted = [...items].sort((a, b) => dueRank(a) - dueRank(b));
  const open = sorted.filter((d) => bucketOf(d) === "open");
  const synthesized = sorted.filter((d) => bucketOf(d) === "synthesized");
  const approved = [...items]
    .filter((d) => bucketOf(d) === "approved")
    .sort(
      (a, b) =>
        new Date(b.approvedAt ?? b.createdAt).getTime() -
        new Date(a.approvedAt ?? a.createdAt).getTime(),
    )
    .slice(0, 6);
  const overdue = open.filter((d) => {
    const dl = dueLabel(d);
    return dl.tone === "overdue";
  }).length;

  return (
    <div className="p-6 md:p-10 space-y-6 max-w-6xl">
      <PageHero
        eyebrow="WIN/LOSS · INTAKE"
        title="Debriefs in flight"
        subtitle="Late-stage closes that need debriefing — open intake, synthesized drafts awaiting approval, and recently approved."
      />

      <div className="flex gap-2 text-sm font-mono">
        <span className="px-3 py-1 rounded bg-gold text-bg">Intake</span>
        <Link
          href={referenceHref}
          className="px-3 py-1 rounded bg-bg-elevate text-text-mute hover:text-text"
        >
          Themes library →
        </Link>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-3 gap-6 text-sm">
          <div>
            <div className="text-text-faint font-mono text-xs uppercase">
              Open
            </div>
            <div className="text-2xl font-semibold mt-1">{open.length}</div>
            {overdue > 0 && (
              <div className="text-xs text-danger font-mono mt-1">
                {overdue} overdue
              </div>
            )}
          </div>
          <div>
            <div className="text-text-faint font-mono text-xs uppercase">
              Awaiting approval
            </div>
            <div className="text-2xl font-semibold mt-1 text-gold">
              {synthesized.length}
            </div>
          </div>
          <div>
            <div className="text-text-faint font-mono text-xs uppercase">
              Approved (recent)
            </div>
            <div className="text-2xl font-semibold mt-1 text-success">
              {approved.length}
            </div>
          </div>
        </div>
      </Card>

      <DebriefBucket
        title="Open · pending intake"
        empty="No open debriefs. New debriefs appear automatically when an opp closes."
        rows={open}
        onOpen={(d) => setLocation(`/opportunities/${d.opportunityId}/win-loss`)}
      />

      <DebriefBucket
        title="Synthesized · awaiting partner approval"
        empty="Nothing synthesized yet. Run the Win/Loss Interviewer from a debrief workspace to draft themes."
        rows={synthesized}
        onOpen={(d) => setLocation(`/opportunities/${d.opportunityId}/win-loss`)}
      />

      <SectionHead title="Recently approved" />
      <div className="grid gap-3">
        {approved.length === 0 && (
          <Card className="p-6 text-text-mute">
            No approved debriefs yet. Approved themes feed the{" "}
            <Link href={referenceHref} className="text-gold underline">
              themes library
            </Link>
            .
          </Card>
        )}
        {approved.map((d) => (
          <DebriefRowCard
            key={d.id}
            row={d}
            onOpen={() =>
              setLocation(`/opportunities/${d.opportunityId}/win-loss`)
            }
          />
        ))}
      </div>
    </div>
  );
}

function DebriefBucket({
  title,
  empty,
  rows,
  onOpen,
}: {
  title: string;
  empty: string;
  rows: DebriefRow[];
  onOpen: (d: DebriefRow) => void;
}) {
  return (
    <div className="space-y-3">
      <SectionHead title={`${title} · ${rows.length}`} />
      <div className="grid gap-3">
        {rows.length === 0 && (
          <Card className="p-6 text-text-mute">{empty}</Card>
        )}
        {rows.map((d) => (
          <DebriefRowCard key={d.id} row={d} onOpen={() => onOpen(d)} />
        ))}
      </div>
    </div>
  );
}

function DebriefRowCard({
  row,
  onOpen,
}: {
  row: DebriefRow;
  onOpen: () => void;
}) {
  const dl = dueLabel(row);
  return (
    <Card className="p-4 hover:border-gold/50 transition-colors">
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left flex flex-wrap gap-3 items-center justify-between"
      >
        <div className="space-y-1">
          <div className="font-medium text-text">{row.opportunityName}</div>
          <div className="flex gap-2 items-center text-xs flex-wrap">
            <MonoChip>{row.outcome}</MonoChip>
            <MonoChip>{row.status}</MonoChip>
            {row.hiddenCompetitor && (
              <MonoChip>vs {row.hiddenCompetitor}</MonoChip>
            )}
            <span className="text-text-faint">{row.themeCount} themes</span>
          </div>
        </div>
        <div className={`text-xs font-mono ${TONE_CLASS[dl.tone]}`}>
          {dl.text}
        </div>
      </button>
    </Card>
  );
}
