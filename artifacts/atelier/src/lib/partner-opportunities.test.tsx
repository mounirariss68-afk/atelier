import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAtelierListPartnerFirmsQueryKey, type Opportunity } from "@workspace/api-client-react";
import { canEditPartnerAssociations, canSeePartnersLens } from "./lens";
import { filterPartnerOpportunities, summarizePartnerOpportunities, partnerReportFilename, partnerReportQuery } from "./partner-opportunity-filters";
import { OpportunityPartnerPicker, OpportunityPartnerTags } from "../components/OpportunityPartnerPicker";

const firms = [{ id: "firm-a", name: "İstanbul & Ortakları" }, { id: "firm-b", name: "Second firm" }];
const opportunity: Opportunity = {
  id: "opp-a", slug: "opp-a", name: "Opportunity A", accountId: "account-a", accountName: "Client",
  salesStage: "prospect", partnerOwnerId: "owner-a", partnerOwnerName: "Same name",
  engagementLeadName: "Lead", partnerFirms: firms, currency: "USD", dealSizeUsd: 100,
  probabilityPct: 50, weightedValueUsd: 50, daysInStage: 0, nextMilestone: "", sourceLead: "manual",
  createdAt: "2026-05-01T00:00:00Z",
};
const opportunities: Opportunity[] = [
  opportunity,
  { ...opportunity, id: "opp-b", partnerOwnerId: "owner-b", currency: "EUR", dealSizeUsd: 200, partnerFirms: [firms[0]], salesStage: "runner", stalled: true },
  { ...opportunity, id: "opp-c", partnerFirms: [], salesStage: "lost" },
];
const all = { stage: "all", owner: "all", partnerFirmId: "all" } as const;
assert.equal(filterPartnerOpportunities(opportunities, all).length, 3);
assert.equal(filterPartnerOpportunities(opportunities, { ...all, partnerFirmId: "firm-a" }).length, 2, "multi-firm opportunity counts once");
assert.deepEqual(filterPartnerOpportunities(opportunities, { ...all, partnerFirmId: "firm-b" }).map((o) => o.id), ["opp-a"]);
assert.deepEqual(filterPartnerOpportunities(opportunities, { stage: "prospect", owner: "owner-a", partnerFirmId: "firm-a" }).map((o) => o.id), ["opp-a"]);
assert.equal(filterPartnerOpportunities(opportunities, { stage: "runner", owner: "owner-a", partnerFirmId: "firm-a" }).length, 0);
assert.deepEqual(filterPartnerOpportunities(opportunities, { ...all, owner: "owner-b" }).map((o) => o.id), ["opp-b"], "owner IDs distinguish identical names");
assert.equal(filterPartnerOpportunities([{ ...opportunity, partnerFirms: undefined }], { ...all, partnerFirmId: "firm-a" }).length, 0);
assert.equal(filterPartnerOpportunities(opportunities, { ...all, partnerFirmId: "removed-firm" }).length, 0, "removed choice must not widen the filter");
assert.deepEqual(summarizePartnerOpportunities(filterPartnerOpportunities(opportunities, { ...all, partnerFirmId: "firm-a" })), {
  count: 2, raw: { USD: 100, EUR: 200 }, weighted: { USD: 50, EUR: 100 }, stalled: 1,
}, "KPIs count the filtered population and keep currencies separate");
assert.deepEqual(summarizePartnerOpportunities([]), { count: 0, raw: {}, weighted: {}, stalled: 0 });

const params = new URLSearchParams(partnerReportQuery({ stage: "runner", owner: "owner-b", partnerFirmId: "firm-a&other" }));
assert.equal(params.get("partnerFirmId"), "firm-a&other");
assert.equal(params.get("owner"), "owner-b");
assert.equal(params.get("stage"), "runner");
assert.equal(partnerReportQuery({ ...all, partnerFirmId: "firm-a" }), "partnerFirmId=firm-a");
const filename = partnerReportFilename("../../İstanbul / \"evil\"\r\n", "2026-05-01");
assert.ok(filename.includes("İstanbul"));
assert.ok(!/[/.\\\r\n"]/.test(filename.slice(0, -4)));
assert.ok(filename.endsWith("-2026-05-01.pdf"));

const writers = ["founding_partner", "partner", "senior_manager", "finance"];
const readers = [...writers, "consultant", "hr", "compliance_officer"];
for (const role of [...readers, "alliance_partner", "non_equity_partner", "employee", "board_observer", "contractor", "partner_firm_resource", "recruiter", "unknown"]) {
  assert.equal(canSeePartnersLens(role), readers.includes(role), `reader gate: ${role}`);
  assert.equal(canEditPartnerAssociations(role), writers.includes(role), `writer gate: ${role}`);
}
assert.equal(canEditPartnerAssociations(undefined), false);
assert.equal(canSeePartnersLens(undefined), false);

const tags = renderToStaticMarkup(<OpportunityPartnerTags firms={firms} />);
assert.ok(tags.includes("İstanbul &amp; Ortakları"));
assert.ok(tags.includes("Second firm"));
assert.ok(!/50|split|commission|margin/i.test(tags), "tags must not manufacture economics");
assert.equal(renderToStaticMarkup(<OpportunityPartnerTags />), "");

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
client.setQueryData(getAtelierListPartnerFirmsQueryKey(), { items: [] });
function picker(role: string) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <OpportunityPartnerPicker role={role} dialogOpen value={["firm-a"]} retained={[firms[0]]} onChange={() => {}} />
    </QueryClientProvider>,
  );
}
assert.equal(picker("consultant"), "", "read-only role cannot tag");
const pickerHtml = picker("partner");
assert.ok(pickerHtml.includes("İstanbul &amp; Ortakları"), "retained unavailable firm keeps its name");
assert.ok(pickerHtml.includes("unavailable"), "removed firm is explained");
assert.ok(pickerHtml.includes("button-remove-partner-firm-a"), "removed firm can be explicitly unselected");
assert.ok(pickerHtml.includes("select-opportunity-partners"));
client.clear();
console.log("Partner opportunity filters, permissions, safe filename, tags and retained-picker rendering: passed");