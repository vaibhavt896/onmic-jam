"use client";

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

/**
 * "The thumb owns the bottom third."
 *
 * The primary action is never something you scroll to find. The bar rises once
 * at 60% of viewport height scrolled — 420ms on the spring curve — and then it
 * stays. On a screen short enough that there is nothing to scroll it is up from
 * the start, because the rule is that the action is always in reach, not that
 * there is an animation.
 *
 * It yields to the form. "One screen, one job": once the booking form is
 * actually on screen, the form's own button is the action in reach, and two
 * primary buttons stacked on top of each other is the exact thing the rule
 * against equal-weight actions exists to prevent.
 */
export function StickyBar({
  price,
  seatsLeft,
  targetId,
}: {
  price: number;
  seatsLeft: number;
  targetId: string;
}) {
  const [risen, setRisen] = useState(false);
  const [atForm, setAtForm] = useState(false);
  const raised = useRef(false);

  useEffect(() => {
    const cleanup: (() => void)[] = [];

    // Design screen 01 has the bar on the first viewport, and build note 01 is
    // "rises once, persists". It springs in just after the hero paints rather
    // than waiting for a scroll: on this layout the form is the very next
    // screen, so a 60%-scroll trigger would fire only after the bar had already
    // become redundant.
    const timer = setTimeout(() => {
      raised.current = true;
      setRisen(true);
    }, 600);
    cleanup.push(() => clearTimeout(timer));

    const form = document.getElementById(targetId);
    if (form) {
      const io = new IntersectionObserver(
        ([entry]) => setAtForm(Boolean(entry?.isIntersecting)),
        { threshold: 0.4 },
      );
      io.observe(form);
      cleanup.push(() => io.disconnect());
    }

    return () => cleanup.forEach((fn) => fn());
  }, [targetId]);

  function book() {
    haptic(12);
    const target = document.getElementById(targetId);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Focus after the scroll settles, so the keyboard does not fight it.
    setTimeout(() => target?.querySelector("input")?.focus(), 420);
  }

  return (
    <div className="sticky-bar" data-up={risen && !atForm} data-testid="sticky-bar">
      <span className="mono text-text-2">
        ₹{price} · {seatsLeft} left
      </span>
      <button onClick={book} className="btn btn-brand btn-sm w-auto" data-testid="sticky-book">
        Book a seat
      </button>
    </div>
  );
}
