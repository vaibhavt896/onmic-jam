"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/admin";
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "That didn't work.");
        setBusy(false);
        return;
      }
      // A full navigation so middleware sees the freshly set cookie. Nothing
      // may follow it — a second navigation here aborts this one.
      window.location.href = next.startsWith("/") ? next : "/admin";
    } catch {
      setError("We couldn't reach the server.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6">
      <input
        className="field"
        type="password"
        placeholder="Passcode"
        autoFocus
        autoComplete="current-password"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        data-testid="passcode"
      />
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-bad/12 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn btn-brand mt-4" data-testid="login-submit">
        {busy ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
