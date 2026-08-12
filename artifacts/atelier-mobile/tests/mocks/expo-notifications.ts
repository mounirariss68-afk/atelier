// Mock expo-notifications for the push-fallback probe.
export const state = {
  granted: true,
  tokenImpl: (): { data: string } => {
    throw new Error(
      'No "projectId" found. If "projectId" can\'t be inferred from the manifest (e.g. in bare workflow), you have to pass it in yourself.',
    );
  },
  scheduled: [] as Array<{ identifier?: string; content: unknown; trigger: unknown }>,
  cancelled: [] as string[],
};

export async function getPermissionsAsync() {
  return { granted: state.granted, canAskAgain: true };
}
export async function requestPermissionsAsync() {
  return { granted: state.granted, canAskAgain: true };
}
export async function getExpoPushTokenAsync(_opts?: unknown) {
  return state.tokenImpl();
}
export async function setNotificationChannelAsync() {}
export const AndroidImportance = { HIGH: 4 };
export async function getAllScheduledNotificationsAsync() {
  return state.scheduled;
}
export async function cancelScheduledNotificationAsync(id: string) {
  state.cancelled.push(id);
  state.scheduled = state.scheduled.filter((n) => n.identifier !== id);
}
export async function scheduleNotificationAsync(req: {
  identifier?: string;
  content: unknown;
  trigger: unknown;
}) {
  state.scheduled.push(req);
  return req.identifier ?? "generated";
}
export const SchedulableTriggerInputTypes = { DATE: "date" };
