import { cookies } from "next/headers";
import { ok } from "@/lib/api";
import { COOKIE_NAME } from "@/lib/cookie";

export const dynamic = "force-dynamic";

/**
 * Not in §9, but the floor screen runs on a volunteer's personal phone and the
 * session lasts 30 days. Being able to end it is the minimum that makes a
 * shared passcode on borrowed hardware defensible.
 */
export async function POST() {
  (await cookies()).delete(COOKIE_NAME);
  return ok({ ok: true });
}
