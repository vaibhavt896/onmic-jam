"use client";

import { useState } from "react";

/**
 * §11.5 — the leak detector, and the entire point of tracking claims.
 *
 * [R10] / §3.4: claims are NOT the invoice. The cafe is paid the committed
 * headcount whatever happens. If their count exceeds ours, those drinks were
 * served without a green screen and came out of *their* margin — which is what
 * gives them a reason to look at the screen at all. It is a conversation with
 * the cafe, not a charge to the community.
 */
export function CafeCount({ claimed }: { claimed: number }) {
  const [value, setValue] = useState("");
  const theirs = Number(value);
  const usable = value.trim() !== "" && Number.isFinite(theirs) && theirs >= 0;
  const gap = usable ? theirs - claimed : 0;

  return (
    <section className="mt-5 rounded-xl border border-line bg-card p-4">
      <label className="text-xs font-semibold tracking-widest text-dim uppercase">
        Cafe&apos;s own mocktail count
      </label>
      <div className="mt-2 flex items-center gap-3">
        <input
          className="field tnum"
          inputMode="numeric"
          placeholder="ask them at the end"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
          data-testid="cafe-count"
        />
        <span className="shrink-0 text-sm text-dim tnum">vs {claimed} claimed</span>
      </div>

      {usable && gap > 0 && (
        <p className="mt-3 rounded-lg bg-brand/10 px-3 py-2 text-xs leading-relaxed text-brand" data-testid="leak">
          ⚠ Cafe reports {theirs} mocktails → {gap} served without a green screen. Raise it with the
          cafe. Not a charge to the community — an over-served drink comes out of their margin,
          which is exactly why the green screen is worth their while.
        </p>
      )}
      {usable && gap === 0 && (
        <p className="mt-3 rounded-lg bg-good/10 px-3 py-2 text-xs text-good" data-testid="leak">
          ✓ Their count matches ours.
        </p>
      )}
      {usable && gap < 0 && (
        <p className="mt-3 rounded-lg bg-card px-3 py-2 text-xs leading-relaxed text-muted" data-testid="leak">
          They counted {-gap} fewer than we claimed. Someone tapped CLAIM and never ordered — no
          money moves either way.
        </p>
      )}
    </section>
  );
}
