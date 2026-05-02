import type { AssessmentSlug, Industry } from "./types";

export interface PeerBenchmark {
  median: number;
  p25: number;
  p75: number;
}

const DEFAULTS: Record<AssessmentSlug, PeerBenchmark> = {
  ari: { median: 2.4, p25: 1.8, p75: 3.1 },
  mvi: { median: 2.6, p25: 2.0, p75: 3.3 },
  dafi: { median: 2.7, p25: 2.0, p75: 3.4 },
  uvr: { median: 3.2, p25: 2.6, p75: 3.8 },
};

const INDUSTRY_OFFSET: Record<Industry, number> = {
  "public-sector": -0.2,
  telecommunications: 0.4,
  "financial-services": 0.5,
  "energy-commodities": 0.1,
  "retail-consumer": -0.05,
  "travel-hospitality": -0.15,
  automotive: -0.1,
  healthcare: -0.1,
  manufacturing: 0.0,
  other: 0,
};

export function getPeerBenchmark(
  slug: AssessmentSlug,
  industry: Industry,
  dimensions: string[]
): Record<string, number> {
  const base = DEFAULTS[slug];
  const offset = INDUSTRY_OFFSET[industry] ?? 0;
  const out: Record<string, number> = {
    overall: clamp(base.median + offset),
    "overall.p25": clamp(base.p25 + offset),
    "overall.p75": clamp(base.p75 + offset),
  };
  for (const id of dimensions) {
    const seed = stringHash(slug + id) % 10;
    const dimOffset = (seed - 5) / 25;
    out[id] = clamp(base.median + offset + dimOffset);
  }
  return out;
}

function clamp(n: number): number {
  return Math.max(1, Math.min(5, +n.toFixed(2)));
}

function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
