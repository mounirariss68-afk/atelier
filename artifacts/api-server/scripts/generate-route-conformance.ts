import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import parityMatrix from "../tests/cli-parity/matrix.json";
import reviewedManifest from "../src/lib/atelier-cli/generated/capability-manifest.v1.json";
import {
  ROUTE_CONFORMANCE_REGISTRY,
  ROUTE_FILE_DIVERGENCES,
} from "../src/lib/atelier-cli/route-conformance-registry.js";

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = resolve(API_ROOT, "../..");
const ROUTES_DIR = join(API_ROOT, "src/routes");
const TARGET = join(
  API_ROOT,
  "src/lib/atelier-cli/generated/route-conformance.v1.json",
);
const NON_ROUTE_FILES = new Set([
  "src/routes/index.ts",
  "src/routes/atelier/index.ts",
  "src/routes/atelier/personaCookie.ts",
  "src/routes/atelier/personaRoles.ts",
  "src/routes/atelier/rls.ts",
  "src/routes/atelier/auditContract.ts",
  "src/routes/atelier/auditPdf.ts",
  "src/routes/salon/salonCookie.ts",
]);
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const REVIEW_BY = "2027-03-31";

async function listTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) out.push(...await listTsFiles(full));
    else if (
      name.endsWith(".ts") &&
      !NON_ROUTE_FILES.has(relative(API_ROOT, full))
    ) out.push(full);
  }
  return out.sort();
}

function literalTexts(node: ts.Expression | undefined, source: ts.SourceFile): string[] {
  if (!node) return ["<missing>"];
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) =>
      ts.isExpression(element) ? literalTexts(element, source) : ["<missing>"]
    );
  }
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  const expression = node.getText(source);
  const digest = createHash("sha256").update(expression).digest("hex").slice(0, 12);
  return [`<dynamic:${digest}>`];
}

function skipReason(node: ts.Node, source: ts.SourceFile): string | null {
  const trivia = source.text.slice(node.getFullStart(), node.getStart(source));
  const matches = [...trivia.matchAll(/@cli-skip:\s*([^\r\n*]+)/g)];
  return matches.at(-1)?.[1]?.trim() || null;
}

const matrixRows = new Map(
  parityMatrix.rows.map((row) => [`${row.method.toLowerCase()} ${row.path}`, row.catalogId]),
);

const routes: Array<Record<string, unknown>> = [];
for (const file of await listTsFiles(ROUTES_DIR)) {
  const text = await readFile(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const occurrences = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "router" &&
      METHODS.has(node.expression.name.text)
    ) {
      const method = node.expression.name.text;
      const filePath = relative(WORKSPACE_ROOT, file);
      const reason = skipReason(node, source);
      for (const path of literalTexts(node.arguments[0], source)) {
        const key = `${method} ${path}`;
        const sharedKey = `${filePath}|${key}`;
        const shared =
          ROUTE_CONFORMANCE_REGISTRY[
            sharedKey as keyof typeof ROUTE_CONFORMANCE_REGISTRY
          ];
        const fileDivergence =
          ROUTE_FILE_DIVERGENCES[
            filePath as keyof typeof ROUTE_FILE_DIVERGENCES
          ];
        const ordinal = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, ordinal);
        const routeId = createHash("sha256")
          .update(`${filePath}|${key}|${ordinal}`)
          .digest("hex")
          .slice(0, 16);
        routes.push({
          routeId,
          file: filePath,
          method,
          path,
          ordinal,
          capabilityId: shared?.capabilityId ?? matrixRows.get(key) ?? null,
          executorContract: shared?.executorContract ?? null,
          evidence: shared?.evidence ??
            (matrixRows.has(key) ? "curated_surface_mapping" : "none"),
          conformance: shared?.conformance ?? {
            auth: "unproven",
            validation: "unproven",
            recordScope: "unproven",
            sideEffects: "unproven",
            confirmation: "unproven",
            idempotency: "unproven",
            audit: "unproven",
            navigation: "unproven",
            publicErrors: "unproven",
          },
          divergence: shared?.divergence ?? fileDivergence ?? (reason
            ? {
                status: "approved",
                owner: "Atelier API Owners",
                reason,
                reviewBy: REVIEW_BY,
                rollback: "disable any divergent assistant capability; keep the route authoritative",
              }
            : null),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

routes.sort((a, b) => String(a.routeId).localeCompare(String(b.routeId)));
const unexplainedRoutes = routes.filter((route) => route.divergence === null);
const unexplainedCapabilities = reviewedManifest.entries.filter(
  (entry) =>
    entry.source !== "route" &&
    !entry.divergenceIds.includes("cli-only-route-parity-v1") &&
    !entry.divergenceIds.includes("agent-executor-unsupported-v1"),
);
const payload = {
  schemaVersion: 1,
  reviewBy: REVIEW_BY,
  owner: "Agent Platform",
  routeCount: routes.length,
  capabilityCount: reviewedManifest.entryCount,
  unexplainedRouteCount: unexplainedRoutes.length,
  unexplainedCapabilityCount: unexplainedCapabilities.length,
  routes,
  capabilities: reviewedManifest.entries.map((entry) => ({
    capabilityId: entry.capabilityId,
    source: entry.source,
    executionStatus: entry.executionStatus,
    implementationVersion: entry.implementationVersion,
    divergenceIds: entry.divergenceIds,
  })),
};
const document = {
  ...payload,
  conformanceVersion: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
};
const content = `${JSON.stringify(document, null, 2)}\n`;

if (unexplainedRoutes.length || unexplainedCapabilities.length) {
  console.error(
    `C16 unexplained divergence: ${unexplainedRoutes.length} route(s), ${unexplainedCapabilities.length} capability(s).`,
  );
  for (const route of unexplainedRoutes) {
    console.error(`${route.file} ${String(route.method).toUpperCase()} ${route.path}`);
  }
  process.exit(1);
}

if (process.argv.includes("--check")) {
  const existing = await readFile(TARGET, "utf8").catch(() => "");
  if (existing !== content) {
    console.error("Generated C16 route conformance manifest is stale.");
    process.exit(1);
  }
  console.log(`C16 route conformance is current (${routes.length} routes, zero unexplained).`);
} else {
  await writeFile(TARGET, content, "utf8");
  console.log(`Wrote C16 conformance for ${routes.length} routes.`);
}