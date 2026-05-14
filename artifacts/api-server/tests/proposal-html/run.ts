import assert from "node:assert/strict";
import {
  PROPOSAL_SPINE,
  DEFAULT_SECTIONS_REQUIRED,
  SPINE_ADDED_SECTIONS,
  LEGACY_TO_SPINE_MAP,
  orderSectionsBySpine,
  renderProposalHtml,
  buildProposalBlocks,
  type RenderProposalHtmlInput,
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

// ---- Fixed header + version label ----
const headerHtml = renderProposalHtml({
  proposalId: "p", title: "Hello", winThemes: [], sections: [],
  firmProfile: null,
  recipient: { recipientName: "Globex", recipientOrg: "Globex Corp" },
  version: 4,
});
assert.ok(headerHtml.includes('data-testid="proposal-fixed-header"'),
  "fixed header element must be present");
assert.ok(headerHtml.includes('data-testid="header-version"'),
  "version pill must be present");
assert.ok(headerHtml.includes("v4"), "version label must render the supplied version");
assert.ok(headerHtml.includes("Globex Corp"), "header must show recipient org");

// ---- 8→15 spine map ----
assert.equal(SPINE_ADDED_SECTIONS.length, 7, "7 new sections must be added on top of legacy 8");
for (const id of ["cover", "exec_summary", "hypothesis", "company_profile", "value_case", "annexes", "appendices"]) {
  assert.ok(SPINE_ADDED_SECTIONS.includes(id), `${id} must be in SPINE_ADDED_SECTIONS`);
}
for (const legacy of ["context", "approach", "workplan", "team", "pricing", "case_studies", "terms", "compliance"]) {
  assert.equal(LEGACY_TO_SPINE_MAP[legacy], legacy, "legacy ids map identity into the spine");
}

// ---- Block parity: PDF/DOCX walk the same blocks as HTML, so every
// piece of business logic (Company Profile entities, Pricing kv,
// Compliance table) lives in exactly one place. We assert that the
// blocks contain the same identifying tokens that we saw in the HTML
// output above — proving they would also appear in the PDF/DOCX walks.
const parityInput: RenderProposalHtmlInput = {
  proposalId: "prp_parity",
  title: "Parity Proposal",
  winThemes: [],
  sections: [
    { sectionId: "cover", name: "Cover", ownerAgent: "x", status: "draft", content: "" },
    { sectionId: "company_profile", name: "Company Profile", ownerAgent: "x", status: "draft", content: "" },
    { sectionId: "pricing", name: "Pricing", ownerAgent: "x", status: "amber", content: "Pricing prose." },
    { sectionId: "compliance", name: "Compliance", ownerAgent: "x", status: "draft", content: "" },
  ],
  pricingModel: { totalRevenueUsd: 200000, totalCostUsd: 110000, marginPct: 45, verdict: "green" },
  complianceMatrix: [{ rfpReqId: "R-1", requirement: "ISO27001", status: "green", evidence: "Annex C" }],
  firmProfile: {
    firmName: "AICo",
    differentiators: ["Senior-overseen"],
    proofPoints: [{ label: "Demo", metric: "+10pts" }],
    legalEntities: [{ name: "AICo DIFC Ltd", jurisdiction: "DIFC" }],
    contactBlock: "contact@aico",
  },
  recipient: { recipientName: "Acme", recipientOrg: "Acme Bank" },
  version: 2,
};
const blocks = buildProposalBlocks(parityInput);
const blockText = JSON.stringify(blocks);
for (const needle of [
  "AICo DIFC Ltd",          // Company Profile entity
  "Senior-overseen",         // Differentiator
  "$200,000",                // Pricing kv block
  "R-1",                     // Compliance table row id
  "ISO27001",                // Compliance table requirement
]) {
  assert.ok(blockText.includes(needle), `block model must contain ${JSON.stringify(needle)}`);
}
const html2 = renderProposalHtml(parityInput);
for (const needle of ["AICo DIFC Ltd", "Senior-overseen", "$200,000", "R-1", "ISO27001"]) {
  assert.ok(html2.includes(needle), `HTML must contain ${JSON.stringify(needle)} (parity with blocks)`);
}

// Cover block always orders first.
assert.equal(blocks[0].sectionId, "cover");
assert.equal(blocks[0].isCover, true);

console.log("ok — proposal-html spine + render + parity + header assertions passed");
