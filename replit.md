# Maven AI — Marketing Website + Diagnostic Suite

## Project Overview
A comprehensive, world-class marketing website for **Maven AI** — a boutique AI advisory and engineering services firm, sister company to Maven Insights. Built as a React + Vite single-page application with full routing. Now includes the **Maven AI Diagnostic Assessment Suite** — four free bilingual (EN/AR) wizards (ARI, MVI, DAFI, UVR) backed by an Express API, Postgres persistence, AI executive memos and branded PDF reports.

## Diagnostic Suite Architecture
- **Shared lib**: `lib/assessments` — pure-TS scoring engine, sovereign sub-score, anti-patterns, peer benchmarks, cost-of-inaction, recommendations, i18n strings, all 4 framework definitions.
- **Schema**: `lib/db/src/schema/assessments.ts` (`assessment_submissions`, `call_requests`, `team_invitations`).
- **API**: `artifacts/api-server/src/routes/assessments.ts` — submit, fetch, memo, email, book-call, team-links, heatmap, reinvention-index. AI memo via Anthropic (claude-sonnet-4-5) → OpenAI (gpt-5) → deterministic template fallback. Email via Resend with log-only fallback.
- **UI**: `artifacts/maven-ai/src/pages/assessments/*` and `src/components/assessment/*` — wizard engine, results screen with gauge/radar/heatmap/UVR portfolio, react-pdf branded report, EN/AR with RTL toggle.
- **Routes**: `/assessments`, `/assessments/:slug`, `/assessments/:slug/results/:publicId`, `/assessments/team/:token`.
- **Entry points**: Navbar (Diagnostics + Free Assessment), Footer (Diagnostics column), Home (hero CTA + suite banner), ServiceDetail (diagnostic CTA), Contact (hero CTA).

## Architecture
- **Stack**: React + Vite + TypeScript + Tailwind CSS v4 + Framer Motion + Wouter routing
- **Monorepo**: pnpm workspace at `/artifacts/maven-ai`
- **Port**: 22132 (via `$PORT` env variable)
- **Preview path**: `/`

## Brand Identity
- **Navy**: `#0E2841` (primary background)
- **Teal**: `#156082` (secondary/accent)
- **Orange**: `#E97132` (CTA/accent)
- **Blue**: `#0F9ED5` (light accent)
- **Green**: `#196B24`
- **Font**: Plus Jakarta Sans (Google Fonts)

## Pages
| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `Home.tsx` | Hero, stats, services, insights, industries CTA |
| `/about` | `About.tsx` | Company story, 4 founders, operating model, Maven Insights |
| `/services` | `Services.tsx` | All 4 service cards overview |
| `/services/:slug` | `ServiceDetail.tsx` | Individual service detail with engagement model |
| `/insights` | `Insights.tsx` | Filterable library of 8 research reports |
| `/insights/:slug` | `InsightDetail.tsx` | Full article with related content sidebar |
| `/industries` | `Industries.tsx` | Public Sector, Telecom, Financial Services |
| `/contact` | `Contact.tsx` | Contact form + 4 GCC office locations |

## Content Data
All content lives in `src/data/content.ts`:
- 4 founders: Mounir Aris (CEO), Gokhan Guney, Alper Kulak, Khalid Al Khudairi
- 4 services: Agentic AI Transformation, AI-Driven SDLC, Data & Governance, AI Product Studio
- 8 insight articles with full content
- 3 industry profiles with case vignettes and stats

## Components
- `Navbar.tsx` — Responsive nav with dropdown menus for Services/Insights
- `Footer.tsx` — 4-column footer with GCC office grid

## Images
Located in `public/images/`:
- `logo-mark.png` — AI-generated Maven AI logo
- `report-1.png` through `report-8.png` — AI-generated report covers
- `founder-mounir.png`, `founder-gokhan.png`, `founder-alper.png`, `founder-khalid.png` — Founder portraits

## Key Features
- McKinsey/Accenture-quality design language
- Navy/teal/orange brand system throughout
- Full-content articles (800-2000 words each)
- Filterable insights library with search
- Animated sections with Framer Motion
- Mobile-responsive navigation with hamburger menu
- Contact form with success state
- Service detail pages with engagement model timelines
- Industry pages with case vignettes and metrics

## GCC Offices
- Dubai: JLT Swiss Tower 3402
- Riyadh: 4288 Anas Bin Malik, Al Malqa
- Abu Dhabi: Musaffah M40
- Doha: Regus No. 67
