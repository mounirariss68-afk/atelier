// Task #477 — single-flight guard for native pickers (document/camera/library).
// A pick that fails to present (e.g. launched mid-modal-dismissal) can leave
// the native module stuck "in progress"; invoking it again then throws
// "Different document picking in progress". The guard makes concurrent taps
// no-ops and turns native failures into a recoverable result so the UI can
// toast + let the user retry instead of surfacing an uncaught red error.

let pickerBusy = false;

export async function runExclusivePick<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: "busy" | "failed"; error?: unknown }> {
  if (pickerBusy) return { ok: false, reason: "busy" };
  pickerBusy = true;
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, reason: "failed", error };
  } finally {
    pickerBusy = false;
  }
}
