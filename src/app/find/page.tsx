import Link from "next/link";
import { Shell, Wordmark } from "@/components/Brand";
import { FindForm } from "@/components/FindForm";

export const dynamic = "force-dynamic";

/**
 * §10.3 — this page removes the entire class of "I lost my link" WhatsApp
 * messages, and it is the reason email is never on the critical path. [E15]
 */
export default function FindPage() {
  return (
    <Shell>
      <Wordmark />
      <h1 className="dsp mt-5 text-[clamp(36px,11vw,56px)]">
        Find my
        <br />
        pass
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-text-2">
        Enter the phone number you booked with and we&apos;ll take you straight to your ticket.
      </p>

      <FindForm />

      <Link
        href="/"
        className="press tap mt-6 flex items-center justify-center text-sm font-semibold text-flare"
      >
        ← Back to booking
      </Link>
    </Shell>
  );
}
