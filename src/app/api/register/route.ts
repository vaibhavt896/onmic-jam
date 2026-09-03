import { rpc } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/api";
import { cleanEmail, cleanInstagram, cleanName, cleanPhone } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** §10.1. [R1] Registering does not reserve a seat — only a confirmed payment does. */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return fail("bad_json");

  const name = cleanName(body.name);
  if (!name) return fail("bad_name");

  const phone = cleanPhone(body.phone);
  if (!phone) return fail("bad_phone");

  const email = cleanEmail(body.email);
  if (!email.ok) return fail("bad_email");

  const result = await rpc<{ pass_code?: string; url?: string; error?: string }>("app_register", {
    p_name: name,
    p_phone: phone,
    p_email: email.value,
    p_instagram: cleanInstagram(body.instagram),
  });

  if (result.error) return fail(result.error);
  return ok({ pass_code: result.pass_code, url: result.url });
}
