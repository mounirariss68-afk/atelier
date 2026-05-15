/**
 * Atelier — Codex clause detail page (Task #512).
 *
 * Shows one clause-library entry: title, family + version, status,
 * risk tier, jurisdiction tags, instrument types, and full body. The
 * chat/CLI is the write surface (publish / retire flow through the
 * `codex.clause_publish` capability).
 */

import * as React from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  PageHero,
  BackLink,
  SectionHead,
  Card,
  MonoChip,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Library } from "lucide-react";

const API = "/api/atelier";

interface Clause {
  id: string;
  family: string;
  title: string;
  version: number;
  status: string;
  riskTier: string;
  jurisdictionTags: string[];
  instrumentTypes: string[];
  body: string;
  publishedAt: string | null;
  updatedAt: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

const STATUS_TONE: Record<
  string,
  "default" | "gold" | "green" | "amber" | "red"
> = {
  draft: "default",
  published: "green",
  retired: "default",
};

export default function CodexClause() {
  const [, params] = useRoute("/codex/clauses/:id");
  const id = params?.id ?? "";
  const cl = useQuery({
    queryKey: ["codex", "clause", id],
    queryFn: () => fetchJson<Clause>(`/codex/clauses/${id}`),
    enabled: !!id,
  });

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/codex/clauses">All clauses</BackLink>
        <SectionHead
          eyebrow="Firm · Codex · Clause"
          headline={
            cl.isLoading ? "Loading…" : cl.data?.title ?? "Clause not found"
          }
          lede={
            cl.data
              ? `${cl.data.family} · v${cl.data.version}`
              : undefined
          }
        />
      </PageHero>

      <div className="container-atelier py-8 space-y-6">
        {cl.error && (
          <Card className="p-6 border border-danger/40 bg-danger/5 text-sm">
            <div className="font-semibold text-danger">Clause unavailable</div>
            <div className="text-[11px] font-mono text-text-mute mt-1 break-all">
              {String(cl.error)}
            </div>
          </Card>
        )}
        {cl.isLoading && <Skeleton className="h-64 bg-bg-elevate" />}
        {cl.data && (
          <>
            <Card className="p-6 space-y-4" data-testid="clause-detail">
              <div className="flex items-center gap-2 flex-wrap">
                <Library className="w-4 h-4 text-gold" />
                <MonoChip tone={STATUS_TONE[cl.data.status] ?? "default"}>
                  {cl.data.status}
                </MonoChip>
                <MonoChip
                  tone={
                    cl.data.riskTier === "high"
                      ? "red"
                      : cl.data.riskTier === "medium"
                        ? "amber"
                        : "default"
                  }
                >
                  {cl.data.riskTier} risk
                </MonoChip>
                {cl.data.jurisdictionTags.map((j) => (
                  <span
                    key={j}
                    className="px-1.5 py-0.5 rounded bg-bg-elevate-2 border border-border-soft text-[10px] font-mono uppercase"
                  >
                    {j}
                  </span>
                ))}
              </div>
              {cl.data.instrumentTypes.length > 0 && (
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
                    Instrument types
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {cl.data.instrumentTypes.map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded bg-bg-elevate-2 border border-border-soft text-[10px] font-mono uppercase"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="text-[11px] font-mono text-text-mute">
                Last updated {cl.data.updatedAt?.slice(0, 10)}
                {cl.data.publishedAt
                  ? ` · published ${cl.data.publishedAt.slice(0, 10)}`
                  : ""}
              </div>
            </Card>
            <Card className="p-6">
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-2">
                Body
              </div>
              <div className="text-sm text-text whitespace-pre-wrap leading-relaxed">
                {cl.data.body}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
