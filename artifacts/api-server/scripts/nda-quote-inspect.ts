/** One-off: inspect active contract template docx blobs for stray-quote lines. */
import { db, atelierContractTemplates, atelierContractTemplateVersions } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loadContractBytes, extractDocxText } from "../src/lib/atelier-contracts.js";

const templates = await db.select().from(atelierContractTemplates);
for (const t of templates) {
  if (!t.currentVersionId) continue;
  const [v] = await db
    .select()
    .from(atelierContractTemplateVersions)
    .where(eq(atelierContractTemplateVersions.id, t.currentVersionId));
  if (!v) continue;
  const bytes = await loadContractBytes(v.blobRef);
  if (!bytes) {
    console.log(`!! ${t.name}: blob missing`);
    continue;
  }
  const text = await extractDocxText(bytes);
  const lines = text.split("\n").filter((l) => /^"|"$|["“”]\[|\]["“”]/.test(l.trim()));
  console.log(`== ${t.name} (${t.id} / ${v.id})`);
  for (const l of lines) console.log(`   >> ${JSON.stringify(l.trim().slice(0, 160))}`);
}
process.exit(0);
