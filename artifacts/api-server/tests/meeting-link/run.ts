/**
 * Task #556 — Meeting-link extraction regression test.
 *
 * Locks down extractMeetingUrl() and resolveJoinAndLocation() in
 * src/lib/msGraph.ts (added in Task #552) so Join buttons don't silently
 * disappear from meetings if the regex or the /me/calendar wire mapping
 * regresses.
 *
 * Pure unit test — no DB, no server. Run: pnpm --filter @workspace/api-server test:meeting-link
 */

import { extractMeetingUrl, resolveJoinAndLocation } from "../../src/lib/msGraph.js";

const failures: string[] = [];
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

group("extractMeetingUrl — plain URLs");
check(
  "plain Google Meet URL as location",
  extractMeetingUrl("https://meet.google.com/abc-defg-hij") ===
    "https://meet.google.com/abc-defg-hij",
);
check(
  "Meet URL with query string",
  extractMeetingUrl("https://meet.google.com/abc-defg-hij?authuser=0") ===
    "https://meet.google.com/abc-defg-hij?authuser=0",
);
check(
  "Teams meetup-join URL",
  extractMeetingUrl(
    "Join here: https://teams.microsoft.com/l/meetup-join/19%3ameeting_XYZ%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d",
  ) ===
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_XYZ%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d",
);
check(
  "teams.live.com/meet URL",
  extractMeetingUrl("https://teams.live.com/meet/9876543210?p=abc") ===
    "https://teams.live.com/meet/9876543210?p=abc",
);
check(
  "Zoom /j/ URL",
  extractMeetingUrl("https://us02web.zoom.us/j/1234567890?pwd=Zm9v") ===
    "https://us02web.zoom.us/j/1234567890?pwd=Zm9v",
);
check(
  "Webex /meet/ URL",
  extractMeetingUrl("https://acme.webex.com/meet/jdoe") ===
    "https://acme.webex.com/meet/jdoe",
);
check(
  "Webex /join/ URL",
  extractMeetingUrl("https://acme.webex.com/join/jdoe") ===
    "https://acme.webex.com/join/jdoe",
);
check(
  "Webex j.php form",
  extractMeetingUrl(
    "https://acme.webex.com/acme/j.php?MTID=m0123456789abcdef",
  ) === "https://acme.webex.com/acme/j.php?MTID=m0123456789abcdef",
);

group("extractMeetingUrl — trailing punctuation & prose");
check(
  "trailing period trimmed",
  extractMeetingUrl("Join at https://meet.google.com/abc-defg-hij.") ===
    "https://meet.google.com/abc-defg-hij",
);
check(
  "trailing close-paren + comma trimmed",
  extractMeetingUrl("(link: https://us02web.zoom.us/j/1234567890),") ===
    "https://us02web.zoom.us/j/1234567890",
);
check(
  "URL embedded mid-sentence stops at whitespace",
  extractMeetingUrl("Call https://acme.webex.com/meet/jdoe then dial in") ===
    "https://acme.webex.com/meet/jdoe",
);

group("extractMeetingUrl — HTML bodies & entities");
check(
  "Teams URL inside an HTML href with encoded entities",
  extractMeetingUrl(
    '<div>Click <a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d&amp;anon=true">here</a> to join</div>',
  ) ===
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d&anon=true",
);
check(
  "Zoom URL with &amp; in query params decodes to &",
  extractMeetingUrl(
    'Join: https://us02web.zoom.us/j/1234567890?pwd=Zm9v&amp;uname=Jane',
  ) === "https://us02web.zoom.us/j/1234567890?pwd=Zm9v&uname=Jane",
);
check(
  "&#38; numeric entity decodes too",
  extractMeetingUrl(
    "https://us02web.zoom.us/j/555?pwd=x&#38;t=1",
  ) === "https://us02web.zoom.us/j/555?pwd=x&t=1",
);
check(
  "URL stops at closing quote of an href",
  extractMeetingUrl(
    '<a href="https://meet.google.com/abc-defg-hij">Join</a>',
  ) === "https://meet.google.com/abc-defg-hij",
);

group("extractMeetingUrl — negatives");
check("physical location text returns null", extractMeetingUrl("Conference Room 4B, London office") === null);
check("empty string returns null", extractMeetingUrl("") === null);
check("undefined returns null", extractMeetingUrl(undefined) === null);
check("null returns null", extractMeetingUrl(null) === null);
check(
  "non-meeting https URL returns null",
  extractMeetingUrl("https://example.com/agenda.pdf") === null,
);
check(
  "zoom marketing page (no /j|my|w|s path) returns null",
  extractMeetingUrl("https://zoom.us/pricing") === null,
);

group("resolveJoinAndLocation — route-level wire mapping");
{
  // Location IS the meeting link → moved to joinUrl, location nulled.
  const r = resolveJoinAndLocation({
    location: { displayName: "https://meet.google.com/abc-defg-hij" },
  });
  check("link-as-location: joinUrl set", r.joinUrl === "https://meet.google.com/abc-defg-hij", r);
  check("link-as-location: location is null (not repeated)", r.location === null, r);
}
{
  // Location is link with surrounding whitespace → still nulled (trim match).
  const r = resolveJoinAndLocation({
    location: { displayName: "  https://meet.google.com/abc-defg-hij  " },
  });
  check("padded link-as-location: joinUrl set", r.joinUrl === "https://meet.google.com/abc-defg-hij", r);
  check("padded link-as-location: location nulled", r.location === null, r);
}
{
  // Physical location + link in body → both preserved.
  const r = resolveJoinAndLocation({
    location: { displayName: "Conference Room 4B" },
    body: {
      content:
        '<p>Join: <a href="https://us02web.zoom.us/j/1234567890?pwd=Zm9v&amp;x=1">Zoom</a></p>',
    },
  });
  check(
    "physical location kept alongside body-scanned joinUrl",
    r.location === "Conference Room 4B" &&
      r.joinUrl === "https://us02web.zoom.us/j/1234567890?pwd=Zm9v&x=1",
    r,
  );
}
{
  // Graph's explicit joinUrl wins over location/body scanning.
  const r = resolveJoinAndLocation({
    onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/explicit" },
    location: { displayName: "https://meet.google.com/abc-defg-hij" },
    body: { content: "https://us02web.zoom.us/j/999" },
  });
  check("onlineMeeting.joinUrl wins", r.joinUrl === "https://teams.microsoft.com/l/meetup-join/explicit", r);
  check("link-as-location still nulled even when Graph joinUrl wins", r.location === null, r);
}
{
  // Legacy onlineMeetingUrl beats scanning.
  const r = resolveJoinAndLocation({
    onlineMeetingUrl: "https://legacy.example/join",
    body: { content: "https://us02web.zoom.us/j/999" },
  });
  check("legacy onlineMeetingUrl beats body scan", r.joinUrl === "https://legacy.example/join", r);
}
{
  // Nothing anywhere → both null.
  const r = resolveJoinAndLocation({});
  check("no fields: joinUrl null and location null", r.joinUrl === null && r.location === null, r);
}
{
  // Physical location, no links at all → location kept, joinUrl null.
  const r = resolveJoinAndLocation({
    location: { displayName: "Boardroom" },
    body: { content: "<p>Agenda attached.</p>" },
  });
  check("physical-only: location kept, joinUrl null", r.location === "Boardroom" && r.joinUrl === null, r);
}

console.log("");
if (failures.length) {
  console.error(`\u2717 ${failures.length} failure(s): ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\u2713 All meeting-link extraction checks passed.");
