import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM;
const targetEmail = process.argv[2];

if (!apiKey || !from) {
  console.log("\n  Resend is currently unconfigured:");
  console.log(`  • RESEND_API_KEY: ${apiKey ? "✓ set" : "✗ missing"}`);
  console.log(`  • EMAIL_FROM:     ${from ? "✓ set" : "✗ missing"}\n`);
  console.log("  Add them to .env.local or your environment, then re-run.\n");
  process.exit(1);
}

if (!targetEmail) {
  console.log("\n  Usage: node --env-file=.env.local scripts/test-email.mjs <recipient@example.com>\n");
  process.exit(1);
}

const resend = new Resend(apiKey);

async function sendTest() {
  console.log(`\n  Sending test message to ${targetEmail} from ${from}…`);
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: targetEmail,
      subject: "On Mic — Test Delivery",
      text: "This is a test email confirming that your Resend integration is active and operating smoothly.",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0B0912; color: #F5F1EA; padding: 32px 24px; max-width: 480px; margin: 0 auto; border-radius: 12px;">
          <h2 style="color: #FF277F; margin-top: 0;">Connection Verified</h2>
          <p style="color: #A69FB5; line-height: 1.6;">Your Resend configuration and sender domain are configured properly. Emails from On Mic will deliver reliably.</p>
        </div>
      `,
    });

    if (error) {
      console.error("\n  ✗ Delivery failed:", error.message);
      process.exit(1);
    }

    console.log(`  ✓ Email sent successfully. Message ID: ${data?.id}\n`);
  } catch (err) {
    console.error("\n  ✗ Unexpected error:", err);
    process.exit(1);
  }
}

sendTest();
