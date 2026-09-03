"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import type { EventJson } from "@/lib/types";

function defaults(event: EventJson | null) {
  const inTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString();
  return {
    name: event?.name ?? "On Mic Jam",
    event_date: event?.event_date ?? new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
    start_time: event?.start_time ?? "5:00 PM",
    venue: event?.venue ?? "",
    price: String(event?.price ?? 300),
    door_price: String(event?.door_price ?? 350),
    cafe_share: String(event?.cafe_share ?? 250),
    fund_share: String(event?.fund_share ?? 50),
    capacity: String(event?.capacity ?? 50),
    claim_seconds: String(event?.claim_seconds ?? 90),
    upi_vpa: event?.upi_vpa ?? "",
    upi_name: event?.upi_name ?? "On Mic Community",
    closes_at: toLocalInput(event?.closes_at ?? inTwoDays),
  };
}

export function EventForm({ event }: { event: EventJson | null }) {
  const router = useRouter();
  const [form, setForm] = useState(defaults(event));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          id: event?.id,
          price: Number(form.price),
          door_price: Number(form.door_price),
          cafe_share: Number(form.cafe_share),
          fund_share: Number(form.fund_share),
          capacity: Number(form.capacity),
          claim_seconds: Number(form.claim_seconds),
          closes_at: fromLocalInput(form.closes_at),
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.message ?? "That didn't work.");
      else {
        router.push("/admin");
        router.refresh();
      }
    } catch {
      setError("Couldn't reach the server.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="mt-5 space-y-3">
      <Field label="Event name" value={form.name} onChange={(v) => set("name", v)} testid="ev-name" />
      <Field
        label="Date"
        type="date"
        value={form.event_date}
        onChange={(v) => set("event_date", v)}
        testid="ev-date"
      />
      <Field
        label="Start time (free text, shown to attendees)"
        value={form.start_time}
        onChange={(v) => set("start_time", v)}
        testid="ev-start"
      />
      <Field label="Venue" value={form.venue} onChange={(v) => set("venue", v)} testid="ev-venue" />

      <div className="grid grid-cols-3 gap-2">
        <Field label="Price ₹" value={form.price} onChange={(v) => set("price", v)} numeric testid="ev-price" />
        <Field
          label="Cafe ₹"
          value={form.cafe_share}
          onChange={(v) => set("cafe_share", v)}
          numeric
          testid="ev-cafe"
        />
        <Field
          label="Fund ₹"
          value={form.fund_share}
          onChange={(v) => set("fund_share", v)}
          numeric
          testid="ev-fund"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field
          label="Capacity"
          value={form.capacity}
          onChange={(v) => set("capacity", v)}
          numeric
          testid="ev-capacity"
        />
        {/* [R12] a walk-in is priced, not refused — an extra body becomes
            revenue instead of an argument. */}
        <Field
          label="Walk-in ₹"
          value={form.door_price}
          onChange={(v) => set("door_price", v)}
          numeric
          testid="ev-door"
        />
        {/* [R6] long enough for a distracted waiter, short enough that you
            cannot claim and hand your phone over later. */}
        <Field
          label="Green secs"
          value={form.claim_seconds}
          onChange={(v) => set("claim_seconds", v)}
          numeric
          testid="ev-claimsecs"
        />
      </div>

      {/* The VPA lives on the event row, not in an env var, so it can change
          per event without a redeploy. §6 */}
      <Field
        label="UPI VPA (merchant QR, not a personal ID)"
        value={form.upi_vpa}
        onChange={(v) => set("upi_vpa", v)}
        placeholder="tiwarvaibhav997@okicici"
        testid="ev-vpa"
      />
      <Field
        label="UPI payee name (short, alphanumeric)"
        value={form.upi_name}
        onChange={(v) => set("upi_name", v)}
        testid="ev-upiname"
      />
      <Field
        label="Registration closes"
        type="datetime-local"
        value={form.closes_at}
        onChange={(v) => set("closes_at", v)}
        testid="ev-closes"
      />

      {Number(form.cafe_share) + Number(form.fund_share) !== Number(form.price) && (
        <p className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-brand">
          Cafe ₹{form.cafe_share} + fund ₹{form.fund_share} doesn&apos;t add up to the ₹{form.price}{" "}
          attendees pay. That&apos;s allowed, just check it&apos;s deliberate.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-bad/12 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="btn btn-brand" data-testid="ev-save">
        {busy ? "Saving…" : event ? "Save changes" : "Create event"}
      </button>

      <p className="pt-2 text-xs leading-relaxed text-dim">
        Use a PhonePe / Paytm for Business merchant QR, not a personal UPI ID. Merchant accounts give
        you the exportable transaction history with UTRs that /admin/verify needs — without that
        export there is no reconciliation. Test with ₹1 to the real VPA before you post the link.
      </p>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  numeric,
  placeholder,
  testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  numeric?: boolean;
  placeholder?: string;
  testid: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <input
        className="field mt-1"
        type={type}
        inputMode={numeric ? "numeric" : undefined}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
      />
    </label>
  );
}
