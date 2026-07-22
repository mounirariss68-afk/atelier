/**
 * Render probe for the web meetings day view (Task #555).
 *
 * Pre-fills the react-query cache with a deterministic calendar fixture,
 * server-renders MeetingsDayView + MyMeetingsCard and asserts:
 *  1. the day timeline, date navigator and now-line render,
 *  2. overlapping meetings each get a positioned block,
 *  3. all-day meetings render in the all-day strip,
 *  4. the Home card exposes the List/Day view toggle.
 *
 * Run: npx tsx --tsconfig tsconfig.test.json src/components/ms/MsMeetings.render.test.tsx
 */
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import {
  getAtelierGetMyCalendarQueryKey,
  getAtelierGetMyMsConnectionQueryKey,
} from "@workspace/api-client-react";

// No network during SSR — everything comes from the pre-filled cache.
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async () =>
  new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

const { MeetingsDayView, MyMeetingsCard } = await import("./MsMeetings");

function startOfDay(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

const dayStart = startOfDay(new Date());
const dayWin = {
  start: dayStart.toISOString(),
  end: new Date(dayStart.getTime() + 24 * 3600 * 1000).toISOString(),
};
const at = (h: number, min = 0) =>
  new Date(dayStart.getTime() + h * 3600 * 1000 + min * 60 * 1000).toISOString();

const meetings = [
  {
    id: "mtg-1",
    subject: "Overlapping A",
    start: at(10),
    end: at(11),
    isAllDay: false,
    location: null,
    joinUrl: "https://teams.microsoft.com/l/meetup-join/abc",
    matches: [],
  },
  {
    id: "mtg-2",
    subject: "Overlapping B",
    start: at(10, 30),
    end: at(11, 30),
    isAllDay: false,
    location: "Room 4",
    joinUrl: null,
    matches: [],
  },
  {
    id: "mtg-3",
    subject: "Offsite day",
    start: at(0),
    end: at(24),
    isAllDay: true,
    location: null,
    joinUrl: null,
    matches: [],
  },
];

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
client.setQueryData(getAtelierGetMyMsConnectionQueryKey(), {
  configured: true,
  connected: true,
  msEmail: "test@cognirise.ai",
  msDisplayName: "Test",
  lastSyncedAt: null,
  lastError: null,
});
client.setQueryData(getAtelierGetMyCalendarQueryKey(dayWin), { meetings });

const dayHtml = renderToString(
  <QueryClientProvider client={client}>
    <Router ssrPath="/">
      <MeetingsDayView />
    </Router>
  </QueryClientProvider>,
);
const cardHtml = renderToString(
  <QueryClientProvider client={client}>
    <Router ssrPath="/">
      <MyMeetingsCard />
    </Router>
  </QueryClientProvider>,
);

let failures = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`ok  - ${name}`);
  else {
    failures++;
    console.error(`FAIL - ${name}`);
  }
}

check("day view renders", dayHtml.includes("meetings-day-view"));
check("date navigator renders", dayHtml.includes("meetings-day-navigator"));
check("navigator shows Today", dayHtml.includes("Today"));
check("prev/next day buttons", dayHtml.includes("button-meetings-prev-day") && dayHtml.includes("button-meetings-next-day"));
check("timeline container renders", dayHtml.includes("meetings-day-timeline"));
check("now line renders for today", dayHtml.includes("meetings-now-line"));
check("timed meeting block A", dayHtml.includes("meeting-block-mtg-1"));
check("timed meeting block B", dayHtml.includes("meeting-block-mtg-2"));
check("overlap splits into 50% lanes", dayHtml.includes("width:50%"));
check("all-day strip renders", dayHtml.includes("meeting-allday-mtg-3"));
check("all-day not in timeline", !dayHtml.includes("meeting-block-mtg-3"));
check("home card renders", cardHtml.includes("home-my-meetings"));
check("view toggle renders", cardHtml.includes("meetings-view-toggle"));
check("list + day toggle buttons", cardHtml.includes("button-meetings-view-list") && cardHtml.includes("button-meetings-view-day"));

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All render checks passed.");
