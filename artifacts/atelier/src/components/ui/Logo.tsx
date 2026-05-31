import lockupSrc from "@/assets/cognirise-logo.png";
import markSrc from "@/assets/cognirise-mark.png";

interface LogoProps {
  /** "lockup" = full wordmark (use on navy surfaces); "mark" = gradient CR
   *  glyph only (reads on any background, light or dark). */
  variant?: "lockup" | "mark";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const heights = {
  sm: 32,
  md: 44,
  lg: 72,
};

/** Cognirise logo. The lockup carries a light wordmark tuned for the navy
 *  brand surfaces (TopNav). The mark is a transparent gradient glyph that
 *  stays legible on light surfaces (SignIn). */
export default function Logo({
  variant = "lockup",
  size = "md",
  className = "",
}: LogoProps) {
  const h = heights[size];
  return (
    <img
      src={variant === "mark" ? markSrc : lockupSrc}
      alt="Cognirise"
      height={h}
      style={{ height: h, width: "auto" }}
      className={`select-none ${className}`}
      draggable={false}
    />
  );
}
