/**
 * Task #211 — Coverage staleness warning appears/disappears at the right times.
 *
 * The Critical buyer-role coverage block (Task #209) shows an amber "stale"
 * chip plus a re-run banner when the last Executive Mapper sweep is >= 30
 * days old, and clears both for fresher runs. After a Mapper run, the
 * coverage query ["atelier-exec-mapper-coverage", accountId] must be
 * invalidated so a fresh run clears the warning.
 *
 * Vitest is not installed in the atelier artifact; this follows the
 * test:board-layer pattern (renderToStaticMarkup under tsx). Run with:
 *
 *   pnpm --filter @workspace/atelier test:coverage-staleness
 *
 * Exits non-zero if any assertion fails.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CriticalRoleCoverageBlock, notifyExecutiveMapperSettled } from "./Account";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass++;
      console.log(`  \u2713 ${name}`);
    })
    .catch((err) => {
      fail++;
      console.error(
        `  \u2717 ${name}\n      ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ACCOUNT_ID = "acc_stale_test";
const COVERAGE_KEY = ["atelier-exec-mapper-coverage", ACCOUNT_ID];
const DAY = 86_400_000;

const coverage = [
  {
    role: "economic_buyer",
    label: "Economic buyer",
    found: true,
    personName: "Erin Buyer",
    title: "CFO",
    confidence: "verified" as const,
  },
  {
    role: "champion",
    label: "Champion",
    found: false,
    personName: null,
    title: null,
    confidence: null,
  },
];

function renderWithRunAt(runAt: string | null): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  qc.setQueryData(COVERAGE_KEY, { runId: "run_1", runAt, coverage });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <CriticalRoleCoverageBlock accountId={ACCOUNT_ID} />
    </QueryClientProvider>,
  );
  qc.clear();
  return html;
}

// Offset by an extra hour inside the target day so Math.floor lands exactly
// on the intended day count regardless of when the test runs.
const runAt29d = new Date(Date.now() - 29 * DAY - 3_600_000).toISOString();
const runAt30d = new Date(Date.now() - 30 * DAY - 3_600_000).toISOString();
const runAtToday = new Date(Date.now() - 3_600_000).toISOString();

async function main(): Promise<void> {
  console.log("CriticalRoleCoverageBlock \u2014 staleness warning");

  await test("today's sweep: age chip says 'today', no stale chip, no banner", () => {
    const html = renderWithRunAt(runAtToday);
    assert(html.includes('data-testid="chip-coverage-age"'), "expected the age chip");
    assert(html.includes(">today<"), "expected the age chip to read 'today'");
    assert(!html.includes('data-testid="chip-coverage-stale"'), "stale chip must NOT render");
    assert(
      !html.includes('data-testid="banner-coverage-rerun-nudge"'),
      "re-run banner must NOT render",
    );
  });

  await test("29-day-old sweep: still fresh — no stale chip, no banner", () => {
    const html = renderWithRunAt(runAt29d);
    assert(html.includes(">29d ago<"), "expected the age chip to read '29d ago'");
    assert(!html.includes('data-testid="chip-coverage-stale"'), "stale chip must NOT render at 29d");
    assert(
      !html.includes('data-testid="banner-coverage-rerun-nudge"'),
      "re-run banner must NOT render at 29d",
    );
  });

  await test("30-day-old sweep: stale chip AND re-run banner appear", () => {
    const html = renderWithRunAt(runAt30d);
    assert(html.includes(">30d ago<"), "expected the age chip to read '30d ago'");
    assert(
      html.includes('data-testid="chip-coverage-stale"'),
      "stale chip MUST render at exactly 30d (threshold is >= 30)",
    );
    assert(
      html.includes("stale — executives may have moved"),
      "expected the stale chip copy",
    );
    assert(
      html.includes('data-testid="banner-coverage-rerun-nudge"'),
      "re-run banner MUST render at 30d",
    );
    assert(
      html.includes('data-testid="button-map-executives"'),
      "banner must carry the Map executives button",
    );
  });

  await test("30-day age chip is amber; fresh age chip is not", () => {
    const stale = renderWithRunAt(runAt30d);
    const fresh = renderWithRunAt(runAt29d);
    const chipOpen = (html: string): string => {
      const idx = html.indexOf('data-testid="chip-coverage-age"');
      assert(idx !== -1, "age chip missing");
      return html.slice(html.lastIndexOf("<", idx), idx);
    };
    assert(chipOpen(stale).includes("amber"), "stale age chip must be amber-toned");
    assert(!chipOpen(fresh).includes("amber"), "fresh age chip must not be amber-toned");
  });

  await test("no runAt: block renders coverage but no age chip or banner", () => {
    const html = renderWithRunAt(null);
    assert(
      html.includes('data-testid="block-critical-role-coverage"'),
      "coverage block should still render",
    );
    assert(!html.includes('data-testid="chip-coverage-age"'), "no age chip without runAt");
    assert(
      !html.includes('data-testid="banner-coverage-rerun-nudge"'),
      "no banner without runAt",
    );
  });

  // Task #868 — the sweep is now followed via the SHARED workspace status
  // (account.executiveMapperStatus). When the page-level watcher sees the
  // status settle, it calls notifyExecutiveMapperSettled with the detail.
  await test("a successful Mapper settle invalidates the coverage query", () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    qc.setQueryData(COVERAGE_KEY, { runId: "run_old", runAt: runAt30d, coverage });
    assert(
      qc.getQueryState(COVERAGE_KEY)?.isInvalidated === false,
      "precondition: coverage query starts un-invalidated",
    );

    const toasts: unknown[] = [];
    notifyExecutiveMapperSettled({
      s: {
        status: "succeeded",
        phase: null,
        error: null,
        proposedCount: 2,
        openQuestions: [],
      },
      accountId: ACCOUNT_ID,
      qc,
      toast: ((t: unknown) => {
        toasts.push(t);
        return { id: "t1", dismiss: () => {}, update: () => {} };
      }) as never,
    });

    assert(
      qc.getQueryState(COVERAGE_KEY)?.isInvalidated === true,
      "coverage query must be invalidated after a Mapper run",
    );
    const first = toasts[0] as { title?: string; variant?: string } | undefined;
    assert(
      first !== undefined && first.variant !== "destructive",
      "run should succeed (non-destructive toast)",
    );
    assert(
      (first as { title?: string }).title === "2 executive updates proposed",
      "toast should carry the proposed count",
    );
    qc.clear();
  });

  await test("a failed Mapper settle does NOT invalidate the coverage query", () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    qc.setQueryData(COVERAGE_KEY, { runId: "run_old", runAt: runAt30d, coverage });

    const toasts: Array<{ variant?: string }> = [];
    notifyExecutiveMapperSettled({
      s: {
        status: "failed",
        phase: null,
        error: "boom",
        proposedCount: null,
        openQuestions: [],
      },
      accountId: ACCOUNT_ID,
      qc,
      toast: ((t: { variant?: string }) => {
        toasts.push(t);
        return { id: "t1", dismiss: () => {}, update: () => {} };
      }) as never,
    });

    assert(
      qc.getQueryState(COVERAGE_KEY)?.isInvalidated === false,
      "coverage query must stay un-invalidated when the run fails",
    );
    assert(
      toasts.some((t) => t.variant === "destructive"),
      "expected a destructive toast on failure",
    );
    qc.clear();
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
