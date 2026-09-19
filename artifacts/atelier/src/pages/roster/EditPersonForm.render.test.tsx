/**
 * UI render probes for the unified add/edit roster form.
 *
 * Run: pnpm --filter @workspace/atelier exec tsx --tsconfig tsconfig.test.json
 *   src/pages/roster/EditPersonForm.render.test.tsx
 */
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { EditPersonForm, type EditablePerson } from "./EditPersonForm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const person: EditablePerson = {
  id: "emp_test_ada",
  workerType: "employee",
  fullName: "Ada Lovelace",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  role: "consultant",
  seniority: "consultant",
  title: "Consultant",
  country: "AE",
  status: "active",
  startDate: "2026-01-05",
  endDate: null,
  gender: "unspecified",
};

function renderForm(
  subject: EditablePerson | null,
  viewerCanSeeComp = false,
  createWorkerType: "employee" | "contractor" = "employee",
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    <QueryClientProvider client={client}>
      <Router ssrPath="/people/people">
        <EditPersonForm
          person={subject}
          createWorkerType={createWorkerType}
          viewerCanEditTitle
          viewerCanSeeComp={viewerCanSeeComp}
          onSaved={() => undefined}
          onClose={() => undefined}
        />
      </Router>
    </QueryClientProvider>,
  );
}

let failures = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`ok  - ${name}`);
  else {
    failures++;
    console.error(`FAIL - ${name}`);
  }
}

const createHtml = renderForm(null);
const contractorCreateHtml = renderForm(null, false, "contractor");
const editHtml = renderForm(person, true);
const formSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "EditPersonForm.tsx"), "utf8");

check("create mode renders the unified roster form", createHtml.includes("Add person to the roster"));
check(
  "create mode offers both internal worker types",
  createHtml.includes("quick-add-type-employee") && createHtml.includes("quick-add-type-contractor"),
);
check(
  "create mode retains onboarding and portal-login options",
  createHtml.includes("quick-add-run-onboarding") && createHtml.includes("quick-add-create-login"),
);
check(
  "create mode does not expose fields the quick-add API cannot persist",
  !createHtml.includes("edit-enddate") &&
    !createHtml.includes("edit-officeaddress") &&
    !createHtml.includes("edit-nationality") &&
    !createHtml.includes("edit-gender"),
);
check(
  "contractor create mode omits employee-only title and seniority inputs",
  !contractorCreateHtml.includes("edit-title") && !contractorCreateHtml.includes("edit-seniority"),
);
check(
  "existing people render pre-filled in the same form",
  editHtml.includes("Edit person") && editHtml.includes("Ada Lovelace"),
);
check("the retired employing entity field is absent", !editHtml.includes(">Employing entity<"));
check("the canonical employing legal entity selector remains", editHtml.includes("Employing legal entity"));
check(
  "legacy unspecified gender is shown as an empty selection",
  editHtml.includes('<option value="" disabled="" selected="">—</option>'),
);
check(
  "gender label is concise and options are Female and Male only",
  editHtml.includes(">Gender<") &&
    editHtml.includes(">Female<") &&
    editHtml.includes(">Male<") &&
    !editHtml.includes("unspecified"),
);
check(
  "quick-add has an essentials then review staged contract",
  formSource.indexOf('createStep === "essentials"') < formSource.indexOf('createStep === "review"') &&
    formSource.includes('setCreateStep("review")') &&
    formSource.includes('data-testid="quick-add-review"'),
);
check(
  "quick-add duplicate warning checks normalized email and names",
  formSource.includes("emailResponse") &&
    formSource.includes("nameResponse") &&
    formSource.includes("quick-add-duplicate-warning"),
);
check(
  "quick-add exposes activation and profile completion outcomes",
  createHtml.includes("quick-add-run-onboarding") &&
    createHtml.includes("quick-add-create-login") &&
    formSource.includes("quick-add-complete-profile") &&
    formSource.includes("quick-add-activation-link"),
);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All unified roster-person form checks passed.");