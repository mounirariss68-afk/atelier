/**
 * Task #820 — shared password policy for every surface that sets a password
 * (change-password, joiner activation, self-service reset, partner reset
 * link). One validator so the rules can never drift between flows.
 *
 * Rules (kept deliberately modest — length is the primary defense):
 *   - 10–200 characters
 *   - at least one letter and one digit
 *   - must not contain the account's email local part (≥ 4 chars)
 *   - not on a tiny list of trivially guessable passwords
 */

const COMMON_PASSWORDS = new Set([
  "password12",
  "password123",
  "password1234",
  "1234567890",
  "qwertyuiop",
  "qwerty1234",
  "cognirise1",
  "cognirise123",
  "atelier123",
  "welcome123",
  "changeme123",
  "letmein123",
]);

export const PASSWORD_POLICY_HINT =
  "At least 10 characters, including a letter and a number.";

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; error: "weak-password"; message: string };

export function validateNewPassword(
  password: string,
  opts: { email?: string | null } = {},
): PasswordPolicyResult {
  if (password.length < 10 || password.length > 200) {
    return {
      ok: false,
      error: "weak-password",
      message: "New password must be at least 10 characters.",
    };
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return {
      ok: false,
      error: "weak-password",
      message: "Password must include at least one letter and one number.",
    };
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return {
      ok: false,
      error: "weak-password",
      message: "That password is too easy to guess — choose something more unique.",
    };
  }
  const localPart = (opts.email ?? "").trim().toLowerCase().split("@")[0] ?? "";
  if (localPart.length >= 4 && lower.includes(localPart)) {
    return {
      ok: false,
      error: "weak-password",
      message: "Password must not contain your email address.",
    };
  }
  return { ok: true };
}
