// Task #1015 — notification tap deep-linking (pure module, no expo imports,
// so the probe in tests/push-route-probe.ts can run it under tsx).
//
// Push payloads carry data.href (a web-style path like "/me/tasks"); map it
// to the mobile route to open when the user taps the alert. Unknown hrefs
// return null so the tap just foregrounds the app without navigating wrong.

/** Structural subset of Notifications.NotificationResponse we read. */
export interface PushResponseLike {
  notification?: {
    request?: {
      content?: {
        data?: unknown;
      };
    };
  };
}

export function routeForPushHref(href: unknown): string | null {
  if (typeof href !== "string" || !href.startsWith("/")) return null;
  // Due-reminder pushes (and other Me-scoped cards) land on the Me tab.
  if (href === "/me" || href.startsWith("/me/") || href.startsWith("/me?")) {
    return "/(tabs)/me";
  }
  return null;
}

/** Extract the target mobile route from a notification response, if any. */
export function routeForNotificationResponse(
  response: PushResponseLike | null | undefined,
): string | null {
  const data = response?.notification?.request?.content?.data as
    | Record<string, unknown>
    | undefined;
  return routeForPushHref(data?.href);
}

// ---------------------------------------------------------------------------
// Pending-route stash. Cold-start responses arrive before auth is ready, so
// the tap handler stashes the target here and the Gate consumes it once
// authenticated navigation is allowed. Module-level so it survives re-renders.
// ---------------------------------------------------------------------------
let pendingPushRoute: string | null = null;

export function stashPushRoute(route: string): void {
  pendingPushRoute = route;
}

/** Returns the stashed route and clears it, or null if none / not ready. */
export function takePushRoute(canNavigate: boolean): string | null {
  if (!pendingPushRoute || !canNavigate) return null;
  const route = pendingPushRoute;
  pendingPushRoute = null;
  return route;
}
