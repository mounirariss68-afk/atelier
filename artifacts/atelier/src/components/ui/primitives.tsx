import * as React from "react";
import { Link } from "wouter";
import { ArrowLeft, Link2, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PlmStage, AgentActivityItemConfidence } from "@workspace/api-client-react";

export const Eyebrow = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(({ className, children, ...props }, ref) => (
  <span ref={ref} className={cn("eyebrow", className)} {...props}>
    {children}
  </span>
));
Eyebrow.displayName = "Eyebrow";

export const GoldRule = () => <span className="gold-rule" />;

/** 48×3 gold bar — Cognirise-inspired major section divider. */
export const SectionDivider = ({ className }: { className?: string }) => (
  <span className={cn("section-divider", className)} />
);

/** Mono uppercase label with a flex hairline rule on its right.
 *  Standardises the recurring "What needs me today ─────" pattern. */
export const SectionLabel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <h3 className={cn("section-label", className)}>{children}</h3>
);

export const SectionHead = ({ eyebrow, headline, lede, className }: { eyebrow?: React.ReactNode, headline: React.ReactNode, lede?: React.ReactNode, className?: string }) => (
  <div className={cn("space-y-4", className)}>
    {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
    <h2 className="headline">{headline}</h2>
    {lede && <div className="lede">{lede}</div>}
  </div>
);

/**
 * Full-width navy band that sits at the top of every workspace page.
 * Sits on the unified dark body; differentiates only with a 1px border.
 */
export const PageHero = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("page-hero", className)}>
    <div className="container-atelier">
      {children}
    </div>
  </div>
);

/** Standard back link used at the top of detail pages. */
export const BackLink = ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
  <Link
    href={href}
    className={cn(
      "inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-text-mute hover:text-gold mb-6 transition-colors",
      className,
    )}
  >
    <ArrowLeft className="w-3.5 h-3.5" /> {children}
  </Link>
);

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { flat?: boolean; hover?: boolean }>(({ className, flat, hover, ...props }, ref) => (
  <div ref={ref} className={cn(flat ? "card-flat" : "card", hover && "card-hover", className)} {...props} />
));
Card.displayName = "Card";

export const PillButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }>(({ className, variant = "primary", ...props }, ref) => (
  <button ref={ref} className={cn("pill-btn", variant === "primary" ? "pill-btn-primary" : "pill-btn-ghost", className)} {...props} />
));
PillButton.displayName = "PillButton";

/* ============================================================
   CopyLinkButton — copies a deep-link URL to the clipboard with
   a toast confirmation. Use `path` for an app-relative URL (a
   leading slash is added if missing) or `url` for a full URL.
   Optional `hash` appends a fragment anchor.
   ============================================================ */

export const CopyLinkButton = ({
  path,
  url,
  hash,
  label = "Copy link",
  toastTitle = "Link copied",
  toastDescription,
  variant = "ghost",
  className,
  iconOnly,
  "data-testid": testId,
  ...rest
}: {
  path?: string;
  url?: string;
  hash?: string;
  label?: string;
  toastTitle?: string;
  toastDescription?: string;
  variant?: "primary" | "ghost";
  className?: string;
  iconOnly?: boolean;
  "data-testid"?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className" | "children">) => {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  const buildUrl = React.useCallback(() => {
    let href: string;
    if (url) {
      href = url;
    } else {
      const p = path ?? (typeof window !== "undefined" ? window.location.pathname : "/");
      const normalized = p.startsWith("/") ? p : `/${p}`;
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      href = `${origin}${normalized}`;
    }
    if (hash) {
      const h = hash.startsWith("#") ? hash : `#${hash}`;
      href = `${href}${h}`;
    }
    return href;
  }, [url, path, hash]);

  async function copy() {
    const href = buildUrl();
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(href);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = href;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      toast({
        title: toastTitle,
        description: toastDescription ?? href,
      });
    } catch (e) {
      toast({
        title: "Copy failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "pill-btn",
        variant === "primary" ? "pill-btn-primary" : "pill-btn-ghost",
        className,
      )}
      title={label}
      aria-label={label}
      data-testid={testId ?? "btn-copy-link"}
      {...rest}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <Link2 className="w-3.5 h-3.5" />
      )}
      {!iconOnly && (
        <span className="ml-1.5">{copied ? "Copied" : label}</span>
      )}
    </button>
  );
};
CopyLinkButton.displayName = "CopyLinkButton";

export const PlmPill = ({ stage, className }: { stage: PlmStage, className?: string }) => {
  return (
    <span className={cn("plm-pill", className)}>
      {stage.replace("_", " ")}
    </span>
  );
};

