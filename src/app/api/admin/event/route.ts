import { rpc } from "@/lib/db";
import { fail, ok, readJson, str } from "@/lib/api";
import type { EventJson } from "@/lib/types";

export const dynamic = "force-dynamic";

function int(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * §11.6 event controls. Creating a second open event is blocked by
 * events_one_open_idx, which comes back as `event_open` rather than a 500.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return fail("bad_json");

  // Status-only change: "Close registration now" / "Mark event done".
  if (body.status !== undefined) {
    const id = str(body.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("not_found");
    const res = await rpc<{ status?: string; error?: string }>("app_set_event_status", {
      p_id: id,
      p_status: str(body.status),
    });
    if (res.error) return fail(res.error);
    return ok({ status: res.status });
  }

  const name = str(body.name).trim();
  const eventDate = str(body.event_date).trim();
  const closesAt = str(body.closes_at).trim();
  const vpa = str(body.upi_vpa).trim();
  const upiName = str(body.upi_name).trim();

  if (
    name.length < 2 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
    Number.isNaN(Date.parse(closesAt)) ||
    !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(vpa) ||
    upiName.length < 2
  ) {
    return fail("bad_event");
  }

  const id = str(body.id);
  const res = await rpc<{ id?: string; event?: EventJson; error?: string }>("app_save_event", {
    p_id: /^[0-9a-f-]{36}$/i.test(id) ? id : null,
    p_name: name,
    p_event_date: eventDate,
    p_start_time: str(body.start_time).trim(),
    p_venue: str(body.venue).trim(),
    p_price: int(body.price, 300),
    p_door_price: int(body.door_price, 350),
    p_cafe_share: int(body.cafe_share, 250),
    p_fund_share: int(body.fund_share, 50),
    p_capacity: int(body.capacity, 50),
    p_claim_seconds: int(body.claim_seconds, 90),
    p_upi_vpa: vpa,
    p_upi_name: upiName,
    p_closes_at: closesAt,
  });

  if (res.error) return fail(res.error);
  return ok({ id: res.id, event: res.event });
}
