/**
 * Task #873 — Alliance-partner portal (the ENTIRE app surface for the
 * external `alliance_partner` role).
 *
 * Two pages, raw-fetch backed (the /partner-portal routes are bespoke —
 * not in the OpenAPI spec, mirroring the account-agent UI precedent):
 *   /partner                      — assigned opportunities list
 *   /partner/opportunities/:id    — opportunity detail + redacted
 *                                   client-overview tab
 *
 * Everything shown here is grant-scoped server-side; this UI never
 * receives (and must never render) contacts, financials, strategy or
 * documents for the client account.
 */

import * as React from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";

const API = `${import.meta.env.BASE_URL}api/atelier/partner-portal`;

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`request-failed:${r.status}`);
  return (await r.json()) as T;
}

type PartnerOpp = {
  id: string;
  name: string;
  salesStage: string;
  subStatus: string | null;
  nextMilestone: string;
  nextMilestoneDate: string | null;
  closeDate: string | null;
  accountId: string;
  createdAt: string;
};

type OppListResponse = {
  firm: { id: string; name: string };
  opportunities: PartnerOpp[];
};

type AccountOverview = {
  name: string;
  brandName: string | null;
  sector: string;
  country: string;
  hqCity: string | null;
  size: string | null;
  employeeCount: number | null;
};

function StageBadge({ stage }: { stage: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium capitalize">
      {stage.replace(/_/g, " ")}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function PartnerPortalHome() {
  const q = useQuery({
    queryKey: ["partner-portal", "opportunities"],
    queryFn: () => getJson<OppListResponse>("/opportunities"),
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="partner-portal-home">
      <h1 className="text-2xl font-semibold">Your opportunities</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {q.data?.firm
          ? `Opportunities assigned to ${q.data.firm.name}.`
          : "Opportunities assigned to your firm."}
      </p>
      {q.isLoading && (
        <div className="mt-8 text-sm text-muted-foreground">Loading…</div>
      )}
      {q.isError && (
        <div className="mt-8 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          We couldn't load your assigned opportunities. If this persists,
          contact your Cognirise counterpart.
        </div>
      )}
      {q.data && q.data.opportunities.length === 0 && (
        <div className="mt-8 rounded-md border border-border p-6 text-sm text-muted-foreground">
          No opportunities are currently assigned to your firm.
        </div>
      )}
      <div className="mt-6 space-y-3">
        {q.data?.opportunities.map((o) => (
          <Link
            key={o.id}
            href={`/partner/opportunities/${o.id}`}
            className="block rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
            data-testid={`link-partner-opp-${o.id}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{o.name}</div>
              <StageBadge stage={o.salesStage} />
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              Next milestone: {o.nextMilestone || "—"}
              {o.nextMilestoneDate ? ` · ${fmtDate(o.nextMilestoneDate)}` : ""}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function PartnerPortalOpportunity() {
  const [, params] = useRoute("/partner/opportunities/:oppId");
  const oppId = params?.oppId ?? "";
  const [tab, setTab] = React.useState<"opportunity" | "client">("opportunity");

  const oppQ = useQuery({
    queryKey: ["partner-portal", "opportunity", oppId],
    queryFn: () => getJson<{ opportunity: PartnerOpp }>(`/opportunities/${oppId}`),
    enabled: !!oppId,
  });
  const acctQ = useQuery({
    queryKey: ["partner-portal", "opportunity", oppId, "account"],
    queryFn: () => getJson<{ account: AccountOverview }>(`/opportunities/${oppId}/account`),
    enabled: !!oppId && tab === "client",
  });

  const o = oppQ.data?.opportunity;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8" data-testid="partner-portal-opportunity">
      <Link href="/partner" className="text-sm text-muted-foreground hover:underline">
        ← All opportunities
      </Link>
      {oppQ.isLoading && (
        <div className="mt-6 text-sm text-muted-foreground">Loading…</div>
      )}
      {oppQ.isError && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          This opportunity is not available.
        </div>
      )}
      {o && (
        <>
          <div className="mt-4 flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">{o.name}</h1>
            <StageBadge stage={o.salesStage} />
          </div>
          <div className="mt-4 flex gap-2 border-b border-border">
            {(["opportunity", "client"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 text-sm font-medium ${
                  tab === t
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground"
                }`}
                data-testid={`tab-partner-${t}`}
              >
                {t === "opportunity" ? "Opportunity" : "Client overview"}
              </button>
            ))}
          </div>
          {tab === "opportunity" && (
            <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Stage</dt>
                <dd className="mt-1 capitalize">{o.salesStage.replace(/_/g, " ")}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Sub-status</dt>
                <dd className="mt-1">{o.subStatus ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Next milestone</dt>
                <dd className="mt-1">
                  {o.nextMilestone || "—"}
                  {o.nextMilestoneDate ? ` (${fmtDate(o.nextMilestoneDate)})` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Expected close</dt>
                <dd className="mt-1">{fmtDate(o.closeDate)}</dd>
              </div>
            </dl>
          )}
          {tab === "client" && (
            <div className="mt-6">
              {acctQ.isLoading && (
                <div className="text-sm text-muted-foreground">Loading…</div>
              )}
              {acctQ.data && (
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Client</dt>
                    <dd className="mt-1">
                      {acctQ.data.account.name}
                      {acctQ.data.account.brandName
                        ? ` (${acctQ.data.account.brandName})`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Sector</dt>
                    <dd className="mt-1">{acctQ.data.account.sector}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Country</dt>
                    <dd className="mt-1">
                      {acctQ.data.account.country}
                      {acctQ.data.account.hqCity ? ` · ${acctQ.data.account.hqCity}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Size</dt>
                    <dd className="mt-1">
                      {acctQ.data.account.size ?? "—"}
                      {acctQ.data.account.employeeCount != null
                        ? ` · ~${acctQ.data.account.employeeCount.toLocaleString()} employees`
                        : ""}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
