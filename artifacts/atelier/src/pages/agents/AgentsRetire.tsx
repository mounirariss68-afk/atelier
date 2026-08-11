/**
 * Agents lens — Retire stage (Tasks #370 read, #381 write).
 *
 * Deprecation schedule with replacement mapping and remaining caller
 * count. Status: scheduled → deprecated → archived. Employee personas
 * advance the lifecycle via POST
 * /api/atelier/agents-lens/retirements/:id/advance.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import {
  Card,
  MonoChip,
  Eyebrow,
  PillButton,
} from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { useToast } from "@/hooks/use-toast";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { useRetirements, type RetirementRow } from "@/lib/agents-lens-seed";

const STATUS_TONE: Record<RetirementRow["status"], "default" | "gold" | "green"> = {
  scheduled: "gold",
  deprecated: "default",
  archived: "green",
};

const EMPLOYEE_ROLES = new Set([
  "founding_partner",
  "partner",
  "finance",
  "hr",
  "senior_manager",
  "consultant",
]);

export default function AgentsRetire() {
  const rows = useRetirements();
  const { data: me } = useAtelierGetMe();
  const canWrite = !!me?.role && EMPLOYEE_ROLES.has(me.role);

  return (
    <div className="animate-in fade-in">
      <LensPageHeader
        headline="Retire — deprecation schedule"
        lede="Every retired agent ships with a replacement mapping and a migration deadline. Archived agents stay queryable in the audit trail."
      />

      <div className="container-atelier py-10">
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm" data-testid="retire-table">
            <thead className="bg-bg-deep/60 text-[10px] font-mono uppercase tracking-widest text-text-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Agent</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Replacement</th>
                <th className="text-left px-4 py-2.5">Deprecate</th>
                <th className="text-left px-4 py-2.5">Archive</th>
                <th className="text-left px-4 py-2.5">Callers to migrate</th>
                {canWrite && <th className="text-left px-4 py-2.5">Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border-soft align-top"
                  data-testid={`retire-row-${r.id}`}
                >
                  <td className="px-4 py-3 text-text">
                    <div className="font-medium">{r.agentName}</div>
                    <div className="text-xs text-text-mute mt-1 max-w-xs">{r.reason}</div>
                  </td>
                  <td className="px-4 py-3"><MonoChip tone={STATUS_TONE[r.status]}>{r.status}</MonoChip></td>
                  <td className="px-4 py-3 text-gold/90 font-mono text-xs">
                    {r.replacementName ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-mute">{r.deprecateAt}</td>
                  <td className="px-4 py-3 font-mono text-xs text-text-mute">{r.archiveAt}</td>
                  <td className="px-4 py-3 font-mono text-text">
                    <MonoChip tone={r.callersToMigrate > 0 ? "amber" : "green"}>
                      {r.callersToMigrate}
                    </MonoChip>
                  </td>
                  {canWrite && (
                    <td className="px-4 py-3">
                      {r.status !== "archived" ? (
                        <AdvanceButton id={r.id} status={r.status} />
                      ) : (
                        <span className="text-[11px] font-mono text-text-faint">
                          archived
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function AdvanceButton({
  id,
  status,
}: {
  id: string;
  status: RetirementRow["status"];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const target: "deprecated" | "archived" =
    status === "scheduled" ? "deprecated" : "archived";

  const advance = useMutation({
    mutationFn: async () => {
      const r = await fetch(
        `${import.meta.env.BASE_URL}api/atelier/agents-lens/retirements/${id}/advance`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target }),
        },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `advance_${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["atelier-agents-lens"] });
      toast({
        title: "Retirement advanced",
        description: `${status} → ${target}`,
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Advance failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  return (
    <PillButton
      variant="primary"
      onClick={() => advance.mutate()}
      disabled={advance.isPending}
      data-testid={`btn-retire-advance-${id}`}
    >
      <ArrowRight className="w-3.5 h-3.5 mr-1 inline" />
      Mark {target}
    </PillButton>
  );
}
