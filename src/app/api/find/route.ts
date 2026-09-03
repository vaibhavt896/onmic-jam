import { rpc } from "@/lib/db";
import { clientIp, fail, ok, readJson } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { cleanPhone } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * §10.3. This endpoint is more important than it looks: it removes the entire
 * class of "I lost my link" WhatsApp messages that would otherwise land on
 * Vaibhav at 11 PM on Saturday.
 */
export async function POST(req: Request) {
  if (!rateLimit(`find:${clientIp(req)}`, 5, 60_000)) return fail("rate_limited");

  const body = await readJson(req);
  if (!body) return fail("bad_json");

  const phone = cleanPhone(body.phone);
  if (!phone) return fail("bad_phone");

  const result = await rpc<{ url?: string; error?: string }>("app_find", { p_phone: phone });
  if (result.error) return fail(result.error);
  return ok({ url: result.url });
}
