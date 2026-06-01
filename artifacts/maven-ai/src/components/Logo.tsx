import logoSrc from "@/assets/cognirise-logo.png";
import logoLightSrc from "@/assets/cognirise-logo-light.png";
import { useLang, tStr } from "@/lib/lang";

interface LogoProps {
  /** "primary" = white wordmark tuned for dark/navy surfaces (navbar, footer).
   *  "light" = navy wordmark for light/white surfaces (reports, memos, print). */
  variant?: "primary" | "light";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const heights = {
  sm: 40,
  md: 56,
  lg: 96,
};

export default function Logo({ variant = "primary", size = "md", className = "" }: LogoProps) {
  const h = heights[size];
  const { lang } = useLang();
  const alt = tStr({ en: "Cognirise", ar: "Cognirise · كوجنيرايز", tr: "Cognirise" }, lang);

  return (
    <img
      src={variant === "light" ? logoLightSrc : logoSrc}
      alt={alt}
      height={h}
      style={{ height: h, width: "auto" }}
      className={`select-none ${className}`}
      draggable={false}
    />
  );
}
