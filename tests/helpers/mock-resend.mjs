import { createServer } from "node:http";

/**
 * Stands in for api.resend.com. The Resend SDK honours RESEND_BASE_URL, so the
 * app under test is completely unmodified — the same code path that talks to
 * the real provider talks to this.
 *
 * `broken` simulates the provider being down, which is what [R8] is about.
 */
export async function startMockResend() {
  const sent = [];
  const state = { broken: false };

  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith("/emails")) {
      res.writeHead(404).end("{}");
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (state.broken) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ name: "validation_error", message: "API key is invalid" }));
        return;
      }
      sent.push(JSON.parse(body || "{}"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `mock-${sent.length}` }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    sent,
    break: () => (state.broken = true),
    fix: () => (state.broken = false),
    clear: () => (sent.length = 0),
    stop: () => new Promise((r) => server.close(r)),
  };
}
