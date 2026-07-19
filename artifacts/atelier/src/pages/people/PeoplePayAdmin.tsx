/**
 * PeoplePayAdmin — Task #54: HR side of the personal pay hub.
 *
 * Two views hosted as sub-tabs of People › Reward (fp/hr only per Task #221; the
 * same gate as the rest of Reward):
 *  - PayDocsAdminView: pick a person, upload pay/benefit documents, publish
 *    (which drops a card on their Me home) or retract, maintain insurance.
 *  - BankChangesAdminView: the bank-detail change-request queue; approving
 *    applies the new IBAN/SWIFT to the roster record.
 *
 * Uploads and downloads use raw fetch — multipart/binary routes are bespoke
 * (same precedent as CLI attachments); everything JSON uses codegen hooks.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierListPersonPayDocuments,
  getAtelierListPersonPayDocumentsQueryKey,
  useAtelierPublishPayDocument,
  useAtelierRetractPayDocument,
  useAtelierUpsertPersonInsurance,
  useAtelierListBankChangeRequests,
  getAtelierListBankChangeRequestsQueryKey,
  useAtelierApproveBankChangeRequest,
  useAtelierRejectBankChangeRequest,
  type AtelierPayDocumentAdmin,
} from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";

interface PersonRow {
  id: string;
  workerType: "employee" | "contractor" | "partner_firm_resource";
  fullName: string;
  email: string | null;
}

const EMPLOYEE_CATEGORIES = [
  "payslip",
  "contract",
  "salary_letter",
  "bonus_letter",
  "comp_letter",
  "insurance",
] as const;
const CONTRACTOR_CATEGORIES = [
  "remittance",
  "contract",
  "salary_letter",
  "bonus_letter",
  "comp_letter",
] as const;

const CATEGORY_LABEL: Record<string, string> = {
  contract: "Contract",
  salary_letter: "Salary letter",
  bonus_letter: "Bonus letter",
  comp_letter: "Comp letter",
  payslip: "Payslip",
  remittance: "Remittance",
  insurance: "Insurance",
};

function usePayPeople(): { people: PersonRow[]; loading: boolean } {
  const [people, setPeople] = React.useState<PersonRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let alive = true;
    fetch("/api/atelier/roster/people", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json: { people?: PersonRow[] } | PersonRow[]) => {
        if (!alive) return;
        const rows = Array.isArray(json) ? json : (json.people ?? []);
        setPeople(rows.filter((p) => p.workerType !== "partner_firm_resource"));
      })
      .catch(() => {
        if (alive) setPeople([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { people, loading };
}

export function PayDocsAdminView() {
  const { people, loading } = usePayPeople();
  const [personId, setPersonId] = React.useState("");
  const person = people.find((p) => p.id === personId) ?? null;

  return (
    <div className="space-y-4" data-testid="people-pay-admin">
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-text mb-2">Person</h3>
        {loading ? (
          <p className="text-sm text-text-faint">Loading roster…</p>
        ) : (
          <select
            className="w-full rounded border border-border-soft bg-transparent px-2 py-1.5 text-sm text-text"
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            data-testid="people-pay-person-select"
          >
            <option value="">Select a person…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} ({p.workerType})
              </option>
            ))}
          </select>
        )}
      </Card>
      {person && (
        <>
          <UploadCard person={person} />
          <DocListCard person={person} />
          {person.workerType === "employee" && <InsuranceAdminCard person={person} />}
        </>
      )}
    </div>
  );
}

function UploadCard({ person }: { person: PersonRow }) {
  const qc = useQueryClient();
  const cats = person.workerType === "contractor" ? CONTRACTOR_CATEGORIES : EMPLOYEE_CATEGORIES;
  const [category, setCategory] = React.useState<string>(cats[0]);
  const [title, setTitle] = React.useState("");
  const [periodDate, setPeriodDate] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setCategory(cats[0]);
  }, [person.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("category", category);
      fd.set("title", title.trim());
      if (periodDate.trim()) fd.set("periodDate", periodDate.trim());
      const r = await fetch(
        `/api/atelier/roster/pay/people/${encodeURIComponent(person.id)}/documents`,
        { method: "POST", body: fd, credentials: "include" },
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `upload failed (${r.status})`);
      }
      setTitle("");
      setPeriodDate("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({
        queryKey: getAtelierListPersonPayDocumentsQueryKey(person.id),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4" data-testid="people-pay-upload">
      <h3 className="text-sm font-semibold text-text mb-2">Upload a document for {person.fullName}</h3>
      <form className="space-y-3" onSubmit={submit}>
        <div className="grid gap-3 md:grid-cols-3">
          <select
            className="rounded border border-border-soft bg-transparent px-2 py-1.5 text-sm text-text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            data-testid="people-pay-upload-category"
          >
            {cats.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <Input
            placeholder="Title (e.g. Payslip — June 2026)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            data-testid="people-pay-upload-title"
          />
          <Input
            placeholder="Period (e.g. 2026-06)"
            value={periodDate}
            onChange={(e) => setPeriodDate(e.target.value)}
            data-testid="people-pay-upload-period"
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          className="block text-sm text-text-mute"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          data-testid="people-pay-upload-file"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
          disabled={busy || !file || !title.trim()}
          data-testid="people-pay-upload-submit"
        >
          {busy ? "Uploading…" : "Upload (unpublished)"}
        </button>
        <p className="font-mono text-[10px] uppercase tracking-wider text-text-faint">
          Max 10 MB. Documents stay hidden from the person until you publish them.
        </p>
      </form>
    </Card>
  );
}

function DocListCard({ person }: { person: PersonRow }) {
  const qc = useQueryClient();
  const { data: docs, isLoading } = useAtelierListPersonPayDocuments(person.id);
  const invalidate = () =>
    void qc.invalidateQueries({
      queryKey: getAtelierListPersonPayDocumentsQueryKey(person.id),
    });
  const publish = useAtelierPublishPayDocument({ mutation: { onSuccess: invalidate } });
  const retract = useAtelierRetractPayDocument({ mutation: { onSuccess: invalidate } });

  return (
    <Card className="p-4" data-testid="people-pay-doclist">
      <h3 className="text-sm font-semibold text-text mb-2">Documents</h3>
      {isLoading ? (
        <p className="text-sm text-text-faint">Loading…</p>
      ) : !docs || docs.length === 0 ? (
        <p className="text-sm text-text-mute">No pay documents for this person yet.</p>
      ) : (
        <ul className="divide-y divide-border-soft">
          {docs.map((d: AtelierPayDocumentAdmin) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2" data-testid={`people-pay-doc-${d.id}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MonoChip tone={d.published ? "gold" : undefined}>
                    {d.published ? "published" : "draft"}
                  </MonoChip>
                  <MonoChip>{CATEGORY_LABEL[d.category] ?? d.category}</MonoChip>
                  <span className="text-sm text-text truncate">{d.title}</span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-text-faint">
                  {d.periodDate ? `${d.periodDate} · ` : ""}{d.fileName}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <a href={d.downloadUrl} className="text-xs text-gold hover:underline">
                  Download
                </a>
                {d.published ? (
                  <button
                    className="text-xs text-text-mute hover:text-text disabled:opacity-50"
                    onClick={() => retract.mutate({ docId: d.id })}
                    disabled={retract.isPending}
                    data-testid={`people-pay-retract-${d.id}`}
                  >
                    Retract
                  </button>
                ) : (
                  <button
                    className="text-xs text-gold hover:underline disabled:opacity-50"
                    onClick={() => publish.mutate({ docId: d.id })}
                    disabled={publish.isPending}
                    data-testid={`people-pay-publish-${d.id}`}
                  >
                    Publish
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function InsuranceAdminCard({ person }: { person: PersonRow }) {
  const [provider, setProvider] = React.useState("");
  const [policyNumber, setPolicyNumber] = React.useState("");
  const [memberNumber, setMemberNumber] = React.useState("");
  const [coverageSummary, setCoverageSummary] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const upsert = useAtelierUpsertPersonInsurance({
    mutation: {
      onSuccess: () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      },
    },
  });

  return (
    <Card className="p-4" data-testid="people-pay-insurance-admin">
      <h3 className="text-sm font-semibold text-text mb-2">Insurance details for {person.fullName}</h3>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!provider.trim()) return;
          upsert.mutate({
            personId: person.id,
            data: {
              provider: provider.trim(),
              ...(policyNumber.trim() ? { policyNumber: policyNumber.trim() } : {}),
              ...(memberNumber.trim() ? { memberNumber: memberNumber.trim() } : {}),
              ...(coverageSummary.trim() ? { coverageSummary: coverageSummary.trim() } : {}),
            },
          });
        }}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Input placeholder="Provider" value={provider} onChange={(e) => setProvider(e.target.value)} required />
          <Input placeholder="Policy number" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
          <Input placeholder="Member number" value={memberNumber} onChange={(e) => setMemberNumber(e.target.value)} />
        </div>
        <Input
          placeholder="Coverage summary (shown to the person)"
          value={coverageSummary}
          onChange={(e) => setCoverageSummary(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
            disabled={upsert.isPending || !provider.trim()}
            data-testid="people-pay-insurance-save"
          >
            {upsert.isPending ? "Saving…" : "Save insurance details"}
          </button>
          {saved && <span className="text-xs text-gold">Saved.</span>}
        </div>
      </form>
    </Card>
  );
}

export function BankChangesAdminView() {
  const qc = useQueryClient();
  const { data: rows, isLoading } = useAtelierListBankChangeRequests();
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListBankChangeRequestsQueryKey() });
  const approve = useAtelierApproveBankChangeRequest({ mutation: { onSuccess: invalidate } });
  const reject = useAtelierRejectBankChangeRequest({ mutation: { onSuccess: invalidate } });
  const [notes, setNotes] = React.useState<Record<string, string>>({});

  if (isLoading) {
    return <Card className="p-6 text-sm text-text-faint">Loading requests…</Card>;
  }
  if (!rows || rows.length === 0) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="people-pay-bank-empty">
        No bank-detail change requests. When someone requests a change from
        their Me lens, it lands here for verification.
      </Card>
    );
  }
  return (
    <div className="space-y-2" data-testid="people-pay-bank-queue">
      {rows.map((r) => (
        <Card key={r.id} className="p-4" data-testid={`bank-req-${r.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text">{r.personName}</span>
                <MonoChip tone={r.status === "pending" ? "gold" : undefined}>{r.status}</MonoChip>
              </div>
              <p className="mt-1 text-sm text-text">
                {r.previousIbanMasked ?? "no IBAN on file"} → <span className="font-mono">{r.newIban}</span>
                {r.newSwift ? <span className="text-text-mute"> · SWIFT {r.newSwift}</span> : null}
              </p>
              {r.reason ? <p className="mt-0.5 text-xs text-text-mute">Reason: {r.reason}</p> : null}
              {r.decisionNote ? (
                <p className="mt-0.5 text-xs text-text-mute">
                  Decision{r.decidedByName ? ` by ${r.decidedByName}` : ""}: {r.decisionNote}
                </p>
              ) : null}
            </div>
            {r.status === "pending" && (
              <div className="flex items-center gap-2">
                <Input
                  className="w-48"
                  placeholder="Note (optional)"
                  value={notes[r.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                />
                <button
                  className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                  onClick={() =>
                    approve.mutate({
                      id: r.id,
                      data: notes[r.id]?.trim() ? { note: notes[r.id].trim() } : {},
                    })
                  }
                  disabled={approve.isPending || reject.isPending}
                  data-testid={`bank-approve-${r.id}`}
                >
                  Approve & apply
                </button>
                <button
                  className="text-xs text-text-mute hover:text-text disabled:opacity-50"
                  onClick={() =>
                    reject.mutate({
                      id: r.id,
                      data: notes[r.id]?.trim() ? { note: notes[r.id].trim() } : {},
                    })
                  }
                  disabled={approve.isPending || reject.isPending}
                  data-testid={`bank-reject-${r.id}`}
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
