/** §10.1 / §10.2 input validation. Order matters — the spec lists it. */

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 60 ? name : null;
}

/**
 * Store bare 10 digits. The unique index on (event_id, phone) is worthless if
 * `9876543210` and `+919876543210` can both exist.
 */
export function cleanPhone(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** Nullable by design — email is a convenience, not the ticket. */
export function cleanEmail(raw: unknown): { ok: true; value: string } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false };
  const email = raw.trim().toLowerCase();
  if (email === "") return { ok: true, value: "" };
  const at = email.indexOf("@");
  if (at < 1) return { ok: false };
  if (email.indexOf(".", at) < at + 2) return { ok: false };
  if (/\s/.test(email) || email.endsWith(".")) return { ok: false };
  return { ok: true, value: email };
}

export function cleanInstagram(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/^@+/, "").slice(0, 40);
}

/** 12 digits is the UPI RRN standard. */
export function cleanUtr(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const d = String(raw).replace(/\D/g, "");
  return /^\d{12}$/.test(d) ? d : null;
}

/**
 * §12.2 — the entire reconciliation algorithm, and its dumbness is the feature.
 * Regex over raw text survives export-format changes, PDF text dumps and a
 * WhatsApp forward; a column-aware CSV parser breaks silently on a Saturday
 * night with 50 people waiting. \b stops a 12-digit run inside a longer
 * account number from matching.
 */
export function extractUtrs(raw: string): string[] {
  return [...new Set(raw.match(/\b\d{12}\b/g) ?? [])];
}

export const MAX_PASTE_BYTES = 200 * 1024;

/**
 * The rupee amount sitting next to a reference on its line.
 *
 * Everything that is definitely not an amount is blanked out first — the
 * 12-digit references themselves, dates and clock times — with spaces, so the
 * surviving candidates keep their original column positions and "next to" can
 * be measured as distance from the reference. A decimal token (300.00) beats a
 * bare integer, because every real export writes the amount with paise.
 *
 * Returns null when nothing plausible is on the line. That case must stay
 * visible rather than counting as ₹0: a statement whose amounts sit on the
 * next line would otherwise report a fifteen-thousand-rupee shortfall.
 */
function amountNear(line: string, at: number): number | null {
  const blank = (s: string) => " ".repeat(s.length);
  const cleaned = line
    .replace(/\b\d{12}\b/g, blank)
    .replace(/\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/g, blank)
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, blank);

  // A bare integer must not touch a slash or a hyphen either: "06/09" is a
  // half-written date, not six rupees and nine rupees.
  const decimals = [...cleaned.matchAll(/\d[\d,]*\.\d{1,2}(?!\d)/g)];
  const pool =
    decimals.length > 0 ? decimals : [...cleaned.matchAll(/(?<![\d.,/-])\d{1,6}(?![\d.,/-])/g)];

  let best: { value: number; distance: number } | null = null;
  for (const m of pool) {
    const value = Number(m[0].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0 || value > 100_000) continue;
    const distance = Math.abs((m.index ?? 0) - at);
    if (!best || distance < best.distance) best = { value, distance };
  }
  return best?.value ?? null;
}

/**
 * §12.2 the total check. `am` in a UPI deep link is a suggestion, not a lock —
 * some payer apps let it be edited — so a person can pay ₹250 against a ₹300
 * seat, produce a perfectly valid reference, and match cleanly. Summing the
 * amounts beside the matched references catches that whole class of
 * underpayment without a per-transaction amount parser, which would reintroduce
 * exactly the CSV-format fragility §12.2 exists to avoid.
 *
 * `readable` is reported separately from `matched` so the screen can say "we
 * could not read amounts here" instead of crying shortfall at a format it does
 * not understand.
 */
export function sumAmountsForUtrs(
  raw: string,
  matched: Iterable<string>,
): { readable: number; total: number } {
  const wanted = new Set(matched);
  if (wanted.size === 0) return { readable: 0, total: 0 };

  const seen = new Set<string>();
  let readable = 0;
  let total = 0;

  for (const line of raw.split(/\r?\n/)) {
    for (const m of line.matchAll(/\b\d{12}\b/g)) {
      const utr = m[0];
      if (!wanted.has(utr) || seen.has(utr)) continue;
      seen.add(utr); // a statement that lists a transaction twice counts once
      const amount = amountNear(line, m.index ?? 0);
      if (amount !== null) {
        readable += 1;
        total += amount;
      }
    }
  }
  return { readable, total };
}

export function normalisePass(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toUpperCase();
}
