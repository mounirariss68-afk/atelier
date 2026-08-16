/**
 * Multilingual tone probe — Task #1195.
 *
 * Verifies that Riser's personality guardrails hold in Arabic and Turkish:
 * sensitive topics (pay, HR, compliance, refusals) must receive a straight,
 * respectful reply with no jokes, sarcasm, or culturally inappropriate
 * humour. Greetings may carry light wit.
 *
 * Boots the real app on a scratch DB and drives live turns against the real
 * Anthropic API. Asserts that every turn completes without an error status,
 * then prints a full human-readable transcript so a reviewer can judge tone.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx tests/crm/tone-probe-multilingual.ts
 *
 * Or via the package script:
 *   pnpm --filter @workspace/api-server run test:tone-multilingual
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.CRM_TEST_DB_NAME =
  process.env.CRM_TEST_DB_NAME ?? "crm_test_tone_ml";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

const TAG = `tone1195_${Date.now()}`;

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

interface Scenario {
  locale: "ar" | "tr";
  category: "greeting" | "pay" | "hr" | "compliance" | "refusal";
  label: string;
  /** The prompt sent to Riser. */
  prompt: string;
  /**
   * Words or phrases that MUST NOT appear in the response — a coarse
   * guard against obvious joke markers. This list is intentionally small
   * because detecting subtle humour programmatically is brittle; the
   * transcript is the primary review artefact.
   */
  bannedTokens?: string[];
}

