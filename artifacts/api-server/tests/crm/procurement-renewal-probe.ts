/**
 * Task #732 — procurement renewal reminder probe (offline, no LLM).
 *
 * Asserts, on an isolated scratch DB:
 *   1. Cadence parsing: annual / N years / N months parse; vague text → null.
 *   2. Scan: status renewal_due → high-priority "due" Pane A item targeted at
 *      the partner owner (founding partners when unowned); re-run idempotent.
 *   3. Scan: registered + parseable cadence anchored past the window →
 *      "approaching" item with a computed renewal date; freshly registered →
 *      no item; archived account → no item.
 *   4. Bucket transition: approaching → renewal_due resolves the stale
 *      approaching item when the due item is emitted (no duplicates).
 *   5. PATCH semantics: a notes-only PATCH must NOT move statusUpdatedAt
 *      (the renewal anchor); a status PATCH does. Moving out of renewal_due
 *      resolves open reminder items; moving into it emits one.
 *
 * Run: pnpm exec tsx tests/crm/procurement-renewal-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const GUIDE = {
  jurisdiction: "saudi_gov",
  summary: "Etimad registration",
  channel: { name: "Etimad", type: "government_portal", portalUrl: "https://etimad.sa" },
  steps: [],
  requiredInformation: [],
  requiredDocuments: [],
  renewal: "Annual profile revalidation",
  sources: [{ url: "https://etimad.sa" }],
  confidence: "green",
};

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts, atelierPaneAItems } = D;
  const { eq, like, and, isNull } = await import("drizzle-orm");
  const R = await import("../../src/lib/atelier-procurement-renewal.js");
  const {
    parseRenewalCadenceMonths,
    evaluateProcurementRenewal,
    runProcurementRenewalScan,
    resolveProcurementRenewalPaneItems,
    PROCUREMENT_RENEWAL_PANE_PREFIX,
  } = R;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  // ---- 1. pure cadence parsing ----
  check("annual → 12", parseRenewalCadenceMonths("Annual profile revalidation") === 12);
  check("every 2 years → 24", parseRenewalCadenceMonths("every 2 years") === 24);
  check("6 months → 6", parseRenewalCadenceMonths("valid for 6 months") === 6);
  check("vague text → null", parseRenewalCadenceMonths("renew when notified") === null);
  check(
    "renewal_due → due bucket",
    evaluateProcurementRenewal({ procurement: { status: "renewal_due" } as any })?.bucket === "due",
  );
  const elevenMonthsAgo = new Date(Date.now() - 335 * 86400_000).toISOString();
  check(
    "registered 11mo ago + annual → approaching",
    evaluateProcurementRenewal({
      procurement: {
        status: "registered",
        statusUpdatedAt: elevenMonthsAgo,
        guide: { renewal: "annual" },
      } as any,
    })?.bucket === "approaching",
  );
  check(
    "freshly registered annual → no finding",
    evaluateProcurementRenewal({
      procurement: {
        status: "registered",
        statusUpdatedAt: new Date().toISOString(),
        guide: { renewal: "annual" },
      } as any,
    }) === null,
  );

  const runTag = `procren_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const acctDue = `acct_${runTag}_due`;
  const acctAppr = `acct_${runTag}_appr`;
  const acctFresh = `acct_${runTag}_fresh`;
  const acctArch = `acct_${runTag}_arch`;
  const acctPatch = `acct_${runTag}_patch`;
  const allAccts = [acctDue, acctAppr, acctFresh, acctArch, acctPatch];

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${fpId}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };
  const paneItems = async (acctId: string) =>
    db
      .select()
      .from(atelierPaneAItems)
      .where(
        and(
          like(atelierPaneAItems.id, `${PROCUREMENT_RENEWAL_PANE_PREFIX}${acctId}_%`),
          isNull(atelierPaneAItems.resolvedAt),
        ),
      );
  // Fire-and-forget PATCH hooks settle async — poll briefly.
  const waitFor = async (fn: () => Promise<boolean>, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  try {
    await db.insert(atelierUsers).values({
      id: fpId,
      orgId: "aico",
      name: "Renewal Probe FP",
      initials: "RP",
      email: `${runTag}-fp@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    const baseAcct = (id: string, extra: Record<string, unknown>) => ({
      id,
      orgId: "aico",
      name: `Renewal Probe ${id}`,
      country: "Saudi Arabia",
      sector: "Government",
      tier: "B",
      partnerOwnerId: fpId,
      ...extra,
    });
    await db.insert(atelierAccounts).values([
      baseAcct(acctDue, { procurement: { status: "renewal_due", guide: GUIDE } }),
      baseAcct(acctAppr, {
        procurement: { status: "registered", statusUpdatedAt: elevenMonthsAgo, guide: GUIDE },
      }),
      baseAcct(acctFresh, {
        procurement: {
          status: "registered",
          statusUpdatedAt: new Date().toISOString(),
          guide: GUIDE,
        },
      }),
      baseAcct(acctArch, {
        status: "archived",
        procurement: { status: "renewal_due", guide: GUIDE },
      }),
      baseAcct(acctPatch, {
        procurement: { status: "registered", statusUpdatedAt: elevenMonthsAgo, guide: GUIDE },
      }),
    ] as any);

    // ---- 2–3. scan buckets ----
    for (const id of [acctDue, acctAppr, acctFresh, acctArch]) {
      await runProcurementRenewalScan({ accountId: id, sendEmails: false });
    }
    const dueItems = await paneItems(acctDue);
    check(
      "renewal_due → one high 'due' item for the partner owner",
      dueItems.length === 1 &&
        dueItems[0]!.userId === fpId &&
        dueItems[0]!.priority === "high" &&
        dueItems[0]!.hrefKind === "account" &&
        dueItems[0]!.hrefTargetId === acctDue,
      dueItems,
    );
    const apprItems = await paneItems(acctAppr);
    check(
      "registered+cadence past window → medium 'approaching' item with date",
      apprItems.length === 1 &&
        apprItems[0]!.priority === "medium" &&
        /\d{4}-\d{2}-\d{2}/.test(apprItems[0]!.dueLabel),
      apprItems,
    );
    check("freshly registered → no item", (await paneItems(acctFresh)).length === 0);
    check("archived account → no item", (await paneItems(acctArch)).length === 0);
    const rerun = await runProcurementRenewalScan({ accountId: acctDue, sendEmails: false });
    check("idempotent re-run emits 0", rerun.emitted === 0, rerun);

    // ---- 4. approaching → due transition resolves the stale bucket ----
    await db
      .update(atelierAccounts)
      .set({ procurement: { status: "renewal_due", guide: GUIDE } as any })
      .where(eq(atelierAccounts.id, acctAppr));
    await runProcurementRenewalScan({ accountId: acctAppr, sendEmails: false });
    const afterTransition = await paneItems(acctAppr);
    check(
      "approaching→due leaves exactly one open item (the due one)",
      afterTransition.length === 1 && afterTransition[0]!.id.includes("_due_"),
      afterTransition,
    );

    // ---- 5. PATCH semantics ----
    const before = await db
      .select({ procurement: atelierAccounts.procurement })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acctPatch));
    const anchorBefore = (before[0]!.procurement as any).statusUpdatedAt;
    const notesPatch = await api("PATCH", `/accounts/${acctPatch}/procurement`, {
      statusNotes: "Chased the supplier-registration desk again.",
    });
    check("notes-only PATCH → 200", notesPatch.status === 200, notesPatch);
    check(
      "notes-only PATCH does NOT move the renewal anchor",
      notesPatch.body?.procurement?.statusUpdatedAt === anchorBefore,
      notesPatch.body?.procurement,
    );
    const statusPatch = await api("PATCH", `/accounts/${acctPatch}/procurement`, {
      status: "renewal_due",
    });
    check(
      "status PATCH moves the anchor",
      statusPatch.status === 200 &&
        statusPatch.body?.procurement?.statusUpdatedAt !== anchorBefore,
      statusPatch.body?.procurement,
    );
    check(
      "PATCH into renewal_due emits a reminder",
      await waitFor(async () => (await paneItems(acctPatch)).length === 1),
      await paneItems(acctPatch),
    );
    const outPatch = await api("PATCH", `/accounts/${acctPatch}/procurement`, {
      status: "registered",
    });
    check("PATCH back to registered → 200", outPatch.status === 200, outPatch);
    check(
      "PATCH out of renewal_due resolves the reminder",
      await waitFor(async () => (await paneItems(acctPatch)).length === 0),
      await paneItems(acctPatch),
    );
    // direct resolve helper is idempotent
    check(
      "resolve helper on clean account → 0",
      (await resolveProcurementRenewalPaneItems(acctPatch)) === 0,
    );
  } finally {
    try {
      for (const id of allAccts) {
        await db
          .delete(atelierPaneAItems)
          .where(like(atelierPaneAItems.id, `${PROCUREMENT_RENEWAL_PANE_PREFIX}${id}_%`));
        await db.delete(atelierAccounts).where(eq(atelierAccounts.id, id));
      }
      await db.delete(atelierUsers).where(eq(atelierUsers.id, fpId));
    } catch (err) {
      console.error("cleanup failed", err);
    }
    server.close();
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll procurement renewal checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
