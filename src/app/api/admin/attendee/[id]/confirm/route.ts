import { rpc } from "@/lib/db";
import { fail, ok } from "@/lib/api";
import { sendTicketEmail } from "@/lib/email";
import type { EventJson } from "@/lib/types";

export const dynamic = "force-dynamic";

type Result = {
  status: "confirmed" | "already" | "over_capacity" | "blocked" | "not_found";
  coupon: number | null;
  name: string;
  email: string | null;
  pass: string;
  id: string;
  event: EventJson;
};

/**
 * §10.7 — manual confirm, for known people and offline payment. Goes through
 * confirm_attendee(id, 'manual') so capacity and coupon minting stay in one
 * place. [R2] [R5]
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("not_found");

  const result = await rpc<Result>("app_confirm_attendee", { p_id: id });
  if (result.status === "not_found") return fail("not_found");

  let emailed = false;
  if (result.status === "confirmed") {
    emailed = await sendTicketEmail(
      { id: result.id, name: result.name, email: result.email, pass: result.pass, coupon: result.coupon },
      result.event,
    );
  }

  return ok({ status: result.status, coupon: result.coupon, emailed });
}
