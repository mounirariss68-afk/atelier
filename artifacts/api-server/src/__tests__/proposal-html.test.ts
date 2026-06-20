import { describe, it, expect } from "vitest";
import {
  PROPOSAL_SPINE,
  DEFAULT_SECTIONS_REQUIRED,
  orderSectionsBySpine,
  renderProposalHtml,
} from "../lib/atelier-proposal-html.js";

describe("Task #297 — proposal HTML renderer", () => {
  it("exposes a 15-entry canonical spine", () => {
    expect(PROPOSAL_SPINE).toHaveLength(15);
    expect(PROPOSAL_SPINE.map((s) => s.id)).toEqual([
      "cover", "exec_summary", "context", "hypothesis", "approach",
      "workplan", "team", "pricing", "case_studies", "company_profile",
      "value_case", "terms", "compliance", "annexes", "appendices",
    ]);
    expect(DEFAULT_SECTIONS_REQUIRED).toHaveLength(15);
  });

  it("orders sections by the spine regardless of insertion order", () => {
    const out = orderSectionsBySpine([
      { sectionId: "compliance", name: "Compliance", ownerAgent: "x", status: "draft", content: null },
      { sectionId: "cover",      name: "Cover",      ownerAgent: "x", status: "draft", content: null },
      { sectionId: "pricing",    name: "Pricing",    ownerAgent: "x", status: "draft", content: null },
      { sectionId: "unknown_x",  name: "Unknown",    ownerAgent: "x", status: "draft", content: null },
    ]);
    expect(out.map((s) => s.sectionId)).toEqual(["cover", "pricing", "compliance", "unknown_x"]);
  });

  it("renders a watermarked, TOC-bearing HTML document with recipient label", () => {
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
        firmName: "Cognirise",
        tagline: "Senior-overseen agentic operations",
        boilerplateShort: "Test boilerplate.",
        differentiators: ["Senior-overseen"],
        proofPoints: [{ label: "Demo", metric: "+10pts" }],
        legalEntities: [{ name: "Cognirise DIFC Ltd", jurisdiction: "DIFC" }],
        contactBlock: "Test contact",
      },
      recipient: { recipientName: "Acme Procurement", recipientOrg: "Acme Bank" },
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Demo Proposal");
    expect(html).toContain("Acme Procurement");
    expect(html).toContain("Acme Bank");
    expect(html).toContain('class="watermark"');
    expect(html).toContain("Confidential");
    expect(html).toContain("scroll-snap-type: y proximity");
    expect(html).toContain("@media print");
    expect(html).toContain('id="sec-pricing"');
    expect(html).toContain('id="sec-compliance"');
    expect(html).toContain("Cognirise DIFC Ltd");
    expect(html).toContain("R-1");
  });

  it("uses generic watermark text when no recipient is supplied", () => {
    const html = renderProposalHtml({
      proposalId: "p", title: "T", winThemes: [],
      sections: [], firmProfile: null, recipient: null,
    });
    expect(html).toContain("Draft preview");
  });
});
