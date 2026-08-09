import {
  createHmac,
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Task #821 — TOTP (RFC 6238) two-factor core. No external dependencies:
 * HMAC-SHA1 over a 30-second step counter, 6 digits, ±1 step drift window.
 *
 * Secrets are stored AES-256-GCM encrypted (key derived from
 * SESSION_SECRET), never plaintext. Backup codes are random, shown once,
 * and stored as salted SHA-256 hashes with a usedAt stamp (single-use).
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_DRIFT_STEPS = 1;

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** New 160-bit secret, returned base32 (the canonical manual-entry key). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

export function totpCodeForStep(secretB32: string, step: number): string {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", key).update(msg).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const bin =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Verify a code within the drift window. Returns the matched step (so the
 * caller can persist it and reject replays at or before it), or null.
 * `minStepExclusive` — the last accepted step; matches at or before it are
 * rejected (each 30-second code is single-use).
 */
export function verifyTotpCode(
  secretB32: string,
  code: string,
  minStepExclusive: number | null,
  now = Date.now(),
): number | null {
  const trimmed = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(trimmed)) return null;
  const base = currentStep(now);
  for (let d = -TOTP_DRIFT_STEPS; d <= TOTP_DRIFT_STEPS; d++) {
    const step = base + d;
    if (minStepExclusive != null && step <= minStepExclusive) continue;
    const expected = totpCodeForStep(secretB32, step);
    if (
      expected.length === trimmed.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(trimmed))
    ) {
      return step;
    }
  }
  return null;
}

export function otpauthUrl(args: { secretB32: string; email: string; issuer?: string }): string {
  const issuer = args.issuer ?? "Cognirise Atelier";
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(args.email)}`;
  return `otpauth://totp/${label}?secret=${args.secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// ---- secret encryption at rest -------------------------------------------

function encKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for 2FA secret encryption");
  return createHash("sha256").update(`totp-enc:${secret}`).digest();
}

/** AES-256-GCM: `v1$<iv hex>$<tag hex>$<ciphertext hex>`. */
export function encryptTotpSecret(secretB32: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(secretB32, "utf8"), cipher.final()]);
  return `v1$${iv.toString("hex")}$${cipher.getAuthTag().toString("hex")}$${ct.toString("hex")}`;
}

export function decryptTotpSecret(stored: string): string | null {
  try {
    const [v, ivHex, tagHex, ctHex] = stored.split("$");
    if (v !== "v1" || !ivHex || !tagHex || !ctHex) return null;
    const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}

// ---- backup codes ---------------------------------------------------------

export interface BackupCodeRecord {
  hash: string; // `sha256$<salt hex>$<digest hex>`
  usedAt: string | null;
}

function normalizeBackupCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashBackupCode(code: string, saltHex?: string): string {
  const salt = saltHex ?? randomBytes(8).toString("hex");
  const digest = createHash("sha256")
    .update(`${salt}:${normalizeBackupCode(code)}`)
    .digest("hex");
  return `sha256$${salt}$${digest}`;
}

/** Ten codes in the form XXXX-XXXX (base32 alphabet, ~40 bits each). */
export function generateBackupCodes(): { codes: string[]; records: BackupCodeRecord[] } {
  const codes: string[] = [];
  const records: BackupCodeRecord[] = [];
  for (let i = 0; i < 10; i++) {
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    codes.push(code);
    records.push({ hash: hashBackupCode(code), usedAt: null });
  }
  return { codes, records };
}

/**
 * Try to consume a backup code. Returns the updated record array when a
 * fresh code matched, else null. Used codes never match again.
 */
export function consumeBackupCode(
  records: BackupCodeRecord[] | null | undefined,
  code: string,
): BackupCodeRecord[] | null {
  if (!Array.isArray(records)) return null;
  const normalized = normalizeBackupCode(code);
  if (normalized.length < 8) return null;
  let matched = false;
  const next = records.map((r) => {
    if (matched || r.usedAt) return r;
    const [alg, salt] = r.hash.split("$");
    if (alg !== "sha256" || !salt) return r;
    if (hashBackupCode(normalized, salt) === r.hash) {
      matched = true;
      return { ...r, usedAt: new Date().toISOString() };
    }
    return r;
  });
  return matched ? next : null;
}

export function backupCodesRemaining(records: unknown): number {
  if (!Array.isArray(records)) return 0;
  return (records as BackupCodeRecord[]).filter((r) => r && !r.usedAt).length;
}
