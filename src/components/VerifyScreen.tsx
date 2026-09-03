"use client";

import { useState } from "react";
import { MAX_PASTE_BYTES } from "@/lib/validate";
import { rupees } from "@/lib/format";
import type { VerifyResult } from "@/lib/types";
import { AttendeeActions } from "./AttendeeActions";

/**
 * §11.6 — one textarea, one button, four result buckets, and the total check.
 *
 * Re-running the same paste is safe and produces confirmed: [] the second time.
 * The UI says so, because an admin who is not sure whether the first click
 * worked will click again, and the app has to be right about that. [E16]
 */
export function VerifyScreen() {
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "That didn't work.");
        setResult(null);
      } else {
        setResult(data as VerifyResult);
      }
    } catch {
      setError("Couldn't reach the server.");
    }
    setBusy(false);
  }

  const bytes = new TextEncoder().encode(raw).length;
  const tooBig = bytes > MAX_PASTE_BYTES;

  return (
    <>
      <h1 className="text-lg font-bold tracking-widest text-white uppercase">Verify payments</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Open PhonePe / Paytm for Business → History → export or select all → copy. Paste it here.
        Format does not matter — we only read 12-digit reference numbers.
      </p>

      <textarea
        className="field mt-4 min-h-44 font-mono text-xs"
        placeholder="(paste the statement)"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        data-testid="verify-paste"
      />
      <div className="mt-1 flex justify-between text-[11px] text-dim">
        <span>{(bytes / 1024).toFixed(1)} KB of 200 KB</span>
        <span className={tooBig ? "text-bad" : ""}>{tooBig ? "too large" : ""}</span>
      </div>

      <button
        onClick={run}
        disabled={busy || raw.trim() === ""}
        className="btn btn-brand mt-3"
        data-testid="verify-run"
      >
        {busy ? "Matching…" : "Match payments"}
      </button>

      <p className="mt-2 text-center text-xs text-dim">
        Safe to paste again — already-confirmed people are skipped.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-bad/12 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-6 space-y-4" data-testid="verify-result">
          <TotalCheck result={result} />

          <div className="rounded-xl border border-good/40 bg-good/8 p-4">
            <p className="text-sm font-semibold text-good" data-testid="verify-summary">
              ✓ {result.confirmed.length} confirmed
              {result.confirmed.length > 0 &&
                ` · coupons ${result.confirmed[0]!.coupon}–${result.confirmed[result.confirmed.length - 1]!.coupon}`}
              {` · ${result.confirmed.filter((c) => c.emailed).length} emailed`}
            </p>
            <p className="mt-1 text-xs text-dim">
              {result.scanned} distinct reference numbers found in the paste.
            </p>
            {result.confirmed.some((c) => !c.emailed) && (
              <RetryEmails count={result.confirmed.filter((c) => !c.emailed).length} />
            )}
          </div>

          <Bucket
            tone="brand"
            title={`${result.pending.length} submitted a reference we can't find`}
            hint="Never auto-rejected — decide each one."
            rows={result.pending.map((p) => ({
              id: p.id,
              name: p.name,
              meta: `${p.utr} · ····${p.phone.slice(-4)}`,
            }))}
          />

          <Bucket
            tone="plain"
            title={`${result.no_utr.length} registered, never paid`}
            hint="Costs nothing and blocks nobody — R2. Leave them, or reject to tidy up."
            rows={result.no_utr.map((p) => ({
              id: p.id,
              name: p.name,
              meta: `····${p.phone.slice(-4)}`,
            }))}
          />

          <Bucket
            tone="bad"
            title={`${result.over_capacity.length} over capacity`}
            hint="Paid but the room is full. Refund these by hand over UPI. [E7]"
            rows={result.over_capacity.map((p) => ({
              id: p.id,
              name: p.name,
              meta: `····${p.phone.slice(-4)}`,
            }))}
          />
        </div>
      )}
    </>
  );
}

