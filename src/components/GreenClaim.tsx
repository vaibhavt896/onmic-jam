"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

/**
 * §11.3 state D — the screen the waiter reads, and the only green screen in the
 * product. If green appears anywhere else it stops meaning "serve this person"
 * and the cafe rule breaks.
 *
 * Shared by the attendee's ticket and by /admin/floor, so that a drink claimed
 * on someone's behalf [R8] looks pixel-identical to one they claimed
 * themselves. Staff learn exactly one rule — *green means serve* — and that
 * rule only holds if there is exactly one green screen.
 */
export function GreenClaim({
  name,
  coupon,
  deadline,
  onExpire,
  onDismiss,
}: {
  name: string;
  coupon: number | null;
  /** absolute ms on THIS device's clock — see deadlineFor() */
  deadline: number;
  onExpire: () => void;
  onDismiss?: () => void;
}) {
  const [left, setLeft] = useState<number | null>(null);
  const sentinel = useRef<WakeLockSentinel | null>(null);

  // One of the two moments worth feeling rather than reading.
  useEffect(() => {
    haptic(40);
  }, []);

  // The live countdown is the anti-screenshot measure: a screenshot freezes,
  // the page does not. Staff are never asked to check it, but a forwarded
  // screenshot stays trivially identifiable if it ever matters.
  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining <= 0) onExpire();
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline, onExpire]);

  // Keep the screen awake for the walk to the counter. Degrade silently where
  // the API is missing — most Android browsers in this room will have it.
  const acquire = useCallback(async () => {
    try {
      sentinel.current = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      /* unsupported or denied — not worth telling anyone about */
    }
  }, []);

  useEffect(() => {
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel.current?.release().catch(() => {});
      sentinel.current = null;
    };
  }, [acquire]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-live px-6 py-10 text-center"
      data-testid="green-screen"
    >
      <p className="mono text-[#04160D]/70">Mocktail</p>
      <p
        className="dsp pop my-1.5 text-[clamp(96px,36vw,200px)] leading-[0.9] text-white [font-variant-numeric:tabular-nums]"
        data-testid="coupon-active"
      >
        {coupon}
      </p>
      <p className="text-2xl font-bold text-[#04160D]">{name}</p>
      <p className="tnum mt-8 text-lg font-semibold text-[#04160D]/60" data-testid="claim-countdown">
        {left === null ? "" : `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
      </p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="press mt-10 rounded-pill border border-[#04160D]/20 px-5 py-3 text-sm font-bold text-[#04160D]/70"
          data-testid="green-dismiss"
        >
          Done
        </button>
      )}
    </div>
  );
}

/**
 * The deadline as this phone's own clock will see it.
 *
 * §11.3: "Compute remaining time from the server's `until`, not from a client
 * timer started at tap. Phone clocks are wrong more often than you would like."
 * Subtracting the server's own `now` from its `until` leaves a duration, which
 * is the part a wrong clock still gets right — elapsed time is accurate even
 * when the wall clock is three minutes out.
 */
export function deadlineFor(until: string, serverNow: string): number {
  return Date.now() + (Date.parse(until) - Date.parse(serverNow));
}
