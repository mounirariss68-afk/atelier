/**
 * Render probe for ConnectedAccountsCard (MS365 connected-accounts card):
 * reassuring disconnect copy, humanized lastError messages, and the
 * one-click Reconnect action shown when the connection needs attention.
 *
 * Run: npx tsx --tsconfig tsconfig.test.json src/components/ms/connected-accounts-probe.test.tsx
 */
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { getAtelierGetMyMsConnectionQueryKey } from "@workspace/api-client-react";

(globalThis as unknown as { fetch: typeof fetch }).fetch = (async () =>
  new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

const { ConnectedAccountsCard } = await import("./MsMeetings");

function render(conn: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(getAtelierGetMyMsConnectionQueryKey(), conn);
  return renderToString(
    <QueryClientProvider client={client}>
      <Router ssrPath="/me/profile">
        <ConnectedAccountsCard />
      </Router>
    </QueryClientProvider>,
  );
}

const base = {
  configured: true,
  connected: true,
  msEmail: "test@cognirise.ai",
  msDisplayName: "Test",
  connectedAt: null,
  lastSyncedAt: null,
  lastError: null,
};

const healthy = render(base);
const broken = render({ ...base, lastError: "refresh-failed" });
const consent = render({ ...base, lastError: "admin-consent-required" });
const unknown = render({ ...base, lastError: "weird-code" });

let failures = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`ok  - ${name}`);
  else {
    failures++;
    console.error(`FAIL - ${name}`);
  }
}

check("healthy: disconnect button present", healthy.includes("button-ms-disconnect"));
check("healthy: no reconnect button", !healthy.includes("button-ms-reconnect"));
check("healthy: no error banner", !healthy.includes("ms-connection-error"));
check("broken: reconnect button shown", broken.includes("button-ms-reconnect"));
check("broken: humanized refresh-failed copy", broken.includes("expired or was revoked"));
check("broken: raw code kept as detail", broken.includes("refresh-failed"));
check("broken: reconnect explanation", broken.includes("nothing else changes"));
check("broken: disconnect still available", broken.includes("button-ms-disconnect"));
check("consent: humanized admin-consent copy", consent.includes("administrator needs to approve"));
check("unknown code: generic fallback", unknown.includes("Reconnecting usually fixes this"));
check("no raw-code-as-primary", !broken.includes("Connection needs attention: refresh-failed"));
check(
  "old scary copy gone",
  !healthy.includes("delete stored tokens") && !broken.includes("delete stored tokens"),
);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All ConnectedAccountsCard checks passed.");
