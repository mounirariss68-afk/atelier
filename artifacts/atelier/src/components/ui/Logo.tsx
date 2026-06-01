import lockupSrc from "@/assets/cognirise-logo.png";
import lockupLightSrc from "@/assets/cognirise-logo-light.png";
import markSrc from "@/assets/cognirise-mark.png";

interface LogoProps {
  /** "lockup" = full wordmark with a light tint (use on navy surfaces);
   *  "lockup-light" = full wordmark in navy ink (use on light/white surfaces
   *  such as reports, exported documents and print);
   *  "mark" = gradient CR glyph only (reads on any background). */
  variant?: "lockup" | "lockup-light" | "mark";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const heights = {
  sm: 32,
  md: 44,
  lg: 72,
};

/** Cognirise logo. The lockup carries a light wordmark tuned for the navy
 *  brand surfaces (TopNav). The lockup-light carries a navy wordmark for light
 *  surfaces. The mark is a transparent gradient glyph that stays legible on
 *  light surfaces (SignIn). */
export default function Logo({
  variant = "lockup",
  size = "md",
  className = "",
}: LogoProps) {
  const h = heights[size];
  const src =
    variant === "mark"
      ? markSrc
      : variant === "lockup-light"
        ? lockupLightSrc
        : lockupSrc;
  return (
    <img
      src={src}
      alt="Cognirise"
      height={h}
      style={{ height: h, width: "auto" }}
      className={`select-none ${className}`}
      draggable={false}
    />
  );
}
