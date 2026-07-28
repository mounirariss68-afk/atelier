/**
 * Task #694 — header-safe Content-Disposition for filenames derived from
 * user data (people's names, uploaded file names, document titles).
 *
 * Node rejects any header value containing characters outside latin1 with
 * ERR_INVALID_CHAR — a Turkish "ş" in `filename="Ömer_Barbaros_Yiş.pdf"`
 * turned the business-card download into a 500 HTML error page. Even
 * latin1-but-non-ASCII characters are unreliable across browsers in the
 * plain `filename=` form.
 *
 * The fix is the standard RFC 6266 / RFC 5987 dual form:
 *
 *   Content-Disposition: attachment; filename="ASCII fallback";
 *                        filename*=UTF-8''percent-encoded-original
 *
 * Browsers that understand `filename*` (all modern ones) show the real
 * UTF-8 name; anything else falls back to the ASCII transliteration.
 */

/** Strip diacritics and map to an ASCII-only fallback filename. */
export function asciiFilenameFallback(filename: string, fallback = "download"): string {
  const ascii = filename
    .normalize("NFKD")
    // Turkish letters that NFKD alone doesn't reduce to ASCII.
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .replace(/ß/g, "ss")
    .replace(/[ØøĐđŁł]/g, (c) => ({ Ø: "O", ø: "o", Đ: "D", đ: "d", Ł: "L", ł: "l" })[c] ?? "_")
    // Drop combining marks left by NFKD (é → e).
    .replace(/[\u0300-\u036f]/g, "")
    // Anything still non-ASCII (or header-hostile) becomes "_".
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .trim();
  return ascii.replace(/^\.+$/, "") || fallback;
}

/**
 * Build a full Content-Disposition header value that is always safe to set,
 * whatever the filename contains.
 */
export function contentDispositionFilename(
  type: "attachment" | "inline",
  filename: string,
): string {
  const cleaned = filename.replace(/[\r\n]/g, " ").trim() || "download";
  const ascii = asciiFilenameFallback(cleaned);
  // Fast path: pure-ASCII names need no RFC 5987 extension.
  if (cleaned === ascii) return `${type}; filename="${ascii}"`;
  // encodeURIComponent covers everything RFC 5987 requires except a few
  // attr-char exceptions that are safe to leave encoded.
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
