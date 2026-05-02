/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { renderToFile } from "@react-pdf/renderer";
import { getAssessment, type AssessmentSlug, type ScoreResult } from "@workspace/assessments";
import AssessmentPDF from "../src/components/assessment/AssessmentPDF";
import { mkdirSync, existsSync, statSync, readFileSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:8080";
const IDS_FILE = "../../.local/verify/ids.json";

interface IdsSummary {
  ariId: string;
  mviIdEn: string;
  mviIdAr: string;
  dafiId: string;
  uvrId: string;
  teamToken: string;
}

interface SubmissionPayload {
  publicId: string;
  slug: AssessmentSlug;
  language: "en" | "ar";
  profile: { name: string; company: string; role: string; country: string };
  result: ScoreResult;
  memo: string | null;
}

async function fetchSubmission(publicId: string): Promise<SubmissionPayload> {
  const r = await fetch(`${BASE}/api/assessments/submissions/${publicId}`);
  if (!r.ok) throw new Error(`fetch ${publicId} -> ${r.status}`);
  return (await r.json()) as SubmissionPayload;
}

async function renderOne(publicId: string, outName: string): Promise<void> {
  const outDir = ".local/verify/pdfs";
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const sub = await fetchSubmission(publicId);
  const def = getAssessment(sub.slug);
  const out = `${outDir}/${outName}`;
  await renderToFile(
    <AssessmentPDF
      def={def}
      result={sub.result}
      profile={sub.profile}
      memo={sub.memo ?? ""}
      lang={sub.language}
      publicId={sub.publicId}
    />,
    out,
  );
  const size = statSync(out).size;
  console.log(`OK ${out} (${(size / 1024).toFixed(1)}kb) lang=${sub.language} slug=${sub.slug}`);
}

function loadIdsBatch(): Array<[string, string]> {
  const raw = readFileSync(IDS_FILE, "utf8");
  const ids = JSON.parse(raw) as IdsSummary;
  return [
    [ids.ariId, "ARI-en.pdf"],
    [ids.mviIdEn, "MVI-en.pdf"],
    [ids.mviIdAr, "MVI-ar.pdf"],
    [ids.dafiId, "DAFI-en.pdf"],
    [ids.uvrId, "UVR-en.pdf"],
  ];
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  let pairs: Array<[string, string]>;
  if (args.length === 0) {
    pairs = loadIdsBatch();
  } else if (args.length % 2 === 0) {
    pairs = [];
    for (let i = 0; i < args.length; i += 2) {
      pairs.push([args[i]!, args[i + 1]!]);
    }
  } else {
    console.error("Usage: render-pdf.tsx [<publicId> <outName> ...] (defaults to ids.json batch)");
    process.exit(2);
  }
  for (const [publicId, outName] of pairs) {
    await renderOne(publicId, outName);
  }
}

run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
