import type { ReactNode } from "react";

export interface DemoBrandBlockProps {
  /** Two-letter logo block (e.g. "KC", "EP"). Ignored when `icon` is set. */
  initials?: string;
  /** Custom icon to render in the logo square instead of `initials`. */
  icon?: ReactNode;
  /** Bilingual platform title already resolved for the active lang. */
  title: string;
  subtitle?: string;
  /** Background color of the logo square. */
  accent: string;
  /** Foreground (ink) color used for the title. */
  ink?: string;
  /** When true, hide the title/subtitle text (collapsed sidebar). */
  collapsed?: boolean;
  /** Optional override for the surface background (e.g. white vs navy). */
  surface?: "white" | "navy";
}

/** Brand block at the top of a demo sidebar: logo square + title + subtitle. */
export default function DemoBrandBlock({
  initials,
  icon,
  title,
  subtitle,
  accent,
  ink = "#0A1230",
  collapsed = false,
  surface = "white",
}: DemoBrandBlockProps) {
  const titleColor = surface === "navy" ? "#FFFFFF" : ink;
  const subColor = surface === "navy" ? "rgba(255,255,255,0.6)" : "#6B7280";
  return (
    <div
      className="px-4 py-4 flex items-center gap-2 border-b"
      style={{ minHeight: 56, borderColor: surface === "navy" ? "rgba(255,255,255,0.1)" : "#F3F4F6" }}
    >
      <div
        className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center text-white font-extrabold text-xs"
        style={{ background: accent }}
      >
        {icon ?? initials}
      </div>
      {!collapsed && (
        <div className="min-w-0">
          {subtitle && surface === "navy" ? (
            <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: subColor }}>{subtitle}</p>
          ) : null}
          <p className="text-[12px] font-extrabold leading-tight truncate" style={{ color: titleColor }}>{title}</p>
          {subtitle && surface !== "navy" && (
            <p className="text-[10px] truncate" style={{ color: subColor }}>{subtitle}</p>
          )}
        </div>
      )}
    </div>
  );
}
