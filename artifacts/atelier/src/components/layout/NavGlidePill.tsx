/**
 * NavGlidePill — animated pill highlight for the top menu bar (Task #930).
 *
 * Renders an absolutely-positioned rounded pill inside a `position:relative`
 * nav container. It finds the element marked `data-nav-pill-active="true"`
 * (nav items opt in via `data-nav-pill-item`), measures it relative to the
 * container, and glides to it with a CSS left/width transition whenever the
 * active route changes. Purely decorative: it sits behind the links
 * (`pointer-events-none`, negative z not needed since it renders first).
 *
 * Works with the glassmorphism theme in both light and dark modes by using
 * a translucent gold tint + hairline border (matches the active text-gold).
 */

import * as React from "react";

interface PillRect {
  left: number;
  width: number;
}

export function NavGlidePill({
  containerRef,
  /** Any value that changes when the active nav item may have moved
   *  (typically the current location + lens id). */
  activeKey,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  activeKey: string;
}) {
  const [rect, setRect] = React.useState<PillRect | null>(null);
  // First placement snaps into position; subsequent moves animate.
  const [animated, setAnimated] = React.useState(false);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const el = container.querySelector<HTMLElement>(
        '[data-nav-pill-active="true"]',
      );
      if (!el) {
        setRect(null);
        return;
      }
      // offsetLeft is relative to the positioned container (the nav is
      // `relative`), so this stays correct while the strip scrolls
      // horizontally (overflow-x-auto).
      setRect({ left: el.offsetLeft, width: el.offsetWidth });
    };

    measure();
    // Enable the transition only after the first successful placement so
    // the pill doesn't fly in from 0,0 on mount.
    const raf = requestAnimationFrame(() => setAnimated(true));

    // Re-measure when the active item resizes (e.g. the Home approvals
    // badge appears) or the container reflows (window resize, font load).
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    const active = container.querySelector<HTMLElement>(
      '[data-nav-pill-active="true"]',
    );
    if (active) ro.observe(active);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [containerRef, activeKey]);

  if (!rect) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="nav-glide-pill"
      className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-7 rounded-full bg-gold/15 border border-gold/30 shadow-sm shadow-gold/10"
      style={{
        left: rect.left,
        width: rect.width,
        transition: animated
          ? "left 300ms cubic-bezier(0.4, 0, 0.2, 1), width 300ms cubic-bezier(0.4, 0, 0.2, 1)"
          : "none",
      }}
    />
  );
}
