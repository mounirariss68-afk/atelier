import * as React from "react";
import { useLocation, Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useAtelierQuickAddRosterPerson,
  type AtelierRosterQuickAddRequest,
} from "@workspace/api-client-react";
import {
  StructuredNameFields,
  EMPTY_NAME,
  type StructuredNameValue,
} from "@/components/StructuredNameFields";
import { CountrySelect, TitleSelect, EmployingEntitySelect, type LegalEntity } from "./rosterPickers";

/**
 * Task #759 — Quick-add a person straight onto the roster.
 *
 * One compact dialog for people who are ALREADY hired (or historical
 * joiners): Employee/Contractor toggle, minimal fields, optional
 * onboarding-checklist + portal-login toggles. The formal pipeline
 * (candidates → offers → invitations → onboarding) stays untouched.
 */

type QuickWorkerType = "employee" | "contractor";

interface ManagerOption {
  id: string;
  fullName: string;
  title: string | null;
}

interface LoginResultWire {
  ok?: boolean;
  error?: string;
  message?: string;
  activationUrl?: string;
  activationExpiresAt?: string;
  welcomeEmail?: { sent?: boolean; status?: string } | null;
}

interface SuccessState {
  id: string;
  fullName: string;
  status: string;
  onboardingId: string | null;
  login: LoginResultWire | null;
}

const FIELD_LABEL = "font-mono text-[11px] uppercase text-text-mute";

