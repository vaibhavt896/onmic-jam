import { rpc } from "@/lib/db";
import { fail, ok, readJson, str } from "@/lib/api";

/**
 * Shared by refund and reject. §10.7 requires a reason of at least 3
 * characters, stored in `note` and in the audit log — voiding someone's paid
 * seat without recording why is exactly the sort of thing that causes an
 * argument in a WhatsApp group three weeks later. [S8]
 */
export async function voidAttendee(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
  state: "refunded" | "rejected",
) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("not_found");

  const body = await readJson(req);
  const reason = str(body?.reason).trim();
  if (reason.length < 3) return fail("bad_reason");

  const result = await rpc<{ state?: string; error?: string }>("app_void_attendee", {
    p_id: id,
    p_state: state,
    p_reason: reason,
  });

  if (result.error) return fail(result.error);
  return ok({ state: result.state });
}
