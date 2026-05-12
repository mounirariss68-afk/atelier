import * as React from "react";

export function ConfidenceDot({ confidence }: { confidence: string | null }) {
  const c = confidence ?? "amber";
  const color =
    c === "green" ? "bg-success" : c === "red" ? "bg-danger" : "bg-warn";
  const label =
    c === "green" ? "High confidence" : c === "red" ? "Low — needs human review" : "Amber — verify";
  return (
    <span className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-text-mute">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
