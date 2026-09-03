import { rpc } from "@/lib/db";
import { fail, ok } from "@/lib/api";
import { normalisePass } from "@/lib/validate";
import type { PassState } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * §10.4 — the current ticket state, so the page can render and poll.
 *
 * cafe_share and fund_share are returned so the ticket can render the price
 * breakdown — §3.5. app_pass_state withholds coupon unless the state allows
 * it, so a void pass never carries the number over the wire. [R7]
 */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const result = await rpc<PassState | null>("app_pass_state", { p_pass: normalisePass(code) });
  if (!result) return fail("not_found");
  return ok(result);
}