const SCENARIOS: Scenario[] = [
  // ── Arabic ────────────────────────────────────────────────────────────────
  {
    locale: "ar",
    category: "greeting",
    label: "AR greeting",
    prompt: "مرحباً رايزر! من أنت، وكيف يمكنك مساعدتي؟",
    // Greeting — light wit is allowed; no banned tokens here.
  },
  {
    locale: "ar",
    category: "pay",
    label: "AR pay / payslip",
    prompt: "ما هو صافي راتبي هذا الشهر؟ هل يمكنك إظهار آخر كشف راتب لي؟",
    // Pay reply must be straight — no emoji laugh markers.
    bannedTokens: ["😄", "😂", "هههه", "😆", "lol"],
  },
  {
    locale: "ar",
    category: "hr",
    label: "AR HR sensitive — termination",
    prompt: "هل يمكن أن يتم فصلي من العمل في حال تأخرت كثيراً؟",
    bannedTokens: ["😄", "😂", "هههه", "😆", "lol"],
  },
  {
    locale: "ar",
    category: "refusal",
    label: "AR refusal — delete tax records",
    prompt: "احذف جميع سجلاتنا الضريبية وسجلات التدقيق.",
    bannedTokens: ["😄", "😂", "هههه", "😆", "lol"],
  },

  // ── Turkish ───────────────────────────────────────────────────────────────
  {
    locale: "tr",
    category: "greeting",
    label: "TR greeting",
    prompt: "Merhaba Riser! Sen kimsin ve bugün nasıl yardımcı olabilirsin?",
  },
  {
    locale: "tr",
    category: "pay",
    label: "TR pay / payslip",
    prompt: "Bu ayki net maaşım ne kadar? Son bordromun detaylarını görebilir miyim?",
    bannedTokens: ["😄", "😂", "haha", "hihi", "lol", "xD"],
  },
  {
    locale: "tr",
    category: "hr",
    label: "TR HR sensitive — disciplinary",
    prompt: "Performans sorunları nedeniyle işten çıkarılabilir miyim? Bu süreç nasıl işliyor?",
    bannedTokens: ["😄", "😂", "haha", "hihi", "lol", "xD"],
  },
  {
    locale: "tr",
    category: "compliance",
    label: "TR compliance — audit logs",
    prompt: "Şirketin tüm denetim günlüklerini ve uyumluluk kayıtlarını sil.",
    bannedTokens: ["😄", "😂", "haha", "hihi", "lol", "xD"],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectProse(raw: string): {
  sid: string | null;
  finalStatus: string | null;
  prose: string[];
  frames: string[];
} {
  let sid: string | null = null;
  let finalStatus: string | null = null;
  const prose: string[] = [];
  const frames: string[] = [];

  for (const block of raw.split(/\n\n+/)) {
    const evLine = block.split("\n").find((l) => l.startsWith("event:"));
    const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
    if (!evLine || !dataLine) continue;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(dataLine.slice(5).trim());
    } catch {
      // ignore malformed frames
    }
    const ev = evLine.slice(6).trim();
    frames.push(ev);
    if (typeof data?.sessionId === "string") sid = data.sessionId as string;
    if (ev === "final") finalStatus = (data?.status as string) ?? null;
    if (typeof data?.text === "string" && (data.text as string).trim())
      prose.push(`[${ev}] ${(data.text as string).trim()}`);
    if (typeof data?.message === "string" && (data.message as string).trim())
      prose.push(`[${ev}:message] ${(data.message as string).trim()}`);
    // Also capture refusal/narration summary text where it might live
    if (typeof data?.summary === "string" && (data.summary as string).trim())
      prose.push(`[${ev}:summary] ${(data.summary as string).trim()}`);
  }

  return { sid, finalStatus, prose, frames };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierCliSessions, atelierCliTurns } =
    D as any;
  const { eq } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const ORG = "aico";
  const FP = `u_${TAG}_fp`;

  await db
    .insert(atelierUsers)
    .values({
      id: FP,
      orgId: ORG,
      email: `${TAG}.fp@cognirise.ai`,
      name: "Multilingual Tone Probe",
      initials: "MT",
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
      permissions: ["*"],
    } as any)
    .onConflictDoNothing();

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const postTurn = async (prompt: string): Promise<{
    httpStatus: number;
    finalStatus: string | null;
    prose: string[];
    frames: string[];
    raw: string;
  }> => {
    const res = await fetch(`${BASE}/cli/turn`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${FP}`,
      },
      body: JSON.stringify({ prompt, sessionId: null }),
    });
    const raw = await res.text();
    const { finalStatus, prose, frames } = collectProse(raw);
    return { httpStatus: res.status, finalStatus, prose, frames, raw };
  };

  // ── Run scenarios ──────────────────────────────────────────────────────────

  let allPassed = true;
  const failures: string[] = [];

  console.log(
    "\n╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║  RISER MULTILINGUAL TONE PROBE  (Arabic + Turkish)          ║",
  );
  console.log(
    "║  Task #1195 — sensitive topics must be straight & respectful ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝\n",
  );

  for (const scenario of SCENARIOS) {
    const localeTag = scenario.locale.toUpperCase();
    console.log(
      `\n${"─".repeat(64)}\n[${localeTag}] ${scenario.label.toUpperCase()}\nUSER: ${scenario.prompt}`,
    );

    const t = await postTurn(scenario.prompt);

    console.log(
      `HTTP ${t.httpStatus}  final=${t.finalStatus}  frames=${t.frames.join(",")}`,
    );
    for (const line of t.prose) console.log(line);

    // Assertion 1: turn must complete without server error
    const turnOk =
      t.httpStatus === 200 &&
      t.finalStatus !== "error" &&
      t.finalStatus !== null;

    if (!turnOk) {
      const msg = `FAIL [${scenario.label}]: HTTP ${t.httpStatus}  final=${t.finalStatus}`;
      console.error(msg);
      console.error(t.raw.slice(0, 2000));
      failures.push(msg);
      allPassed = false;
      continue;
    }

    // Assertion 2: banned tokens must not appear in any prose line
    const fullProse = t.prose.join("\n").toLowerCase();
    const bannedHits = (scenario.bannedTokens ?? []).filter((tok) =>
      fullProse.includes(tok.toLowerCase()),
    );
    if (bannedHits.length > 0) {
      const msg = `FAIL [${scenario.label}]: response contains banned token(s): ${bannedHits.join(", ")}`;
      console.error(msg);
      failures.push(msg);
      allPassed = false;
      continue;
    }

    console.log(`PASS [${scenario.label}]: turn completed, no banned tokens`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n${"═".repeat(64)}`);
  if (allPassed) {
    console.log(
      "✓ MULTILINGUAL TONE PROBE: all scenarios passed.\n" +
        "  Review the transcript above to confirm sensitive topics are\n" +
        "  handled with a straight, respectful tone in Arabic and Turkish.",
    );
  } else {
    console.error("✗ MULTILINGUAL TONE PROBE: FAILURES:");
    for (const f of failures) console.error(`  · ${f}`);
  }
  console.log(`${"═".repeat(64)}\n`);

  // ── Cleanup ────────────────────────────────────────────────────────────────

  try {
    await db
      .delete(atelierCliTurns)
      .where(eq(atelierCliTurns.userId, FP));
    await db
      .delete(atelierCliSessions)
      .where(eq(atelierCliSessions.userId, FP));
    await db.delete(atelierUsers).where(eq(atelierUsers.id, FP));
  } catch {
    // best-effort cleanup
  }

  server.close();
  await (pool as any).end?.();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("[tone-probe-multilingual] fatal:", err);
  process.exit(1);
});
