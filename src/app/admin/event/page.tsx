import { rpc } from "@/lib/db";
import type { EventJson } from "@/lib/types";
import { AdminShell } from "@/components/AdminNav";
import { EventForm } from "@/components/EventForm";

export const dynamic = "force-dynamic";

export default async function EventPage() {
  const event = await rpc<EventJson | null>("app_current_event");

  return (
    <AdminShell active="/admin/event">
      <h1 className="text-lg font-bold tracking-widest text-white uppercase">
        {event ? "Edit event" : "Create event"}
      </h1>
      {!event && (
        <p className="mt-2 text-sm text-muted">
          There is no live jam. Create one and the public registration page opens immediately.
        </p>
      )}
      <EventForm event={event} />
    </AdminShell>
  );
}