export const MonoChip = ({ children, tone = "default", className, ...rest }: { children: React.ReactNode, tone?: "default" | "gold" | "green" | "amber" | "red", className?: string } & React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span className={cn("mono-chip", tone !== "default" && tone, className)} {...rest}>
      {children}
    </span>
  );
};

export const ConfidenceChip = ({ value, className }: { value: AgentActivityItemConfidence, className?: string }) => {
  if (!value) return null;
  return (
    <MonoChip tone={value} className={className}>
      {value}
    </MonoChip>
  );
};

/* ============================================================
   TabNav — shared tab bar.
   Active: 2px gold underline + bright text.
   Hover: between active and muted.
   Inactive: muted, no underline.
   Two flavours: button-driven (state) and link-driven (router).
   ============================================================ */

export const TabNav = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("tab-nav scrollbar-thin", className)}>{children}</div>
);

export const TabNavItem = ({
  active,
  onClick,
  children,
  className,
  ...rest
}: {
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children" | "className">) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? "true" : undefined}
    className={cn("tab-nav-item", active && "is-active", className)}
    {...rest}
  >
    {children}
  </button>
);

export const TabNavLink = ({ href, active, children, className, ...rest }: { href: string; active: boolean; children: React.ReactNode; className?: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children" | "className">) => (
  <Link
    href={href}
    aria-current={active ? "true" : undefined}
    className={cn("tab-nav-item", active && "is-active", className)}
    {...rest}
  >
    {children}
  </Link>
);

/* ============================================================
   HeroStat — the dominant gold figure pattern.
   Used on Opportunity (deal value), Home stat cards, Agent Profile run count.
   ============================================================ */

export const HeroStat = ({
  value,
  caption,
  size = "lg",
  className,
}: {
  value: React.ReactNode;
  caption?: React.ReactNode;
  size?: "md" | "lg" | "xl";
  className?: string;
}) => {
  const sizeClass = size === "xl"
    ? "text-5xl md:text-6xl"
    : size === "lg"
      ? "text-4xl md:text-5xl"
      : "text-3xl md:text-4xl";
  return (
    <div className={cn("space-y-2", className)}>
      <div className={cn("font-light tracking-tight text-gold leading-none", sizeClass)}>
        {value}
      </div>
      {caption && (
        <div className="text-xs font-mono uppercase tracking-widest text-text-mute flex items-center gap-2 flex-wrap">
          {caption}
        </div>
      )}
    </div>
  );
};

/* ============================================================
   OwnershipPanel — structured Partner/Lead/meta block.
   Replaces the inline mono "Partner: X / Lead: Y / Next: Z" text
   on the right side of detail-page heroes.
   ============================================================ */

export type OwnershipRow = {
  label: string;
  name?: string;
  initials?: string;
  detail?: React.ReactNode;
  /** When true, render as a small footer row (no avatar), e.g. "Next milestone". */
  meta?: boolean;
};

const initialsFor = (name?: string) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

export const OwnershipPanel = ({ rows, className }: { rows: OwnershipRow[]; className?: string }) => (
  <div
    className={cn(
      "min-w-[240px] rounded-lg border border-border bg-bg-elevate/60 backdrop-blur-sm divide-y divide-border-soft",
      className,
    )}
  >
    {rows.map((r, i) => {
      if (r.meta) {
        return (
          <div key={i} className="px-4 py-2.5 text-xs font-mono">
            <div className="uppercase tracking-widest text-text-faint">{r.label}</div>
            <div className="text-text mt-0.5">{r.name ?? r.detail}</div>
          </div>
        );
      }
      return (
        <div key={i} className="px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-bg-deep border border-gold/40 flex items-center justify-center text-[11px] font-mono text-gold shrink-0">
            {r.initials ?? initialsFor(r.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">{r.label}</div>
            <div className="text-sm text-text font-medium truncate">{r.name ?? "—"}</div>
          </div>
          {r.detail && <div className="text-xs font-mono text-text-mute shrink-0">{r.detail}</div>}
        </div>
      );
    })}
  </div>
);

/* ============================================================
   StatusCard — bordered card with a clear left content / right
   actions layout. Used for the Pursuit Scout run-status row.
   ============================================================ */

export const StatusCard = ({
  status,
  title,
  detail,
  actions,
  tone = "amber",
  className,
}: {
  status?: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: "amber" | "green" | "default";
  className?: string;
}) => {
  const toneRing =
    tone === "amber" ? "border-l-warn" :
    tone === "green" ? "border-l-success" :
    "border-l-border";
  return (
    <div
      className={cn(
        "card flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border-l-4",
        toneRing,
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {status && <div className="shrink-0">{status}</div>}
        <div className="min-w-0">
          <div className="text-sm text-text font-medium truncate">{title}</div>
          {detail && <div className="text-xs text-text-mute font-mono mt-0.5 truncate">{detail}</div>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
};

