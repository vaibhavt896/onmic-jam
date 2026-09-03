import Link from "next/link";
import { rpc } from "@/lib/db";
import { upiLink, upiQrDataUri } from "@/lib/upi";
import { normalisePass } from "@/lib/validate";
import type { PassView } from "@/lib/types";
import { PassTicket } from "@/components/PassTicket";
import { Shell, Wordmark } from "@/components/Brand";

export const dynamic = "force-dynamic";

export default async function PassPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const view = await rpc<PassView | null>("app_pass_view", { p_pass: normalisePass(code) });

  if (!view) {
    return (
      <Shell>
        <Wordmark />
        <div className="mt-10 rounded-xl border border-line bg-card p-6">
          <h1 className="text-xl font-bold text-white">We couldn&apos;t find that pass</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Check the link, or look it up with the phone number you registered with.
          </p>
          <Link href="/find" className="btn btn-brand mt-5">
            Find my pass
          </Link>
        </div>
      </Shell>
    );
  }

  const { event, attendee } = view;
  const needsPayment = attendee.state === "registered" || attendee.state === "submitted";

  // `tn` carries the pass code so a human can eyeball a statement, but it is
  // never used for matching — some apps let the user edit it, some strip it,
  // some truncate it. Matching is by UTR, only and always. §12.1
  const link = upiLink({
    vpa: event.upi_vpa,
    payeeName: event.upi_name,
    amount: event.price,
    note: attendee.pass_code,
  });

  return (
    <PassTicket
      view={view}
      upiUrl={link}
      qr={needsPayment ? await upiQrDataUri(link) : null}
    />
  );
}
