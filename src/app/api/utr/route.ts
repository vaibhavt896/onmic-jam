import { rpc } from "@/lib/db";
import { fail, ok, readJson } from "@/lib/api";
import { cleanUtr, normalisePass } from "@/lib/validate";
import { sendPaymentReceivedEmail, type EventLike } from "@/lib/email";

export const dynamic = "force-dynamic";

type Result = {
  state?: string;
  error?: string;
  name?: string;
  email?: string | null;
  pass?: string;
  utr?: string;
  event?: EventLike;
};

/** §10.2. [E4] re-submitting from `submitted` overwrites — people mistype. */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return fail("bad_json");

  const utr = cleanUtr(body.utr);
  if (!utr) return fail("bad_utr");

  const pass = normalisePass(body.pass_code);
  if (!pass) return fail("not_found");

  const result = await rpc<Result>("app_submit_utr", {
    p_pass: pass,
    p_utr: utr,
  });

  if (result.error) return fail(result.error);

  // Acknowledge the payment by email so nobody is left wondering whether their
  // reference landed. [R9] deliberately not awaited and never able to throw: a
  // dead email provider must not stop a payment reference being recorded, and
  // the person is standing there watching the page.
  if (result.email && result.event) {
    void sendPaymentReceivedEmail(
      {
        name: result.name ?? "",
        email: result.email,
        pass: result.pass ?? pass,
        utr: result.utr ?? utr,
      },
      result.event,
    );
  }

  return ok({ state: result.state });
}
