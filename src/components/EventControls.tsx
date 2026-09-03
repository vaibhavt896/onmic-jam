"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import type { EventJson } from "@/lib/types";

/** §11.6 event controls: the two things an admin changes under time pressure. */
export function EventControls({ event }: { event: EventJson }) {
  const router = useRouter();
  const [closesAt, setClosesAt] = useState(toLocalInput(event.closes_at));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function post(body: Record<string, unknown>, tag: string) {
    setBusy(tag);
    setError("");
    try {
      const res = await fetch("/api/admin/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) setError(data.message ?? "That didn't work.");
      else router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    }
    setBusy("");
  }

  return (
    <section className="mt-6 rounded-xl border border-line bg-card p-4">
      <h2 className="text-xs font-semibold tracking-widest text-dim uppercase">Event controls</h2>

      <label className="mt-4 block text-xs text-muted">Registration closes</label>
      <div className="mt-1 flex gap-2">
        <input
          type="datetime-local"
          className="field"
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          data-testid="closes-at"
        />
        <button
          onClick={() =>
            post(
              {
                id: event.id,
                name: event.name,
                event_date: event.event_date,
                start_time: event.start_time ?? "",
                venue: event.venue ?? "",
                price: event.price,
                door_price: event.door_price,
                cafe_share: event.cafe_share,
                fund_share: event.fund_share,
                capacity: event.capacity,
                claim_seconds: event.claim_seconds,
                upi_vpa: event.upi_vpa,
                upi_name: event.upi_name,
                closes_at: fromLocalInput(closesAt),
              },
              "closes",
            )
          }
          disabled={busy !== ""}
          className="btn btn-ghost w-auto px-4"
        >
          {busy === "closes" ? "…" : "Save"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {event.status === "open" && (
          <button
            onClick={() => post({ id: event.id, status: "closed" }, "close")}
            disabled={busy !== ""}
            className="btn btn-ghost w-auto px-4 text-sm"
          >
            Close registration now
          </button>
        )}
        {event.status !== "done" && (
          <button
            onClick={() => post({ id: event.id, status: "done" }, "done")}
            disabled={busy !== ""}
            className="btn btn-ghost w-auto px-4 text-sm"
          >
            Mark event done
          </button>
        )}
        {event.status === "closed" && (
          <button
            onClick={() => post({ id: event.id, status: "open" }, "open")}
            disabled={busy !== ""}
            className="btn btn-ghost w-auto px-4 text-sm"
          >
            Re-open registration
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <p className="mt-3 text-xs text-dim">
        Marking the event done frees the slot so the next jam can be opened. The floor screen and
        the money page keep working while registration is closed — the jam is on Sunday, the cutoff
        was Saturday.
      </p>
    </section>
  );
}
