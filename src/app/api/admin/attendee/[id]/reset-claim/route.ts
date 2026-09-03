import { rpc } from "@/lib/db";
import { fail, ok, readJson, str } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * §8.4 — for exactly one situation: someone taps CLAIM by accident before the
 * waiter arrives. Without this they lose their drink and you have an argument
 * at the table. [E10] [E13]
 *
 * [S9] wants a reason on every reset, §8.4 wants it two taps away, so the UI
 * sends "accidental tap" unless the admin typed something else. The audit row
 * is never blank.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("not_found");

  const body = await readJson(req);
  const reason = str(body?.reason).trim() || "accidental tap";
  if (reason.length < 3) return fail("bad_reason");

  const result = await rpc<{ status?: string; error?: string }>("app_reset_claim", {
    p_id: id,
    p_reason: reason,
  });

  if (result.error) return fail(result.error);
  return ok({ status: result.status });
}
