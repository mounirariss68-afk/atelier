/**
 * Agents lens — Retire stage (Task #370).
 *
 * Deprecation schedule with replacement mapping and remaining caller
 * count. Status: scheduled → deprecated → archived.
 */
import {
  PageHero,
  SectionHead,
  Card,
  MonoChip,
  Eyebrow,
} from "@/components/ui/primitives";
import { useRetirements, type RetirementRow } from "@/lib/agents-lens-seed";

const STATUS_TONE: Record<RetirementRow["status"], "default" | "gold" | "green"> = {
  scheduled: "gold",
  deprecated: "default",
  archived: "green",
};

export default function AgentsRetire() {
  const rows = useRetirements();
  return (
    <div className="animate-in fade-in">
      <PageHero>
        <Eyebrow>Manage · Agents · Retire</Eyebrow>
        <SectionHead
          headline="Retire — deprecation schedule"
          lede="Every retired agent ships with a replacement mapping and a migration deadline. Archived agents stay queryable in the audit trail."
          className="mt-3"
        />
      </PageHero>

      <div className="container-atelier py-10">
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm" data-testid="retire-table">
            <thead className="bg-bg-deep text-[10px] font-mono uppercase tracking-widest text-text-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Agent</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Replacement</th>
                <th className="text-left px-4 py-2.5">Deprecate</th>
                <th className="text-left px-4 py-2.5">Archive</th>
                <th className="text-left px-4 py-2.5">Callers to migrate</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
