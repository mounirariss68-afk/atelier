/**
 * Task #845 — one-off, idempotent seed of the Dubai entity's letter
 * signing assets: signatory Mounir Ariss ("CEO and Co-founder") plus
 * the transparent signature + stamp PNGs prepared from the uploaded
 * originals (backgrounds color-keyed out with ImageMagick).
 *
 * NOT a demo seeder — it configures real production signing assets.
 * DB data never merges from task envs: re-run on main AND on prod
 * (Publish) before go-live.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx src/scripts/seed-letter-signing-assets.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, ilike } from "drizzle-orm";
import { db, atelierUsers, atelierFirmProfile } from "@workspace/db";
import { listSigningEntities } from "../lib/atelier-contract-service.js";
import { storePersonDocBytes } from "../lib/personDocStorage.js";

const SIGNATORY_NAME = "Mounir Ariss";
const SIGNATORY_TITLE = "CEO and Co-founder";

function asset(name: string): Buffer {
  return readFileSync(
    fileURLToPath(new URL(`../../assets/atelier-templates/${name}`, import.meta.url)),
  );
}

async function main(): Promise<void> {
  const [mounir] = await db
    .select()
    .from(atelierUsers)
    .where(ilike(atelierUsers.name, "%Mounir%"));
  if (!mounir) throw new Error("Mounir Ariss user row not found");
  const orgId = mounir.orgId;

  const entities = await listSigningEntities(orgId);
  if (entities.length === 0) throw new Error("No signing entities in the registry");
  const dubai =
    entities.find((e) => `${e.name} ${e.registeredAddress} ${e.officeAddress}`.toLowerCase().includes("dubai")) ??
    entities.find((e) => e.isDefault) ??
    entities[0];
  console.log(`Target entity: ${dubai.id} — ${dubai.name}`);

  const [profile] = await db
    .select()
    .from(atelierFirmProfile)
    .where(and(eq(atelierFirmProfile.orgId, orgId), eq(atelierFirmProfile.status, "published")));
  if (!profile) throw new Error("No published firm profile row");

  const payload = { ...(profile.payload as Record<string, unknown>) };
  const overlay = { ...((payload.letterSigning as Record<string, Record<string, string>>) ?? {}) };
  const existing = { ...(overlay[dubai.id] ?? {}) };

  // Idempotent: keep already-ingested blobs; only fill gaps.
  if (!existing.signatureFileRef) {
    const { fileRef } = await storePersonDocBytes(asset("entity-signature-mounir.png"), "image/png");
    existing.signatureFileRef = fileRef;
    console.log("Ingested signature →", fileRef);
  } else console.log("Signature already present:", existing.signatureFileRef);
  if (!existing.stampFileRef) {
    const { fileRef } = await storePersonDocBytes(asset("entity-stamp-dubai.png"), "image/png");
    existing.stampFileRef = fileRef;
    console.log("Ingested stamp →", existing.stampFileRef);
  } else console.log("Stamp already present:", existing.stampFileRef);

  existing.signatoryName = SIGNATORY_NAME;
  existing.signatoryTitle = SIGNATORY_TITLE;
  existing.signatoryEmail = mounir.email ?? existing.signatoryEmail ?? "";

  overlay[dubai.id] = existing;
  payload.letterSigning = overlay;
  await db
    .update(atelierFirmProfile)
    .set({ payload: payload as never, updatedAt: new Date() })
    .where(eq(atelierFirmProfile.id, profile.id));

  const after = (await listSigningEntities(orgId)).find((e) => e.id === dubai.id)!;
  console.log("Seeded:", {
    signatoryName: after.signatoryName,
    signatoryTitle: after.signatoryTitle,
    signatoryEmail: after.signatoryEmail,
    hasSignature: !!after.signatureFileRef,
    hasStamp: !!after.stampFileRef,
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
