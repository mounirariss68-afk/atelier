import * as React from "react";
import { useSearch } from "wouter";
import { Card, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CountrySelect,
  countryDisplayName,
  TitleSelect,
  PartnerFirmSelect,
  EmployingEntitySelect,
  type LegalEntity,
} from "./rosterPickers";
import { splitLegacyFullName } from "@/components/StructuredNameFields";

type WorkerType = "employee" | "contractor" | "partner_firm_resource";
type SourceKind = "hired_candidate" | "accepted_offer" | "partner_firm_resource";

interface Invitation {
  id: string;
  workerType: WorkerType;
  personDraft: {
    fullName: string;
    email: string;
    role?: string | null;
    seniority?: string | null;
    title?: string | null;
    country?: string | null;
    partnerFirmId?: string | null;
    startDate?: string | null;
    legalEntityId?: string | null;
    employingEntityName?: string | null;
    employingEntityLegacyUnmatched?: boolean;
  };
  sentByUserId: string;
  sentAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  acceptedPersonId: string | null;
  status: string;
}

interface HiredCandidate {
  id: string;
  name: string;
  email: string;
  roleTitle: string;
  stage: string;
}
interface AcceptedOffer {
  id: string;
  candidateName: string;
  roleTitle: string;
  startDate: string | null;
  status: string;
}
interface PartnerFirmResource {
  id: string;
  partnerFirmId: string;
  fullName: string;
  email: string | null;
  role: string | null;
  seniority: string | null;
  country: string | null;
  startDate: string | null;
  firmName: string | null;
}

const STATUS_TONE: Record<string, "default" | "gold" | "green" | "amber" | "red"> = {
  sent: "gold",
  accepted: "green",
  revoked: "red",
  expired: "amber",
};

const emptyDraft = {
  workerType: "employee" as WorkerType,
  honorific: "",
  firstName: "",
  middleName: "",
  lastName: "",
  preferredName: "",
  email: "",
  role: "",
  seniority: "",
  title: "",
  country: "",
  partnerFirmId: "",
  startDate: "",
  legalEntityId: "",
  officeAddress: "",
};

