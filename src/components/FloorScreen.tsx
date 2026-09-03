"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clockTime, minutesAgo } from "@/lib/format";
import { cleanPhone } from "@/lib/validate";
import type { ClaimResult, Roster, RosterPerson, WalkinResult } from "@/lib/types";
import { GreenClaim, deadlineFor } from "./GreenClaim";

const LAST_EVENT_KEY = "onmic.lastEvent";
const rosterKey = (id: string) => `onmic.roster.${id}`;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — the in-memory copy still works for tonight */
  }
}

/** Case- and diacritic-insensitive, so "Vaibhav" matches "Vaibhāv". */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * §11.4 — the one screen the organisers keep open during the jam. Three jobs:
 *
 *   1. [R8] claim on someone's behalf when their phone is dead or has no signal
 *   2. [R12] register a walk-in at door price in under 30 seconds
 *   3. [E10] reset an accidental claim, two taps
 *
 * Search runs against a locally cached roster, never a round-trip per
 * keystroke. There is deliberately NO offline claim queue (§12.3): a claim must
 * be authoritative at the moment it is granted, and an optimistic local claim
 * that later fails on the server hands out a drink you cannot account for.
 */
export function FloorScreen({
  doorPrice,
  vpa,
  qr,
}: {
  doorPrice: number;
  vpa: string | null;
  qr: string | null;
}) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [query, setQuery] = useState("");
  const [online, setOnline] = useState(true);
  const [booted, setBooted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [green, setGreen] = useState<{ name: string; coupon: number | null; deadline: number } | null>(
    null,
  );
  const [note, setNote] = useState("");
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [walkinOpen, setWalkinOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/roster", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as Roster;
      localStorage.setItem(LAST_EVENT_KEY, next.event.id);
      write(rosterKey(next.event.id), next);
      setRoster(next);
      setOnline(true);
    } catch {
      // §11.4: if the fetch fails but a cache exists, use it and show its age.
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const last = localStorage.getItem(LAST_EVENT_KEY);
    if (last) {
      const cached = read<Roster>(rosterKey(last));
      if (cached) setRoster(cached);
    }
    setBooted(true);
    void refresh();

    const onOnline = () => {
      setOnline(true);
      void refresh();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh]);

  // Auto-clear the small confirmations so the volunteer can look away.
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(""), 4000);
    return () => clearTimeout(id);
  }, [note]);

  // --- the three jobs ----------------------------------------------------

  async function claimFor(person: RosterPerson) {
    setBusyId(person.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/attendee/${person.id}/claim`, { method: "POST" });
      const data = (await res.json()) as ClaimResult;
      if ((data.reason === "ok" || data.reason === "active") && data.until && data.now) {
        setGreen({
          name: data.name ?? person.name,
          coupon: data.coupon ?? person.coupon,
          deadline: deadlineFor(data.until, data.now),
        });
        setQuery("");
        void refresh();
      } else if (data.reason === "already") {
        setError(
          `${data.name ?? person.name} already claimed at ${
            data.claimed_at ? clockTime(data.claimed_at) : "earlier"
          }. Undo it below if it was a mistake.`,
        );
        void refresh();
      } else {
        setError(`Can't claim for ${person.name}: ${data.reason.replace("_", " ")}.`);
      }
    } catch {
      setError("No signal — a claim has to reach the server. Try again in a moment.");
    }
    setBusyId(null);
  }

  async function resetClaim(person: RosterPerson) {
    setBusyId(person.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/attendee/${person.id}/reset-claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "accidental tap" }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.message ?? "That didn't work.");
      else {
        setNote(`${person.name}'s drink is claimable again.`);
        await refresh();
      }
    } catch {
      setError("Couldn't reach the server.");
    }
    setConfirmReset(null);
    setBusyId(null);
  }

  // --- search (local cache only, never a round-trip per keystroke) -------
  const matches = useMemo(() => {
    if (!roster) return [];
    const q = fold(query.trim());
    if (!q) return [];
    return roster.people
      .filter(
        (p) =>
          fold(p.name).includes(q) ||
          p.phone4.includes(q) ||
          String(p.coupon ?? "") === q ||
          fold(p.pass).includes(q),
      )
      .slice(0, 25);
  }, [roster, query]);

  const claimed = roster?.people.filter((p) => p.state === "claimed").length ?? 0;
  const headcount = roster?.people.length ?? 0;

  if (!booted) return null;

  if (!roster) {
    return (
      <div className="rounded-xl border border-line bg-card p-6 text-center">
        <p className="text-sm text-muted">
          {online
            ? "No event on the floor yet."
            : "You're offline and there's no cached roster on this phone. Get online once and it works from cache after that."}
        </p>
        <button onClick={() => void refresh()} className="btn btn-ghost mt-4">
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-widest text-white uppercase">Floor</h1>
        <button
          onClick={() => void refresh()}
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium ${
            online ? "bg-good/15 text-good" : "bg-line text-muted"
          }`}
          data-testid="floor-count"
        >
          <span className="h-2 w-2 rounded-full bg-current" />
          <span className="tnum">
            {claimed}/{headcount}
          </span>
          <span className="opacity-60">⟳</span>
        </button>
      </div>

      <input
        ref={searchRef}
        className="field"
        placeholder="🔍 search name / coupon / ····4"
        autoFocus
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="floor-search"
      />

      {!online && (
        <p className="mt-3 rounded-lg bg-card px-3 py-2 text-center text-xs text-dim">
          Roster from {minutesAgo(roster.fetched_at)} min ago. Search still works; claiming needs
          signal.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-bad/12 px-3 py-2 text-sm text-bad" data-testid="floor-error">
          {error}
        </p>
      )}
      {note && (
        <p className="mt-3 rounded-lg bg-good/12 px-3 py-2 text-sm text-good" data-testid="floor-note">
          {note}
        </p>
      )}

      <ul className="mt-4 overflow-hidden rounded-xl border border-line" data-testid="floor-results">
        {matches.map((p) => (
          <li key={p.id} className="border-b border-line last:border-0">
            <div className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium text-white">{p.name}</p>
                <p className="text-xs text-dim tnum">
                  ····{p.phone4}
                  {p.coupon != null && ` · coupon ${p.coupon}`}
                </p>
              </div>

              {p.state === "claimed" ? (
                <div className="shrink-0 text-right">
                  <span className="text-xs text-good">
                    ✓ claimed {p.claimed_at ? clockTime(p.claimed_at) : ""}
                  </span>
                  {/* [E10] two taps, and every reset is logged with a reason. */}
                  {confirmReset === p.id ? (
                    <button
                      onClick={() => void resetClaim(p)}
                      disabled={busyId === p.id}
                      className="mt-1 block w-full rounded bg-bad px-2 py-1 text-[11px] font-semibold text-white"
                      data-testid={`reset-confirm-${p.pass}`}
                    >
                      {busyId === p.id ? "…" : "yes, undo it"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmReset(p.id)}
                      className="mt-1 block w-full text-[11px] text-muted underline"
                      data-testid={`reset-${p.pass}`}
                    >
                      undo claim
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => void claimFor(p)}
                  disabled={busyId === p.id}
                  className="btn btn-brand w-auto shrink-0 px-4"
                  data-testid={`claim-for-${p.pass}`}
                >
                  {busyId === p.id ? "…" : "CLAIM FOR THEM"}
                </button>
              )}
            </div>
          </li>
        ))}

        {query.trim().length >= 2 && matches.length === 0 && (
          <li className="p-4 text-center">
            <p className="text-sm text-bad">Nobody paid by that name.</p>
            <p className="mt-1 text-xs text-dim">
              No green screen, no mocktail. Add them as a walk-in below.
            </p>
          </li>
        )}
      </ul>

      {/* [R12] an extra body becomes revenue instead of an argument. */}
      <button
        onClick={() => setWalkinOpen(true)}
        className="btn btn-ghost mt-4"
        data-testid="walkin-open"
      >
        + WALK-IN · ₹{doorPrice}
      </button>

      {walkinOpen && (
        <WalkinSheet
          doorPrice={doorPrice}
          vpa={vpa}
          qr={qr}
          onClose={() => setWalkinOpen(false)}
          onDone={() => void refresh()}
        />
      )}

      {green && (
        <GreenClaim
          name={green.name}
          coupon={green.coupon}
          deadline={green.deadline}
          onExpire={() => setGreen(null)}
          onDismiss={() => setGreen(null)}
        />
      )}
    </>
  );
}

/**
 * §10.6 / §11.4 — name, phone, show them the QR, confirm. It has to be faster
 * than arguing or nobody will use it, so there are exactly two fields.
 */
function WalkinSheet({
  doorPrice,
  vpa,
  qr,
  onClose,
  onDone,
}: {
  doorPrice: number;
  vpa: string | null;
  qr: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<WalkinResult | null>(null);

  async function save() {
    setError("");
    if (name.trim().length < 2 || !cleanPhone(phone)) {
      setError("Name and a 10-digit phone number, that's all.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/walkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.message ?? "That didn't work.");
      else {
        setDone(data as WalkinResult);
        onDone();
      }
    } catch {
      setError("Couldn't reach the server.");
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end overflow-y-auto bg-black/75 p-4">
      <div className="w-full rounded-2xl border border-line bg-surface p-5">
        {done ? (
          <div className="text-center" data-testid="walkin-done">
            <p className="text-sm font-bold tracking-[0.2em] text-good uppercase">
              {done.status === "already" ? "Already in" : "Walk-in added"}
            </p>
            <p className="mt-4 text-[11px] tracking-[0.2em] text-dim uppercase">coupon</p>
            <p className="text-5xl font-bold text-brand tnum">{done.coupon}</p>
            <p className="mt-3 text-sm text-bright">
              {done.name} · ₹{done.amount} to collect
            </p>
            {qr && (
              <div className="mt-4 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt={`UPI QR to pay ₹${doorPrice}`}
                  width={180}
                  height={180}
                  className="rounded-lg bg-white p-2"
                />
              </div>
            )}
            {vpa && <p className="mt-2 text-xs text-muted tnum">{vpa}</p>}
            <p className="mt-4 rounded-lg bg-card px-3 py-2 text-xs leading-relaxed text-muted">
              Send them to <span className="text-bright">{done.url}</span> — that is the page that
              turns green when the waiter arrives.
            </p>
            <button onClick={onClose} className="btn btn-brand mt-4">
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold text-white">Walk-in · ₹{doorPrice}</p>
            <p className="mt-1 text-xs text-dim">
              They pay ₹{doorPrice} now and get a coupon like everyone else.
            </p>
            <input
              className="field mt-4"
              placeholder="Name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="walkin-name"
            />
            <input
              className="field mt-2 tnum"
              placeholder="Phone (10 digits)"
              inputMode="numeric"
              maxLength={15}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              data-testid="walkin-phone"
            />
            {error && <p className="mt-2 text-xs text-bad" data-testid="walkin-error">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={onClose} className="btn btn-ghost">
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={busy}
                className="btn btn-brand"
                data-testid="walkin-save"
              >
                {busy ? "…" : `Add · ₹${doorPrice}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
