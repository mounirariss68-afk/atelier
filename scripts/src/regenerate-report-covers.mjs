#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { toFile } from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const ORIGINALS = path.join(ROOT, ".local", "originals");
const OUTPUT = path.join(ROOT, "artifacts", "maven-ai", "public", "images");

const COVERS = [
  "report-2", "report-3", "report-4", "report-5",
  "report-6", "report-7", "report-8", "report-9",
  "report-industry-automotive",
  "report-industry-energy-commodities",
  "report-industry-financial-services",
  "report-industry-public-sector",
  "report-industry-retail-consumer",
  "report-industry-telecom",
  "report-industry-travel-hospitality",
];

const PROMPT = `Recolor this abstract editorial cover image into the Cognirise brand palette while preserving the original composition, layout, subjects, line work, and level of detail exactly where they are. Do not move, redraw, or reshape any of the illustrated forms or figures.

This image contains NO text. Do NOT add any text, letters, words, titles, headlines, labels, captions, logos, wordmarks, watermarks, or signatures of any kind. The output must be a purely visual abstract image with zero typography.

Palette and roles: use a deep, near-black navy (#0A1230) for backgrounds and large dark fields; use a vivid electric blue (#5B7CFF) and a rich violet-purple (#8A5BD6) for the primary illustrated forms and key shapes; use a bright magenta-pink (#C45BB8) for highlights and accents; reserve warm coral (#FF7B5A) ONLY as the final warm terminus of gradients, used sparingly.

Color treatment: maximize contrast. Backgrounds should be dark and clean; foreground forms should be luminous and saturated so they pop sharply against the navy. Maintain strong figure-ground separation and crisp edges. Avoid muddy mid-tones, avoid washed-out or desaturated areas, avoid a flat low-contrast look, and avoid covering the whole image in soft gradients.

Style: keep the same premium, modern, cinematic editorial style as the source (the source is a realistic 3D render). Do not add noise, grain, texture, watermarks, or extra elements. Output should look sharp and high-resolution.`;

const client = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

async function regenerate(name) {
  const srcPath = path.join(ORIGINALS, `${name}.png`);
  const buf = fs.readFileSync(srcPath);
  const image = await toFile(buf, `${name}.png`, { type: "image/png" });
  const t0 = Date.now();
  const res = await client.images.edit({
    model: "gpt-image-1",
    image,
    prompt: PROMPT,
    size: "1536x1024",
    input_fidelity: "high",
    quality: "high",
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image data returned for ${name}`);
  const outBuf = Buffer.from(b64, "base64");
  fs.writeFileSync(path.join(OUTPUT, `${name}.png`), outBuf);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✓ ${name} (${secs}s, ${(outBuf.length / 1024).toFixed(0)}KB)`);
}

async function runBatch(names, concurrency) {
  const queue = [...names];
  const failures = [];
  async function worker() {
    while (queue.length) {
      const name = queue.shift();
      try {
        await regenerate(name);
      } catch (err) {
        console.error(`✗ ${name}: ${err?.message || err}`);
        failures.push(name);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return failures;
}

async function main() {
  const only = process.argv.slice(2);
  const targets = only.length ? COVERS.filter((c) => only.includes(c)) : COVERS;
  console.log(`Regenerating ${targets.length} covers (concurrency 4)...`);
  let failures = await runBatch(targets, 4);
  if (failures.length) {
    console.log(`Retrying ${failures.length} failures sequentially...`);
    failures = await runBatch(failures, 1);
  }
  if (failures.length) {
    console.error(`FAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("All covers regenerated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
