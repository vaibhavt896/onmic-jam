import { voidAttendee } from "@/lib/void-attendee";

export const dynamic = "force-dynamic";

/** §10.7 — UTR never matched, or a bad actor. [E3] never happens automatically. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return voidAttendee(req, ctx, "rejected");
}
