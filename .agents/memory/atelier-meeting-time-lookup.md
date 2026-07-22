---
name: Chat meeting lookup by time
description: Internal-meeting reschedule/cancel resolver matches by title AND (fallback) Dubai start time; time extraction must reject date-like numbers.
---
Rule: when the chat resolver's title ILIKE finds nothing, it falls back to matching manageable meetings on Dubai wall-clock start time (timeFromMeetingQuery + optional dateFromMeetingQuery narrowing).

**Why:** Users identify meetings by time ("tomorrow's 7:00am meeting"); a title-only match returns a misleading "only the organizer can change" not-found. First fix was too permissive — architect showed "2026", "12/09", "phase 2" parsed as times, risking mis-targeted destructive reschedule/cancel.

**How to apply:** Any new lookup-by-phrase over meetings must only treat EXPLICIT time forms (H:MM, H am/pm, "at HHMM") as times, strip date tokens first, and keep disambiguation for multiple same-time hits. Regression cases live in the meeting-chat probe suite.
