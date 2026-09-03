import { rpc } from "@/lib/db";
import { upiLink, upiQrDataUri } from "@/lib/upi";
import type { EventJson } from "@/lib/types";
import { AdminShell } from "@/components/AdminNav";
import { FloorScreen } from "@/components/FloorScreen";

export const dynamic = "force-dynamic";

/**
 * §11.4. The roster itself is fetched client-side and cached, so a flaky
 * connection at the venue degrades to "roster from 14 min ago" rather than a
 * blank screen. Only the walk-in QR is rendered here, because it needs the
 * event's VPA and a server-side render to a data URI.
 */
export default async function FloorPage() {
  const event = await rpc<EventJson | null>("app_current_event");

  const qr = event
    ? await upiQrDataUri(
        upiLink({
          vpa: event.upi_vpa,
          payeeName: event.upi_name,
          amount: event.door_price,
          // `tn` is best-effort and never used for matching — §12.1.
          note: "WALKIN",
        }),
      )
    : null;

  return (
    <AdminShell active="/admin/floor">
      <FloorScreen
        doorPrice={event?.door_price ?? 350}
        vpa={event?.upi_vpa ?? null}
        qr={qr}
      />
    </AdminShell>
  );
}
