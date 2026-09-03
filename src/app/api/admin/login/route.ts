import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { clientIp, fail, ok, readJson, str } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { COOKIE_NAME, cookieOptions, signSession } from "@/lib/cookie";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * §10.8. [S6] Compare SHA-256 digests with timingSafeEqual: hashing first
 * equalises length (timingSafeEqual throws on a length mismatch, which would
 * itself leak) and removes the early-exit timing leak of `===`.
 */
function passcodeMatches(given: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(env.ADMIN_PASSCODE).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!rateLimit(`login:${clientIp(req)}`, 10, 10 * 60_000)) return fail("rate_limited");

  const body = await readJson(req);
  if (!body) return fail("bad_json");

  if (!passcodeMatches(str(body.passcode))) return fail("bad_passcode");

  const jar = await cookies();
  jar.set(COOKIE_NAME, await signSession(), cookieOptions(new URL(req.url).protocol === "https:"));
  return ok({ ok: true });
}
