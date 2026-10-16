-- Oct 2026 audit (Phase 0 follow-up).
-- The attachment-blob purge in artifacts/api-server/src/lib/atelier-cli/retention.ts
-- excludes attachments that back a live expense receipt (`atelier_expenses.receipt_file_ref`)
-- or a pending EA item. The purge runs as `atelier_retention_executor` (0085), which
-- needs SELECT on those two tables for the NOT EXISTS checks. runRetention() applies
-- the same grant idempotently at runtime; this file records it for fresh databases.
GRANT SELECT ON atelier_expenses, atelier_ea_pending_items TO atelier_retention_executor;
