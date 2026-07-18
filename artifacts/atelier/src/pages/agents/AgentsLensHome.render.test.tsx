/**
 * Render probe for the honest Agents Lens dashboard (Task #117).
 *
 * Stubs fetch so all data hooks resolve empty, then server-renders the
 * page and asserts:
 *  1. it renders without throwing,
 *  2. telemetry panels show explicit "no telemetry" / no-data states,
 *  3. no fabricated metric strings (latency ms, $ costs, SLO %) appear.
 *
 * Run: npx tsx --tsconfig tsconfig.test.json src/pages/agents/AgentsLensHome.render.test.tsx
 */
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

// Stub fetch before importing the page: every API call returns empty.
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.includes("/agents-lens/") ? { items: [] } : [];
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

const { default: AgentsLensHome } = await import("./AgentsLensHome");

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const html = renderToString(
  <QueryClientProvider client={client}>
    <Router ssrPath="/agents">
      <AgentsLensHome />
    </Router>
  </QueryClientProvider>,
);

let failures = 0;
function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok  - ${name}`);
  } else {
    failures++;
    console.error(`FAIL - ${name}`);
  }
}

check("page renders", html.includes("agents-dashboard"));
check("no-telemetry KPI tile present", html.includes("kpi-run-telemetry-no-data"));
check("eval KPI shows no-data state", html.includes("kpi-eval-pass-no-data"));
check("runs KPI shows no-data state", html.includes("kpi-runs-30d-no-data"));
check("reliability panel is honest placeholder", html.includes("No run telemetry yet") || html.includes("isn&#x27;t collected yet"));
check("cost panel is honest placeholder", html.includes("agents-cost-no-telemetry"));
check("no fabricated latency values", !/\d+ms/.test(html));
check("no fabricated dollar values", !/\$\d/.test(html));
check("no fabricated SLO burn", !html.includes("SLO burn (30d)"));

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All render checks passed.");
