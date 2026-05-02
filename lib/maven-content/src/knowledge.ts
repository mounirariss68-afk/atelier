/**
 * Maven AI knowledge base — used by:
 *  - the chat assistant on the server (system-prompt grounding)
 *  - the chat widget on the client (suggestion cards / linking)
 *
 * Keep this lean: titles, slugs, one-line summaries, audience.
 * For long-form content (HTML, vignettes), refer the user to the
 * canonical pages. The chat assistant must never invent a slug.
 */

export interface ServiceEntry {
  slug: string;
  title: string;
  tagline: string;
  buyer: string;
  summary: string;
}

export interface IndustryEntry {
  id: string;
  title: string;
  subtitle: string;
}

export interface InsightEntry {
  slug: string;
  title: string;
  category: string;
  type: string;
  summary: string;
}

export interface AssessmentEntry {
  slug: "ari" | "mvi" | "dafi" | "uvr";
  code: string;
  name: string;
  summary: string;
  estMinutes: number;
}

export interface FounderEntry {
  name: string;
  title: string;
  location: string;
  summary: string;
}

export const services: ServiceEntry[] = [
  {
    slug: "agentic-ai-transformation",
    title: "Agentic AI Transformation",
    tagline: "Reimagining operations with agents at the core",
    buyer: "CEO, COO, CXO",
    summary:
      "Production AI agents that own end-to-end work — deciding, acting, learning, coordinating with humans. Not chatbots, not workflows. 90 days from kickoff to production MVP.",
  },
  {
    slug: "ai-driven-sdlc",
    title: "AI-Driven SDLC & Legacy Modernization",
    tagline: "Unlock your legacy — AI-first, on-prem capable",
    buyer: "CIO, CTO",
    summary:
      "Spec-from-legacy methodology: AI-driven extraction and re-engineering of Siebel, COBOL, legacy Java estates. 40–60% SDLC reduction. Sovereign on-prem capable.",
  },
  {
    slug: "data-governance-foundations",
    title: "Data & Governance Foundations",
    tagline: "The foundation that makes AI trustworthy",
    buyer: "CDO, CRO",
    summary:
      "Data platforms, lineage, mastering, and governance frameworks engineered (not advised) so AI agents are trustworthy. Aligned to UAE AI Charter, Saudi PDPL, SAMA.",
  },
  {
    slug: "ai-product-studio",
    title: "AI Product Studio",
    tagline: "From idea to production in 90 days",
    buyer: "CXO, Business Heads",
    summary:
      "Productized AI: regulatory intelligence, procurement intelligence, HR-ops AI, smart-contract analysis. 90-day MVP, reusable IP that compounds margin.",
  },
];

export const industries: IndustryEntry[] = [
  { id: "public-sector", title: "Public Sector", subtitle: "Accelerating national vision through production AI" },
  { id: "telecom", title: "Telecommunications", subtitle: "From legacy infrastructure to AI-native operations" },
  { id: "financial-services", title: "Financial Services", subtitle: "AI-grade governance for the region's most demanding regulators" },
  { id: "energy-commodities", title: "Energy & Commodities", subtitle: "Powering the energy transition with production AI" },
  { id: "retail-consumer", title: "Retail & Consumer Products", subtitle: "From dukan to D2C — AI-native retail for the GCC consumer" },
  { id: "travel-hospitality", title: "Travel & Hospitality", subtitle: "AI for the GCC's tourism megaprojects and global hospitality brands" },
  { id: "automotive", title: "Automotive", subtitle: "Building the GCC's mobility future, from EV mandates to autonomous" },
];

export const insights: InsightEntry[] = [
  {
    slug: "the-agentic-enterprise",
    title: "The Agentic Enterprise: From Pilot to Production",
    category: "Agentic AI",
    type: "Report",
    summary:
      "Why 80% of enterprise AI pilots never reach production — and the four-layer architecture (Value Case, Data & AI Foundations, Agentic AI, Change Management) that closes the gap.",
  },
  {
    slug: "ai-governance-gulf",
    title: "AI Governance in the Gulf: Building Trust at Scale",
    category: "Data & Governance",
    type: "Report",
    summary:
      "Governance frameworks for enterprise-grade AI deployment in the GCC, aligned to UAE AI Charter, Saudi PDPL, and SAMA guidelines.",
  },
  {
    slug: "legacy-modernization-playbook",
    title: "Legacy Modernization Playbook: AI-Driven SDLC for GCC Enterprises",
    category: "Legacy Modernization",
    type: "Report",
    summary:
      "The spec-from-legacy methodology that unlocks modernization for GCC enterprises — sovereign, on-prem capable delivery for national security environments.",
  },
  {
    slug: "gcc-ai-spending-outlook",
    title: "GCC AI Spending Outlook 2025–2030",
    category: "Industry Trends",
    type: "Research Report",
    summary:
      "Data-rich analysis of AI investment trends across GCC public sector, telecom, and financial services — spending forecasts through 2030.",
  },
  {
    slug: "agentic-workforce",
    title: "The Agentic Workforce: Human-AI Collaboration in Public Sector Operations",
    category: "Agentic AI",
    type: "Perspective",
    summary:
      "How GCC government entities can redesign operating models around human-AI collaboration — from AI tools to AI teammates that own work end-to-end.",
  },
  {
    slug: "cdo-to-cao",
    title: "From CDO to CAO: Rethinking the Chief Data Officer Role in the Age of AI",
    category: "Data & Governance",
    type: "Opinion",
    summary:
      "The CDO role was defined for a world that no longer exists. The new mandate — Chief AI Officer or Chief Analytics Officer — requires a different skillset and organizational mandate.",
  },
  {
    slug: "sovereign-ai",
    title: "Building Sovereign AI: On-Prem Agentic Deployment for National Security Clients",
    category: "Agentic AI",
    type: "Technical Brief",
    summary:
      "A technical framework for deploying production-grade agentic AI in air-gapped, sovereign data environments — without compromising capability or security posture.",
  },
  {
    slug: "90-day-mvp",
    title: "The 90-Day MVP: How Boutique AI Firms Outpace Tier-1 Consultancies",
    category: "Industry Trends",
    type: "Thought Leadership",
    summary:
      "Why lean, senior-delivery AI firms consistently outperform Tier-1 competitors on the dimension that matters most: time from contract to working software in production.",
  },
];

