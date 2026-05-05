# Maven AI — Marketing Website + Diagnostic Suite

## Overview
This project delivers a marketing website for Maven AI, an AI advisory and engineering firm, built as a React + Vite single-page application. Its core purpose is to showcase Maven AI's expertise, services, and diagnostic capabilities, with a focus on a premium user experience. A key component is the integrated Maven AI Diagnostic Assessment Suite, offering four free, bilingual (EN/AR) diagnostic wizards (ARI, MVI, DAFI, UVR). This suite is backed by an Express API and a Postgres database, generating AI-powered executive memos and branded PDF reports.

## User Preferences
The user wants me to follow an iterative development approach. I should ask for confirmation before implementing any major changes. The user prefers detailed explanations of the code and design decisions. I should use clear, simple language in all communications.

## System Architecture
The project utilizes a modern web stack: React, Vite, TypeScript, Tailwind CSS v4, Framer Motion for animations, and Wouter for routing, all managed within a pnpm monorepo. The design adheres to a premium aesthetic, using a consistent brand identity with a navy, teal, and amber color scheme, and Plus Jakarta Sans typography.

**Key Features:**
-   **UI/UX:** Responsive design with mobile-first considerations, animated sections, and a floating amber FAB for the chat widget.
-   **Content Management:** Static content (founders, services, insights, industries) is centrally managed within `src/data/content.ts` and `lib/maven-content`.
-   **Navigation & Routing:** Comprehensive routing supports main pages, service details, articles, industry profiles, a dynamic marketplace for demo tools, and dedicated routes for diagnostic assessments and multi-variant demos.
-   **Marketplace:** Features a filterable catalog of demo tools with detailed pages, including multi-demo variants like the Arçelik Pricing Intelligence demo. This demo incorporates complex UIs (KPI summaries, heatmaps, radar charts, campaign builders, pricing simulators, Gantt calendars) with AI chat integrations and bilingual intent patterns, along with an agentic pricing intelligence layer.
-   **Arçelik Demo Data Architecture:** Pricing data is stored in PostgreSQL (15 Drizzle schema tables) with provenance metadata. Data is seeded from a baseline JSON and supplemented by web scrapers. An automated scheduler updates prices daily, tracking history and logging scrape runs.
-   **Cross-Brand Marketplace Intelligence:** A live N11 + Trendyol marketplace pipeline ingests competitor SKUs (`arcelik_marketplace_prices`), extracts structured PDP specs (`arcelik_product_specs` — capacity, energy class, dimensions, RPM, noise), and builds confidence-scored cross-brand equivalences (`arcelik_product_equivalences`) via a multi-signal matcher (category, capacity, energy tier, price band, title token overlap, subtype synonyms). An append-only `arcelik_marketplace_price_history` captures per-source price movements. API exposes `/api/arcelik/{coverage, marketplace-prices, marketplace-prices/summary, marketplace-prices/history, equivalences, product-specs}`.
-   **Arçelik Demo i18n:** Full TR/EN internationalization for the demo, including UI elements, chat intents, and seeded data, ensuring a fully bilingual user experience.
-   **Diagnostic Suite:** A shared TypeScript library powers the scoring engine, i18n, and framework definitions. The UI includes a wizard engine, results screens with data visualizations, and React-PDF for branded reports supporting English and Arabic (with RTL toggle).
-   **AI Chat Assistant:** A site-wide assistant integrates with server-side (Anthropic/OpenAI) and client-side logic, leveraging a shared knowledge base, an OpenAPI-defined `POST /chat` endpoint for SSE, strict allow-listing for internal links, and features rate limiting, streaming responses, and session persistence.
-   **New Dashboard Views (Arçelik Demo):** Includes a **Product Comparison View** (cards, scatter plot, search/sort) and a **Market Whitespace View** (bubble chart, bar chart, opportunity cards), both with full TR/EN i18n. A specialized AI Agents Panel within the `AgentDecisionsView` shows 9 agents with real-time status and metrics.

## External Dependencies
-   **AI Integrations:** Anthropic (claude-sonnet-4-5) and OpenAI (gpt-5) for AI memo generation and chat assistant responses.
-   **Email Service:** Resend for sending emails.
-   **Database:** PostgreSQL for persistent storage of assessment submissions, call requests, team invitations, and Arçelik demo pricing data (15 tables, including marketplace prices, structured PDP specs, cross-brand equivalences, and marketplace price history).
-   **Scraper Dependencies:** `cheerio` (HTML parsing for Vestel, Bosch, Samsung) and `playwright-core` (headless Chromium for Arçelik, Beko, N11, Trendyol) are used for web scraping.