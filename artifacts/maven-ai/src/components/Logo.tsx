interface LogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizes = {
  sm: { wordmark: 28, sub: 11, subTracking: "0.45em" },
  md: { wordmark: 36, sub: 14, subTracking: "0.5em" },
  lg: { wordmark: 56, sub: 22, subTracking: "0.55em" },
};

export default function Logo({ size = "md", className = "" }: LogoProps) {
  const s = sizes[size];
  const triangleSize = s.wordmark * 0.32;

  return (
    <div className={`inline-flex flex-col items-start leading-none select-none ${className}`}>
      <div className="relative inline-block">
        <svg
          width={triangleSize}
          height={triangleSize * 0.85}
          viewBox="0 0 24 20"
          className="absolute"
          style={{
            top: -triangleSize * 0.55,
            left: `calc(60% - ${triangleSize / 2}px)`,
          }}
          aria-hidden="true"
        >
          <polygon points="12,0 24,20 0,20" fill="#E97132" />
        </svg>
        <span
          className="block text-white"
          style={{
            fontFamily: "'Anton', 'Impact', 'Arial Narrow', sans-serif",
            fontSize: s.wordmark,
            letterSpacing: "0.02em",
            lineHeight: 0.92,
          }}
        >
          maven
        </span>
      </div>
      <span
        className="block text-white mt-0.5"
        style={{
          fontFamily: "'Anton', 'Impact', 'Arial Narrow', sans-serif",
          fontSize: s.sub,
          letterSpacing: s.subTracking,
          lineHeight: 1,
          paddingLeft: "0.1em",
        }}
      >
        AI
      </span>
    </div>
  );
}
