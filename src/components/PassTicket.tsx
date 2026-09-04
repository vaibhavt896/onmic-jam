"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clockTime, dayTime, maskUtr, shortDate } from "@/lib/format";
import { cleanUtr } from "@/lib/validate";
import { calendarUrl } from "@/lib/calendar";
import { haptic } from "@/lib/haptics";
import type { AttendeeState, ClaimResult, PassView } from "@/lib/types";
import { LockedVenue } from "./LockedVenue";
import { GreenClaim, deadlineFor } from "./GreenClaim";

type Props = { view: PassView; upiUrl: string; qr: string | null };

/**
 * §11.2 / §11.3 — one route, five states.
 *
 * [R7] lives here: the coupon renders at serving size (≥96px) on full green
 * ONLY while a claim window is open. In every other state the page is grey and
 * the number is small and labelled inactive — and for a void pass the server
 * never sends the number at all, so a forwarded screenshot of any other screen
 * is worth nothing.
 */
export function PassTicket({ view, upiUrl, qr }: Props) {
  const { event } = view;
  const pass = view.attendee.pass_code;

  const [state, setState] = useState<AttendeeState>(view.attendee.state);
  const [coupon, setCoupon] = useState<number | null>(view.attendee.coupon_no);
  const [claimedAt, setClaimedAt] = useState<string | null>(view.attendee.claimed_at);
  const [utr, setUtr] = useState<string | null>(view.attendee.utr);

  // [E12] closing and re-opening the page mid-window shows the same claim with
  // the same countdown — it is rebuilt from the server's `until`, not from a
  // timer that started at the tap.
  const [deadline, setDeadline] = useState<number | null>(() =>
    view.attendee.state === "claimed" && view.attendee.claim_until
      ? deadlineFor(view.attendee.claim_until, view.now)
      : null,
  );
  // Decided from the server's two timestamps, never from Date.now(), so a
  // spent pass cannot flash green for one frame before the first tick — and so
  // the server and client renders agree.
  const [expired, setExpired] = useState(
    () =>
      view.attendee.state === "claimed" &&
      (!view.attendee.claim_until ||
        Date.parse(view.attendee.claim_until) <= Date.parse(view.now)),
  );

  const green = state === "claimed" && deadline !== null && !expired;

  function applyClaim(r: ClaimResult) {
    if (r.reason === "ok" || r.reason === "active") {
      setState("claimed");
      setCoupon(r.coupon ?? null);
      setClaimedAt(r.claimed_at ?? null);
      setExpired(false);
      if (r.until && r.now) setDeadline(deadlineFor(r.until, r.now));
    } else if (r.reason === "already") {
      // The window closed while they were away. Spent, and it stays spent. [E13]
      setState("claimed");
      setCoupon(r.coupon ?? null);
      setClaimedAt(r.claimed_at ?? null);
      setDeadline(null);
      setExpired(true);
    }
  }

  // Poll while confirmed. [R8] / [E14]: when an organiser claims on this
  // person's behalf from /admin/floor, their own phone goes green too.
  useEffect(() => {
    if (state !== "confirmed") return;

    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/pass/${pass}`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const next = await res.json();
        if (next.state && next.state !== "confirmed") {
          setState(next.state);
          setCoupon(next.coupon);
          setClaimedAt(next.claimed_at);
          if (next.claim_until && next.now) {
            const d = deadlineFor(next.claim_until, next.now);
            setDeadline(d);
            setExpired(d <= Date.now());
          }
        }
      } catch {
        // no signal in a basement cafe is normal; the next tick retries
      }
    };

    const id = setInterval(poll, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state, pass]);

  if (state === "refunded" || state === "rejected") {
    return <VoidCard name={view.attendee.name} pass={pass} />;
  }

  if (green) {
    return (
      <GreenClaim
        name={view.attendee.name}
        coupon={coupon}
        deadline={deadline!}
        onExpire={() => setExpired(true)}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-9 pb-10 sm:max-w-lg">
      <header className="rise">
        <p className="mono text-flare">On Mic</p>
        <h1 className="dsp mt-3 text-[32px] tracking-tight [font-variant-numeric:tabular-nums]">
          {pass}
        </h1>
        <p className="mt-1 text-base text-text-2">{view.attendee.name}</p>
        <StatusDot state={state} spent={state === "claimed"} />
      </header>

      {state === "claimed" ? (
        <SpentBlock coupon={coupon} at={claimedAt} />
      ) : state === "confirmed" ? (
        <ConfirmedBlock
          pass={pass}
          coupon={coupon}
          event={event}
          onClaimed={applyClaim}
        />
      ) : (
        <PayBlock
          state={state}
          utr={utr}
          event={event}
          upiUrl={upiUrl}
          qr={qr}
          pass={pass}
          onSubmitted={(value) => {
            setUtr(value);
            setState("submitted");
          }}
        />
      )}

      <footer className="mt-auto pt-8 text-center">
        <p className="mono text-text-3">
          {shortDate(event.event_date)}
          {event.start_time ? ` · ${event.start_time}` : ""}
          {event.venue ? ` · ${event.venue}` : ""}
        </p>
        <Link
          href="/find"
          className="press tap mt-2 inline-flex items-center text-sm font-semibold text-flare"
        >
          Find another pass
        </Link>
      </footer>
    </main>
  );
}

// ---------------------------------------------------------------------------

function StatusDot({ state, spent }: { state: AttendeeState; spent: boolean }) {
  const map = {
    registered: { color: "bg-stop", label: "Not paid yet" },
    submitted: { color: "bg-warn", label: "Payment sent — waiting to be confirmed" },
    confirmed: { color: "bg-live", label: "Confirmed" },
    claimed: { color: "bg-text-3", label: "Mocktail claimed" },
  } as const;
  const item = map[state as keyof typeof map] ?? map.registered;
  return (
    <p className="mt-3 flex items-center gap-2 text-sm text-text-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-pill ${item.color}`} />
      {spent ? map.claimed.label : item.label}
    </p>
  );
}

