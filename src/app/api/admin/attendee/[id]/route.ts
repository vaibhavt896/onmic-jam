import { rpc } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/api";
import { cleanEmail, cleanName, cleanPhone } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * §10.7 PATCH — edit name, phone, email, note.
 *
 * This is how [E18] seat transfer works: the ticket stays, the person on it
 * changes. Pass code and coupon number are deliberately not editable.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("not_found");

  const body = await readJson(req);
  if (!body) return fail("bad_json");

  let name: string | null = null;
  if (body.name !== undefined) {
    name = cleanName(body.name);
    if (!name) return fail("bad_name");
  }

  let phone: string | null = null;
  if (body.phone !== undefined) {
    phone = cleanPhone(body.phone);
    if (!phone) return fail("bad_phone");
  }

  let email: string | null = null;
  if (body.email !== undefined) {
    const parsed = cleanEmail(body.email);
    if (!parsed.ok) return fail("bad_email");
    email = parsed.value;
  }

  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;

  const result = await rpc<{ ok?: boolean; error?: string }>("app_patch_attendee", {
    p_id: id,
    p_name: name,
    p_phone: phone,
    p_email: email,
    p_note: note,
  });

  if (result.error) return fail(result.error);
  return ok({ ok: true });
}
