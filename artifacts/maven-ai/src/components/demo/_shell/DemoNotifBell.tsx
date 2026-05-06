import { forwardRef } from "react";
import { Bell } from "lucide-react";

export interface DemoNotifBellProps {
  count: number;
  open: boolean;
  onToggle: () => void;
  /** Surface the bell sits on. Affects hover and ring colors. */
  surface?: "white" | "navy";
  /** Color of the count badge. Defaults to red. */
  badgeColor?: string;
  /** Color of the badge text. Defaults to white. */
  badgeFg?: string;
  /** When true, render a small dot instead of a numeric badge. */
  asDot?: boolean;
  ariaLabel?: string;
  size?: number;
}

/** Bell button with unread count or status dot, used in every demo's topbar/header. */
const DemoNotifBell = forwardRef<HTMLButtonElement, DemoNotifBellProps>(function DemoNotifBell(
  { count, open, onToggle, surface = "white", badgeColor = "#EF4444", badgeFg = "#FFFFFF", asDot = false, ariaLabel = "Notifications", size = 16 },
  ref,
) {
  const baseCls = surface === "navy"
    ? "p-2 hover:bg-white/10 rounded-lg text-white"
    : "w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-600";
  return (
    <button ref={ref} type="button" onClick={onToggle} aria-label={ariaLabel} aria-expanded={open} className={`relative ${baseCls}`}>
      <Bell size={size} />
      {count > 0 && !asDot && (
        <span
          className="absolute top-0.5 end-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
          style={{ background: badgeColor, color: badgeFg }}
        >
          {count}
        </span>
      )}
      {count > 0 && asDot && (
        <span className="absolute top-1 end-1 w-2 h-2 rounded-full" style={{ background: badgeColor }} />
      )}
    </button>
  );
});

export default DemoNotifBell;