// ---------------------------------------------------------------------------
// §11.2 states A and B

function PayBlock({
  state,
  utr,
  event,
  upiUrl,
  qr,
  pass,
  onSubmitted,
}: {
  state: AttendeeState;
  utr: string | null;
  event: PassView["event"];
  upiUrl: string;
  qr: string | null;
  pass: string;
  onSubmitted: (utr: string) => void;
}) {
  const submitted = state === "submitted";
  const [editing, setEditing] = useState(false);
  const showPayment = !submitted || editing;

  return (
    <>
      {submitted && (
        <div
          className="mt-6 rounded-card border border-warn/40 bg-warn/8 p-4"
          data-testid="submitted-note"
        >
          <p className="text-sm leading-relaxed">
            Transaction ID <span className="tnum font-semibold">{utr ? maskUtr(utr) : ""}</span> received.
            We confirm on Saturday night — you&apos;ll get an email and this page turns active.
          </p>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="press mt-2 text-[13px] font-semibold text-flare underline underline-offset-4"
          >
            {editing ? "never mind" : "wrong number? fix it"}
          </button>
        </div>
      )}

      {/* Above the fold, deliberately. §11.2: prepayment fails without a visible
          exit — people who cannot see how to get their money back do not pay. */}
      {!submitted && (
        <p className="mt-4 rounded-input bg-surface px-4 py-3 text-[13px] leading-relaxed text-text-2">
          Cancel before {dayTime(event.closes_at)} for a full refund. Or pass your seat to a friend —
          message us.
        </p>
      )}

      {showPayment && (
        <>
          <section className="mt-5">
            <a href={upiUrl} className="btn btn-brand" data-testid="upi-link">
              Pay ₹{event.price} by UPI
            </a>

            {/* The QR is a co-equal path, not a desktop fallback: `upi://` does
                not resolve inside the Instagram and WhatsApp in-app browsers,
                which is exactly where these users come from. §12.1 */}
            <p className="mono mt-5 text-center text-text-3">or scan with any UPI app</p>
            {qr && (
              <div className="mt-3 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt={`UPI QR code to pay ₹${event.price} to ${event.upi_vpa}`}
                  width={200}
                  height={200}
                  className="rounded-input bg-white p-2"
                />
              </div>
            )}
            <p className="tnum mt-2 text-center text-sm text-text-2">{event.upi_vpa}</p>
          </section>

          <UtrForm pass={pass} initial={utr ?? ""} onSubmitted={onSubmitted} />
          <WhereIsTheReference />
        </>
      )}
    </>
  );
}

