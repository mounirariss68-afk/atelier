import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageOrientation,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("generated/Atelier-Adding-New-Employee-or-Contractor.docx");
const navy = "12223B";
const gold = "C9A45C";
const pale = "F3F5F7";
const ink = "172033";
const muted = "536175";

const noBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function run(text, opts = {}) {
  return new TextRun({
    text,
    font: "Arial",
    size: opts.size ?? 19,
    color: opts.color ?? ink,
    bold: opts.bold ?? false,
    italics: opts.italics ?? false,
  });
}

function p(text = "", opts = {}) {
  return new Paragraph({
    style: opts.style,
    alignment: opts.alignment,
    spacing: opts.spacing ?? { after: 100 },
    children: Array.isArray(text) ? text : [run(text, opts)],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { after: 70 },
    children: [run(text)],
  });
}

function cell(content, opts = {}) {
  const children = Array.isArray(content)
    ? content.map((item) => typeof item === "string" ? p(item) : item)
    : [p(String(content))];
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.shading ? { type: ShadingType.CLEAR, fill: opts.shading } : undefined,
    margins: { top: 110, bottom: 110, left: 120, right: 120 },
    children,
  });
}

function dataTable(headers, rows, widths) {
  const header = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      cell([p([run(h, { bold: true, color: "FFFFFF", size: 17 })])], {
        width: widths?.[i],
        shading: navy,
      }),
    ),
  });
  const body = rows.map((row, rowIndex) =>
    new TableRow({
      cantSplit: true,
      children: row.map((value, i) => {
        const parts = Array.isArray(value)
          ? value.map((item) => typeof item === "string" ? p(item) : item)
          : [p(String(value))];
        return cell(parts, {
          width: widths?.[i],
          shading: rowIndex % 2 === 0 ? "FFFFFF" : pale,
        });
      }),
    }),
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 5, color: "CBD3DE" },
      bottom: { style: BorderStyle.SINGLE, size: 5, color: "CBD3DE" },
      left: { style: BorderStyle.SINGLE, size: 5, color: "CBD3DE" },
      right: { style: BorderStyle.SINGLE, size: 5, color: "CBD3DE" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "DDE2E9" },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "DDE2E9" },
    },
    rows: [header, ...body],
  });
}

function sectionTitle(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 260, after: 130 },
    children: [run(text, { bold: true, size: 27, color: navy })],
  });
}

function note(title, text, color = "FFF5DF") {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: color },
            margins: { top: 130, bottom: 130, left: 170, right: 170 },
            children: [
              p([run(`${title}: `, { bold: true, color: navy }), run(text)]),
            ],
          }),
        ],
      }),
    ],
  });
}

const quickRows = [
  [
    "1. Choose the route",
    "Open People → People → Add person to the roster. Use Quick add only when the person is already hired or is a historical joiner. Formal recruits must use the hiring flow.",
    "Select Employee or Contractor.",
    "The form switches to the correct worker type and prepares the matching roster record.",
  ],
  [
    "2. Enter identity",
    "First name and last name are required. Honorific, middle name and preferred name are optional. Enter a work email.",
    "Work email must be valid and must not already belong to a live roster person. Names are stored as structured name fields.",
    "A person identity is prepared. The email is normalised to lower case.",
  ],
  [
    "3. Enter role and location",
    "Employee: job title, seniority, country and employing legal entity. Contractor: vendor entity, country and start date. Start date is optional but recommended.",
    "Employees use a registered legal entity; free-text employing entities are rejected. A contractor does not receive an employing legal entity through Quick add.",
    "The appropriate employee or contractor roster record is created. Default role/seniority for an employee is consultant when left blank.",
  ],
  [
    "4. Add reporting line",
    "Optionally choose a manager from the manager list.",
    "The manager must be an existing, non-deleted employee.",
    "A reports-to relationship is recorded and audited. If no manager is selected, the person is added without one.",
  ],
  [
    "5. Decide the starting status",
    "Tick Run the onboarding checklist if the person still needs pre-boarding tasks. Leave it unticked for an already-ready person or historical joiner.",
    "Checked = status onboarding. Unchecked = status active.",
    "If checked, Atelier creates the correct employee or contractor checklist. If unchecked, no checklist is created and the person starts active.",
  ],
  [
    "6. Decide whether to create access",
    "Tick Send welcome invitation & create portal login when the person should receive Atelier access now. It can be left unticked for a roster-only record.",
    "Login creation is optional. It uses the same secure provisioning path as the onboarding page.",
    "If selected, Atelier creates the login setup and returns a one-time activation link. If not selected, the roster record exists without a portal login.",
  ],
  [
    "7. Submit",
    "Review the fields and choose Add to roster.",
    "The action is restricted to founding partners, partners, Finance or HR. Duplicate email, invalid name, invalid date or unknown manager stops the save before the record is created.",
    "A success card shows the person, worker type, status, onboarding ID if created, and login result if requested. The creation is written to the audit history.",
  ],
];

