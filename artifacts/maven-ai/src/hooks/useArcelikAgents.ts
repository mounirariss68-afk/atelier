import { useCallback, useState } from "react";
import type {
  AgentRecommendation,
  RecommendationAgentType,
  RecommendationSource,
} from "@/data/arcelik-agent";

export type LiveAgentType = Exclude<RecommendationAgentType, "seed">;

export const LIVE_AGENT_TYPES: LiveAgentType[] = [
  "competitive-response",
  "price-elasticity",
  "cannibalization",
  "dealer-optimization",
];

export interface AgentRunResult {
  agentType: LiveAgentType;
  generatedAt: string;
  language: "tr" | "en";
  source: RecommendationSource;
  fallbackReason?: string;
  recommendations: AgentRecommendation[];
  contextDigest?: {
    productCount: number;
    competitorCount: number;
    dealerCount: number;
    cityCount: number;
  };
}

export interface AgentRunAllResult {
  generatedAt: string;
  language: "tr" | "en";
  results: AgentRunResult[];
}

interface AgentMeta {
  lastRunAt: string | null;
  source: RecommendationSource | null;
  fallbackReason?: string;
}

const BASE = "/api/arcelik/agent";

async function postAgent<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Agent request failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function useArcelikAgents(language: "tr" | "en") {
  // Server-produced recommendations (deduped by id; latest wins per agent).
  const [serverRecs, setServerRecs] = useState<AgentRecommendation[]>([]);
  // Per-agent loading flags so each button shows its own spinner.
  const [loading, setLoading] = useState<Record<LiveAgentType, boolean>>({
    "competitive-response": false,
    "price-elasticity": false,
    "cannibalization": false,
    "dealer-optimization": false,
  });
  const [meta, setMeta] = useState<Record<LiveAgentType, AgentMeta>>({
    "competitive-response": { lastRunAt: null, source: null },
    "price-elasticity": { lastRunAt: null, source: null },
    "cannibalization": { lastRunAt: null, source: null },
    "dealer-optimization": { lastRunAt: null, source: null },
  });
  const [runAllLoading, setRunAllLoading] = useState(false);

  // Replace any existing recs from this agent type with the new ones, then prepend.
  const mergeResult = useCallback((result: AgentRunResult) => {
    setServerRecs((prev) => {
      const filtered = prev.filter((r) => r.agentType !== result.agentType);
      return [...result.recommendations, ...filtered];
    });
    setMeta((prev) => ({
      ...prev,
      [result.agentType]: {
        lastRunAt: result.generatedAt,
        source: result.source,
        fallbackReason: result.fallbackReason,
      },
    }));
  }, []);

  const runAgent = useCallback(
    async (agentType: LiveAgentType): Promise<AgentRunResult> => {
      setLoading((p) => ({ ...p, [agentType]: true }));
      try {
        const result = await postAgent<AgentRunResult>(`/${agentType}`, { language });
        mergeResult(result);
        return result;
      } finally {
        setLoading((p) => ({ ...p, [agentType]: false }));
      }
    },
    [language, mergeResult],
  );

  const runAll = useCallback(async (): Promise<AgentRunAllResult> => {
    setRunAllLoading(true);
    // Mark each individual agent as loading too.
    setLoading({
      "competitive-response": true,
      "price-elasticity": true,
      "cannibalization": true,
      "dealer-optimization": true,
    });
    try {
      const result = await postAgent<AgentRunAllResult>("/run-all", { language });
      for (const r of result.results) mergeResult(r);
      return result;
    } finally {
      setRunAllLoading(false);
      setLoading({
        "competitive-response": false,
        "price-elasticity": false,
        "cannibalization": false,
        "dealer-optimization": false,
      });
    }
  }, [language, mergeResult]);

  return {
    serverRecs,
    loading,
    runAllLoading,
    meta,
    runAgent,
    runAll,
  };
}