function Bucket({
  title,
  hint,
  rows,
  tone,
}: {
  title: string;
  hint: string;
  tone: "brand" | "bad" | "plain";
  rows: { id: string; name: string; meta: string }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-card px-4 py-3 text-sm text-dim">{title}</p>
    );
  }
  const border = tone === "brand" ? "border-brand/40" : tone === "bad" ? "border-bad/40" : "border-line";
  return (
    <div className={`rounded-xl border ${border} bg-card p-4`}>
      <p className="text-sm font-semibold text-bright">{title}</p>
      <p className="mt-1 text-xs text-dim">{hint}</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
            <p className="text-sm text-white">{r.name}</p>
            <p className="text-xs text-dim tnum">{r.meta}</p>
            <AttendeeActions id={r.id} compact />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RetryEmails({ count }: { count: number }) {
  const [state, setState] = useState<string>("");
  return (
    <button
      onClick={async () => {
        setState("…");
        try {
          const res = await fetch("/api/admin/email/retry", { method: "POST" });
          const data = await res.json();
          setState(
            data.email_configured === false
              ? "Email is not configured — that's fine, /find is the real recovery path."
              : `Sent ${data.sent} of ${data.pending}.`,
          );
        } catch {
          setState("Couldn't reach the server.");
        }
      }}
      className="mt-2 text-xs text-brand underline"
    >
      {state || `${count} not emailed — retry`}
    </button>
  );
}

/**
 * §12.2 / §11.6 — the total check, always visible above the buckets.
 *
 * `am` in a UPI deep link is a suggestion, not a lock: some payer apps let it
 * be edited before confirming, so ₹300 can arrive as ₹250 with a perfectly
 * valid reference that matches cleanly. One sum catches that whole class of
 * underpayment. It never blocks a confirmation — a short payment is a person to
 * talk to, not a system error. [E6]
 */
function TotalCheck({ result }: { result: VerifyResult }) {
  const { total, price } = result;
  const gap = total.in_paste - total.expected;

  if (total.readable === 0) {
    return (
      <div className="rounded-xl border border-line bg-card p-4" data-testid="total-check">
        <p className="text-sm text-muted">
          No amounts readable next to the references in this paste — the totals check is skipped.
        </p>
        <p className="mt-1 text-xs text-dim">
          Compare {rupees(total.matched * price)} against your UPI app&apos;s own total by hand:{" "}
          {total.matched} matched × ₹{price}.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border p-4 ${gap === 0 ? "border-good/40 bg-good/8" : "border-brand/40 bg-brand/8"}`}
      data-testid="total-check"
    >
      <dl className="space-y-1 text-sm tnum">
        <div className="flex justify-between">
          <dt className="text-muted">
            Expected {total.readable} × ₹{price}
          </dt>
          <dd className="font-semibold text-bright">{rupees(total.expected)}</dd>
        </div>
        <div className="flex justify-between border-b border-line pb-2">
          <dt className="text-muted">In paste</dt>
          <dd className="font-semibold text-bright" data-testid="in-paste">
            {rupees(total.in_paste)}
          </dd>
        </div>
      </dl>

      {gap === 0 ? (
        <p className="mt-2 text-sm font-semibold text-good" data-testid="total-verdict">
          ✓ Balances.
        </p>
      ) : (
        <p className="mt-2 text-sm leading-relaxed font-semibold text-brand" data-testid="total-verdict">
          ⚠ {gap < 0 ? `Short by ${rupees(-gap)}` : `Over by ${rupees(gap)}`} — someone edited the
          amount in their UPI app. Find them in the list below; do not just confirm and forget.
        </p>
      )}

      {total.readable < total.matched && (
        <p className="mt-2 text-xs text-dim">
          Amounts were readable for {total.readable} of {total.matched} matched references — the rest
          are not counted either way.
        </p>
      )}
    </div>
  );
}
