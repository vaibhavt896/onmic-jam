"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cleanPhone } from "@/lib/validate";
import { haptic } from "@/lib/haptics";

export function FindForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    haptic(12);
    if (!cleanPhone(phone)) {
      setError("10 digits, starting with 6, 7, 8 or 9.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/find", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      router.replace(data.url);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6">
      <input
        className="field tnum"
        placeholder="Phone (10 digits)"
        inputMode="numeric"
        autoComplete="tel"
        autoFocus
        maxLength={15}
        value={phone}
        aria-invalid={Boolean(error)}
        onChange={(e) => setPhone(e.target.value)}
      />
      {error && (
        <p role="alert" className="mt-3 rounded-input bg-stop/12 px-4 py-3 text-sm text-stop">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn btn-brand mt-4">
        {busy ? "Looking…" : "Find my pass"}
      </button>
    </form>
  );
}
