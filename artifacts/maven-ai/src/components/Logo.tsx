import logoSrc from "@/assets/cognirise-logo.png";
import { useLang, tStr } from "@/lib/lang";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const heights = {
  sm: 40,
  md: 56,
  lg: 96,
};

export default function Logo({ size = "md", className = "" }: LogoProps) {
  const h = heights[size];
  const { lang } = useLang();
  const alt = tStr({ en: "Cognirise", ar: "Cognirise · كوجنيرايز", tr: "Cognirise" }, lang);

  return (
    <img
      src={logoSrc}
      alt={alt}
      height={h}
      style={{ height: h, width: "auto" }}
      className={`select-none ${className}`}
      draggable={false}
    />
  );
}
