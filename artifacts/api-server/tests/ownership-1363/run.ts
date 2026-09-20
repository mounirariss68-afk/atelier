/** Task #1363 — normalized ownership, economic rights and distributions. */
import "../crm/scratch-db.js";
import { AddressInfo } from "node:net";
import { and, eq, inArray, like } from "drizzle-orm";
import { activeAt } from "../../src/routes/atelier/ownershipRoutes.js";
import { ensureAtelierOwnershipSeed } from "../../src/lib/atelier-seed-ownership.js";

const stamp = Date.now();
const org = `ownership_1363_${stamp}`;
const FOUNDER = `own1363_founder_${stamp}`;
const FINANCE = `own1363_finance_${stamp}`;
const VIEWER = `own1363_viewer_${stamp}`;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures.push(name); console.error(`  ✗ ${name}`, detail ?? ""); }
};
const id = (suffix: string) => `own1363_${suffix}_${stamp}`;

async function main() {
  const D = await import("@workspace/db");
  const {
    db, pool, atelierUsers, atelierOwnershipStructures: structures,
    atelierPersons, atelierAdminPersonMappings, atelierPersonRelationshipClassifications: classifications,
    atelierOwnershipStakeholders: stakeholders, atelierOwnershipStructureLinks: links,
    atelierOwnershipInterests: interests, atelierCommercialRights: rights,
    atelierDistributionDeclarations: declarations, atelierDistributionSnapshots: snapshots,
    atelierDistributionAllocations: allocations, atelierDistributionPayments: payments,
    atelierDistributionTrueUps: trueUps, atelierAuditEvents: audits,
  } = D as any;
  const app = (await import("../../src/app.js")).default;
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;
  async function call(method: string, path: string, persona: string, body?: unknown) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${persona}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) as any };
  }
  const founder = { id: FOUNDER, orgId: org, email: `${FOUNDER}@test`, name: "Founder", initials: "FO", role: "founding_partner", roleLabel: "Founding Partner", title: "Founder" };
  const finance = { id: FINANCE, orgId: org, email: `${FINANCE}@test`, name: "Finance", initials: "FI", role: "finance", roleLabel: "Finance", title: "Finance" };
  const viewer = { id: VIEWER, orgId: org, email: `${VIEWER}@test`, name: "Viewer", initials: "VI", role: "consultant", roleLabel: "Consultant", title: "Consultant" };
  const holding = id("holding"), saudi = id("saudi"), europe = id("europe");
  const boundaryStructure = id("boundary_structure");
  const mounir = id("mounir"), gokhan = id("gokhan"), ayman = id("ayman"), bulent = id("bulent"), omer = id("omer"), newPartner = id("new_partner");
  const saudiMounir = id("saudi_mounir"), saudiAyman = id("saudi_ayman");
  const h = { id: holding, orgId: org, name: "Test Cognirise Holding", structureType: "holding", status: "planned", approvalStatus: "approved", effectiveFrom: "2026-01-01" };
  const s = { id: saudi, orgId: org, name: "Test Cognirise Saudi Arabia", structureType: "entity", status: "planned", approvalStatus: "approved", effectiveFrom: "2026-01-01" , country: "SA" };
  const e = { id: europe, orgId: org, name: "Test Cognirise Europe", structureType: "territory", status: "planned", approvalStatus: "approved", effectiveFrom: "2026-01-01", country: "EU" };
  try {
    await db.insert(atelierUsers).values([founder, finance, viewer]);
    const seededPeople = [
      { id: "p_mounir_ariss", orgId: org, firstName: "Mounir", lastName: "Ariss", displayName: "Mounir Ariss", sourceKind: "ownership_test" },
      { id: "p_gokhan_guney", orgId: org, firstName: "Gokhan", lastName: "Guney", displayName: "Gokhan Guney", sourceKind: "ownership_test" },
      { id: "p_omer_barbaros_yis", orgId: org, firstName: "Omer", middleName: "Barbaros", lastName: "Yis", displayName: "Omer Barbaros Yis", sourceKind: "ownership_test" },
      { id: "p_bulent_egrilmez", orgId: org, firstName: "Bulent", lastName: "Egrilmez", displayName: "Bulent Egrilmez", sourceKind: "ownership_test" },
    ];
    await db.insert(atelierPersons).values(seededPeople);
    await ensureAtelierOwnershipSeed(org);
    const seededMappings = await db.select().from(atelierAdminPersonMappings).where(eq(atelierAdminPersonMappings.orgId, org));
    const seededClassifications = await db.select().from(classifications).where(eq(classifications.orgId, org));
    check("opening seed creates four stable admin mappings", seededMappings.length === 4 && seededMappings.every((m: any) => m.stableKey.startsWith("equity-partner:")));
    check("opening seed classifies partners with no salary", seededClassifications.length === 4 && seededClassifications.every((c: any) => c.relationshipType === "equity_partner" && c.compensationBasis === "none" && c.status === "active"));
    const seededStakeholders = await db.select().from(stakeholders).where(eq(stakeholders.orgId, org));
    check("opening stakeholders retain mapping-backed person IDs", seededStakeholders.filter((s: any) => ["mounir", "gokhan", "omer", "bulent"].includes(s.stableKey)).every((s: any) => !!s.personId));
    const seededInterests = await db.select().from(interests).where(eq(interests.orgId, org));
    const stakeholderIds = new Set(seededStakeholders.map((s: any) => s.id));
    check("opening interests have no unresolved stakeholder references", seededInterests.every((i: any) => stakeholderIds.has(i.stakeholderId)));
    await ensureAtelierOwnershipSeed(org);
    const rerunMappings = await db.select().from(atelierAdminPersonMappings).where(eq(atelierAdminPersonMappings.orgId, org));
    const rerunClassifications = await db.select().from(classifications).where(eq(classifications.orgId, org));
    check("opening seed is idempotent", rerunMappings.length === 4 && rerunClassifications.length === 4);
    await db.insert(structures).values([h, s, e]);
    await db.insert(stakeholders).values([
       { id: mounir, orgId: org, label: "Mounir Ariss", stakeholderType: "person", stableKey: "test-mounir" },
       { id: gokhan, orgId: org, label: "Gokhan Guney", stakeholderType: "person", stableKey: "test-gokhan" },
       { id: ayman, orgId: org, label: "Dr. Ayman AlShelfan", stakeholderType: "external_party", stableKey: "test-ayman-external" },
       { id: bulent, orgId: org, label: "Bulent Egrilmez", stakeholderType: "person", stableKey: "test-bulent" },
       { id: omer, orgId: org, label: "Omer Barbaros Yis", stakeholderType: "person", stableKey: "test-omer" },
      { id: newPartner, orgId: org, label: "New Partner", stakeholderType: "person", stableKey: "new-partner" },
    ]);
    await db.insert(links).values({ id: id("link"), orgId: org, parentStructureId: holding, childStructureId: saudi, relationship: "owns", effectiveFrom: "2026-01-01", status: "approved" });
    await db.insert(interests).values([
      { id: id("holding_mounir"), orgId: org, structureId: holding, stakeholderId: mounir, legalPct: 45, votingPct: 45, profitPct: 45, status: "approved", effectiveFrom: "2026-01-01" },
      { id: id("holding_bulent"), orgId: org, structureId: holding, stakeholderId: bulent, legalPct: 10, votingPct: 10, profitPct: 10, status: "approved", effectiveFrom: "2026-01-01" },
      { id: saudiMounir, orgId: org, structureId: saudi, stakeholderId: mounir, legalPct: 49, votingPct: 49, profitPct: 100, status: "approved", effectiveFrom: "2026-01-01" },
      { id: saudiAyman, orgId: org, structureId: saudi, stakeholderId: ayman, legalPct: 51, votingPct: 51, profitPct: 0, status: "approved", effectiveFrom: "2026-01-01" },
      { id: id("europe_bulent"), orgId: org, structureId: europe, stakeholderId: bulent, legalPct: 85, votingPct: 85, profitPct: 85, status: "approved", effectiveFrom: "2026-01-01" },
    ]);
    await db.insert(rights).values({ id: id("saudi_pending"), orgId: org, structureId: saudi, holderStakeholderId: ayman, rightType: "sponsor", pendingTerms: true, status: "pending", effectiveFrom: "2026-01-01", terms: { reason: "rate and basis not supplied" } });

    check("activeAt includes start and excludes end", activeAt("2026-01-01", "2027-01-01", "2026-01-01") && !activeAt("2026-01-01", "2027-01-01", "2027-01-01"));
    let result = await call("GET", "/finance/ownership?asOf=2026-06-01", FOUNDER);
    check("founder can read normalized ownership", result.status === 200 && result.body.entities?.length >= 3, result);
    const saudiView = result.body.entities?.find((x: any) => x.id === saudi);
    const sponsor = saudiView?.directStakes?.find((x: any) => x.holderId === ayman);
    check("Saudi sponsor is 51% legal and 0% profit", sponsor?.legalOwnershipPct === 51 && sponsor?.profitParticipationPct === 0, sponsor);
    check("pending separate sponsor terms are visible", result.body.pendingTerms?.some((x: string) => x.includes("Saudi")), result.body);
    result = await call("GET", `/finance/ownership/people/p_mounir_ariss?asOf=2026-06-01`, FOUNDER);
    const exactFounder = new Map((result.body.lookThrough ?? []).map((x: any) => [x.entityName, x]));
    check("person read exposes exact seeded look-through interests", result.status === 200 &&
      exactFounder.get("Cognirise Holding")?.profitParticipationPct === 45 &&
      exactFounder.get("Cognirise Dubai")?.profitParticipationPct === 45 &&
      exactFounder.get("Cognirise Saudi Arabia")?.legalOwnershipPct === 22.05 &&
      exactFounder.get("Cognirise Saudi Arabia")?.profitParticipationPct === 45 &&
      exactFounder.get("Cognirise Europe")?.profitParticipationPct === 6.75 &&
      exactFounder.get("Cognirise Türkiye")?.profitParticipationPct === 31.5, JSON.stringify(result.body));
    const expectedPeople: Record<string, Record<string, { legal?: number; voting?: number; profit: number }>> = {
      p_gokhan_guney: {
        "Cognirise Holding": { profit: 45 }, "Cognirise Dubai": { profit: 45 },
        "Cognirise Saudi Arabia": { legal: 22.05, voting: 22.05, profit: 45 },
        "Cognirise Europe": { profit: 6.75 }, "Cognirise Türkiye": { profit: 31.5 },
      },
      p_bulent_egrilmez: {
        "Cognirise Holding": { profit: 10 }, "Cognirise Dubai": { profit: 10 },
        "Cognirise Saudi Arabia": { legal: 4.9, voting: 4.9, profit: 10 },
        "Cognirise Europe": { profit: 86.5 }, "Cognirise Türkiye": { profit: 7 },
      },
      p_omer_barbaros_yis: { "Cognirise Türkiye": { profit: 30 } },
    };
    for (const [personId, expected] of Object.entries(expectedPeople)) {
      const person = await call("GET", `/finance/ownership/people/${personId}?asOf=2026-06-01`, FOUNDER);
      const rows = person.body?.lookThrough ?? [];
      const names = rows.map((x: any) => `${x.entityName}:${(x.path ?? []).join(">")}`);
      const aggregate = new Map<string, any>();
      for (const row of rows) {
        check(`${personId} has no unresolved look-through holder`, row.holderName !== "Unresolved stakeholder", row);
        const old = aggregate.get(row.entityName) ?? { legal: 0, voting: 0, profit: 0 };
        aggregate.set(row.entityName, {
          legal: old.legal + row.legalOwnershipPct,
          voting: old.voting + row.votingControlPct,
          profit: old.profit + row.profitParticipationPct,
        });
      }
      check(`${personId} has no duplicate path rows`, new Set(names).size === names.length, names);
      check(`${personId} matches exact seeded opening graph`, person.status === 200 &&
        Object.entries(expected).every(([entity, values]) => {
          const actual = aggregate.get(entity);
          return actual &&
            Math.abs(actual.profit - values.profit) < 0.00001 &&
            (values.legal === undefined || Math.abs(actual.legal - values.legal) < 0.00001) &&
            (values.voting === undefined || Math.abs(actual.voting - values.voting) < 0.00001);
        }) &&
        aggregate.size === Object.keys(expected).length, JSON.stringify(person.body));
    }

    const restricted = await call("GET", "/finance/ownership", VIEWER);
    check("ordinary users cannot read ownership economics", restricted.status === 403, restricted);
    const proposal = await call("POST", "/finance/ownership/interests", FOUNDER, { structureId: europe, stakeholderId: newPartner, legalPct: 5, votingPct: 5, profitPct: 5, effectiveFrom: "2027-01-01" });
    check("new partner interest is proposed", proposal.status === 201 && proposal.body.interest?.status === "pending", proposal);
    const selfApprove = await call("POST", `/finance/ownership/interests/${proposal.body.interest.id}/approve`, FOUNDER);
    check("maker cannot approve own interest", selfApprove.status === 409, selfApprove);
    const approved = await call("POST", `/finance/ownership/interests/${proposal.body.interest.id}/approve`, FINANCE);
    check("second approver can approve interest", approved.status === 200 && approved.body.interest?.status === "approved", approved);

    const overlap = await call("POST", "/finance/ownership/interests", FOUNDER, { structureId: europe, stakeholderId: bulent, legalPct: 80, votingPct: 80, profitPct: 80, effectiveFrom: "2026-06-01" });
    check("overlapping dated version is rejected", overlap.status === 409 && overlap.body.error === "overlapping-interest-version", overlap);
    const overTotal = await call("POST", "/finance/ownership/interests", FOUNDER, { structureId: europe, stakeholderId: mounir, legalPct: 20, votingPct: 20, profitPct: 20, effectiveFrom: "2027-01-01" });
    check("percentage total over 100 is rejected", overTotal.status === 409 && overTotal.body.error === "percentage-total-exceeded", overTotal);
    const pendingA = await call("POST", "/finance/ownership/interests", FOUNDER, { structureId: europe, stakeholderId: ayman, legalPct: 10, votingPct: 10, profitPct: 10, effectiveFrom: "2035-01-01" });
    const pendingB = await call("POST", "/finance/ownership/interests", FOUNDER, { structureId: europe, stakeholderId: gokhan, legalPct: 10, votingPct: 10, profitPct: 10, effectiveFrom: "2035-01-01" });
    check("two individually valid over-total approvals can be proposed", pendingA.status === 201 && pendingB.status === 201);
    const firstPendingApproval = await call("POST", `/finance/ownership/interests/${pendingA.body.interest?.id}/approve`, FINANCE);
    const secondPendingApproval = await call("POST", `/finance/ownership/interests/${pendingB.body.interest?.id}/approve`, FINANCE);
    check("first pending interest approval succeeds", firstPendingApproval.status === 200, firstPendingApproval);
    check("second pending interest approval rejects transactionally", secondPendingApproval.status === 409 && secondPendingApproval.body.error === "percentage-total-exceeded", secondPendingApproval);
    await db.insert(structures).values({ id: boundaryStructure, orgId: org, name: "Boundary Entity", structureType: "entity", status: "planned", effectiveFrom: "2026-01-01" });
    await db.insert(interests).values([
      { id: id("boundary_initial"), orgId: org, structureId: boundaryStructure, stakeholderId: ayman, legalPct: 60, votingPct: 60, profitPct: 60, status: "approved", effectiveFrom: "2026-01-01" },
      { id: id("future_boundary"), orgId: org, structureId: boundaryStructure, stakeholderId: bulent, legalPct: 30, votingPct: 30, profitPct: 30, status: "approved", effectiveFrom: "2036-01-01" },
    ]);
    const boundary = await call("POST", "/finance/ownership/interests", FOUNDER, { structureId: boundaryStructure, stakeholderId: omer, legalPct: 30, votingPct: 30, profitPct: 30, effectiveFrom: "2035-01-01", effectiveTo: "2037-01-01" });
    check("future-boundary interest proposal is initially valid", boundary.status === 201, boundary);
    const boundaryApproval = await call("POST", `/finance/ownership/interests/${boundary.body.interest?.id}/approve`, FINANCE);
    check("future boundary total is rejected at approval", boundaryApproval.status === 409 && boundaryApproval.body.error === "percentage-total-exceeded", boundaryApproval);
    const pending = await call("POST", "/finance/ownership/commercial-rights", FOUNDER, { structureId: saudi, holderStakeholderId: ayman, rightType: "revenue_share", pendingTerms: true, ratePct: 5, effectiveFrom: "2026-01-01" });
    check("pending terms cannot include invented rate", pending.status === 400, pending);
    const rightProposal = await call("POST", "/finance/ownership/commercial-rights", FOUNDER, { structureId: europe, holderStakeholderId: newPartner, rightType: "royalty", ratePct: 5, basis: "net_revenue", effectiveFrom: "2028-01-01", effectiveTo: "2029-01-01" });
    const rightSelfApprove = await call("POST", `/finance/ownership/commercial-rights/${rightProposal.body.right?.id}/approve`, FOUNDER);
    const rightApprove = await call("POST", `/finance/ownership/commercial-rights/${rightProposal.body.right?.id}/approve`, FINANCE);
    check("commercial right supports proposal and independent approval", rightProposal.status === 201 && rightSelfApprove.status === 409 && rightApprove.status === 200, { rightProposal, rightSelfApprove, rightApprove });
    const rightOverlap = await call("POST", "/finance/ownership/commercial-rights", FOUNDER, { structureId: europe, holderStakeholderId: newPartner, rightType: "royalty", ratePct: 6, effectiveFrom: "2028-06-01" });
    const rightBadDates = await call("POST", "/finance/ownership/commercial-rights", FOUNDER, { structureId: europe, holderStakeholderId: newPartner, rightType: "royalty", ratePct: 6, effectiveFrom: "2030-01-01", effectiveTo: "2029-01-01" });
    check("commercial right overlap and invalid dates are rejected", rightOverlap.status === 409 && rightBadDates.status === 400, { rightOverlap, rightBadDates });
    const rejectedRight = await call("POST", "/finance/ownership/commercial-rights", FOUNDER, { structureId: europe, holderStakeholderId: newPartner, rightType: "royalty", ratePct: 7, effectiveFrom: "2032-01-01" });
    const rejectedRightMaker = await call("POST", `/finance/ownership/commercial-rights/${rejectedRight.body.right?.id}/reject`, FOUNDER);
    const rejectedRightChecker = await call("POST", `/finance/ownership/commercial-rights/${rejectedRight.body.right?.id}/reject`, FINANCE);
    const rejectedRightRepeat = await call("POST", `/finance/ownership/commercial-rights/${rejectedRight.body.right?.id}/approve`, FINANCE);
    check("commercial-right rejection is maker-checked and terminal", rejectedRightMaker.status === 409 && rejectedRightChecker.status === 200 && rejectedRightChecker.body.commercial_right?.status === "rejected" && rejectedRightRepeat.status >= 400, { rejectedRightMaker, rejectedRightChecker, rejectedRightRepeat });
    const pendingStructure = await call("POST", "/finance/ownership/structures", FOUNDER, { name: "Pending Structure", structureType: "entity", effectiveFrom: "2030-01-01" });
    const hiddenBeforeApproval = await call("GET", "/finance/ownership?asOf=2030-06-01", FOUNDER);
    const structureSelfApprove = await call("POST", `/finance/ownership/structures/${pendingStructure.body.structure?.id}/approve`, FOUNDER);
    const structureApprove = await call("POST", `/finance/ownership/structures/${pendingStructure.body.structure?.id}/approve`, FINANCE);
    check("pending structure is hidden until maker-checker approval", pendingStructure.status === 201 && !hiddenBeforeApproval.body.entities?.some((x: any) => x.id === pendingStructure.body.structure?.id) && structureSelfApprove.status === 409 && structureApprove.status === 200, { pendingStructure, hiddenBeforeApproval, structureSelfApprove, structureApprove });
    const rejectedInterest = await call("POST", "/finance/ownership/interests", FOUNDER, { structureId: pendingStructure.body.structure?.id, stakeholderId: omer, legalPct: 1, votingPct: 1, profitPct: 1, effectiveFrom: "2040-01-01" });
    const rejectedInterestMaker = await call("POST", `/finance/ownership/interests/${rejectedInterest.body.interest?.id}/reject`, FOUNDER);
    const rejectedInterestChecker = await call("POST", `/finance/ownership/interests/${rejectedInterest.body.interest?.id}/reject`, FINANCE);
    const rejectedInterestRepeat = await call("POST", `/finance/ownership/interests/${rejectedInterest.body.interest?.id}/approve`, FINANCE);
    const afterInterestReject = await call("GET", "/finance/ownership?asOf=2040-06-01", FOUNDER);
    check("interest rejection is maker-checked, terminal, and absent from active graph", rejectedInterestMaker.status === 409 && rejectedInterestChecker.status === 200 && rejectedInterestChecker.body.interest?.status === "rejected" && rejectedInterestRepeat.status >= 400 && !afterInterestReject.body.entities?.flatMap((x: any) => x.directStakes ?? []).some((x: any) => x.id === rejectedInterest.body.interest?.id), { rejectedInterestMaker, rejectedInterestChecker, rejectedInterestRepeat });
    const rejectedStructure = await call("POST", "/finance/ownership/structures", FOUNDER, { name: "Rejected Structure", structureType: "entity", effectiveFrom: "2031-01-01" });
    const rejectedStructureMaker = await call("POST", `/finance/ownership/structures/${rejectedStructure.body.structure?.id}/reject`, FOUNDER);
    const rejectedStructureChecker = await call("POST", `/finance/ownership/structures/${rejectedStructure.body.structure?.id}/reject`, FINANCE);
    const rejectedStructureRepeat = await call("POST", `/finance/ownership/structures/${rejectedStructure.body.structure?.id}/approve`, FINANCE);
    const afterStructureReject = await call("GET", "/finance/ownership?asOf=2031-06-01", FOUNDER);
    check("structure rejection is maker-checked, terminal, and hidden", rejectedStructureMaker.status === 409 && rejectedStructureChecker.status === 200 && rejectedStructureChecker.body.structure?.approvalStatus === "rejected" && rejectedStructureRepeat.status >= 400 && !afterStructureReject.body.entities?.some((x: any) => x.id === rejectedStructure.body.structure?.id), { rejectedStructureMaker, rejectedStructureChecker, rejectedStructureRepeat });
    const rejectedLink = await call("POST", "/finance/ownership/links", FOUNDER, { parentStructureId: europe, childStructureId: saudi, effectiveFrom: "2040-01-01" });
    const rejectedLinkMaker = await call("POST", `/finance/ownership/links/${rejectedLink.body.link?.id}/reject`, FOUNDER);
    const rejectedLinkChecker = await call("POST", `/finance/ownership/links/${rejectedLink.body.link?.id}/reject`, FINANCE);
    const rejectedLinkRepeat = await call("POST", `/finance/ownership/links/${rejectedLink.body.link?.id}/approve`, FINANCE);
    check("link rejection is maker-checked and terminal", rejectedLinkMaker.status === 409 && rejectedLinkChecker.status === 200 && rejectedLinkChecker.body.link?.status === "rejected" && rejectedLinkRepeat.status === 409, { rejectedLinkMaker, rejectedLinkChecker, rejectedLinkRepeat });
    const concurrentLinkIds = [id("concurrent_link_a"), id("concurrent_link_b")];
    await db.insert(links).values(concurrentLinkIds.map((linkId, index) => ({ id: linkId, orgId: org, parentStructureId: saudi, childStructureId: europe, relationship: "owns", effectiveFrom: index ? "2050-06-01" : "2050-01-01", effectiveTo: "2051-01-01", status: "pending", proposedBy: FOUNDER })));
    const concurrentLinkResults = await Promise.all(concurrentLinkIds.map((linkId) => call("POST", `/finance/ownership/links/${linkId}/approve`, FINANCE)));
    check("concurrent overlapping link approvals allow only one", concurrentLinkResults.filter((x) => x.status === 200).length === 1 && concurrentLinkResults.filter((x) => x.status === 409).length === 1, concurrentLinkResults);
    const cycle = await call("POST", "/finance/ownership/links", FOUNDER, { parentStructureId: saudi, childStructureId: holding, effectiveFrom: "2026-01-01" });
    check("ownership cycle is rejected", cycle.status === 409 && cycle.body.error === "ownership-cycle", cycle);

    const franchise = await call("POST", "/finance/ownership/structures", FOUNDER, { name: "Qatar Franchise", structureType: "franchise", status: "franchise_operated", effectiveFrom: "2027-01-01", country: "QA" });
    check("franchise territory is not an equity stake", franchise.status === 201);
    const franchiseRight = await call("POST", "/finance/ownership/commercial-rights", FOUNDER, { structureId: franchise.body.structure.id, holderStakeholderId: newPartner, rightType: "franchise", ratePct: 8, territory: "Qatar", agreementTerm: "2027-2030", effectiveFrom: "2027-01-01" });
    check("franchise commercial right is separate from equity", franchiseRight.status === 201);

    await db.insert(interests).values({ id: id("distribution_future_interest"), orgId: org, structureId: holding, stakeholderId: omer, legalPct: 5, votingPct: 5, profitPct: 5, status: "approved", effectiveFrom: "2027-01-01" });
    const declaration = await call("POST", "/finance/distributions/declarations", FOUNDER, { structureId: holding, fiscalYear: "2025", estimatedProfit: 1000, reserveCash: 100, reserveOperatingCapital: 150 });
    const badDeclaration = await call("POST", "/finance/distributions/declarations", FOUNDER, { structureId: holding, fiscalYear: "2024", estimatedProfit: 100, reserveCash: 101, reserveOperatingCapital: 0 });
    check("disconnected declaration path is gone", declaration.status === 404 && badDeclaration.status === 404, { declaration, badDeclaration });
    const draft = await call("POST", "/finance/distributions", FOUNDER, { year: 2026, estimatedProfit: 100000, cashReserve: 10000, operatingCapitalReserve: 20000 });
    const badDraft = await call("POST", "/finance/distributions", FOUNDER, { year: 2025, estimatedProfit: 100, cashReserve: 101, operatingCapitalReserve: 0 });
    check("distribution draft reserves cash outside payroll", draft.status === 201 && draft.body.item?.distributableProfit === 70000, draft);
    check("distribution rejects reserves above profit", badDraft.status === 400, badDraft);
    const submitted = await call("POST", `/finance/distributions/${draft.body.item.id}/submit`, FOUNDER, {});
    check("distribution can be submitted", submitted.status === 200);
    const ownApprove = await call("POST", `/finance/distributions/${draft.body.item.id}/approve`, FOUNDER, {});
    check("distribution maker cannot approve", ownApprove.status === 409, ownApprove);
    const otherApprove = await call("POST", `/finance/distributions/${draft.body.item.id}/approve`, FINANCE, {});
    check("distribution receives independent approval", otherApprove.status === 200);
    const frozen = otherApprove;
    check("approval atomically freezes ownership snapshot", frozen.status === 200 && frozen.body.item?.status === "snapshotted" && frozen.body.allocations?.length > 0, frozen);
    check("distribution snapshot excludes interests that start after fiscal boundary", frozen.body.allocations?.every((x: any) => x.stakeholderId !== omer), frozen);
    const allocation = frozen.body.item?.allocations?.[0];
    const payment = await call("POST", "/finance/distributions/payments", FINANCE, { allocationId: allocation?.id, amount: 1000 });
    check("staged distribution payment is recorded", payment.status === 201, payment);
    const paymentCumulative = await call("POST", "/finance/distributions/payments", FINANCE, { allocationId: allocation?.id, amount: 1000 });
    const paymentOverpay = await call("POST", "/finance/distributions/payments", FINANCE, { allocationId: allocation?.id, amount: 999999999 });
    const paymentArbitrary = await call("POST", "/finance/distributions/payments", FINANCE, { allocationId: "other-org-allocation", amount: 1 });
    check("valid cumulative payments work but arbitrary and overpay fail", paymentCumulative.status === 201 && paymentOverpay.status === 409 && paymentArbitrary.status === 404, { paymentCumulative, paymentOverpay, paymentArbitrary });
    const trueUp = await call("POST", "/finance/distributions/true-ups", FINANCE, { declarationId: draft.body.item.id, stakeholderId: allocation.stakeholderId, expectedAmount: allocation.amount, actualAmount: allocation.amount + 100, rationale: "Final accounts true-up" });
    check("distribution true-up is recorded outside payroll", trueUp.status === 201 && trueUp.body.trueUp?.deltaAmount === 100, trueUp);
    const badTrueUpStakeholder = await call("POST", "/finance/distributions/true-ups", FINANCE, { declarationId: draft.body.item.id, stakeholderId: "not-an-allocation", expectedAmount: 1, actualAmount: 2, rationale: "invalid" });
    const badTrueUpAmount = await call("POST", "/finance/distributions/true-ups", FINANCE, { declarationId: draft.body.item.id, stakeholderId: mounir, expectedAmount: 1, actualAmount: 2, rationale: "wrong frozen amount" });
    check("true-up rejects arbitrary stakeholders and non-reconciling amounts", badTrueUpStakeholder.status === 409 && badTrueUpAmount.status === 409, { badTrueUpStakeholder, badTrueUpAmount });
    const listed = await call("GET", "/finance/distributions", FINANCE);
    check("distribution read includes payments and true-ups", listed.status === 200 && listed.body.items?.some((x: any) => x.trueUps?.length === 1 && x.payments?.length >= 2), JSON.stringify(listed.body));
    const auditRows = await db.select().from(audits).where(eq(audits.orgId, org));
    check("economic changes are audited", auditRows.length >= 8, auditRows.length);
  } finally {
    await db.delete(payments).where(eq(payments.orgId, org));
    await db.delete(trueUps).where(eq(trueUps.orgId, org));
    await db.delete(allocations).where(eq(allocations.orgId, org));
    await db.delete(snapshots).where(eq(snapshots.orgId, org));
    await db.delete(declarations).where(eq(declarations.orgId, org));
    await db.delete(rights).where(eq(rights.orgId, org));
    await db.delete(interests).where(eq(interests.orgId, org));
    await db.delete(links).where(eq(links.orgId, org));
    await db.delete(stakeholders).where(eq(stakeholders.orgId, org));
    await db.delete(structures).where(eq(structures.orgId, org));
    await db.delete(classifications).where(eq(classifications.orgId, org));
    await db.delete(atelierAdminPersonMappings).where(eq(atelierAdminPersonMappings.orgId, org));
    await db.delete(atelierPersons).where(eq(atelierPersons.orgId, org));
    await db.delete(audits).where(eq(audits.orgId, org));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FOUNDER, FINANCE, VIEWER]));
    server.close();
    await pool.end().catch(() => undefined);
  }
  console.log(failures.length ? `✗ ${failures.length} failures` : "✓ ownership-1363 probe passed");
  process.exit(failures.length ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });