import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RosterNav } from "./RosterNav";

interface Invitation {
  id: string;
  workerType: "employee" | "contractor" | "partner_firm_resource";
  personDraft: {
    fullName: string;
    email: string;
    role?: string | null;
    seniority?: string | null;
    title?: string | null;
    country?: string | null;
    partnerFirmId?: string | null;
    startDate?: string | null;
  };
  sentByUserId: string;
  sentAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  acceptedPersonId: string | null;
  status: string;
}

const STATUS_TONE: Record<string, "default" | "gold" | "green" | "amber" | "red"> = {
  sent: "gold",
  accepted: "green",
  revoked: "red",
  expired: "amber",
};

export default function RosterInvitations(): React.ReactElement {
  const [rows, setRows] = React.useState<Invitation[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState({
    workerType: "employee" as Invitation["workerType"],
    fullName: "",
    email: "",
    role: "",
    seniority: "",
    title: "",
    country: "",
    partnerFirmId: "",
    startDate: "",
  });
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    fetch("/api/atelier/roster/invitations", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setRows(d.invitations ?? []))
      .catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/atelier/roster/invitations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "failed");
        return;
      }
      setDraft({ ...draft, fullName: "", email: "" });
      reload();
    } finally {
      setBusy(false);
    }
  };

  const action = async (id: string, kind: "resend" | "revoke" | "accept") => {
    await fetch(`/api/atelier/roster/invitations/${id}/${kind}`, {
      method: "POST",
      credentials: "include",
    });
    reload();
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-screen-2xl mx-auto">
      <PageHero>
        <SectionHead
          eyebrow="The Roster"
          headline="Invitations"
          lede="Pre-onboarding hand-offs. The Onboarding Concierge materialises the person and starts the sequence on accept."
        />
      </PageHero>
      <RosterNav />

      <Card className="p-4 mb-6 space-y-3" data-testid="invitation-form">
        <h3 className="font-mono text-xs uppercase text-text-mute">New invitation</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Worker type</span>
            <select
              className="w-full bg-bg-elev border border-line rounded px-2 py-1 text-sm"
              value={draft.workerType}
              onChange={(e) =>
                setDraft({ ...draft, workerType: e.target.value as Invitation["workerType"] })
              }
              data-testid="invite-worker-type"
            >
              <option value="employee">Employee</option>
              <option value="contractor">Contractor</option>
              <option value="partner_firm_resource">Partner-firm resource</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Full name</span>
            <Input
              value={draft.fullName}
              onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
              data-testid="invite-fullname"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Email</span>
            <Input
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              data-testid="invite-email"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Role</span>
            <Input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Title</span>
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Country</span>
            <Input value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Seniority</span>
            <Input
              value={draft.seniority}
              onChange={(e) => setDraft({ ...draft, seniority: e.target.value })}
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Start date</span>
            <Input
              type="date"
              value={draft.startDate}
              onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            />
          </label>
          {draft.workerType === "partner_firm_resource" && (
            <label className="space-y-1">
              <span className="font-mono text-[11px] uppercase text-text-mute">Partner firm id</span>
              <Input
                value={draft.partnerFirmId}
                onChange={(e) => setDraft({ ...draft, partnerFirmId: e.target.value })}
              />
            </label>
          )}
        </div>
        {error && <div className="text-red-500 text-xs font-mono">{error}</div>}
        <Button onClick={submit} disabled={busy || !draft.fullName || !draft.email} data-testid="invite-send">
          {busy ? "Sending…" : "Send invitation"}
        </Button>
      </Card>

      <div className="space-y-2">
        {rows === null && <div className="text-text-mute py-8">Loading…</div>}
        {rows?.length === 0 && (
          <div className="text-text-mute py-8 italic">No invitations yet.</div>
        )}
        {rows?.map((r) => (
          <Card key={r.id} className="p-4 flex items-start justify-between gap-4" data-testid={`invitation-${r.id}`}>
            <div className="space-y-1">
              <div className="font-medium">{r.personDraft.fullName}</div>
              <div className="text-text-mute text-xs">{r.personDraft.email}</div>
              <div className="flex gap-1 mt-1">
                <MonoChip>{r.workerType}</MonoChip>
                <MonoChip tone={STATUS_TONE[r.status] ?? "default"}>{r.status}</MonoChip>
                {r.expiresAt && (
                  <MonoChip>expires {r.expiresAt.slice(0, 10)}</MonoChip>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {r.status === "sent" && (
                <>
                  <Button variant="outline" size="sm" onClick={() => action(r.id, "resend")}>
                    Resend
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => action(r.id, "accept")} data-testid={`accept-${r.id}`}>
                    Accept (demo)
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => action(r.id, "revoke")}>
                    Revoke
                  </Button>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
