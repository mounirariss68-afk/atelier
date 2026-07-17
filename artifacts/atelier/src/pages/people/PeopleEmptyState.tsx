import { Card } from "@/components/ui/primitives";

/**
 * Honest "no data yet" placeholder for People modules that do not yet have
 * real records behind them (Task #96 — no fake demo data).
 */
export function PeopleEmptyState({ message }: { message: string }) {
  return (
    <Card className="p-8 text-center" data-testid="people-empty-state">
      <div className="text-sm text-text-mute">{message}</div>
    </Card>
  );
}
