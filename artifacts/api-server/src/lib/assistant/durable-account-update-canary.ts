export function durableAccountUpdateEnabled(orgId: string): boolean {
  if (process.env.RISER_DURABLE_ACCOUNT_UPDATE !== "1") return false;
  const allowlist = new Set(
    (process.env.RISER_DURABLE_ACCOUNT_UPDATE_ORGS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return allowlist.has(orgId);
}