import { createHash, timingSafeEqual } from "node:crypto";
import { clientIp, fail, ok, readJson, str } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { rpc } from "@/lib/db";
import { env } from "@/lib/env";
import { extractUtrs, MAX_PASTE_BYTES, sumAmountsForUtrs } from "@/lib/validate";
import { sendTicketEmails, type EventLike, type Recipient } from "@/lib/email";
import type { EventJson, VerifyResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DbResult = {
  error?: string;
  event: EventJson;
  confirmed: (Recipient & { phone: string })[];
  over_capacity: VerifyResult["over_capacity"];
  pending: VerifyResult["pending"];
  no_utr: VerifyResult["no_utr"];
  matched: string[];
};

/**
 * Deliberately outside /api/admin — middleware gates that tree with the
 * cookie-based admin session, which a phone automation app has no way to
 * hold. This route carries its own shared-secret check instead, compared the
 * same timing-safe way as the admin passcode.
 */
function secretMatches(given: string): boolean {
  if (!env.SMS_WEBHOOK_SECRET || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(env.SMS_WEBHOOK_SECRET).digest();
  return timingSafeEqual(a, b);
}

/**
 * Auto-reconciliation from a single forwarded bank SMS, in place of the
 * once-a-day bulk paste at /admin/verify. Same extraction, same
 * app_admin_verify RPC — a phone automation app (MacroDroid, Tasker, ...)
 * posts each incoming bank-credit SMS here the moment it arrives, so
 * attendees can be confirmed within seconds of paying instead of overnight.
 *
 * Re-posting the same SMS, or one with no recognisable transaction ID, is a
 * safe no-op — same guarantee §12.2 already gives the bulk paste.
 */
export async function POST(req: Request) {
  if (!rateLimit(`sms:${clientIp(req)}`, 120, 10 * 60_000)) return fail("rate_limited");

  const body = await readJson(req);
  if (!body) return fail("bad_json");

  if (!env.SMS_WEBHOOK_SECRET) return fail("server_error");
  const given = req.headers.get("x-sms-secret") ?? str(body.secret);
  if (!secretMatches(given)) return fail("unauthorized");

  const raw = str(body.raw);
  if (new TextEncoder().encode(raw).length > MAX_PASTE_BYTES) return fail("too_large");

  const refs = extractUtrs(raw);
  if (refs.length === 0) return ok({ scanned: 0, matched: 0, confirmed: [] });

  const result = await rpc<DbResult>("app_admin_verify", {
    p_utrs: refs,
    p_scanned: refs.length,
  });
  if (result?.error) return fail(result.error);

  const matched = result.matched ?? [];
  const sums = sumAmountsForUtrs(raw, matched);
  const ev: EventLike = result.event;
  const sent = await sendTicketEmails(result.confirmed, ev);

  return ok({
    scanned: refs.length,
    matched: matched.length,
    amount_in_sms: sums.readable > 0 ? sums.total : null,
    expected: sums.readable * ev.price,
    confirmed: result.confirmed.map((p) => ({
      name: p.name,
      coupon: p.coupon,
      emailed: sent.has(p.id),
    })),
  });
}
