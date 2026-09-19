/**
 * Lightweight source contract probe for the roster MVP safety boundaries.
 * It intentionally avoids mounting network-backed detail components.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const person = readFileSync(resolve(here, "RosterPerson.tsx"), "utf8");
const app = readFileSync(resolve(here, "../../App.tsx"), "utf8");

assert.ok(
  person.includes("PFR_HIDDEN_TABS.includes(activeTab)") &&
    person.includes('const effectiveTab = PFR_HIDDEN_TABS.includes(activeTab) ? "profile" : activeTab'),
  "hidden person tabs must normalize for every worker type before rendering",
);
assert.ok(
  person.includes('["founding_partner", "partner", "finance", "hr"].includes(role ?? "")') &&
    person.includes("removal-check"),
  "removal-check must be role-gated before its fetch",
);
assert.ok(
  person.includes("!protectedDemo && <SafeRemovalPanel") &&
    person.includes("demo@cognirise.ai") &&
    person.includes("p_demo_reviewer"),
  "protected demo must not receive removal controls and detection uses stable identity",
);
assert.ok(
  person.indexOf("const { user } = useAuth()") < person.indexOf("if (!personId) return null") &&
    person.indexOf("const { user } = useAuth()") < person.indexOf("if (!person)"),
  "useAuth must run before missing-person/loading early returns",
);
assert.ok(
  app.includes('path="/people/attract"') && app.includes('<Redirect to="/people/people" />') &&
    app.includes('path="/people/hire"') && app.includes('path="/people/offboard"'),
  "hidden People lifecycle routes must redirect to the roster MVP",
);
console.log("roster MVP routing/safety probe ✓");