export function QuickAddPersonDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Refresh the people list after a successful create. */
  onCreated: () => void;
}): React.ReactElement {
  const [, navigate] = useLocation();
  const [workerType, setWorkerType] = React.useState<QuickWorkerType>("employee");
  const [name, setName] = React.useState<StructuredNameValue>({ ...EMPTY_NAME });
  const [email, setEmail] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [seniority, setSeniority] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [employingEntity, setEmployingEntity] = React.useState("");
  const [vendorEntity, setVendorEntity] = React.useState("");
  const [managerPersonId, setManagerPersonId] = React.useState("");
  const [runOnboarding, setRunOnboarding] = React.useState(false);
  const [createLogin, setCreateLogin] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<SuccessState | null>(null);
  const [managers, setManagers] = React.useState<ManagerOption[]>([]);

  const mutation = useAtelierQuickAddRosterPerson();

  // Manager options — active employees.
  React.useEffect(() => {
    if (!open) return;
    fetch("/api/atelier/roster/people?workerType=employee", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { people: [] }))
      .then((d) =>
        setManagers(
          ((d.people ?? []) as Array<{ id: string; fullName: string; title: string | null; status: string }>)
            .filter((p) => p.status === "active")
            .map((p) => ({ id: p.id, fullName: p.fullName, title: p.title })),
        ),
      )
      .catch(() => setManagers([]));
  }, [open]);

  const reset = React.useCallback(() => {
    setWorkerType("employee");
    setName({ ...EMPTY_NAME });
    setEmail("");
    setTitle("");
    setSeniority("");
    setCountry("");
    setStartDate("");
    setEmployingEntity("");
    setVendorEntity("");
    setManagerPersonId("");
    setRunOnboarding(false);
    setCreateLogin(false);
    setError(null);
    setSuccess(null);
  }, []);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  const canSubmit =
    name.firstName.trim().length > 0 &&
    name.lastName.trim().length > 0 &&
    email.trim().includes("@") &&
    !mutation.isPending;

  const submit = async () => {
    setError(null);
    const body: AtelierRosterQuickAddRequest = {
      workerType,
      honorific: name.honorific.trim() || null,
      firstName: name.firstName.trim(),
      middleName: name.middleName.trim() || null,
      lastName: name.lastName.trim(),
      preferredName: name.preferredName.trim() || null,
      email: email.trim(),
      title: title.trim() || null,
      seniority: seniority.trim() || null,
      country: country || null,
      startDate: startDate || null,
      employingEntity: workerType === "employee" ? employingEntity.trim() || null : null,
      vendorEntity: workerType === "contractor" ? vendorEntity.trim() || null : null,
      managerPersonId: managerPersonId || null,
      runOnboarding,
      createLogin,
    };
    try {
      const d = await mutation.mutateAsync({ data: body });
      onCreated();
      setSuccess({
        id: d.id,
        fullName: d.fullName,
        status: d.status,
        onboardingId: d.onboardingId ?? null,
        login: (d.login as LoginResultWire | null) ?? null,
      });
    } catch (e) {
      const err = e as { data?: { message?: string; error?: string }; message?: string };
      setError(err?.data?.message ?? err?.data?.error ?? err?.message ?? "Failed to add person");
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-testid="quick-add-dialog">
        {success ? (
          <>
            <DialogHeader>
              <DialogTitle>{success.fullName} is on the roster</DialogTitle>
              <DialogDescription>
                Added as {workerType} · status <span className="font-mono">{success.status}</span>
                {success.onboardingId ? " · onboarding checklist started" : ""}.
              </DialogDescription>
            </DialogHeader>
            {success.login && success.login.ok && success.login.activationUrl && (
              <div className="space-y-2">
                <p className="text-sm text-text-mute">
                  Portal login created. The one-time activation link below lets them choose their
                  own password — it expires in 72 hours and is shown only once. Welcome email:{" "}
                  {success.login.welcomeEmail?.sent
                    ? "sent"
                    : success.login.welcomeEmail?.status ?? "not sent"}
                  .
                </p>
                <div
                  className="bg-bg-deep border border-line rounded p-3 font-mono text-xs break-all select-all"
                  data-testid="quick-add-activation-link"
                >
                  {success.login.activationUrl}
                </div>
              </div>
            )}
            {success.login && success.login.ok === false && (
              <p className="text-sm text-red-500 font-mono" data-testid="quick-add-login-error">
                Person added, but the portal login couldn’t be created:{" "}
                {success.login.message ?? success.login.error}. You can create it later from
                Onboarding.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => close(false)} data-testid="quick-add-done">
                Close
              </Button>
              <Button
                onClick={() => {
                  const id = success.id;
                  close(false);
                  navigate(`/roster/people/${id}`);
                }}
                data-testid="quick-add-view-person"
              >
                View person
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add person to the roster</DialogTitle>
              <DialogDescription>
                For people who are already hired or historical joiners — no candidate, offer or
                invitation needed. Formal recruits should go through{" "}
                <Link
                  href="/roster/invitations"
                  className="text-gold hover:underline"
                  onClick={() => close(false)}
                >
                  the hiring flow
                </Link>
                .
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex gap-2">
                {(["employee", "contractor"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setWorkerType(v)}
                    className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-widest border transition-colors ${
                      workerType === v
                        ? "bg-gold text-bg border-gold"
                        : "border-border text-text-mute hover:text-text"
                    }`}
                    data-testid={`quick-add-type-${v}`}
                  >
                    {v}
                  </button>
                ))}
              </div>

              <StructuredNameFields value={name} onChange={setName} idPrefix="quick-add" autoFocus />

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className={FIELD_LABEL}>Email *</span>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@cognirise.ai"
                    data-testid="quick-add-email"
                  />
                </label>
                <label className="space-y-1">
                  <span className={FIELD_LABEL}>Role / title</span>
                  <TitleSelect
                    value={title}
                    workerType={workerType}
                    onChange={(t, row) => {
                      setTitle(t);
                      if (row?.seniority) setSeniority(row.seniority);
                    }}
                    testId="quick-add-title"
                  />
                </label>
                <label className="space-y-1">
                  <span className={FIELD_LABEL}>Country</span>
                  <CountrySelect value={country} onChange={setCountry} testIdPrefix="quick-add-country" />
                </label>
                <label className="space-y-1">
                  <span className={FIELD_LABEL}>Start date</span>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    data-testid="quick-add-start-date"
                  />
                </label>
                {workerType === "employee" ? (
                  <label className="space-y-1">
                    <span className={FIELD_LABEL}>Employing entity</span>
                    <EmployingEntitySelect
                      value={employingEntity}
                      onChange={setEmployingEntity}
                      onSelectEntity={(ent: LegalEntity | null) => {
                        if (ent?.country) setCountry((c) => c || ent.country!);
                      }}
                      testId="quick-add-employing-entity"
                    />
                  </label>
                ) : (
                  <label className="space-y-1">
                    <span className={FIELD_LABEL}>Vendor entity</span>
                    <Input
                      value={vendorEntity}
                      onChange={(e) => setVendorEntity(e.target.value)}
                      placeholder="Their company (optional)"
                      data-testid="quick-add-vendor-entity"
                    />
                  </label>
                )}
                <label className="space-y-1">
                  <span className={FIELD_LABEL}>Manager (optional)</span>
                  <select
                    className="w-full bg-bg-elev border border-line rounded px-2 py-1.5 text-sm"
                    value={managerPersonId}
                    onChange={(e) => setManagerPersonId(e.target.value)}
                    data-testid="quick-add-manager"
                  >
                    <option value="">No manager</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName}
                        {m.title ? ` · ${m.title}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="border-t border-line pt-3 space-y-2">
                <label className="flex items-start gap-2 text-sm text-text-mute">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={runOnboarding}
                    onChange={(e) => setRunOnboarding(e.target.checked)}
                    data-testid="quick-add-run-onboarding"
                  />
                  <span>
                    Run the onboarding checklist
                    <span className="block text-[11px] text-text-faint">
                      They'll start as <span className="font-mono">onboarding</span> with the
                      standard {workerType} sequence; otherwise they're{" "}
                      <span className="font-mono">active</span> immediately.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-text-mute">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={createLogin}
                    onChange={(e) => setCreateLogin(e.target.checked)}
                    data-testid="quick-add-create-login"
                  />
                  <span>
                    Send welcome invitation &amp; create portal login
                    <span className="block text-[11px] text-text-faint">
                      A one-time activation link lets them choose their own password. Untick for a
                      roster-only record with no login.
                    </span>
                  </span>
                </label>
              </div>

              {error && (
                <div className="text-red-500 text-xs font-mono" data-testid="quick-add-error">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => close(false)} data-testid="quick-add-cancel">
                  Cancel
                </Button>
                <Button onClick={submit} disabled={!canSubmit} data-testid="quick-add-submit">
                  {mutation.isPending ? "Adding…" : "Add to roster"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
