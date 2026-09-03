import Link from "next/link";
import { rpc } from "@/lib/db";
import { shortDate } from "@/lib/format";
import type { EventJson } from "@/lib/types";
import { Shell, Wordmark } from "@/components/Brand";

export const dynamic = "force-dynamic";

/** [E20] / [E21] — where every public route lands when registration is not live. */
export default async function ClosedPage() {
  const event = await rpc<EventJson | null>("app_public_event");
  const pastCutoff = Boolean(event && !event.is_open);

  return (
    <Shell>
      <Wordmark />

      <div className="mt-9 rounded-card border border-line bg-surface p-6">
        <div className="h-2.5 w-2.5 rounded-pill bg-text-3" />
        <h1 className="dsp mt-4 text-[28px]">
          {pastCutoff ? "Registration has closed" : "No jam open right now"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-text-2">
          {pastCutoff
            ? `Seats for ${event!.name} on ${shortDate(event!.event_date)} are locked in — we confirm the headcount to the cafe on Saturday night.`
            : "We announce each jam on the community WhatsApp group a few days ahead. The link to book shows up here."}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-text-2">
          Still want a seat? Message the organisers directly — sometimes there is room.
        </p>
      </div>

      <Link href="/find" className="btn btn-ghost mt-6">
        Find my pass
      </Link>
    </Shell>
  );
}
