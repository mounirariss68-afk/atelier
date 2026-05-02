interface LogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizes = {
  sm: { wordPx: 26, subPx: 13, triPx: 9, gapPx: 1, subTrack: "0.95em" },
  md: { wordPx: 34, subPx: 17, triPx: 11, gapPx: 1, subTrack: "1.05em" },
  lg: { wordPx: 56, subPx: 28, triPx: 18, gapPx: 2, subTrack: "1.15em" },
};

const wordmarkFamily = "'Bowlby One', 'Archivo Black', 'Impact', sans-serif";

const chiselStyle = {
  color: "#ffffff",
  WebkitTextStroke: "0.5px rgba(8, 18, 36, 0.55)",
  textShadow: [
    "0 1px 0 rgba(255,255,255,0.35)",
    "0 -1px 0 rgba(8,18,36,0.45)",
    "1px 0 0 rgba(8,18,36,0.35)",
    "-1px 0 0 rgba(255,255,255,0.18)",
    "0 3px 4px rgba(0,0,0,0.45)",
  ].join(", "),
} as const;

export default function Logo({ size = "md", className = "" }: LogoProps) {
  const s = sizes[size];

  return (
    <div
      className={`inline-flex flex-col items-stretch leading-none select-none ${className}`}
      aria-label="Maven AI"
      role="img"
    >
      {/* maven */}
      <div
        className="relative inline-flex"
        style={{
          fontFamily: wordmarkFamily,
          fontSize: s.wordPx,
          letterSpacing: "0.005em",
          lineHeight: 0.9,
        }}
      >
        <span style={chiselStyle}>m</span>
        <span style={chiselStyle}>a</span>
        <span className="relative inline-block" style={chiselStyle}>
          {/* down-pointing triangle, anchored to the v glyph */}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              top: `-${s.triPx * 0.55}px`,
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: `${s.triPx * 0.6}px solid transparent`,
              borderRight: `${s.triPx * 0.6}px solid transparent`,
              borderTop: `${s.triPx}px solid #F5A623`,
              filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))",
              pointerEvents: "none",
            }}
          />
          v
        </span>
        <span style={chiselStyle}>e</span>
        <span style={chiselStyle}>n</span>
      </div>

      {/* AI — letter-spaced so it visually fills the width of "maven" above */}
      <div
        className="flex justify-center"
        style={{
          fontFamily: wordmarkFamily,
          fontSize: s.subPx,
          lineHeight: 1,
          marginTop: s.gapPx,
          letterSpacing: s.subTrack,
          // remove the trailing letter-spacing on the right so the row stays centered
          paddingLeft: s.subTrack,
        }}
      >
        <span style={chiselStyle}>A</span>
        <span style={chiselStyle}>I</span>
      </div>
    </div>
  );
}
