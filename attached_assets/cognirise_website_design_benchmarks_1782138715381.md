# Cognirise Website — Design Benchmarks & Guidelines

Derived from live analysis of bcg.com/x, palantir.com, and mckinsey.com.  
Cross-referenced with Cognirise brand guidelines (Template v2.pptx).

---

## 1. What the Benchmarks Tell Us

### BCG X (`bcg.com/x`)
**Character:** Bold, editorial, "builder" energy. Mixes consulting credibility with startup momentum.

- **Fonts:** `henderson-bcg-mod` (custom display, headings) + `henderson-bcg-sans` (body)
- **H1:** 86px / weight 700 / line-height 1.0 / white on dark video hero
- **H2:** 52px / weight 700 / dark text on light sections
- **H3:** 32px / weight 700 / `text-transform: capitalize`
- **Body:** 16px / weight 400 / `henderson-bcg-sans`
- **Background palette:** Dark video hero → transitions to white (#fff) and warm neutral (#F1EEEA / cream)
- **Accent colors:** Electric green (#21BF61), deep green (#197A56)
- **Navigation:** White bar, overlays dark hero, no border radius on CTAs
- **CTA style:** All-caps text links + outlined/pill buttons, 0px border radius
- **Content pattern:** Fullscreen video hero → stat strip (3000 / 80 / 48 / 30+) → case study carousels → "What We Do" accordion → team profiles → insights grid → leadership grid

**What to steal:**  
→ The stat strip pattern (big number + label) is powerful for Cognirise credibility  
→ Case study carousels with client name + outcome snippet  
→ Section cadence: hero → proof numbers → services → cases → team → content

---

### Palantir (`palantir.com`)
**Character:** Dark, serious, enterprise-grade. Zero decoration. Demands respect rather than asking for it.

- **Fonts:** `Alliance No.1` (primary, all-purpose) + `Alliance No.2` (captions/detail labels)
- **H1/display:** 72px / weight **400** (deliberately light on dark) / letter-spacing **−2.16px** (very tight negative)
- **Body:** 16px / weight 400 / line-height 1.43
- **Caption/label:** 10px / `Alliance No.2` / letter-spacing +0.5px / `rgb(185,185,185)`
- **Background:** `#1e1f2b` (very dark navy-charcoal) — single dominant background throughout
- **Text colors:** Off-white `#efefef` (primary) / mid-grey `rgb(185,185,185)` (secondary)
- **Accent:** Dark forest green `#2b5945` (very subtle, used sparingly) + bright blue `#4e8af7` (links only)
- **Navigation:** Minimal dark nav, product-category links, single "Get Started" CTA
- **CTA style:** Ghost/outline buttons on dark background, no fill, very restrained
- **Spacing system:** 12-column grid, `--gutter: 0.56rem`, section vertical spacing `3.33rem`
- **Content pattern:** Dark full-screen hero → news ticker → product capabilities → impact studies link

**What to steal:**  
→ Tight negative letter-spacing (−2px to −3px) on large display headings — makes type feel premium  
→ Dual-weight font system: same family in two optical variants (body vs. caption)  
→ Single dark background color held through the entire page — no jarring light sections  
→ Category labels in all-caps small text above headings (e.g. "ARTIFICIAL INTELLIGENCE / ARTICLE")

---

### McKinsey (`mckinsey.com`)
**Character:** Authoritative and editorial. Intellectual premium. Thought leadership as product.

- **Fonts:** `McKinsey Sans` (custom, all weights, used exclusively) + `Bower` (serif, likely display/pull-quote use)
- **H2:** 44px / weight **300** / line-height 52px — deliberately thin at large sizes
- **H3:** 64px / weight **300** / line-height 76.8px
- **Body:** 16px / weight 300 / line-height 24px
- **Background:** Dark navy hero `#051c2c` → transitions to white body
- **Text colors:** White on hero, `#333` on body, electric blue `#2251ff` for links
- **CSS variables:** 224 design tokens — highly systematic, token-driven design
- **Navigation:** Ultra-clean horizontal nav, industry taxonomy, search icon, no hamburger on desktop
- **CTA style:** Clean text links + blue accent → very editorial, not SaaS-y
- **Content pattern:** Dark hero (full width, video/animation) → featured article cards → podcast → newsletter CTA → careers

**What to steal:**  
→ Using a **light font weight (300)** at large display sizes — counterintuitive but extremely refined  
→ Dark navy hero + immediate transition to light content body — creates strong first impression then readability  
→ Editorial content hierarchy: tag label → date → headline → excerpt → "Learn More" arrow link  
→ Dual typeface: geometric sans (workhorse) + serif (editorial gravitas)

---

## 2. Synthesized Design Direction for Cognirise

### 2.1 Color System

Cognirise already has the right bones. Here's how to use them:

| Role | Color | Hex | Source Alignment |
|------|-------|-----|-----------------|
| Page background (hero) | Deep navy | `#07122C` | Matches McKinsey `#051c2c`, Palantir `#1e1f2b` |
| Page background (body) | Near-white | `#F5F5F3` | BCG neutral cream |
| Primary accent | Cognirise blue | `#5E7AFD` | McKinsey uses `#2251ff`, Palantir `#4e8af7` — same electric-blue family |
| Primary text (on dark) | Off-white | `#EFEFEF` | Palantir exact match |
| Secondary text (on dark) | Muted grey | `#B9B9B9` | Palantir `rgb(185,185,185)` |
| Body text (on light) | Near-black | `#1A1A2E` or `#212427` | BCG `#212427` |
| Section divider / subtle | Warm neutral | `#F1EEEA` | BCG `--neutral-200` |
| Success/highlight | — | Reserve for data viz only | — |

**Rule:** Hero and top sections stay dark (`#07122C`). Mid-page transitions to light (`#F5F5F3`). This is the BCG X + McKinsey pattern and it works.

---

### 2.2 Typography

**Primary font:** Plus Jakarta Sans (already established for Cognirise)  
**Secondary/editorial font:** Consider adding a serif for pull quotes and editorial moments (McKinsey uses Bower, BCG uses a custom serif). Options: `Playfair Display`, `DM Serif Display`, or `Fraunces`.

| Level | Size | Weight | Letter-spacing | Line-height | Notes |
|-------|------|--------|----------------|-------------|-------|
| Display / Hero H1 | 80–96px | 600–700 | −2px to −3px | 1.0 | Palantir tight-tracking approach |
| Section H2 | 48–56px | 300–400 | −1px | 1.1 | McKinsey light-weight refinement |
| Sub-section H3 | 28–36px | 600 | normal | 1.2 | BCG bold clarity |
| Body | 16–18px | 400 | normal | 1.5 | Standard |
| Caption / Label | 10–12px | 400–500 | +0.5px | 1.6 | Palantir `Alliance No.2` role |
| Nav links | 14–16px | 400 | normal | 1.0 | Clean, no transform |

**Key rule from benchmarks:** Large display type (Hero H1) should use **tight negative letter-spacing (−2px to −3px)** and either bold weight (BCG) or light weight (McKinsey). Cognirise should pick one — recommend **bold + tight tracking** given the dark navy background and desire to project strength.

---

### 2.3 Navigation

All three benchmarks use the same nav pattern. Follow it exactly:

- Logo mark left  
- Horizontal nav links center (4–6 items max): Services · Work · Insights · About · Careers  
- Single CTA button right: "Contact Us" — filled with `#5E7AFD`, white text, no border-radius or 4px max  
- Nav background: transparent over hero → solid white/dark on scroll (sticky)  
- Nav font: 14–16px / weight 400 / no uppercase transform  

---

### 2.4 Page Structure (Recommended Section Order)

Following the BCG X and McKinsey cadence:

```
1. HERO (full-viewport, dark #07122C)
   — Bold statement headline (1–2 lines max)
   — 1-sentence subheadline
   — "Contact Us" CTA
   — Optional: subtle animated background or still image

2. CREDIBILITY STRIP (dark or near-white band)
   — 4 stats: clients / projects / geographies / years
   — Big number + small label, like BCG's "3000 / nearly 3000 experts"

3. WHAT WE DO (light background #F5F5F3)
   — 5 service lines as expandable cards or horizontal tabs
   — Each: eyebrow label (ALL CAPS, small) → H3 → 2-line description → "Learn More"

4. CLIENT IMPACT (alternating dark/light or card grid)
   — 3–4 case study cards: industry tag → client → outcome → link
   — Carousel on mobile

5. OUR APPROACH (dark #07122C)
   — Methodology: INNOVATE · DEMONSTRATE · ACTIVATE · GENERATE
   — Visual timeline or numbered step layout

6. AGENTS / TECHNOLOGY (dark or mid-tone)
   — Guild model or agent roster
   — Grid of named agents with role + description

7. INSIGHTS (light)
   — Editorial grid: label → date → headline → excerpt
   — Tag-filtered: AI Strategy / Agentic Enterprise / Sovereign AI

8. TEAM / FOUNDERS (light or warm neutral)
   — Gokhan + Mounir + Ömer with short bios
   — "Formerly of / Based in" pattern (like BCG X expert cards)

9. CONTACT / CTA (dark #07122C)
   — Single CTA, email, regional offices

10. FOOTER (very dark, near-black)
    — Navigation links, legal, social
```

---

### 2.5 Component Patterns

**Buttons**
- Primary: `#5E7AFD` fill, white text, 0–4px border radius, 14px font, uppercase or normal (pick one)
- Secondary: Outline only, `#5E7AFD` border + text, transparent fill
- Ghost (on dark bg): White border + white text, transparent fill
- No border radius > 4px (avoid pill buttons — too SaaS-y for consulting)

**Cards (case studies, insights)**
- Dark version: `#0D1F45` card on `#07122C` page — subtle elevation via color, not shadow
- Light version: White card on `#F5F5F3` — 1px border `#E0DDD8`, no drop shadow
- Structure: Eyebrow label (ALL CAPS, 11px, `#5E7AFD`) → H3 title → 2-line excerpt → arrow link

**Stat display**
- Number: 56–72px / weight 700 / `#5E7AFD` or white
- Label: 12px / weight 400 / muted grey
- Separator: 1px vertical line between stats, or just spacing

**Section labels / eyebrows**
- Pattern stolen from Palantir: `CLIENT IMPACT` or `WHAT WE DO` in 10–11px / weight 500 / letter-spacing +0.5px / `#5E7AFD`
- Placed above every section heading — creates scannable hierarchy

---

### 2.6 Motion & Interaction

All three benchmark sites use motion purposefully, not decoratively:

- **Hero:** Subtle background animation or video loop (Palantir: dark particle/grid; BCG X: actual build video)
- **Scroll reveals:** Fade-up on section enter (standard, nothing aggressive)
- **Stat counter:** Numbers count up on scroll-into-view (BCG X pattern)
- **Nav:** Crossfade from transparent to solid on scroll
- **Hover on cards:** Slight border highlight or `#5E7AFD` left-border reveal

Avoid: parallax, heavy 3D transforms, excessive micro-animations. These undermine the gravitas of an enterprise consulting brand.

---

### 2.7 Photography & Visual Style

- **BCG X:** Real people (team headshots with "Formerly of X" attribution), client industry photography
- **Palantir:** Almost no photography — relies entirely on data visualization, dark UI screenshots, abstract grids
- **McKinsey:** Editorial photography, abstract conceptual imagery, illustration-style data graphics

**Recommendation for Cognirise:**
- Hero: Abstract AI/data visualization — dark, geometric, subtle. NOT stock photos of people in meetings.
- Team section: Professional headshots on neutral dark background (Palantir style)
- Case studies: Abstract industry imagery (energy = mining/extraction, finance = grid/data)
- Avoid: generic AI imagery (glowing brains, neural network clichés)

---

## 3. Quick-Reference: What Each Benchmark Contributes

| Element | Steal from BCG X | Steal from Palantir | Steal from McKinsey |
|---------|-----------------|---------------------|---------------------|
| Hero | Bold headline + stat strip | Dark background system | Dark hero → light body transition |
| Typography | 700 weight display | Tight negative tracking | Light weight (300) at large sizes |
| Color | Warm neutral mid-sections | Single dark bg discipline | Electric blue links |
| Eyebrow labels | ✓ | ✓ ALL CAPS small | ✓ Tag + date pattern |
| Case studies | ✓ Carousel cards | ✗ | ✓ Editorial cards |
| Navigation | White-on-scroll sticky | Minimal dark | Ultra-clean taxonomy |
| Team section | "Formerly of" + quotes | ✗ | ✗ |
| Content/Insights | Blog carousel | ✗ | ✓ Full editorial grid |
| Motion | Stats count-up | Restrained reveals | Restrained reveals |

---

*Prepared June 2026 — based on live extraction from bcg.com/x, palantir.com, mckinsey.com*

---

## 4. Visual Design Principles — Benchmark Analysis

### 4.1 What Each Site Actually Does (Live Extraction)

#### BCG X — Visual Fingerprint
- **Hero:** 15-second autoplay looping video (`bcg_x_launch_film-15s_loop.mp4`, 1920×1080) — branded film showing people, technology, and scale; not abstract
- **Animation library:** Lottie — used for icon/illustration animations throughout (services, methodology)
- **SVG count:** 192 — extremely icon-heavy; every service, feature, and section has custom iconography
- **Images:** 90 total, predominantly 16:9 industry stock photography per sector (aerospace, energy, healthcare, automotive, financial) sourced via CDN with aggressive WebP + crop optimization
- **No canvas, no Three.js, no GSAP** — all animation via CSS keyframes + Lottie
- **Visual theme:** Consulting credibility + builder energy. Images show industries, not AI abstractions.

#### Palantir — Visual Fingerprint
- **Hero:** `Website_Reel_Update_V7.mp4` (1920×1080, autoplay, muted, loop) with dedicated poster fallback image — a cinematic product/mission reel
- **Hover-state product videos:** Each product card (AIP, Gotham, Foundry, Ontology, Apollo) has a dedicated hover video showing the live UI — videos load and play automatically on hover, paused otherwise
- **Photography style:** Dramatic real-world impact — military hardware (TITAN trucks), hospital rooms, manufacturing floors, CEO interviews, developer conferences — technology made consequential by context
- **SVG count:** 14 only — extremely restrained; photography does the visual heavy lifting
- **Images:** 42 total — high-contrast photography with dark overlays to maintain the dark aesthetic
- **No Lottie, no GSAP, no Three.js** — custom CSS animations only
- **Visual theme:** Technology operationalized. Not "here's what we build" — "here's the world where it runs."

#### McKinsey — Visual Fingerprint
- **Video:** 1 video element (non-autoplay podcast/interview) — background video not used at all
- **Images:** Only 12 total — the most restrained of all three
- **Photography style:** Abstract 3D digital art ("digitally generated cylinders stacking upward"), occasional editorial portrait photography — conceptual and intellectual, not operational
- **SVG count:** 4 — logo, app store badges only
- **No animation libraries at all** — almost no motion beyond text transitions
- **Visual theme:** Ideas over imagery. The text IS the visual. Authority through restraint.

---

### 4.2 The Visual Spectrum

```
TEXT-DOMINANT                                             IMAGE/VIDEO-DOMINANT
       │                                                              │
   McKinsey ──────────── BCG X ──────────── Palantir
  (12 images,          (90 images,          (42 images,
   0 bg video,        Lottie + hero          hero + 5 hover
   4 SVGs,            video, 192 SVGs,       product videos,
   pure editorial)    industry stock)        dramatic real-world)
```

Cognirise should sit **between BCG X and Palantir** — darker than BCG X, more impactful imagery than McKinsey, with video as a deliberate tool not decoration.

---

### 4.3 Cognirise Visual Design Recommendations

#### HERO VIDEO
**What to build:** A 20–30 second autoplay looping reel, muted, with poster fallback.

**What it should show (not stock footage):**
- Abstract AI network/data flow — dark navy base, blue (#5E7AFD) node connections pulsing
- Transition to: industrial operations (mining conveyor systems, data center racks, banking trading floors) being augmented by agent overlays
- Transition to: clean UI screens showing Cognirise agents running — dashboards, decision flows
- End on: Cognirise logo + wordmark hold

**What to avoid:** Generic "AI brain with glowing nodes" footage. Talking heads. Stock "diverse team in glass office." Anything that looks like a SaaS startup.

**Production spec:** 1920×1080 minimum, H.264 MP4, < 8MB for web, separate poster JPG for first frame.

---

#### PHOTOGRAPHY SYSTEM

Three distinct image registers, each for a different section:

**Register 1 — Operational / Industrial (Palantir-inspired)**
Use in: case study cards, industry section, "Our Work" pages.
Style: Real industrial environments — mining operations, data centers, refineries, financial trading floors, government infrastructure. High contrast. Dark-treated with color overlay (#07122C at 40–60% opacity) to maintain brand cohesion.
Message: *This is the world where your agents run.*

**Register 2 — Abstract / Conceptual (McKinsey-inspired)**
Use in: hero background, section breaks, insight article covers.
Style: AI-generated 3D abstract imagery — geometric lattices, data topographies, network graphs rendered as sculpture. Color palette: dark navy + Cognirise blue + white highlights. Can be AI-generated (Midjourney / Stable Diffusion) for cost efficiency.
Message: *This is the intelligence behind it.*

**Register 3 — People / Founder (BCG X-inspired)**
Use in: team section, "About" page, testimonials.
Style: Professional headshots on neutral dark studio background. Clean, direct eye contact. No "casual office" staging.
Message: *These are the people responsible for it.*

**What to never use:**
- Stock photos of people pointing at whiteboards
- Generic blue "digital transformation" imagery
- Neural network brain diagrams
- Handshake photos

---

#### ANIMATION & MOTION SYSTEM

| Element | Approach | Reference |
|---------|----------|-----------|
| Hero background | Looping video reel | Palantir `Website_Reel_Update_V7.mp4` |
| Service line icons | Lottie animations (play on hover) | BCG X approach |
| Service/agent cards | Hover-state video preview (5–8 sec loop of agent in action) | Palantir product hover videos |
| Section scroll reveals | CSS fade-up, 0.4s ease-out, stagger 0.1s per item | Standard |
| Stat counter | Count-up on scroll-into-view | BCG X stat strip |
| Navigation | Crossfade background from transparent to `rgba(7,18,44,0.95)` on scroll | BCG X/McKinsey |
| Data visualization | Lightweight Chart.js or D3 — animated on scroll | New addition |

**Libraries to use:** Lottie-web (for service icons), AOS or Intersection Observer API (for scroll reveals). **Do not use** GSAP, Three.js, Framer Motion, or heavy animation rigs — they create performance debt and feel startup-y, not enterprise.

---

#### SVG & ICONOGRAPHY SYSTEM

BCG X uses 192 SVGs — a rich icon vocabulary. Palantir uses 14. The difference is in purpose:

- BCG X icons: decorative, one per feature/service, replace photography in product sections
- Palantir icons: functional only — navigation, UI controls

**Recommendation for Cognirise:** Target ~40–60 custom SVG icons. Build a consistent icon set for:
- 5 service line icons (geometric, linear style, animated via Lottie)
- 13 guild agent icons (one per agent — simplified avatar or symbol)
- UI/navigation icons (search, menu, arrow, external link)
- Industry vertical icons (mining, finance, government, telecom)

**Icon style:** Linear/outline, 2px stroke, rounded joins, consistent 24×24 or 32×32 grid. Color: `#5E7AFD` on dark, `#07122C` on light. Avoid filled/solid icons — they feel dated.

---

#### ASPECT RATIOS & IMAGE SPECS

| Use case | Ratio | Minimum size |
|----------|-------|-------------|
| Hero video poster | 16:9 | 1920×1080 |
| Case study card | 16:9 | 768×432 |
| Insight/article card | 3:2 | 600×400 |
| Team headshot | 1:1 | 400×400 |
| Section background | 21:9 | 1920×822 |
| Mobile hero | 9:16 | 390×844 |

All images: WebP format, < 200KB per card image, lazy-loaded except hero poster.

---

### 4.4 The Single Most Important Visual Decision

**Palantir's hover-state product videos are the most distinctive pattern across all three benchmarks.** When you hover a product card, a silent looping video instantly reveals the product in action. It's not a modal or a new page — it's ambient demonstration.

For Cognirise, the equivalent is: **service line cards that play a 6-second agent demo video on hover.** When a visitor hovers over "Agentic Enterprise Transformation," they see an agent autonomously processing a workflow. Over "Data & AI Foundations," they see a pipeline being configured. This single interaction communicates capability faster than any copywriting.

**Priority:** Build this hover-video pattern for at least 3 of the 5 service lines before launch.

---

*Visual analysis section added June 2026 — based on live DOM/asset extraction from bcg.com/x, palantir.com, mckinsey.com*
