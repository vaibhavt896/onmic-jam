import { rpc } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/api";
import { cleanEmail, cleanName, cleanPhone } from "@/lib/validate";
import { sendTicketEmail } from "@/lib/email";
import type { EventJson, WalkinResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * §10.6 — [R12] an extra person becomes revenue instead of an argument. The
 * attendee is created and confirmed at door_price in one request, because R12
 * only works if using it is faster than arguing.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return fail("bad_json");

  const name = cleanName(body.name);
  const phone = cleanPhone(body.phone);
  if (!name || !phone) return fail("bad_walkin");

  const email = cleanEmail(body.email);
  if (!email.ok) return fail("bad_email");

  const result = await rpc<
    WalkinResult & { id?: string; error?: string; event?: EventJson }
  >("app_walkin", { p_name: name, p_phone: phone, p_email: email.value });

  if (result.error) return fail(result.error);

  // [R9] a dead email provider must never affect a confirmation that already
  // happened — and at the table nobody is waiting on an inbox anyway.
  if (email.value && result.event && result.status === "confirmed") {
    void sendTicketEmail(
      {
        id: result.id!,
        name: result.name,
        email: email.value,
        pass: result.pass_code,
        coupon: result.coupon,
      },
      result.event,
    );
  }

  return ok<WalkinResult>({
    pass_code: result.pass_code,
    url: result.url,
    name: result.name,
    coupon: result.coupon,
    amount: result.amount,
    status: result.status,
  });
}