function UtrForm({
  pass,
  initial,
  onSubmitted,
}: {
  pass: string;
  initial: string;
  onSubmitted: (utr: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    haptic(12);
    if (!cleanUtr(value)) {
      setError(
        "A UPI transaction ID is 12 digits. Check the number on your payment success screen and try again.",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/utr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pass_code: pass, utr: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      haptic(40);
      onSubmitted(cleanUtr(value)!);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 border-t border-line pt-6">
      <p className="text-sm leading-relaxed text-text-2">
        After paying, your UPI app shows a 12-digit transaction ID. Paste it here:
      </p>
      <input
        className="field tnum mt-3"
        placeholder="12-digit UPI transaction ID"
        inputMode="numeric"
        maxLength={20}
        value={value}
        aria-invalid={Boolean(error)}
        onChange={(e) => setValue(e.target.value)}
        data-testid="utr-input"
      />
      {error && (
        <p role="alert" className="mt-3 rounded-input bg-stop/12 px-4 py-3 text-sm text-stop">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn btn-brand mt-3" data-testid="utr-submit">
        {busy ? "Sending…" : "Submit"}
      </button>
    </form>
  );
}

/**
 * §11.2 — "this single element prevents more support messages than anything
 * else on the site."
 */
function WhereIsTheReference() {
  return (
    <details className="mt-4 rounded-card border border-line bg-surface px-4">
      <summary className="press tap cursor-pointer py-3 text-sm font-semibold text-flare leading-[42px]">
        Where do I find the transaction ID?
      </summary>
      <ul className="flex flex-col gap-3 pb-4 text-[13px] leading-relaxed text-text-2">
        <li>
          <strong className="text-text">Google Pay</strong> — open the payment from the home screen,
          scroll down. It is the long number after &ldquo;UPI transaction ID&rdquo;.
        </li>
        <li>
          <strong className="text-text">PhonePe</strong> — History → tap the payment. Look for
          &ldquo;UTR&rdquo; or &ldquo;Transaction ID&rdquo;.
        </li>
        <li>
          <strong className="text-text">Paytm</strong> — Balance &amp; History → tap the payment →
          &ldquo;UPI Ref No.&rdquo;
        </li>
        <li className="text-text-3">
          It is always exactly 12 digits. Not the order ID, not the amount.
        </li>
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// §11.3 state C — confirmed, inert. Design screen 03: "You're in", the coupon,
// and the locked venue as the reward for booking. The number is present but
// visibly not a ticket, so a forwarded screenshot of this screen is worth
// nothing. [R7]

function ConfirmedBlock({
  pass,
  coupon,
  event,
  onClaimed,
}: {
  pass: string;
  coupon: number | null;
  event: PassView["event"];
  onClaimed: (r: ClaimResult) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function claim() {
    setBusy(true);
    setError("");
    haptic(12);

    // §12.3 — no offline queue, ever. A claim must be authoritative at the
    // moment it is granted; an optimistic local claim that later fails on the
    // server hands out a drink you cannot account for. One reliable path, plus
    // one human fallback, beats two unreliable paths.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 6000);
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pass_code: pass }),
        signal: abort.signal,
      });
      const data = (await res.json()) as ClaimResult;
      if (data.ok || data.reason === "already") {
        onClaimed(data);
        return;
      }
      setError(
        data.reason === "not_paid"
          ? "This pass isn't confirmed yet. Find an organiser."
          : data.reason === "void"
            ? "This pass is no longer valid. Find an organiser."
            : "We couldn't find that pass. Find an organiser.",
      );
    } catch {
      setError("Ask an organiser to claim it for you.");
    } finally {
      clearTimeout(timer);
      setBusy(false);
      setAsking(false);
    }
  }

  return (
    <>
      <section className="mt-7 rounded-card border border-live/40 bg-live/8 p-6 text-center">
        <p className="mono text-live">✓ You&apos;re in</p>
        <p className="mono mt-6 text-text-3">coupon</p>
        <p
          className="dsp text-[28px] text-text-3 [font-variant-numeric:tabular-nums]"
          data-testid="coupon-inactive"
        >
          {coupon}
        </p>
        <p className="mono mt-2 text-text-3" data-testid="coupon-inactive-label">
          not active yet
        </p>
      </section>

      <div className="mt-3">
        <LockedVenue
          venue={event.venue}
          locked={event.venue_locked}
          unlocksAt={event.venue_unlocks_at}
          compact
        />
      </div>

      <AddToCalendar event={event} pass={pass} coupon={coupon} />

      <button
        onClick={() => {
          haptic(12);
          setAsking(true);
        }}
        disabled={busy}
        className="btn btn-brand mt-5 h-auto flex-col gap-1 py-4"
        data-testid="claim-button"
      >
        <span>CLAIM MY MOCKTAIL</span>
        <span className="text-[11px] font-medium opacity-75">
          only tap when the waiter is standing with you
        </span>
      </button>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-input bg-stop/12 px-4 py-3 text-sm text-stop"
          data-testid="claim-error"
        >
          {error}
        </p>
      )}

      {asking && <ConfirmSheet busy={busy} onCancel={() => setAsking(false)} onConfirm={claim} />}
    </>
  );
}

/** Design screen 03 — the reward for booking gets a reason to be re-opened. */
function AddToCalendar({
  event,
  pass,
  coupon,
}: {
  event: PassView["event"];
  pass: string;
  coupon: number | null;
}) {
  const [href, setHref] = useState("");

  useEffect(() => {
    setHref(
      calendarUrl({
        name: event.name,
        date: event.event_date,
        startTime: event.start_time,
        venue: event.venue,
        passCode: pass,
        coupon,
        ticketUrl: window.location.href,
      }),
    );
  }, [event, pass, coupon]);

  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() => haptic(12)}
      className="btn btn-ghost btn-sm mt-3"
      data-testid="add-to-calendar"
    >
      Add to calendar
    </a>
  );
}

