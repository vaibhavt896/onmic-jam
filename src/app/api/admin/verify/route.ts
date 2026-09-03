import { rpc } from "@/lib/db";
import { fail, ok, readJson, str } from "@/lib/api";
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
  /** references in the paste that belong to an attendee of this event */
  matched: string[];
};

/**
 * §10.7 / §12.2 — the whole reconciliation, one paste. Reruns are safe:
 * confirm_attendee returns early on confirmed/claimed, so a second paste of the
 * same statement confirms nobody. [E18]
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return fail("bad_json");

  const raw = str(body.raw);
  if (new TextEncoder().encode(raw).length > MAX_PASTE_BYTES) return fail("too_large");

  const refs = extractUtrs(raw);

  const result = await rpc<DbResult>("app_admin_verify", {
    p_utrs: refs,
    p_scanned: refs.length,
  });
  if (result?.error) return fail(result.error);

  // §12.2 the total check. Computed here, from the paste, and then the paste is
  // dropped — a bank statement is never persisted. [S11]
  const matched = result.matched ?? [];
  const sums = sumAmountsForUtrs(raw, matched);

  // [R9] email failures are swallowed; the confirmations already happened and
  // must stand whether or not Resend is reachable.
  const ev: EventLike = result.event;
  const sent = await sendTicketEmails(result.confirmed, ev);

  return ok<VerifyResult>({
    scanned: refs.length,
    price: ev.price,
    total: {
      matched: matched.length,
      readable: sums.readable,
      expected: sums.readable * ev.price,
      in_paste: sums.total,
    },
    confirmed: result.confirmed.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      phone: p.phone,
      pass: p.pass,
      coupon: p.coupon!,
      emailed: sent.has(p.id),
    })),
    over_capacity: result.over_capacity,
    pending: result.pending,
    no_utr: result.no_utr,
  });
}
