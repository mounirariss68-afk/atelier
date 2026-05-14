import { runTurn, type CliFrame } from "../../src/lib/atelier-cli/index.ts";
import { db } from "@workspace/db";
import { atelierUsers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const PERSONA_ID = "p_mounir_ariss";

async function main(): Promise<void> {
  const [p] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, PERSONA_ID)).limit(1);
  if (!p) throw new Error("persona not seeded");

  const frames: CliFrame[] = [];
  const result = await runTurn(
    {
      prompt: "list my open raid items",
    },
    {
      persona: {
        id: p.id,
        orgId: p.orgId,
        name: p.name,
        role: p.role,
        email: p.email ?? null,
      },
      emit: (frame) => frames.push(frame),
    },
  );
  const budgetFrame = frames.find((f) => f.type === "budget_exceeded") ?? null;
  process.stdout.write(
    JSON.stringify({
      turnId: result.turnId,
      status: result.status,
      budgetFrame: budgetFrame ? budgetFrame.data : null,
    }) + "\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