const formalRows = [
  [
    "1. Open a position (optional but recommended)",
    "People → Hire → create an open role with title, jurisdiction, start date and any market/band information.",
    "HR or a partner enters the role definition.",
    "An open role is available to link candidates and gives the hiring record context.",
  ],
  [
    "2. Add the candidate",
    "Enter candidate name, email/phone, CV or supporting documents, source, current role/employer and the open role if applicable.",
    "The candidate starts in the sourcing pipeline. CV files are stored against the candidate record.",
    "A candidate record is created and can move through the hiring stages.",
  ],
  [
    "3. Run interviews and record feedback",
    "Schedule interview panels and record structured feedback.",
    "The hiring team records the evidence used for the decision.",
    "The candidate’s stage and interview record show whether the person is ready for an offer.",
  ],
  [
    "4. Draft the offer",
    "Choose the candidate and enter role title, jurisdiction, start date and optional total compensation/market range.",
    "Only HR or a partner can manage hiring. Atelier keeps the offer linked to the candidate.",
    "An offer is created with status draft.",
  ],
  [
    "5. Send and accept the offer",
    "Update the offer status through the hiring screen. Move it to sent, then accepted when the candidate has accepted.",
    "An invitation cannot be created from an offer until its status is accepted. An accepted offer also moves the candidate into the hired stage.",
    "The accepted offer becomes a valid source for the invitation step.",
  ],
  [
    "6. Send the invitation",
    "From the accepted offer, choose Send invitation. Confirm worker type, structured name, work email, country, start date and (for employees) a registered employing legal entity.",
    "An invitation must have a valid source: hired candidate, accepted offer or active partner-firm resource. It expires in 1–60 days; the default is 14 days.",
    "The invitation is recorded as sent, audited, and a draft onboarding sequence starts immediately so pre-arrival work can begin.",
  ],
  [
    "7. Candidate accepts",
    "The invitee follows the invitation/acceptance process.",
    "At acceptance, Atelier materialises the employee or contractor roster record from the invitation draft and binds the draft onboarding sequence to the real person.",
    "A real roster person ID is created and the onboarding record no longer points to a draft invitation.",
  ],
  [
    "8. Work through onboarding",
    "Open People → Onboarding. For each checklist item, the assigned owner marks it done or records a block reason.",
    "Compliance gates keep the sequence open while blocked. The page shows owner, due date, status and progress.",
    "The person moves toward a complete onboarding record. A blocked item remains visible rather than being silently skipped.",
  ],
  [
    "9. Create portal login last",
    "On the final Portal login created step, choose Create login. Optionally skip the Microsoft email address or select the employee/contractor Microsoft service profile.",
    "This is the final pre-boarding action. The shared provisioning path creates a placeholder credential, a one-time token valid for 72 hours, welcome email attempt and optional Microsoft provisioning.",
    "Atelier returns an activation URL once. The login step is completed when provisioning succeeds.",
  ],
  [
    "10. Employee/contractor activates",
    "Share the one-time activation link securely. The joiner opens it and chooses their own password.",
    "The token is single-use and expires after 72 hours. Atelier never emails or displays a temporary password.",
    "The joiner can sign in after activation. If the link expires, HR/Operations must use the supported recovery/provisioning path.",
  ],
];

const employeeSteps = [
  ["Contract signed", "Countersigned employment contract on file.", "Partner", "Day 0", "Yes"],
  ["Right-to-work / visa verified", "Passport, residency/visa status and work permit checked and recorded.", "HR", "Day 0", "Yes"],
  ["IT account, email & SSO provisioned", "Corporate email, SSO identity, MFA enrolment and core tool access.", "HR", "Day 2", "No"],
  ["Payroll & bank details registered", "Payroll enrolment, including GOSI/WPS where applicable, and verified bank details.", "HR", "Day 2", "Yes"],
  ["Policies acknowledged", "Code of conduct, confidentiality, IT security and expenses policies signed off.", "HR", "Day 3", "No"],
  ["Buddy & manager introductions", "Buddy assigned; manager intro and first-week schedule booked.", "Senior manager", "Day 5", "No"],
  ["Workspace ready", "Equipment issued/shipped and desk or remote setup confirmed.", "HR", "Day 5", "No"],
  ["Portal login created", "Create the portal login as the final pre-boarding step.", "HR", "Day 7", "No"],
];

