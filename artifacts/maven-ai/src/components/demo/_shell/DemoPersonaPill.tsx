export interface DemoPersonaPillProps {
  initials: string;
  name: string;
  role: string;
  /** Background color for the avatar circle. Defaults to BRAND. */
  bg?: string;
  /** Foreground color for avatar text. Defaults to white. */
  fg?: string;
  /** Foreground color for the name line. Defaults to BRAND_INK. */
  ink?: string;
  /** When true, wrap the pill in the translucent navy-header background. */
  surface?: "white" | "navy";
  /** Hide the name/role on small viewports. Defaults to true. */
  hideMetaOnSmall?: boolean;
}

/** Round avatar + name + role used in the topbar/header of every demo. */
export default function DemoPersonaPill({
  initials, name, role, bg = "#5B7CFF", fg = "#FFFFFF", ink = "#0A1230", surface = "white", hideMetaOnSmall = true,
}: DemoPersonaPillProps) {
  if (surface === "navy") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: bg, color: fg }}>{initials}</div>
        <div className={`${hideMetaOnSmall ? "hidden md:block" : ""} text-xs leading-tight text-white`}>
          <div className="font-semibold">{name}</div>
          <div className="text-white/60 text-[10px]">{role}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 ps-2 border-s border-gray-200">
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: bg, color: fg }}>{initials}</div>
      <div className={hideMetaOnSmall ? "hidden md:block" : ""}>
        <p className="text-[12px] font-bold leading-tight" style={{ color: ink }}>{name}</p>
        <p className="text-[10px] text-gray-500">{role}</p>
      </div>
    </div>
  );
}