/**
 * §11.3 — "Not yet" is the visually dominant option and "Yes, claim it" the
 * secondary one. The asymmetry is deliberate: the expensive mistake is claiming
 * too early, so the safe answer is the easy one. [E10]
 */
function ConfirmSheet({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/75 p-4" data-testid="claim-sheet">
      <div className="w-full rounded-sheet border border-line bg-surface p-6">
        <p className="text-lg leading-relaxed font-bold">Is the waiter with you right now?</p>
        <p className="mt-2 text-sm text-text-2">Your mocktail can only be claimed once.</p>

        <button
          onClick={onCancel}
          disabled={busy}
          className="btn btn-brand mt-6"
          data-testid="claim-cancel"
        >
          Not yet
        </button>
        {/* Deliberately not a `btn`: it keeps a 48px touch target but is
            nowhere near the weight of "Not yet". §11.3 */}
        <button
          onClick={onConfirm}
          disabled={busy}
          className="press mx-auto mt-3 block min-h-[48px] px-4 text-sm text-text-2 underline underline-offset-4"
          data-testid="claim-confirm"
        >
          {busy ? "Claiming…" : "Yes, claim it"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §11.3 — spent. Reached without a reload when the window closes. No large
// number anywhere in the DOM. [R6] acceptance test 22.

function SpentBlock({ coupon, at }: { coupon: number | null; at: string | null }) {
  return (
    <section
      className="mt-7 rounded-card border border-line bg-surface p-6 text-center"
      data-testid="spent-card"
    >
      <p className="mono text-text-3">coupon</p>
      <p
        className="dsp text-[28px] text-text-3 [font-variant-numeric:tabular-nums]"
        data-testid="coupon-inactive"
      >
        {coupon}
      </p>
      <p className="mt-4 text-base font-semibold text-text-2" data-testid="claimed-at">
        Claimed {at ? clockTime(at) : ""}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-text-3">
        One drink per pass. If this was a mistake, an organiser can undo it.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function VoidCard({ name, pass }: { name: string; pass: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-8">
      <div
        className="rounded-card border border-line bg-surface p-6 text-center"
        data-testid="void-card"
      >
        <div className="mx-auto h-2.5 w-2.5 rounded-pill bg-text-3" />
        <p className="mt-4 text-lg font-bold text-text-2">This pass is no longer valid.</p>
        <p className="mt-2 text-sm text-text-3">
          {name} · {pass}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-text-3">
          If that&apos;s unexpected, message the organisers on WhatsApp.
        </p>
      </div>
    </main>
  );
}