const contractorSteps = [
  ["NDA & MSA signed", "Non-disclosure and master services agreements executed.", "HR", "Day 0", "Yes"],
  ["Conflicts of interest disclosed", "Conflict disclosure captured and cleared.", "HR", "Day 0", "Yes"],
  ["Vendor & AP setup", "Vendor entity registered with accounts payable; payment terms agreed.", "HR", "Day 1", "No"],
  ["Limited SSO provisioned", "Scoped access to only the tools required for the engagement.", "HR", "Day 2", "No"],
  ["Invoice cadence agreed", "Invoicing schedule, rate and approval chain confirmed.", "HR", "Day 3", "No"],
  ["Engagement scope briefed", "Scope of work, deliverables and ways of working walked through.", "Senior manager", "Day 3", "No"],
  ["Portal login created", "Create the portal login as the final pre-boarding step.", "HR", "Day 4", "No"],
];

const doc = new Document({
  creator: "Cognirise Atelier",
  title: "Adding a New Employee or Contractor in Atelier",
  subject: "Atelier People and onboarding operating guide",
  description: "A print-ready guide to the employee and contractor creation flows in Cognirise Atelier.",
  styles: {
    default: {
      document: { run: { font: "Arial", size: 19, color: ink } },
      heading1: { run: { font: "Arial", bold: true, color: navy, size: 27 } },
      heading2: { run: { font: "Arial", bold: true, color: navy, size: 22 } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 16838, height: 11906 },
        orientation: PageOrientation.LANDSCAPE,
        margin: { top: 780, right: 820, bottom: 760, left: 820 },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [run("COGNIRISE ATELIER  /  PEOPLE OPERATIONS", { size: 14, bold: true, color: muted })],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              run("Internal operating guide  •  Current Atelier workflow  •  Page ", { size: 14, color: muted }),
              PageNumber.CURRENT,
            ],
          }),
        ],
      }),
    },
    children: [
      new Paragraph({
        spacing: { after: 80 },
        children: [run("ATELIER PEOPLE OPERATIONS", { size: 15, bold: true, color: gold })],
      }),
      new Paragraph({
        spacing: { after: 130 },
        children: [run("Adding a New Employee or Contractor", { size: 36, bold: true, color: navy })],
      }),
      p("A practical, print-ready guide to choosing the right route, entering the record, completing onboarding, and giving the new joiner secure access.", { size: 21, color: muted, spacing: { after: 180 } }),
      note("The short answer", "Use Quick add for someone already hired or a historical joiner. Use the formal hiring flow for a new recruit so the candidate, offer, acceptance, invitation and onboarding history remain connected."),
      p("Document purpose", { bold: true, color: navy, size: 21, spacing: { before: 220, after: 80 } }),
      dataTable(
        ["Question", "Answer"],
        [
          ["Who can perform these actions?", "Hiring is restricted to HR or a partner. Quick add and invitation creation are restricted to founding partners, partners, Finance or HR."],
          ["What is different for employees?", "Employees can have a registered employing legal entity, statutory payroll details and the employee onboarding checklist."],
          ["What is different for contractors?", "Contractors use a vendor entity and contractor onboarding checklist. They receive scoped access and do not use the employee employing-entity field."],
          ["What does Atelier never do?", "It does not accept free-standing invitations, allow duplicate live roster emails, create a temporary password, or let general profile editing bypass audited pay/bank flows."],
        ],
        [2600, 12500],
      ),
      new Paragraph({ children: [run(" ")] }),
      sectionTitle("1. Choose the correct route"),
      dataTable(
        ["Route", "Use it when", "What you start with", "What it produces"],
        [
          ["Quick add", "The person is already hired, or you are recording a historical joiner.", "The person’s identity, work email and basic role details.", "A live employee or contractor roster record; optional onboarding and optional portal login."],
          ["Formal hiring", "You are recruiting a new person and want the hiring evidence connected to the final roster record.", "Open role/candidate information and the hiring decision.", "Candidate → offer → accepted offer → invitation → real roster record → onboarding → activation."],
        ],
        [1800, 4400, 4400, 4500],
      ),
      p("Important: partner-firm resources are not created through Quick add. They use the partner-firm registry and invitation route.", { italics: true, color: muted, spacing: { before: 110, after: 80 } }),
      sectionTitle("2. Quick add — detailed step-by-step"),
      p("This is the fastest route. It creates an employee or contractor directly in the roster without a candidate, offer or invitation prerequisite.", { color: muted }),
      dataTable(
        ["Step", "What the person adding them does", "Input rules and employee/contractor difference", "Output from Atelier"],
        quickRows,
        [1900, 4800, 4800, 4000],
      ),
      new Paragraph({ children: [run(" ")] }),
      note("Quick-add login reminder", "The activation link is shown only once and expires after 72 hours. Share it through a secure channel. The joiner chooses their own password; no temporary password is sent.", "EAF3FF"),
      sectionTitle("3. Formal hiring — detailed step-by-step"),
      p("Use this route for a new recruit. It preserves the chain of evidence and prevents an invitation from being created without a real hiring source.", { color: muted }),
      dataTable(
        ["Step", "What happens", "Input / owner", "Output"],
        formalRows,
        [1900, 5000, 4300, 4300],
      ),
      new Paragraph({ children: [run(" ")] }),
      sectionTitle("4. Onboarding checklist — employee"),
      p("The employee sequence has eight steps. A compliance gate keeps onboarding open when the required evidence is missing or blocked.", { color: muted }),
      dataTable(["Checklist step", "Explanation", "Owner", "Target", "Gate?"], employeeSteps, [3000, 6800, 2000, 1200, 1200]),
      new Paragraph({ children: [run(" ")] }),
      sectionTitle("5. Onboarding checklist — contractor"),
      p("The contractor sequence has seven steps and focuses on agreements, conflicts, vendor/AP setup, scoped access and engagement readiness.", { color: muted }),
      dataTable(["Checklist step", "Explanation", "Owner", "Target", "Gate?"], contractorSteps, [3000, 6800, 2000, 1200, 1200]),
      new Paragraph({ children: [run(" ")] }),
      sectionTitle("6. What to prepare before starting"),
      dataTable(
        ["For an employee", "For a contractor", "For both"],
        [
          [
            "• Full legal name and work email\n• Country/location\n• Job title and seniority\n• Start date\n• Registered employing legal entity\n• Signed employment contract\n• Right-to-work / visa evidence\n• Payroll and verified bank details before payroll processing",
            "• Full legal name and work email\n• Country/location\n• Vendor entity\n• Start date and engagement scope\n• Signed NDA and MSA\n• Conflict disclosure\n• Invoice cadence, rate and approval chain",
            "• Manager, if known\n• Whether to run onboarding\n• Whether to create an Atelier login\n• Whether to provision Microsoft services\n• Secure way to share the one-time activation link",
          ],
        ],
        [5500, 5500, 5500],
      ),
      new Paragraph({ children: [run(" ")] }),
      note("Money and bank details", "Do not use the general person form to change pay or bank information after creation. Those values stay behind the dedicated Finance and HR-approved flows so there is one audited write path.", "FDECEC"),
      sectionTitle("7. Expected results and common stops"),
      dataTable(
        ["Situation", "What Atelier does", "What to do next"],
        [
          ["Duplicate work email", "Stops with “A roster person with this email already exists.”", "Open the existing person rather than creating a second record."],
          ["No valid hiring source", "Rejects the invitation. Free-standing invitations are not allowed.", "Create or locate the hired candidate, accepted offer or active partner-firm resource first."],
          ["Unknown manager", "Stops the Quick add before saving.", "Select an existing, non-deleted employee as manager, or leave manager blank."],
          ["Employee legal entity missing/invalid", "Rejects the employee invitation or Quick add when an invalid entity is supplied.", "Select a registered active legal entity. Do not type a free-text entity."],
          ["Onboarding task is blocked", "Keeps the sequence open and displays the block reason.", "Resolve the evidence or dependency, then mark the step done."],
          ["Login creation fails", "Keeps the roster person; reports the login problem instead of rolling back the person.", "Retry from Onboarding after correcting the issue. The person record is not silently lost."],
          ["Activation link expires", "The single-use 72-hour token can no longer be used.", "Ask the authorised onboarding owner to use the supported login provisioning/recovery path."],
        ],
        [3600, 6900, 6000],
      ),
      new Paragraph({ children: [run(" ")] }),
      sectionTitle("8. Final operating checklist"),
      bullet("Confirm the person is being added as Employee or Contractor — not a partner-firm resource."),
      bullet("Confirm the work email is correct and not already on the roster."),
      bullet("For a formal recruit, confirm the candidate is hired and the offer is accepted before sending the invitation."),
      bullet("For an employee, select the registered employing legal entity and prepare payroll/right-to-work evidence."),
      bullet("For a contractor, prepare the vendor entity, NDA/MSA, conflict disclosure and invoice cadence."),
      bullet("Choose whether the person should start as onboarding or active."),
      bullet("Choose whether to create a portal login now or later."),
      bullet("Share any one-time activation link securely and remind the joiner to set their own password."),
      bullet("After saving, review the person page, onboarding progress and audit history."),
      new Paragraph({ children: [run(" ")] }),
      p("Source note: This guide reflects the current Atelier web screens and server rules as of 27 August 2026. It describes the employee and contractor flows; it does not replace employment, immigration, payroll, tax or information-security advice.", { size: 15, color: muted, italics: true, spacing: { before: 180 } }),
    ],
  }],
});

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, await Packer.toBuffer(doc));
console.log(OUT);