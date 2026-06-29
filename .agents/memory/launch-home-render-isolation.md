---
name: Launch Home render isolation
description: Why the launch site's nav/scroll/menu state lives in an isolated SiteNav component
---

The `launch` site renders as one giant monolithic page component (`artifacts/launch/src/pages/Home.tsx`, ~1300 lines of JSX with many framer-motion subtrees, a 4s hero auto-rotate interval, and several IntersectionObservers).

**Rule:** Scroll-position state (`scrolled`), active-section tracking, and the mobile menu toggle must live in a small isolated `SiteNav` component — NOT in `Home`.

**Why:** When that state lived in `Home`, every scroll tick (scrolled threshold cross + activeSection IntersectionObserver firing) and every menu toggle re-rendered the entire page tree. On mobile this caused visible scroll jank and a multi-hundred-ms delay before the hamburger menu appeared ("feels stuck"). Isolating the state so only the nav re-renders fixed both.

**How to apply:** Keep nav/scroll/menu state in `SiteNav`. Don't hoist it back into `Home` for convenience. Avoid stacking `backdrop-blur` (nav blur + menu blur) on mobile — it compounds GPU repaint cost; the mobile menu drawer uses an opaque `bg-navydeep` instead.

Related mobile-layout decisions in the hero:
- Hero slide imagery is desktop-only (`hidden md:grid`); on mobile only the rotating text + CTAs show.
- The rotating-text container needs a fixed `min-h` large enough for the tallest slide (intro headline + clamped body) so the CTA buttons don't shift between slides. The intro body is `line-clamp-4 sm:line-clamp-none` to keep that height bounded on mobile.
- Large in-flow images (guild deck, human-agent) carry width/height + `aspect-[w/h]` to reserve space and prevent layout shift as they decode.
