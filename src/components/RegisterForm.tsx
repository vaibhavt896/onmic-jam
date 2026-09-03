"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cleanEmail, cleanName, cleanPhone } from "@/lib/validate";
import { haptic } from "@/lib/haptics";

type FieldName = "name" | "phone" | "email";

/**
 * Design screen 02 — two fields. Name and phone.
 *
 * "Email is optional and lives behind a link, because every extra required
 * field costs bookings and the pass works by phone lookup anyway." /find
 * recovers a pass by phone, and §13 says the email is a receipt and never the
 * ticket — so nothing is lost by moving it out of the way.
 *
 * Validation is inline on blur, not on submit: nobody should tap the button and
 * get bounced back.
 */
export function RegisterForm({ price }: { price: number }) {
  const router = useRouter();
  const [values, setValues] = useState({ name: "", phone: "", email: "", instagram: "" });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [extras, setExtras] = useState(false);

  function check(field: FieldName, value: string): string {
    if (field === "name") return cleanName(value) ? "" : "Enter your name (2–60 characters).";
    if (field === "phone") return cleanPhone(value) ? "" : "10 digits, starting with 6, 7, 8 or 9.";
    return cleanEmail(value).ok ? "" : "That email doesn't look right.";
  }

  function set(field: keyof typeof values, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    if (field !== "instagram" && errors[field]) {
      setErrors((e) => ({ ...e, [field]: check(field, value) || undefined }));
    }
  }

  function blur(field: FieldName) {
    setErrors((e) => ({ ...e, [field]: check(field, values[field]) || undefined }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    haptic(12);

    const found: Partial<Record<FieldName, string>> = {};
    for (const field of ["name", "phone", "email"] as FieldName[]) {
      const msg = check(field, values[field]);
      if (msg) found[field] = msg;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      if (found.email) setExtras(true); // never hide the field that is wrong
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) {
        // §10: render the server's sentence verbatim.
        setFormError(data.message ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      haptic(40);
      // replace, not push, so Back does not resubmit
      router.replace(data.url);
    } catch {
      setFormError("We couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate id="book" className="mt-5 flex flex-col gap-3">
      <Field
        label="Your name"
        error={errors.name}
        input={
          <input
            className="field"
            placeholder="Your name"
            autoComplete="name"
            value={values.name}
            aria-invalid={Boolean(errors.name)}
            onChange={(e) => set("name", e.target.value)}
            onBlur={() => blur("name")}
          />
        }
      />
      <Field
        label="Phone"
        error={errors.phone}
        input={
          <input
            className="field tnum"
            placeholder="Phone (10 digits)"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={15}
            value={values.phone}
            aria-invalid={Boolean(errors.phone)}
            onChange={(e) => set("phone", e.target.value)}
            onBlur={() => blur("phone")}
          />
        }
      />

      {extras ? (
        <>
          <Field
            label="Email"
            error={errors.email}
            input={
              <input
                className="field"
                placeholder="Email (for your ticket)"
                type="email"
                autoComplete="email"
                autoFocus
                value={values.email}
                aria-invalid={Boolean(errors.email)}
                onChange={(e) => set("email", e.target.value)}
                onBlur={() => blur("email")}
              />
            }
          />
          <Field
            label="Instagram"
            input={
              <input
                className="field"
                placeholder="Instagram (optional)"
                autoCapitalize="none"
                value={values.instagram}
                onChange={(e) => set("instagram", e.target.value)}
              />
            }
          />
        </>
      ) : (
        <button
          type="button"
          onClick={() => setExtras(true)}
          className="press tap self-start text-[13px] font-semibold text-flare underline underline-offset-4"
          data-testid="add-email"
        >
          Add email for a receipt →
        </button>
      )}

      {formError && (
        <p role="alert" className="rounded-input bg-stop/12 px-4 py-3 text-sm text-stop">
          {formError}
        </p>
      )}

      <button type="submit" disabled={busy} className="btn btn-brand" data-testid="register-submit">
        {busy ? "One moment…" : `Pay ₹${price} by UPI`}
      </button>
    </form>
  );
}

function Field({
  label,
  input,
  error,
}: {
  label: string;
  input: React.ReactNode;
  error?: string;
}) {
  return (
    <div>
      <label className="sr-only">{label}</label>
      {input}
      {error && <p className="mt-1.5 px-1 text-[13px] text-stop">{error}</p>}
    </div>
  );
}
