import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const i18n = read("constants/i18n.ts");
const me = read("app/(tabs)/me.tsx");
const ui = read("components/ui.tsx");
const appConfig = JSON.parse(read("app.json")) as { expo?: { version?: string } };
const buildInfo = read("constants/buildInfo.ts");
const login = read("app/login.tsx");
const settings = read("app/(tabs)/settings.tsx");

check("employee pay label uses sentence case", i18n.includes('"me.tabPay": "My pay"'));
check(
  "contractor pay label uses sentence case",
  i18n.includes('"me.tabPayContractor": "My remittances"'),
);
for (const key of ["tasks", "documents", "letters", "time", "pay"] as const) {
  check(
    `${key} is reachable from the live Me navigation`,
    me.includes(`{ key: "${key}"`) && me.includes(`meTab === "${key}"`),
  );
}
check("task tab label is not repeated as a section heading", !me.includes('{t("me.tabTasks")}</Text>'));
check("documents tab label is not repeated as a section heading", !me.includes('{t("me.documents")}</Text>'));
check("letters tab label is not repeated as a section heading", !me.includes(">Official letters</Text>"));
check(
  "Time tab label is not repeated as a section heading",
  !me.includes('fontSize: 17 }}>Time</Text>'),
);

for (const [label, testID] of [
  ["Add task", "button-mobile-task-add-open"],
  ["Add document", "button-mobile-document-add-open"],
  ["Request", "button-mobile-letter-request-open"],
  ["Add entry", "button-mobile-time-entry-add-open"],
] as const) {
  check(`${label} uses the shared action pill`, me.includes(`<ActionPill`) && me.includes(`testID="${testID}"`));
}
check("shared action pill preserves RTL row direction", ui.includes("flexDirection: rtl.row"));
check("shared action pill is accessible", ui.includes('accessibilityRole="button"'));

check("Expo version is 2.0.0", appConfig.expo?.version === "2.0.0", appConfig.expo?.version);
check("build marker identifies the Me polish bundle", buildInfo.includes('BUILD_MARKER = "2026-09-22 me-polish"'));
check("login displays the shared build stamp", login.includes("{BUILD_STAMP}"));
check("Settings reads the Expo version", settings.includes("Constants.expoConfig?.version"));
check("Me displays the shared build stamp", me.includes('testID="me-build-stamp"') && me.includes("{BUILD_STAMP}"));

if (failures > 0) {
  console.error(`✗ me-polish-probe: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("✓ me-polish-probe: all checks passed");