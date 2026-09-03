import { voidAttendee } from "@/lib/void-attendee";

export const dynamic = "force-dynamic";

/** §10.7 / [R10] — the app records that a refund happened. It never moves money. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return voidAttendee(req, ctx, "refunded");
}
