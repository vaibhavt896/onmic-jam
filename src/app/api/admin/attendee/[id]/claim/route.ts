import { rpc } from "@/lib/db";
import { ok } from "@/lib/api";
import type { ClaimResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * [R8] — an attendee's phone may be dead or offline, and there must always be a
 * way through that does not involve arguing with a waiter. Same one-time server
 * action as the attendee's own tap; records claim_by='admin'. [E14]
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return ok<ClaimResult>({ ok: false, reason: "not_found" });

  const result = await rpc<ClaimResult>("app_admin_claim", { p_id: id });
  return ok(result);
}
