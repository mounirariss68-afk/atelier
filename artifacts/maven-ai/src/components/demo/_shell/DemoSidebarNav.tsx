import type { ReactNode } from "react";

export interface DemoNavItem<K extends string = string> {
  id: K;
  icon: ReactNode;
  label: string;
  /** Optional badge text (e.g. "AI", "NEW") rendered on the right. */
  badge?: string;
  badgeTone?: "ai" | "new" | "count";
}

export interface DemoSidebarNavProps<K extends string = string> {
  items: DemoNavItem<K>[];
  activeId: K;
  onSelect: (id: K) => void;
  /** Brand accent used for the active state. */
  accent: string;
  /** When true, hide labels and just render icons. */
  collapsed?: boolean;
  /** Visual style of the active row. */
  variant?: "fill" | "border" | "tint";
  /** Surface color (white sidebar vs navy sidebar). */
  surface?: "white" | "navy";
  /** Font-size of the row label. Defaults to 12px. */
  fontSize?: 12 | 13;
}

/**
 * Vertical list of nav buttons used inside a demo sidebar. Three visual
 * variants cover the patterns used by the 10 user-facing demos:
 *  - "fill"   : full accent background on the active row (most common).
 *  - "border" : transparent row with accent left-border + tint (procurement/sama).
 *  - "tint"   : tinted background on the active row (tender-response-studio).
 */
export default function DemoSidebarNav<K extends string = string>({
  items, activeId, onSelect, accent, collapsed = false, variant = "fill", surface = "white", fontSize = 12,
}: DemoSidebarNavProps<K>) {
  return (
    <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
      {items.map((n) => {
        const active = n.id === activeId;
        const baseText = surface === "navy" ? "text-white/70 hover:text-white hover:bg-white/5" : "text-gray-600 hover:bg-gray-50";
        let style: React.CSSProperties | undefined;
        let cls = `w-full flex items-center gap-3 px-3 py-2 rounded-lg font-semibold transition-colors text-[${fontSize}px] `;
        if (active) {
          if (variant === "fill") { style = { background: accent }; cls += "text-white"; }
          else if (variant === "border") {
            style = {
              background: `${accent}0D`,
              color: accent,
              borderInlineStartWidth: 3,
              borderInlineStartStyle: "solid",
              borderInlineStartColor: accent,
            };
            cls += "";
          } else {
            style = { background: `${accent}1A`, color: accent };
            cls += "";
          }
        } else {
          cls += baseText;
          if (variant === "border") {
            style = { borderInlineStartWidth: 3, borderInlineStartStyle: "solid", borderInlineStartColor: "transparent" };
          }
        }
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => onSelect(n.id)}
            className={cls}
            style={style}
            title={n.label}
          >
            <span className="flex-shrink-0">{n.icon}</span>
            {!collapsed && <span className="flex-1 truncate text-start">{n.label}</span>}
            {!collapsed && n.badge && (
              <span
                className="text-[9px] font-extrabold px-1.5 py-0.5 rounded"
                style={
                  active
                    ? { background: variant === "fill" ? "rgba(255,255,255,0.25)" : `${accent}33`, color: variant === "fill" ? "white" : accent }
                    : n.badgeTone === "new"
                      ? { background: "#10B981", color: "white" }
                      : { background: "#C45BB8", color: "white" }
                }
              >
                {n.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
