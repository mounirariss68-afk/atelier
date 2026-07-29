// Share-sheet import probe (pure logic, no native modules):
//   1) file-type classification (image / pdf / heic / unsupported)
//   2) pending-share store one-shot consume + change notification
//   3) navigation decision: share while logged out → sign in → navigate to
//      the New Expense screen, retrying after the auth Gate's own redirect,
//      and consuming the shared file exactly once.
// Run: pnpm --filter @workspace/atelier-mobile run test:share-intent
import {
  classifyShareFile,
  consumePendingShare,
  hasPendingShare,
  setPendingShare,
  shareNavigationAction,
  subscribePendingShare,
} from "../lib/pendingShare";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

// 1) classification -----------------------------------------------------
check("jpeg mime → image", classifyShareFile("r.jpg", "image/jpeg") === "image");
check("png ext, no mime → image", classifyShareFile("scan.PNG", null) === "image");
check("pdf mime → pdf", classifyShareFile(null, "application/pdf") === "pdf");
check("pdf ext, empty mime → pdf", classifyShareFile("invoice.pdf", "") === "pdf");
check("heic mime → heic", classifyShareFile("img.heic", "image/heic") === "heic");
check("heif ext, octet mime → heic", classifyShareFile("img.HEIF", "application/octet-stream") === "heic");
check("mime with params → image", classifyShareFile(null, "image/jpeg; charset=binary") === "image");
check("docx → unsupported", classifyShareFile("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document") === "unsupported");
check("video → unsupported", classifyShareFile("v.mp4", "video/mp4") === "unsupported");
check("nothing known → unsupported", classifyShareFile(null, null) === "unsupported");

// 2) store one-shot semantics -------------------------------------------
let notified = 0;
const unsub = subscribePendingShare(() => {
  notified += 1;
});
check("store starts empty", !hasPendingShare());
setPendingShare({ uri: "file:///a.jpg", mime: "image/jpeg", fileName: "a.jpg", size: 100, receivedAt: 1 });
check("subscriber notified", notified === 1);
check("pending after set", hasPendingShare());
const first = consumePendingShare();
check("consume returns the file", first?.uri === "file:///a.jpg");
check("consume is one-shot", consumePendingShare() === null && !hasPendingShare());
unsub();

// 3) navigation decision across the login flow ---------------------------
// Share arrives while logged out, app sitting on the login screen.
setPendingShare({ uri: "file:///b.pdf", mime: "application/pdf", fileName: "b.pdf", size: 200, receivedAt: 2 });
const base = { pending: true, mustChangePassword: false, seg1: undefined as string | undefined };
check(
  "logged out → wait (share held)",
  shareNavigationAction({ ...base, ready: true, token: null, seg0: "login" }) === "wait",
);
check(
  "auth still loading → wait",
  shareNavigationAction({ ...base, ready: false, token: "t", seg0: undefined }) === "wait",
);
check(
  "forced password change → wait",
  shareNavigationAction({ ready: true, token: "t", mustChangePassword: true, seg0: "change-password", seg1: undefined, pending: true }) === "wait",
);
// Sign-in completes → navigate.
check(
  "signed in on login screen → navigate",
  shareNavigationAction({ ...base, ready: true, token: "t", seg0: "login" }) === "navigate",
);
// Gate's own redirect wins the race and lands on tabs; share still pending
// (never consumed) → the segment change re-runs the effect → navigate again.
check(
  "gate redirected to tabs, still pending → navigate again",
  shareNavigationAction({ ...base, ready: true, token: "t", seg0: "(tabs)" }) === "navigate",
);
// New Expense screen is now in front → stop pushing; the screen consumes it.
check(
  "on expense/new → wait (screen consumes)",
  shareNavigationAction({ ...base, ready: true, token: "t", seg0: "expense", seg1: "new" }) === "wait",
);
// On an expense DETAIL route ([id]) nothing consumes shares — must navigate.
check(
  "on expense/[id] detail → navigate (detail never consumes)",
  shareNavigationAction({ ...base, ready: true, token: "t", seg0: "expense", seg1: "[id]" }) === "navigate",
);
// Screen mounts and consumes exactly once; afterwards no more navigation.
const consumed = consumePendingShare();
check("screen consumes the shared file once", consumed?.uri === "file:///b.pdf" && consumePendingShare() === null);
check(
  "after consumption → wait everywhere",
  shareNavigationAction({ ready: true, token: "t", mustChangePassword: false, seg0: "(tabs)", seg1: undefined, pending: hasPendingShare() }) === "wait",
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll share-intent probe checks passed.");
