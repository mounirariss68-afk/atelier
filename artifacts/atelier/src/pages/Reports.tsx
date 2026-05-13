import * as React from "react";
import { Card, PageHero, SectionHead, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

interface Template {
  id: string;
  name: string;
  abstract: string;
  columns: string[];
}
interface ReportRow {
  id: string;
  name: string;
  templateId: string;
  parameters: Record<string, unknown>;
  lastRunAt: string | null;
  schedule: string;
  scheduleChannels: string[];
  scheduleCron: string | null;
  scheduleRecipientUserIds: string[];
  createdAt: string;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export default function Reports() {
  const { toast } = useToast();
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [reports, setReports] = React.useState<ReportRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [snapshot, setSnapshot] = React.useState<{ id: string; rows: Array<Record<string, unknown>>; summary: string } | null>(null);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const [t, r] = await Promise.all([
        api<{ templates: Template[] }>("/api/atelier/reports/templates"),
        api<{ items: ReportRow[] }>("/api/atelier/reports"),
      ]);
      setTemplates(t.templates);
      setReports(r.items);
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void reload();
  }, [reload]);

  const create = async (templateId: string, name: string) => {
    await api("/api/atelier/reports", {
      method: "POST",
      body: JSON.stringify({ templateId, name }),
    });
    toast({ title: `Created "${name}"` });
    await reload();
  };
  const run = async (id: string) => {
    const out = await api<{ result: { rows: Array<Record<string, unknown>>; summary: string } }>(
      `/api/atelier/reports/${id}/run`,
      { method: "POST" },
    );
    setSnapshot({ id, rows: out.result.rows, summary: out.result.summary });
    toast({ title: "Report ran" });
    await reload();
  };
  const schedule = async (id: string) => {
    await api(`/api/atelier/reports/${id}/schedule`, {
      method: "POST",
      body: JSON.stringify({
        schedule: "weekly_monday",
        cron: "0 7 * * 1",
        channels: ["in_app"],
      }),
    });
    toast({ title: "Scheduled — Mon 07:00" });
    await reload();
  };

  if (loading)
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-32 bg-bg-elevate" />
      </div>
    );

  return (
    <div className="p-6 md:p-10 space-y-8 max-w-6xl">
      <PageHero
        eyebrow="REPORTS"
        title="Branded exports & scheduled deliveries"
        subtitle="9 templates per PRD §5. Schedules stub Slack/email — no real channels in v2."
      />

      <section>
        <SectionHead title="Templates" />
        <div className="grid gap-3 md:grid-cols-2 mt-3">
          {templates.map((t) => (
            <Card key={t.id} className="p-4 space-y-2">
              <div className="font-medium text-text">{t.name}</div>
              <div className="text-sm text-text-mute">{t.abstract}</div>
              <div className="flex flex-wrap gap-1">
                {t.columns.map((c) => (
                  <MonoChip key={c}>{c}</MonoChip>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => create(t.id, t.name)}>
                Create from template
              </Button>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionHead title={`Saved reports (${reports.length})`} />
        <div className="grid gap-3 mt-3">
          {reports.map((r) => (
            <Card key={r.id} className="p-4 space-y-2">
              <div className="flex flex-wrap justify-between gap-2 items-start">
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-text-mute font-mono mt-1">
                    {r.templateId} ·{" "}
                    {r.lastRunAt
                      ? `last run ${new Date(r.lastRunAt).toLocaleString()}`
                      : "never run"}
                    {r.schedule !== "none" &&
                      ` · ${r.schedule}${r.scheduleCron ? ` (${r.scheduleCron})` : ""}${
                        r.scheduleChannels.length ? ` → ${r.scheduleChannels.join("+")}` : ""
                      }`}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => run(r.id)}>
                    Run
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => schedule(r.id)}>
                    Schedule
                  </Button>
                  <a
                    href={`/api/atelier/reports/${r.id}/export.pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gold underline self-center"
                  >
                    PDF
                  </a>
                  <a
                    href={`/api/atelier/reports/${r.id}/export.csv`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gold underline self-center"
                  >
                    CSV
                  </a>
                </div>
              </div>
              {snapshot?.id === r.id && (
                <div className="mt-3 border-t border-border-soft pt-3 space-y-2">
                  <div className="text-sm text-text-mute italic">{snapshot.summary}</div>
                  {snapshot.rows.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="text-xs font-mono">
                        <thead>
                          <tr className="text-text-faint">
                            {Object.keys(snapshot.rows[0]).map((c) => (
                              <th key={c} className="text-left p-1 pr-4">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {snapshot.rows.slice(0, 20).map((row, i) => (
                            <tr key={i}>
                              {Object.keys(snapshot.rows[0]).map((c) => (
                                <td key={c} className="p-1 pr-4">
                                  {String(row[c] ?? "")}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
