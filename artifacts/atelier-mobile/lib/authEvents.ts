let handler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  handler = fn;
}

export function triggerUnauthorized(): void {
  handler?.();
}
