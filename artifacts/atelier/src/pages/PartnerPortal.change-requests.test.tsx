// Task #1175 regression: change-request values may be structured — e.g. a
// `capabilities` request submitted via the partner chat tool arrives from
// GET /partner-portal/change-requests with toValue as a string ARRAY.
// Rendering must never assume string methods on toValue (a `.trim()` call on
// an array crashed the Company tab once).
//
// Run: pnpm --filter @workspace/atelier run test:partner-change-requests
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { truncateValue, changeFieldLabel } from "./PartnerPortal";

// --- truncateValue handles every wire shape without throwing -------------
assert.equal(truncateValue("  plain string  "), "plain string");
assert.equal(truncateValue(["Cloud migration", "Data engineering"]), "Cloud migration, Data engineering");
assert.equal(truncateValue([]), "");
assert.equal(truncateValue(null), "");
assert.equal(truncateValue(undefined), "");
assert.equal(truncateValue({ summary: "x" }), '{"summary":"x"}');
assert.equal(truncateValue(42), "42");
assert.equal(truncateValue("y".repeat(200)).length, 121); // 120 + ellipsis
assert.ok(truncateValue([{ label: "L" }]).includes('"label":"L"'));

// --- the exact row markup path renders with an array-valued request ------
type Wire = { id: string; field: string; toValue: unknown; status: string };
const rows: Wire[] = [
  { id: "prop_arr", field: "capabilities", toValue: ["Cloud migration", "Data engineering"], status: "pending" },
  { id: "prop_str", field: "legalName", toValue: "Acme FZ-LLC", status: "approved" },
  { id: "prop_null", field: "speciality", toValue: null, status: "rejected" },
];
const html = renderToStaticMarkup(
  <div>
    {rows.map((cr) => (
      <div key={cr.id} data-testid={`change-request-${cr.id}`}>
        <div>{changeFieldLabel(cr.field)}</div>
        <div>Proposed: {truncateValue(cr.toValue) || "—"}</div>
      </div>
    ))}
  </div>,
);
assert.ok(html.includes("Cloud migration, Data engineering"), "array value renders joined");
assert.ok(html.includes("Acme FZ-LLC"));
assert.ok(html.includes("Proposed: —"), "null value renders em dash");
assert.ok(html.includes("Capabilities") || html.includes("capabilities"), "field label renders");

console.log("PartnerPortal change-request rendering: all assertions passed");
