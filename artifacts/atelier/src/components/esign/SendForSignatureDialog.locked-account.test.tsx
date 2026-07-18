/**
 * Task #121 — pin the locked-account behavior of the shared
 * SendForSignatureDialog (backs Agreements page, account header and
 * opportunity toolbar). Covers:
 *
 *   - contact chips render only for contacts with an email on file
 *   - clicking a chip fills the FIRST empty signer row (not append)
 *   - duplicate emails can't be added (case-insensitive)
 *   - signer prefill from contacts dedupes emails and caps at 10
 *   - the create payload carries the locked accountId (locked wins over
 *     any free-selection accountId)
 *
 * Vitest/jsdom are not installed in the atelier artifact, so per the
 * established pattern (EditAccountProfileDialog.revenue-gate.test.tsx,
 * Account.relationships-board.test.tsx) the dialog's locked-account
 * surface is extracted into pure, exported pieces — ContactSignerChips,
 * seedSignersFromContacts, addContactToSigners and
 * buildCreateSignaturePayload — which the component itself consumes.
 * Chip rendering is asserted via renderToStaticMarkup; the click/dedupe/
 * payload logic via the pure functions the handlers delegate to. Run:
 *
 *   pnpm --filter @workspace/atelier test:esign-dialog
 *
 * Exits non-zero if any assertion fails.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ContactSignerChips,
  contactsWithValidEmail,
  seedSignersFromContacts,
  addContactToSigners,
  buildCreateSignaturePayload,
  type SignerContact,
  type SignerDraft,
} from "./SendForSignatureDialog";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    fail++;
    console.error(
      `  \u2717 ${name}\n      ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function eq(a: unknown, b: unknown, msg: string): void {
  const aj = JSON.stringify(a);
  const bj = JSON.stringify(b);
  if (aj !== bj) throw new Error(`${msg}\n      got:      ${aj}\n      expected: ${bj}`);
}

const withEmail: SignerContact = {
  id: "c_1",
  fullName: "Aisha CEO",
  email: "aisha@acme.test",
  title: "CEO",
};
const withEmail2: SignerContact = {
  id: "c_2",
  fullName: "Bob CFO",
  email: "bob@acme.test",
  title: "CFO",
};
const noEmail: SignerContact = { id: "c_3", fullName: "No Email", email: null };
const badEmail: SignerContact = { id: "c_4", fullName: "Bad Email", email: "not-an-email" };
const dupEmailUpper: SignerContact = {
  id: "c_5",
  fullName: "Aisha Duplicate",
  email: "AISHA@ACME.TEST",
};

console.log("SendForSignatureDialog \u2014 locked-account mode");

test("chips render only for contacts with a valid email", () => {
  const eligible = contactsWithValidEmail([withEmail, noEmail, badEmail, withEmail2]);
  const html = renderToStaticMarkup(
    <ContactSignerChips contacts={eligible} signerEmails={new Set()} onAdd={() => {}} />,
  );
  assert(html.includes('data-testid="chips-esign-contacts"'), "chip strip must render");
  assert(html.includes('data-testid="chip-esign-contact-c_1"'), "chip for contact with email");
  assert(html.includes('data-testid="chip-esign-contact-c_2"'), "chip for 2nd contact with email");
  assert(!html.includes("chip-esign-contact-c_3"), "no chip for contact without email");
  assert(!html.includes("chip-esign-contact-c_4"), "no chip for contact with invalid email");
  assert(html.includes("Aisha CEO"), "chip shows the contact name");
  assert(html.includes("· CEO"), "chip shows the contact title");
});

test("chip for an already-added email renders disabled", () => {
  const html = renderToStaticMarkup(
    <ContactSignerChips
      contacts={[withEmail, withEmail2]}
      signerEmails={new Set(["aisha@acme.test"])}
      onAdd={() => {}}
    />,
  );
  const idx1 = html.indexOf('data-testid="chip-esign-contact-c_1"');
  const idx2 = html.indexOf('data-testid="chip-esign-contact-c_2"');
  const chip1 = html.slice(html.lastIndexOf("<button", idx1), idx1);
  const chip2 = html.slice(html.lastIndexOf("<button", idx2), idx2);
  assert(chip1.includes("disabled"), "chip whose email is already a signer must be disabled");
  assert(!chip2.includes("disabled"), "chip whose email is NOT a signer must stay enabled");
});

test("clicking a chip fires onAdd with the contact's name + email", () => {
  // ContactSignerChips wires onClick={() => onAdd(name, email)}. React's
  // static renderer strips handlers, so pin the handler contract by
  // invoking the element's props directly.
  const calls: Array<[string, string]> = [];
  const el = ContactSignerChips({
    contacts: [withEmail],
    signerEmails: new Set(),
    onAdd: (n, e) => calls.push([n, e]),
  });
  // el is the wrapper <div>; its child is the chip <button>.
  const btn = React.Children.toArray(el.props.children)[0] as React.ReactElement<{
    onClick: () => void;
    disabled: boolean;
  }>;
  btn.props.onClick();
  eq(calls, [["Aisha CEO", "aisha@acme.test"]], "onAdd receives the chip's name + email");
});

test("adding a contact fills the first empty signer row (no stray blank row)", () => {
  const start: SignerDraft[] = [{ name: "", email: "" }];
  const out = addContactToSigners(start, "Aisha CEO", "aisha@acme.test");
  eq(out, [{ name: "Aisha CEO", email: "aisha@acme.test" }], "empty row is filled in place");
});

test("adding fills the first EMPTY row even when later rows exist", () => {
  const start: SignerDraft[] = [
    { name: "Bob CFO", email: "bob@acme.test" },
    { name: "", email: "" },
    { name: "Cara COO", email: "cara@acme.test" },
  ];
  const out = addContactToSigners(start, "Aisha CEO", "aisha@acme.test");
  eq(
    out,
    [
      { name: "Bob CFO", email: "bob@acme.test" },
      { name: "Aisha CEO", email: "aisha@acme.test" },
      { name: "Cara COO", email: "cara@acme.test" },
    ],
    "the middle empty row is filled, order preserved",
  );
});

test("duplicate email can't be added (case-insensitive, whitespace-tolerant)", () => {
  const start: SignerDraft[] = [{ name: "Aisha CEO", email: " aisha@acme.test " }];
  const out = addContactToSigners(start, "Aisha Again", "AISHA@ACME.TEST");
  eq(out, start, "adding an existing email must be a no-op");
});

test("appends a new row when no empty row exists, capped at 10 signers", () => {
  const start: SignerDraft[] = [{ name: "Bob CFO", email: "bob@acme.test" }];
  const appended = addContactToSigners(start, "Aisha CEO", "aisha@acme.test");
  assert(appended.length === 2, "appends when all rows are occupied");
  const ten: SignerDraft[] = Array.from({ length: 10 }, (_, i) => ({
    name: `S${i}`,
    email: `s${i}@acme.test`,
  }));
  const overflow = addContactToSigners(ten, "Extra", "extra@acme.test");
  eq(overflow, ten, "an 11th signer must be rejected");
});

test("signer prefill seeds from contacts with email only, deduped", () => {
  const seeded = seedSignersFromContacts([
    withEmail,
    noEmail,
    badEmail,
    dupEmailUpper,
    withEmail2,
  ]);
  eq(
    seeded,
    [
      { name: "Aisha CEO", email: "aisha@acme.test" },
      { name: "Bob CFO", email: "bob@acme.test" },
    ],
    "prefill skips missing/invalid emails and case-insensitive duplicates",
  );
});

test("signer prefill caps at 10 contacts", () => {
  const many: SignerContact[] = Array.from({ length: 14 }, (_, i) => ({
    id: `c_${i}`,
    fullName: `Contact ${i}`,
    email: `contact${i}@acme.test`,
  }));
  assert(seedSignersFromContacts(many).length === 10, "prefill must cap at 10 signers");
});

test("create payload carries the locked accountId", () => {
  const payload = buildCreateSignaturePayload({
    title: "  NDA — Acme  ",
    message: "",
    documentId: "doc_1",
    signers: [{ name: " Aisha CEO ", email: " aisha@acme.test " }],
    lockedAccountId: "acc_locked",
    selectedAccountId: "",
    expiresInDays: "30",
  });
  eq(
    payload,
    {
      title: "NDA — Acme",
      documentId: "doc_1",
      signers: [{ name: "Aisha CEO", email: "aisha@acme.test" }],
      accountId: "acc_locked",
      expiresInDays: 30,
    },
    "payload is trimmed and pinned to the locked account",
  );
});

test("locked accountId wins over any free-selection accountId", () => {
  const payload = buildCreateSignaturePayload({
    title: "NDA",
    message: "hi",
    documentId: "doc_1",
    signers: [{ name: "A", email: "a@a.test" }],
    lockedAccountId: "acc_locked",
    selectedAccountId: "acc_other",
    expiresInDays: "",
  });
  assert(payload.accountId === "acc_locked", "locked account must override the selector");
  assert(payload.expiresInDays === undefined, "blank expiry stays undefined");
  assert(payload.message === "hi", "message passes through");
});

test("without a locked account the selected accountId (or undefined) is used", () => {
  const chosen = buildCreateSignaturePayload({
    title: "NDA",
    message: "",
    documentId: "doc_1",
    signers: [{ name: "A", email: "a@a.test" }],
    selectedAccountId: "acc_free",
    expiresInDays: "",
  });
  assert(chosen.accountId === "acc_free", "free selection is honored when not locked");
  const none = buildCreateSignaturePayload({
    title: "NDA",
    message: "",
    documentId: "doc_1",
    signers: [{ name: "A", email: "a@a.test" }],
    selectedAccountId: "",
    expiresInDays: "",
  });
  assert(none.accountId === undefined, "no account selected -> accountId omitted");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
