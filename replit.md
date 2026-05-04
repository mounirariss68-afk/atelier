# Maven AI — Marketing Website + Diagnostic Suite

## Overview
This project delivers a world-class marketing website for Maven AI, an AI advisory and engineering services firm. It's built as a React + Vite single-page application. A key enhancement is the integration of the Maven AI Diagnostic Assessment Suite, offering four free, bilingual (EN/AR) diagnostic wizards (ARI, MVI, DAFI, UVR). This suite is supported by an Express API, uses Postgres for persistence, and generates AI-powered executive memos and branded PDF reports. The website aims to showcase Maven AI's expertise, services, and diagnostic capabilities, with a strong focus on a premium user experience and robust functionality.

## User Preferences
The user wants me to follow an iterative development approach. I should ask for confirmation before implementing any major changes. The user prefers detailed explanations of the code and design decisions. I should use clear, simple language in all communications.

## System Architecture
The project is built on a modern web stack: React, Vite, TypeScript, Tailwind CSS v4, Framer Motion, and Wouter for routing, managed within a pnpm monorepo. The design emphasizes a McKinsey/Accenture-quality aesthetic, utilizing a consistent brand identity with a navy (`#0E2841`), teal (`#156082`), and amber (`#F5A623`) color scheme, and Plus Jakarta Sans for typography.

**Key Features:**
- **UI/UX:** Responsive design with mobile-first considerations, animated sections using Framer Motion, and a sophisticated visual language. The site includes a floating amber FAB for the chat widget, which also supports full-screen mode on mobile.
- **Content Management:** All static content (founders, services, insights, industries) is centrally managed within `src/data/content.ts` and `lib/maven-content`.
- **Navigation & Routing:** Comprehensive routing handles main pages, service details, insight articles, industry profiles, a dynamic marketplace for demo tools, and dedicated routes for diagnostic assessments and multi-variant demos (e.g., `/demo/:slug/:variant`).
- **Marketplace:** Features a filterable catalog of demo tools with detailed pages showcasing screens, data models, and multi-demo variants. Includes flagship demos like Value Realization and detailed, localized (Turkish) demos for Arçelik Pricing Intelligence with both Business Dashboard and Dealer Portal variants. These variants include complex UIs such as KPI summaries, heatmaps, radar charts, campaign builders, pricing simulators, and Gantt calendars, all with AI chat integrations and specific Turkish intent patterns. The Arçelik demo features a full **agentic pricing intelligence platform** with: autonomous reasoning engine generating 15+ recommendations with multi-step reasoning traces, agent task queue, alert monitoring, automated playbooks, approval/rejection workflows, decision history, role-based filtering (Pricing/Finance/Marketing Director), and integration across all views — Agent Decisions view (5 sub-tabs), Simulator (agent-recommended scenarios), Campaign Studio (agent suggestions), Dealer Portal (personalized agent tasks), and Chat (agent-aware intents). Key data model lives in `arcelik-agent.ts` with deterministic engine; main view is `AgentDecisionsView.tsx`.
- **Diagnostic Suite:** Comprises a shared TypeScript library for the scoring engine, i18n, and framework definitions. The UI includes a wizard engine, results screens with gauges, radar charts, heatmaps, and a portfolio view, plus React-PDF for branded reports, supporting both English and Arabic with an RTL toggle.
- **AI Chat Assistant:** A site-wide assistant integrates with both server-side (Anthropic/OpenAI) and client-side logic. It leverages a shared `knowledgeBase` from `lib/maven-content`, uses an OpenAPI-defined `POST /chat` endpoint for SSE, implements a strict allow-list for internal links, and provides a user-friendly interface with rate limiting, streaming responses, and session persistence.

## External Dependencies
- **AI Integrations:** Anthropic (claude-sonnet-4-5) and OpenAI (gpt-5) for AI memo generation and chat assistant responses.
- **Email Service:** Resend for sending emails.
- **Database:** PostgreSQL for persistent storage of assessment submissions, call requests, and team invitations.