export default function RosterInvitations(): React.ReactElement {
  const searchStr = useSearch();
  const [rows, setRows] = React.useState<Invitation[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Source selection
  const [sourceKind, setSourceKind] = React.useState<SourceKind>("hired_candidate");
  const [sourceId, setSourceId] = React.useState("");
  const [candidates, setCandidates] = React.useState<HiredCandidate[]>([]);
  const [offers, setOffers] = React.useState<AcceptedOffer[]>([]);
  const [resources, setResources] = React.useState<PartnerFirmResource[]>([]);

  const [draft, setDraft] = React.useState({ ...emptyDraft });

  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    fetch("/api/atelier/roster/invitations", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Server error (${r.status})`);
        return r.json();
      })
      .then((d) => {
        setRows(d.invitations ?? []);
        setLoadError(null);
      })
      .catch((e) => {
        setRows([]);
        setLoadError(e instanceof Error ? e.message : "Couldn't load invitations");
      });
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  // Load candidate / offer / partner-firm sources.
  React.useEffect(() => {
    fetch("/api/atelier/hire/candidates", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) =>
        setCandidates(
          ((d.items ?? []) as HiredCandidate[]).filter((c) => c.stage === "hired"),
        ),
      )
      .catch(() => setCandidates([]));
    fetch("/api/atelier/hire/offers", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) =>
        setOffers(
          ((d.items ?? []) as AcceptedOffer[]).filter((o) => o.status === "accepted"),
        ),
      )
      .catch(() => setOffers([]));
    fetch("/api/atelier/roster/partner-firms", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { resources: [] }))
      .then((d) => setResources((d.resources ?? []) as PartnerFirmResource[]))
      .catch(() => setResources([]));
  }, []);

  // Deep-link prefill: ?sourceKind=accepted_offer&sourceId=<id>
  React.useEffect(() => {
    const sp = new URLSearchParams(searchStr);
    const sk = sp.get("sourceKind") as SourceKind | null;
    const si = sp.get("sourceId");
    if (sk && ["hired_candidate", "accepted_offer", "partner_firm_resource"].includes(sk)) {
      setSourceKind(sk);
      if (si) setSourceId(si);
    }
  }, [searchStr]);

  // Prefill draft from the selected source.
  const applySource = React.useCallback(
    (kind: SourceKind, id: string) => {
      if (!id) return;
      if (kind === "hired_candidate") {
        const c = candidates.find((x) => x.id === id);
        if (c)
          setDraft((d) => ({
            ...d,
            workerType: "employee",
            ...splitLegacyFullName(c.name),
            email: c.email,
            role: c.roleTitle,
            title: c.roleTitle,
          }));
      } else if (kind === "accepted_offer") {
        const o = offers.find((x) => x.id === id);
        if (o)
          setDraft((d) => ({
            ...d,
            workerType: "employee",
            ...splitLegacyFullName(o.candidateName),
            role: o.roleTitle,
            title: o.roleTitle,
            startDate: o.startDate ?? d.startDate,
          }));
      } else {
        // Contracted partner-firm resource — identity fields come from the
        // resource record, firm linkage from its parent firm.
        const pr = resources.find((x) => x.id === id);
        if (pr)
          setDraft((d) => ({
            ...d,
            workerType: "partner_firm_resource",
            ...splitLegacyFullName(pr.fullName),
            email: pr.email ?? d.email,
            role: pr.role ?? d.role,
            seniority: pr.seniority ?? d.seniority,
            country: pr.country ?? d.country,
            startDate: pr.startDate ?? d.startDate,
            partnerFirmId: pr.partnerFirmId,
          }));
      }
    },
    [candidates, offers, resources],
  );

  React.useEffect(() => {
    applySource(sourceKind, sourceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKind, sourceId, candidates, offers, resources]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/atelier/roster/invitations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerType: draft.workerType,
          honorific: draft.honorific.trim() || null,
          firstName: draft.firstName.trim(),
          middleName: draft.middleName.trim() || null,
          lastName: draft.lastName.trim(),
          preferredName: draft.preferredName.trim() || null,
          email: draft.email,
          role: draft.role || null,
          seniority: draft.seniority || null,
          title: draft.title || null,
          country: draft.country || null,
          partnerFirmId: draft.partnerFirmId || null,
          startDate: draft.startDate || null,
          legalEntityId:
            draft.workerType === "employee"
              ? draft.legalEntityId || null
              : null,
          sourceKind,
          sourceId,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.message ?? d.error ?? `Invitation failed (${r.status})`);
        return;
      }
      setDraft({ ...emptyDraft });
      setSourceId("");
      reload();
    } catch (e) {
      // Transport failure (network down, server unreachable) — surface it.
      setError(e instanceof Error ? e.message : "Network error — invitation not sent");
    } finally {
      setBusy(false);
    }
  };

  const action = async (id: string, kind: "resend" | "revoke" | "accept") => {
    setActionError(null);
    try {
      const r = await fetch(`/api/atelier/roster/invitations/${id}/${kind}`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}) as { message?: string; error?: string });
        setActionError(
          d.message ?? d.error ?? `Couldn't ${kind} the invitation (${r.status})`,
        );
        return;
      }
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : `Network error — couldn't ${kind} the invitation`,
      );
      return;
    }
    reload();
  };

  const sourceReady = Boolean(sourceId);

  return (
    <div>
      <p className="text-text-mute text-sm mb-4">
        Pre-onboarding hand-offs. Invitations are created only from a hired candidate, an accepted
        offer, or a contracted partner-firm resource. The Onboarding Concierge materialises the person and
        starts the pre-boarding sequence when you mark it accepted.
      </p>

      <Card className="p-4 mb-6 space-y-3" data-testid="invitation-form">
        <h3 className="font-mono text-xs uppercase text-text-mute">New invitation</h3>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Source</span>
            <select
              className="w-full bg-bg-elev border border-line rounded px-2 py-1 text-sm"
              value={sourceKind}
              onChange={(e) => {
                setSourceKind(e.target.value as SourceKind);
                setSourceId("");
              }}
              data-testid="invite-source-kind"
            >
              <option value="hired_candidate">Hired candidate</option>
              <option value="accepted_offer">Accepted offer</option>
              <option value="partner_firm_resource">Contracted partner-firm resource</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">
              {sourceKind === "hired_candidate"
                ? "Candidate"
                : sourceKind === "accepted_offer"
                  ? "Offer"
                  : "Partner-firm resource"}
            </span>
            <select
              className="w-full bg-bg-elev border border-line rounded px-2 py-1 text-sm"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              data-testid="invite-source-id"
            >
              <option value="">Select source…</option>
              {sourceKind === "hired_candidate" &&
                candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.roleTitle ? ` · ${c.roleTitle}` : ""}
                  </option>
                ))}
              {sourceKind === "accepted_offer" &&
                offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.candidateName}
                    {o.roleTitle ? ` · ${o.roleTitle}` : ""}
                  </option>
                ))}
              {sourceKind === "partner_firm_resource" &&
                resources.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.fullName}
                    {pr.firmName ? ` — ${pr.firmName}` : ""}
                    {pr.role ? ` · ${pr.role}` : ""}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Worker type</span>
            <select
              className="w-full bg-bg-elev border border-line rounded px-2 py-1 text-sm"
              value={draft.workerType}
              onChange={(e) =>
                setDraft({ ...draft, workerType: e.target.value as WorkerType })
              }
              data-testid="invite-worker-type"
            >
              <option value="employee">Employee</option>
              <option value="contractor">Contractor</option>
              <option value="partner_firm_resource">Partner-firm resource</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Honorific</span>
            <Input
              value={draft.honorific}
              placeholder="Dr."
              onChange={(e) => setDraft({ ...draft, honorific: e.target.value })}
              data-testid="invite-honorific"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">First name *</span>
            <Input
              value={draft.firstName}
              onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
              data-testid="invite-firstname"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Middle name</span>
            <Input
              value={draft.middleName}
              onChange={(e) => setDraft({ ...draft, middleName: e.target.value })}
              data-testid="invite-middlename"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Last name *</span>
            <Input
              value={draft.lastName}
              onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
              data-testid="invite-lastname"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Preferred name</span>
            <Input
              value={draft.preferredName}
              placeholder="Goes by…"
              onChange={(e) => setDraft({ ...draft, preferredName: e.target.value })}
              data-testid="invite-preferredname"
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
            <span className="font-mono text-[11px] uppercase text-text-mute">Seniority / title</span>
            <TitleSelect
              value={draft.title}
              workerType={draft.workerType}
              onChange={(title, row) =>
                setDraft((d) => ({
                  ...d,
                  title,
                  seniority: row?.seniority ?? d.seniority,
                }))
              }
              testId="invite-title"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Country</span>
            <CountrySelect
              value={draft.country}
              onChange={(iso) => setDraft((d) => ({ ...d, country: iso }))}
              testIdPrefix="invite-country"
            />
          </label>
          {draft.workerType === "employee" && (
          <label className="space-y-1">
            <span className="font-mono text-[11px] uppercase text-text-mute">Employing entity</span>
            <EmployingEntitySelect
              value={draft.legalEntityId}
              onChange={(id) => setDraft((d) => ({ ...d, legalEntityId: id }))}
              onSelectEntity={(ent: LegalEntity | null) =>
                setDraft((d) => ({
                  ...d,
                  officeAddress: ent?.officeAddress ?? d.officeAddress,
                  country: ent?.country ? ent.country : d.country,
                }))
              }
              testId="invite-employing-entity"
            />
          </label>
          )}
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
              <span className="font-mono text-[11px] uppercase text-text-mute">Partner firm</span>
              <PartnerFirmSelect
                value={draft.partnerFirmId}
                onChange={(id) => setDraft((d) => ({ ...d, partnerFirmId: id }))}
                testId="invite-partner-firm"
              />
            </label>
          )}
        </div>
        {error && <div className="text-red-500 text-xs font-mono">{error}</div>}
        <Button
          onClick={submit}
          disabled={busy || !sourceReady || !draft.firstName.trim() || !draft.lastName.trim() || !draft.email}
          data-testid="invite-send"
        >
          {busy ? "Sending…" : "Send invitation"}
        </Button>
      </Card>

      <div className="space-y-2">
        {actionError && (
          <div
            className="text-red-500 text-xs font-mono flex items-center gap-3"
            data-testid="invitation-action-error"
          >
            <span>{actionError}</span>
            <button className="underline" onClick={() => setActionError(null)}>
              dismiss
            </button>
          </div>
        )}
        {loadError && (
          <div
            className="text-red-500 text-xs font-mono flex items-center gap-3"
            data-testid="invitations-load-error"
          >
            <span>Couldn't load invitations: {loadError}</span>
            <button className="underline" onClick={reload}>
              retry
            </button>
          </div>
        )}
        {rows === null && <div className="text-text-mute py-8">Loading…</div>}
        {rows?.length === 0 && !loadError && (
          <div className="text-text-mute py-8 italic">No invitations yet.</div>
        )}
        {rows?.map((r) => (
          <Card key={r.id} className="p-4 flex items-start justify-between gap-4" data-testid={`invitation-${r.id}`}>
            <div className="space-y-1">
              <div className="font-medium">{r.personDraft.fullName}</div>
              <div className="text-text-mute text-xs">{r.personDraft.email}</div>
              <div className="flex gap-1 mt-1 flex-wrap">
                <MonoChip>{r.workerType}</MonoChip>
                <MonoChip tone={STATUS_TONE[r.status] ?? "default"}>{r.status}</MonoChip>
                {r.personDraft.country && (
                  <MonoChip>{countryDisplayName(r.personDraft.country)}</MonoChip>
                )}
                {r.personDraft.employingEntityName && (
                  <MonoChip
                    tone={
                      r.personDraft.employingEntityLegacyUnmatched
                        ? "amber"
                        : "default"
                    }
                  >
                    {r.personDraft.employingEntityName}
                    {r.personDraft.employingEntityLegacyUnmatched
                      ? " · needs correction"
                      : ""}
                  </MonoChip>
                )}
                {r.expiresAt && <MonoChip>expires {r.expiresAt.slice(0, 10)}</MonoChip>}
              </div>
            </div>
            <div className="flex gap-2">
              {r.status === "sent" && (
                <>
                  <Button variant="outline" size="sm" onClick={() => action(r.id, "resend")}>
                    Resend
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => action(r.id, "accept")}
                    data-testid={`accept-${r.id}`}
                  >
                    Mark accepted — start pre-boarding
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
