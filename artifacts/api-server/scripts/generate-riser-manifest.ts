import { mkdir, readFile, writeFile } from "node:fs/promises";

process.env.RISER_MANIFEST_GENERATING = "1";
await import("../src/lib/atelier-cli/bootstrap-capabilities.js");
const { generateCapabilityManifestDocumentV1 } = await import(
  "../src/lib/atelier-cli/capability-manifest.js"
);

const target = new URL(
  "../src/lib/atelier-cli/generated/capability-manifest.v1.json",
  import.meta.url,
);
const content = `${JSON.stringify(generateCapabilityManifestDocumentV1(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  const existing = await readFile(target, "utf8").catch(() => "");
  if (existing !== content) {
    console.error(
      "Generated Riser capability manifest is stale. Run `pnpm --filter @workspace/api-server run generate:riser-manifest` and review the diff.",
    );
    process.exit(1);
  }
  console.log("Riser capability manifest is current.");
} else {
  await mkdir(new URL(".", target), { recursive: true });
  await writeFile(target, content, "utf8");
  console.log(`Wrote ${generateCapabilityManifestDocumentV1().entryCount} capability entries.`);
}