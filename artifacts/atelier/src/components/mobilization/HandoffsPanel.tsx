/**
 * HandoffsPanel — lists existing handoffs and provides a form to record a
 * new one via POST /engagements/:id/mobilization/handoffs.
 *
 * PersonPicker returns the scoped roster identity. The server resolves that
 * person to an org-scoped portal login, so the browser never enumerates users.
 */
import * as React from "react";
import { Plus } from "lucide-react";
import { Card, MonoChip, PillButton, SectionLabel } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { PersonPicker, type PersonPickerRow } from "@/pages/roster/rosterPickers";
import { API, FIELD_CLS, HANDOFF_KINDS } from "./constants";
import { FormField, EmptySlot } from "./FormPrimitives";
import type { MobilizationHandoff } from "./types";

interface HandoffsPanelProps {
  engId: string;
  handoffs: MobilizationHandoff[];
  canMobilize: boolean;
  onDone: () => void;
}

export function HandoffsPanel({
  engId,
  handoffs,
  canMobilize,
  onDone,
}: HandoffsPanelProps) {
  const { toast } = useToast();
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // Picker state
  const [selectedPerson, setSelectedPerson] = React.useState<PersonPickerRow | null>(null);
  const [recipientPersonId, setRecipientPersonId] = React.useState<string | null>(null);

  const [kind, setKind] = React.useState("knowledge_transfer");
  const [notes, setNotes] = React.useState("");

  function handlePersonChange(personId: string, person: PersonPickerRow | null) {
    setSelectedPerson(person);
    setRecipientPersonId(person && personId ? personId : null);
  }

  function resetForm() {
    setSelectedPerson(null);
    setRecipientPersonId(null);
    setNotes("");
    setKind("knowledge_transfer");
  }

  function toggleShow() {
    if (show) {
      resetForm();
      setShow(false);
    } else {
      setShow(true);
    }
  }

  async function submitHandoff(e: React.FormEvent) {
    e.preventDefault();
    if (!recipientPersonId || !kind) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/engagements/${engId}/mobilization/handoffs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientPersonId,
          kind,
          notes: notes || null,
          idempotencyKey: `hof-${engId}-${recipientPersonId}-${kind}-${Date.now()}`,
        }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? `hof_${r.status}`);
      toast({ title: "Handoff recorded" });
      resetForm();
      setShow(false);
      onDone();
    } catch (err) {
      toast({
        title: "Handoff failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !!recipientPersonId && !busy;

  return (
    <Card className="p-5 space-y-4" data-testid="handoffs-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SectionLabel>Handoffs</SectionLabel>
        {canMobilize && (
          <PillButton
            variant="ghost"
            onClick={toggleShow}
            data-testid="btn-add-handoff"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            {show ? "Cancel" : "Record handoff"}
          </PillButton>
        )}
      </div>

      {show && canMobilize && (
        <form
          onSubmit={submitHandoff}
          className="rounded-md p-4 space-y-3 border border-border-soft bg-bg-deep"
          data-testid="add-handoff-form"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Recipient *" className="sm:col-span-2">
              <PersonPicker
                value={selectedPerson?.id ?? ""}
                onChange={handlePersonChange}
                placeholder="Search roster for recipient…"
                testId="handoff-person-picker"
              />
              {selectedPerson && (
                <div className="mt-1 text-[11px] text-text-mute">
                  {selectedPerson.fullName}
                  {selectedPerson.title ? ` · ${selectedPerson.title}` : ""}
                  {selectedPerson.email ? ` · ${selectedPerson.email}` : ""}
                </div>
              )}
            </FormField>

            <FormField label="Kind *">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className={FIELD_CLS}
                data-testid="handoff-kind"
              >
                {HANDOFF_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Notes">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes…"
                className={FIELD_CLS}
                data-testid="handoff-notes"
              />
            </FormField>
          </div>

          <div className="flex items-center gap-2">
            <PillButton
              type="submit"
              variant="primary"
              disabled={!canSubmit}
              data-testid="btn-handoff-submit"
            >
              {busy ? "Recording…" : "Record handoff"}
            </PillButton>
          </div>
        </form>
      )}

      {handoffs.length === 0 && !show && (
        <EmptySlot message="No handoffs recorded." />
      )}

      {handoffs.length > 0 && (
        <div className="space-y-2">
          {handoffs.map((h) => (
            <div
              key={h.id}
              className="flex items-start gap-3 p-3 rounded-md border border-border-soft bg-bg-deep"
              data-testid={`handoff-row-${h.id}`}
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-text capitalize">
                    {h.kind.replace(/_/g, " ")}
                  </span>
                  <MonoChip
                    tone={
                      h.status === "completed"
                        ? "green"
                        : h.status === "pending"
                        ? "amber"
                        : "default"
                    }
                  >
                    {h.status}
                  </MonoChip>
                </div>
                {h.notes && (
                  <div className="text-xs text-text-mute">{h.notes}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
