import assert from "node:assert/strict";
import {
  PROPOSAL_SPINE,
  DEFAULT_SECTIONS_REQUIRED,
  orderSectionsBySpine,
  renderProposalHtml,
} from "../../src/lib/atelier-proposal-html.js";

assert.equal(PROPOSAL_SPINE.length, 15, "spine has 15 entries");
assert.deepEqual(
  PROPOSAL_SPINE.map((s) => s.id),
  [
    "cover", "exec_summary", "context", "hypothesis", "approach",
    "workplan", "team", "pricing", "case_studies", "company_profile",
    "value_case", "terms", "compliance", "annexes", "appendices",
  ],
);
assert.equal(DEFAULT_SECTIONS_REQUIRED.length, 15);

const ordered = orderSectionsBySpine([
  { sectionId: "compliance", name: "Compliance", ownerAgent: "x", status: "draft", content: null },
  { sectionId: "cover",      name: "Cover",      ownerAgent: "x", status: "draft", content: null },
  { sectionId: "pricing",    name: "Pricing",    ownerAgent: "x", status: "draft", content: null },
  { sectionId: "unknown_x",  name: "Unknown",    ownerAgent: "x", status: "draft", content: null },
]);
assert.deepEqual(ordered.map((s) => s.sectionId), ["cover", "pricing", "compliance", "unknown_x"]);

const html = renderProposalHtml({
  proposalId: "prp_test",
  title: "Demo Proposal",
  winThemes: ["bilingual", "audit-trail"],
  sections: [
    { sectionId: "cover", name: "Cover", ownerAgent: "brand_profile_writer", status: "draft", content: "Cover" },
    { sectionId: "exec_summary", name: "Executive Summary", ownerAgent: "context_writer", status: "draft", content: "Summary." },
    { sectionId: "company_profile", name: "Company Profile", ownerAgent: "brand_profile_writer", status: "draft", content: "" },
    { sectionId: "pricing", name: "Pricing", ownerAgent: "pricing_analyst", status: "amber", content: "Pricing copy." },
    { sectionId: "compliance", name: "Compliance", ownerAgent: "compliance_reviewer", status: "draft", content: "" },
  ],
  pricingModel: { totalRevenueUsd: 200000, totalCostUsd: 110000, marginPct: 45, verdict: "green" },
  complianceMatrix: [
    { rfpReqId: "R-1", requirement: "ISO27001", status: "green", evidence: "Annex C" },
  ],
  firmProfile: {
    firmName: "AICo",
    tagline: "Senior-overseen agentic operations",
    boilerplateShort: "Test boilerplate.",
    differentiators: ["Senior-overseen"],
    proofPoints: [{ label: "Demo", metric: "+10pts" }],
    legalEntities: [{ name: "AICo DIFC Ltd", jurisdiction: "DIFC" }],
    contactBlock: "Test contact",
  },
  recipient: { recipientName: "Acme Procurement", recipientOrg: "Acme Bank" },
});
for (const needle of [
  "<!doctype html>", "Demo Proposal", "Acme Procurement", "Acme Bank",
  "watermark", "Confidential", "scroll-snap-type",
  "@media print", "id=\"sec-pricing\"", "id=\"sec-compliance\"",
  "AICo DIFC Ltd", "R-1",
]) {
  assert.ok(html.includes(needle), `expected HTML to contain ${JSON.stringify(needle)}`);
}

const draftHtml = renderProposalHtml({
  proposalId: "p", title: "T", winThemes: [],
  sections: [], firmProfile: null, recipient: null,
});
assert.ok(draftHtml.includes("Draft preview"));

console.log("ok — proposal-html spine + render assertions passed");
