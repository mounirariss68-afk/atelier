/**
 * Task #100 — Board layer of the account org chart renders correctly.
 *
 * The Relationships tab shows a "Board of directors" layer ABOVE the
 * reporting tree: the chairman is highlighted/labelled "chairman", board
 * members are excluded from the executive tree, and executives who report
 * only to board members (e.g. a CEO reporting to the Chairman) still head
 * the reporting structure. This pins those invariants.
 *
 * Vitest is not installed in the atelier artifact (matching the approach
 * used by EditAccountProfileDialog.revenue-gate.test.tsx). RelationshipsTab
 * is a pure component, so it renders to static markup without providers.
 * Run with:
 *
 *   pnpm --filter @workspace/atelier test:board-layer
 *
 * Exits non-zero if any assertion fails.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RelationshipsTab } from "./Account";
import type {
  AtelierContact,
  AtelierContactRelationship,
} from "@workspace/api-client-react";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    fail++;
    console.error(`  \u2717 ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function contact(
  id: string,
  fullName: string,
  seniority: AtelierContact["seniority"],
  title: string,
): AtelierContact {
  return {
    id,
    accountId: "acc_1",
    fullName,
    title,
    seniority,
    influenceScore: 3,
    disposition: "neutral",
  } as AtelierContact;
}

function rel(
  id: string,
  fromContactId: string,
  toContactId: string,
  type: AtelierContactRelationship["type"] = "reports_to",
): AtelierContactRelationship {
  return { id, accountId: "acc_1", fromContactId, toContactId, type };
}

const chairman = contact("c_chair", "Beatrice Chairwoman", "board_chair", "Chairman of the Board");
const boardMember = contact("c_board", "Bertram Boardman", "board_member", "Non-Executive Director");
const ceo = contact("c_ceo", "Cecilia Executive", "c_suite", "Chief Executive Officer");
const vp = contact("c_vp", "Victor President", "vp", "VP of Operations");

// CEO reports only to the chairman; VP reports to the CEO.
const relationships = [rel("r1", ceo.id, chairman.id), rel("r2", vp.id, ceo.id)];
const contacts = [chairman, boardMember, ceo, vp];

const html = renderToStaticMarkup(
  <RelationshipsTab contacts={contacts} relationships={relationships} />,
);

// Split the markup at the "Reporting structure" label: everything after it
// is the executive tree; the board layer must live entirely before it.
const splitAt = html.indexOf("Reporting structure");
const beforeTree = html.slice(0, splitAt);
const tree = html.slice(splitAt);

console.log("RelationshipsTab \u2014 board layer");

test("board layer renders (org-board-layer) above the reporting structure", () => {
  assert(splitAt !== -1, "expected the Reporting structure section to render");
  assert(
    beforeTree.includes('data-testid="org-board-layer"'),
    "expected org-board-layer to render before the reporting structure",
  );
  assert(beforeTree.includes("Board of directors"), "expected the Board of directors label");
});

test("chairman is highlighted and labelled 'chairman'", () => {
  const chairCard = html.split(`data-testid="org-board-${chairman.id}"`)[0];
  assert(
    chairCard !== html,
    `expected a board card for the chairman (org-board-${chairman.id})`,
  );
  // The chairman card carries the accent highlight classes.
  const cardStart = html.indexOf(`data-testid="org-board-${chairman.id}"`);
  const cardOpenTag = html.lastIndexOf("<div", cardStart);
  const openTag = html.slice(cardOpenTag, cardStart);
  assert(
    openTag.includes("border-accent") && openTag.includes("bg-accent/5"),
    "chairman board card must carry the accent highlight (border-accent bg-accent/5)",
  );
  assert(html.includes(">chairman<"), "expected a 'chairman' chip");
});

test("board member renders in the board layer with a 'board' chip", () => {
  assert(
    beforeTree.includes(`data-testid="org-board-${boardMember.id}"`),
    "expected the board member card in the board layer",
  );
  assert(html.includes(">board<"), "expected a 'board' chip for the non-chair director");
});

test("CEO (reporting only to the chairman) still heads the reporting structure", () => {
  assert(
    tree.includes(ceo.fullName),
    "CEO must appear in the reporting structure despite reporting to the chairman",
  );
  // CEO must appear before their report (VP) — i.e. as the tree root.
  assert(
    tree.indexOf(ceo.fullName) < tree.indexOf(vp.fullName),
    "CEO must head the tree, rendering above their report (VP)",
  );
  assert(tree.includes(vp.fullName), "VP must render under the CEO in the tree");
});

test("board members never appear inside the reporting tree", () => {
  assert(
    !tree.includes(chairman.fullName),
    "chairman must not appear inside the reporting structure",
  );
  assert(
    !tree.includes(boardMember.fullName),
    "board member must not appear inside the reporting structure",
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