export const assessments: AssessmentEntry[] = [
  {
    slug: "ari",
    code: "ARI",
    name: "Agentic Readiness Index",
    summary:
      "Diagnoses how ready your organisation is to move agentic AI from pilot to production. 8 dimensions, ~12 minutes.",
    estMinutes: 12,
  },
  {
    slug: "mvi",
    code: "MVI",
    name: "Modernization Velocity Index",
    summary:
      "Rates the velocity at which your legacy estate can be modernised with AI-driven SDLC and spec-from-legacy. ~10 minutes.",
    estMinutes: 10,
  },
  {
    slug: "dafi",
    code: "DAFI",
    name: "Data & AI Foundations Index",
    summary:
      "Scores the data readiness, lineage, mastering, and governance posture beneath your AI ambition. ~14 minutes.",
    estMinutes: 14,
  },
  {
    slug: "uvr",
    code: "UVR",
    name: "Use-Case Value Rating",
    summary:
      "A short rating of any single AI use case — value, feasibility, governance fit. ~6 minutes.",
    estMinutes: 6,
  },
];

export const founders: FounderEntry[] = [
  {
    name: "Mounir Aris",
    title: "Senior Partner",
    location: "Dubai, UAE",
    summary:
      "20+ years in strategy and AI transformation across GCC. Former Big-4 Partner. Advises sovereign funds and government ministries.",
  },
  {
    name: "Gokhan Guney",
    title: "Senior Partner",
    location: "Riyadh, KSA",
    summary:
      "15+ years in enterprise AI engineering. Expert in agentic AI platforms, LLM orchestration, and sovereign on-prem AI.",
  },
  {
    name: "Alper Kulak",
    title: "Senior Partner",
    location: "Dubai, UAE",
    summary:
      "Data platform and AI governance expert. 15+ years building data foundations for GCC telecoms, banks, and government.",
  },
  {
    name: "Khalid Al Khudairi",
    title: "Senior Partner",
    location: "Riyadh, KSA",
    summary:
      "KSA Vision 2030 advisor with deep PIF and government relationships. 12+ years in AI adoption and organisational transformation.",
  },
];

export const firmFacts = {
  positioning:
    "Maven AI is a boutique GCC AI advisory and engineering firm — sister firm to Maven Insights (~200 consultant bench). We exist to close the gap between enterprise AI ambition and production outcomes.",
  offices: "4 GCC offices (Dubai, Riyadh and partner presence across the Gulf).",
  promise:
    "Senior partners on every call, every deliverable. 90-day MVP commitment from kickoff to production. Sovereign on-prem capable for national security environments.",
  pricing:
    "Engagement-based, scoped per programme. Maven AI does not publish day rates publicly. Use the diagnostics or book a 30-minute readout to discuss scope.",
  contact:
    "Use the Contact page or book a 30-minute partner readout from any assessment results page. Founders' email is reserved for shortlisted scope conversations.",
};

/** Single object exposed for prompt-building convenience. */
export const knowledgeBase = {
  firmFacts,
  services,
  industries,
  insights,
  assessments,
  founders,
};

export type KnowledgeBase = typeof knowledgeBase;

/** Stable suggestion link types the chat widget can render as wouter <Link>s. */
export type ChatSuggestionKind = "service" | "insight" | "assessment" | "industry" | "page";

export interface KnownLink {
  kind: ChatSuggestionKind;
  href: string;
  label: string;
}

/** Allow-list every link the chat widget is permitted to surface.
 * Important: every href here MUST resolve to a real route in the maven-ai app.
 *  - Industries use in-page anchors (`/industries#<id>`), not subroutes.
 *  - High-intent contact CTAs use `?topic=<slug>` to prefill the form.
 *  - There is no `/founders` page; founders live on `/about`.
 */
export function buildKnownLinks(): KnownLink[] {
  const out: KnownLink[] = [];
  for (const s of services) {
    out.push({ kind: "service", href: `/services/${s.slug}`, label: s.title });
    // High-intent CTA — pre-fills the contact form's "interest" field.
    out.push({
      kind: "page",
      href: `/contact?topic=${s.slug}`,
      label: `Talk to a partner about ${s.title}`,
    });
  }
  for (const i of insights) out.push({ kind: "insight", href: `/insights/${i.slug}`, label: i.title });
  for (const a of assessments) out.push({ kind: "assessment", href: `/assessments/${a.slug}`, label: `${a.code} — ${a.name}` });
  for (const ind of industries) out.push({ kind: "industry", href: `/industries#${ind.id}`, label: ind.title });
  out.push({ kind: "page", href: "/about", label: "About Maven AI (founders, story, operating model)" });
  out.push({ kind: "page", href: "/contact", label: "Contact / book a 30-minute readout" });
  out.push({ kind: "page", href: "/insights", label: "All insights" });
  out.push({ kind: "page", href: "/assessments", label: "All diagnostic assessments" });
  out.push({ kind: "page", href: "/services", label: "All services" });
  out.push({ kind: "page", href: "/industries", label: "All industries we serve" });
  return out;
}
