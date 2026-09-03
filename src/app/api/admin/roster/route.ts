import { rpc } from "@/lib/db";
import { fail, ok } from "@/lib/api";
import type { Roster } from "@/lib/types";

export const dynamic = "force-dynamic";

/** §10.5. [S10] people[] carries phone4, never the full number. */
export async function GET() {
  const roster = await rpc<Roster & { error?: string }>("app_roster");
  if (roster?.error) return fail(roster.error);
  return ok(roster);
}
