import { rpc } from "@/lib/db";
import { ok, readJson } from "@/lib/api";
import { normalisePass } from "@/lib/validate";
import type { ClaimResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * §10.3 — the important one. A thin wrapper over claim_drink, and deliberately
 * nothing else: no "has it been claimed" check in JS, no timestamp arithmetic.
 * All of that lives in the database function under a row lock, where
 * concurrency is actually handled. [R6] [S5]
 *
 * Every outcome is a 200. A blocked drink is not an HTTP error — the table is
 * not the place for one — and the client renders the reason.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  const pass = normalisePass(body?.pass_code);
  if (!pass) return ok<ClaimResult>({ ok: false, reason: "not_found" });

  const result = await rpc<ClaimResult>("app_claim", { p_pass: pass, p_by: "self" });
  return ok(result);
}
