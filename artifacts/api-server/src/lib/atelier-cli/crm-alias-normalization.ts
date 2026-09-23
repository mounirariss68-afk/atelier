/**
 * One normalization contract for governed CRM alias writes and reads.
 * Keep this deterministic and locale-neutral: aliases are identifiers, not
 * presentation text.
 */
export function normalizeCrmAlias(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u200b-\u200f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}