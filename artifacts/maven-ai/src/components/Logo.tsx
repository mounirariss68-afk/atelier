import logoSrc from "@/assets/maven-ai-logo.png";

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

  return (
    <img
      src={logoSrc}
      alt="Maven AI"
      height={h}
      style={{ height: h, width: "auto", mixBlendMode: "screen" }}
      className={`select-none ${className}`}
      draggable={false}
    />
  );
}
