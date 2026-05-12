import * as React from "react";
import { cn } from "@/lib/utils";
import { PlmStage, AgentActivityItemConfidence } from "@workspace/api-client-react";

export const Eyebrow = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(({ className, children, ...props }, ref) => (
  <span ref={ref} className={cn("eyebrow", className)} {...props}>
    {children}
  </span>
));
Eyebrow.displayName = "Eyebrow";

export const GoldRule = () => <span className="gold-rule" />;

export const SectionHead = ({ eyebrow, headline, lede, className }: { eyebrow?: React.ReactNode, headline: React.ReactNode, lede?: React.ReactNode, className?: string }) => (
  <div className={cn("space-y-4", className)}>
    {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
    <h2 className="headline">{headline}</h2>
    {lede && <p className="lede">{lede}</p>}
  </div>
);

/**
 * Full-width navy band that contains the page-level header (eyebrow +
 * headline, optional back link, optional right-aligned meta). Lives at
 * the top of every workspace page and breaks out of the cream body
 * surface defined by `.page-light` on <main>.
 */
export const PageHero = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn("page-hero", className)}>
    <div className="container-atelier">
      {children}
    </div>
  </div>
);

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { flat?: boolean }>(({ className, flat, ...props }, ref) => (
  <div ref={ref} className={cn(flat ? "card-flat" : "card", className)} {...props} />
));
Card.displayName = "Card";

export const PillButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }>(({ className, variant = "primary", ...props }, ref) => (
  <button ref={ref} className={cn("pill-btn", variant === "primary" ? "pill-btn-primary" : "pill-btn-ghost", className)} {...props} />
));
PillButton.displayName = "PillButton";

export const PlmPill = ({ stage, className }: { stage: PlmStage, className?: string }) => {
  return (
    <span className={cn("plm-pill", className)}>
      {stage.replace("_", " ")}
    </span>
  );
};

export const MonoChip = ({ children, tone = "default", className }: { children: React.ReactNode, tone?: "default" | "gold" | "green" | "amber" | "red", className?: string }) => {
  return (
    <span className={cn("mono-chip", tone !== "default" && tone, className)}>
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
