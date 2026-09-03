"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clockTime, maskUtr } from "@/lib/format";
import type { AttendeeState, Person } from "@/lib/types";
import { AttendeeActions } from "./AttendeeActions";

const TONE: Record<AttendeeState, string> = {
  registered: "text-dim",
  submitted: "text-brand",
  confirmed: "text-good",
  claimed: "text-good",
  refunded: "text-bad",
  rejected: "text-bad",
};

export function PersonRow({ person }: { person: Person }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-line last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-3 text-left"
        data-testid={`person-${person.pass_code}`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            {person.name}
            {person.coupon_no != null && (
              <span className="ml-2 text-xs text-brand tnum">#{person.coupon_no}</span>
            )}
          </p>
          <p className="truncate text-xs text-dim tnum">
            {person.pass_code} · ····{person.phone.slice(-4)}
            {person.utr ? ` · ${maskUtr(person.utr)}` : ""}
          </p>
        </div>
        <span className={`shrink-0 text-xs ${TONE[person.state]}`}>
          {person.state.replace("_", " ")}
        </span>
      </button>

      {open && (
        <div className="border-t border-line bg-card px-3 py-3">
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            <Detail label="Phone" value={person.phone} />
            <Detail label="Email" value={person.email ?? "—"} />
            <Detail label="Instagram" value={person.instagram ?? "—"} />
            <Detail label="UTR" value={person.utr ?? "—"} />
            <Detail
              label="Confirmed"
              value={
                person.confirmed_at
                  ? `${clockTime(person.confirmed_at)} (${person.verify_method})`
                  : "—"
              }
            />
            <Detail
              label="Claimed"
              value={
                person.claimed_at
                  ? `${clockTime(person.claimed_at)} (${person.claim_by ?? "self"})`
                  : "—"
              }
            />
            <Detail
              label="Paid"
              value={
                person.amount_paid != null
                  ? `₹${person.amount_paid}${person.is_walkin ? " (walk-in)" : ""}`
                  : "—"
              }
            />
            <Detail label="Emailed" value={person.emailed_at ? "yes" : "no"} />
          </dl>
          {person.note && (
            <p className="mt-2 rounded bg-surface px-2 py-1 text-xs whitespace-pre-wrap text-muted">
              {person.note}
            </p>
          )}

          <AttendeeActions id={person.id} state={person.state} />
          <EditForm person={person} />
        </div>
      )}
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-dim">{label}</dt>
      <dd className="text-bright tnum">{value}</dd>
    </>
  );
}

/**
 * [E18] seat transfer: the ticket stays, the person on it changes. Pass code
 * and coupon number are not editable here, deliberately.
 */
function EditForm({ person }: { person: Person }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: person.name,
    phone: person.phone,
    email: person.email ?? "",
    note: person.note ?? "",
  });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 text-xs text-brand underline">
        Edit / transfer seat
      </button>
    );
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      {(["name", "phone", "email", "note"] as const).map((field) => (
        <input
          key={field}
          className="field mt-2 text-sm"
          placeholder={field}
          value={form[field]}
          onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
          data-testid={`edit-${field}`}
        />
      ))}
      {msg && <p className="mt-2 text-xs text-bad">{msg}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={() => setOpen(false)} className="btn btn-ghost w-auto px-4 text-sm">
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg("");
            try {
              const res = await fetch(`/api/admin/attendee/${person.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(form),
              });
              const data = await res.json();
              if (!res.ok) setMsg(data.message ?? "That didn't work.");
              else {
                setOpen(false);
                router.refresh();
              }
            } catch {
              setMsg("Couldn't reach the server.");
            }
            setBusy(false);
          }}
          className="btn btn-brand w-auto px-4 text-sm"
          data-testid="edit-save"
        >
          {busy ? "…" : "Save"}
        </button>
      </div>
    </div>
  );
}
