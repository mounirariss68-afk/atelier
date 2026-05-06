import { ChevronLeft, ChevronRight } from "lucide-react";

export interface DemoCollapseToggleProps {
  collapsed: boolean;
  onToggle: () => void;
  isAr: boolean;
  label?: string;
}

/** Sidebar collapse/expand chevron used by every demo with a collapsible nav. */
export default function DemoCollapseToggle({ collapsed, onToggle, isAr, label }: DemoCollapseToggleProps) {
  const ChevronExpand = isAr ? ChevronLeft : ChevronRight;
  const ChevronCollapse = isAr ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-gray-500 hover:bg-gray-50"
    >
      {collapsed ? <ChevronExpand size={16} /> : <ChevronCollapse size={16} />}
      {!collapsed && label && <span>{label}</span>}
    </button>
  );
}
