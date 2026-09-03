"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Action = "confirm" | "refund" | "reject" | "reset-claim";

/**
 * §10. Refund and reject both demand a reason of at least 3 characters — it
 * lands in `note` and in the audit log. [S9]
 *
 * Reset-claim is here too, because §8.4 requires it "reachable in two taps from
 * /admin/people": tap Reset claim, tap Yes. The reason is filled in for you so
 * that two taps and a mandatory audit reason can both be true.
 */
export function AttendeeActions({
  id,
  state,
  compact = false,
  onDone,
}: {
  id: string;
  state?: string;
  compact?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  async function run(action: Action, body?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/attendee/${id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult(data.message ?? "That didn't work.");
      } else if (action === "confirm") {
        setResult(
          data.status === "confirmed"
            ? `Confirmed · coupon ${data.coupon}${data.emailed ? " · emailed" : ""}`
            : data.status === "already"
              ? `Already confirmed · coupon ${data.coupon}`
              : data.status === "over_capacity"
                ? "Room is full — refund this one instead."
                : "Blocked — this pass is already void.",
        );
        router.refresh();
        onDone?.();
      } else if (action === "reset-claim") {
        setResult("Claim undone — they can claim again");
        router.refresh();
        onDone?.();
      } else {
        setResult(action === "refund" ? "Marked refunded" : "Marked rejected");
        router.refresh();
        onDone?.();
      }
    } catch {
      setResult("Couldn't reach the server.");
    }
    setBusy(false);
    setAsking(null);
    setReason("");
  }

  if (result) {
    return (
      <p className="mt-2 text-xs text-muted" data-testid="action-result">
        {result}{" "}
        <button onClick={() => setResult("")} className="underline">
          undo view
        </button>
      </p>
    );
  }

  if (asking === "reset-claim") {
    // [E10] the accidental tap. Two taps total, and it is written to the audit
    // log with a reason either way.
    return (
      <div className="mt-2">
        <p className="text-xs text-muted">
          Undo this claim? Only for a tap made before the waiter arrived.
        </p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setAsking(null)}
            className="rounded-lg border border-line px-3 py-2 text-xs text-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => run("reset-claim", { reason: "accidental tap" })}
            disabled={busy}
            className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-ink"
            data-testid="reset-confirm"
          >
            {busy ? "…" : "Yes, undo it"}
          </button>
        </div>
      </div>
    );
  }

  if (asking) {
    return (
      <div className="mt-2">
        <input
          className="field text-sm"
          placeholder={`Why ${asking === "refund" ? "refunded" : "rejected"}? (goes in the audit log)`}
          value={reason}
          autoFocus
          onChange={(e) => setReason(e.target.value)}
          data-testid="reason-input"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setAsking(null)}
            className="rounded-lg border border-line px-3 py-2 text-xs text-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => run(asking, { reason })}
            disabled={busy || reason.trim().length < 3}
            className="rounded-lg bg-bad px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            data-testid="reason-confirm"
          >
            {busy ? "…" : `Yes, ${asking}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "mt-2" : "mt-3"}`}>
      {state === "claimed" && (
        <button
          onClick={() => setAsking("reset-claim")}
          disabled={busy}
          className="rounded-lg bg-brand/15 px-3 py-2 text-xs font-semibold text-brand"
          data-testid="action-reset-claim"
        >
          Reset claim
        </button>
      )}
      <button
        onClick={() => run("confirm")}
        disabled={busy}
        className="rounded-lg bg-good/15 px-3 py-2 text-xs font-semibold text-good"
        data-testid="action-confirm"
      >
        Confirm
      </button>
      <button
        onClick={() => setAsking("refund")}
        disabled={busy}
        className="rounded-lg border border-line px-3 py-2 text-xs text-muted"
        data-testid="action-refund"
      >
        Refund
      </button>
      <button
        onClick={() => setAsking("reject")}
        disabled={busy}
        className="rounded-lg border border-line px-3 py-2 text-xs text-muted"
        data-testid="action-reject"
      >
        Reject
      </button>
    </div>
  );
}
