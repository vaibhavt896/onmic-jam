/**
 * The admin screens that the §16 list does not name explicitly but that the
 * organisers touch every week: dashboard, people, event.
 */
import { expect, test } from "@playwright/test";
import { applySchema, closePool, login, PASSCODE, seedEvent, sql } from "./fixtures.mjs";

test.afterAll(async () => {
  await closePool();
});

test("the login form gates the admin area", async ({ page }) => {
  await seedEvent({ confirmed: 1 });

  // [S8] an unauthenticated admin page redirects and preserves the destination.
  await page.goto("/admin/money");
  await page.waitForURL(/\/admin\/login\?next=/);

  await page.getByTestId("passcode").fill("wrong-passcode");
  await page.getByTestId("login-submit").click();
  await expect(page.getByText("That passcode is not right.")).toBeVisible();

  await page.getByTestId("passcode").fill(PASSCODE);
  await page.getByTestId("login-submit").click();
  await page.waitForURL("**/admin/money");
  await expect(page.getByTestId("total-confirmed-claimed")).toBeVisible();

  await page.getByTestId("sign-out").click();
  await page.waitForURL("**/admin/login");
  await page.goto("/admin/money");
  await page.waitForURL(/\/admin\/login/);
});

test("the dashboard sends you to create an event when there is none", async ({ page }) => {
  await applySchema();
  await sql("truncate attendees, events, audit_log cascade");

  await login(page);
  await page.waitForURL("**/admin/event");
  await expect(page.getByText("There is no live jam")).toBeVisible();

  await page.getByTestId("ev-name").fill("On Mic Jam");
  await page.getByTestId("ev-venue").fill("Pandu Nagar");
  await page.getByTestId("ev-vpa").fill("onmic@ybl");
  await page.getByTestId("ev-upiname").fill("On Mic Community");
  await page.getByTestId("ev-save").click();

  await page.waitForURL(/\/admin$/);
  await expect(page.getByTestId("tile-seats-left")).toHaveText("50");

  // The public page opens immediately.
  await page.goto("/");
  await expect(page.getByTestId("register-submit")).toBeVisible();
});

test("only one jam can be open at a time", async ({ page }) => {
  await seedEvent({ confirmed: 1 });
  await login(page);
  await page.goto("/admin/event");

  // Clearing the id would be a create; the form is bound to the live event, so
  // force the create path through the API the way a second admin would.
  const res = await page.request.post("/api/admin/event", {
    data: {
      name: "Second Jam",
      event_date: "2026-09-13",
      closes_at: "2026-09-12T21:00:00+05:30",
      upi_vpa: "onmic@ybl",
      upi_name: "On Mic Community",
    },
  });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe("event_open");
});

test("closing registration keeps the floor and the money page alive", async ({ page }) => {
  await seedEvent({ confirmed: 4 });
  await login(page);

  await page.getByRole("button", { name: "Close registration now" }).click();
  await expect(page.getByText("Registration closed")).toBeVisible();

  // Public registration is gone …
  await page.goto("/");
  await page.waitForURL("**/closed");

  // … but the event the organisers are running is not. Registration closes on
  // Saturday night; the jam — and every claim — happens on Sunday.
  await page.goto("/admin/floor");
  await page.getByTestId("floor-search").fill("OM0609-P001");
  await expect(page.getByTestId("claim-for-OM0609-P001")).toBeVisible();

  await page.goto("/admin/money");
  await expect(page.getByTestId("total-confirmed-claimed")).toHaveText("₹1,200");
});

test("people search, seat transfer, and a refund with a recorded reason", async ({ page }) => {
  await seedEvent({ confirmed: 5 });
  await login(page);
  await page.goto("/admin/people");

  await expect(page.getByTestId("people-list").locator("li")).toHaveCount(5);

  await page.getByTestId("people-search").fill("Vaibhavi");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("people-list").locator("li")).toHaveCount(1);

  // [E20] transfer the seat: pass and coupon must survive.
  const [before] = await sql("select id, pass_code, coupon_no from attendees where name like 'Vaibhavi%'");
  await page.getByTestId(`person-${before.pass_code}`).click();
  await page.getByRole("button", { name: "Edit / transfer seat" }).click();
  await page.getByTestId("edit-name").fill("Meera Joshi");
  await page.getByTestId("edit-phone").fill("9811122233");
  await page.getByTestId("edit-save").click();

  // The row leaves the "Vaibhavi" result set, because they are not Vaibhavi any
  // more. Look them up by the pass code, which is what survives a transfer.
  await page.goto(`/admin/people?q=${before.pass_code}`);
  await expect(page.getByText("Meera Joshi").first()).toBeVisible();
  const [after] = await sql("select name, phone, pass_code, coupon_no from attendees where id = $1", [
    before.id,
  ]);
  expect(after).toMatchObject({
    name: "Meera Joshi",
    phone: "9811122233",
    pass_code: before.pass_code,
    coupon_no: before.coupon_no,
  });

  // A refund needs a reason before the button will fire.
  await page.getByTestId(`person-${before.pass_code}`).click();
  await page.getByTestId("action-refund").click();
  await expect(page.getByTestId("reason-confirm")).toBeDisabled();
  await page.getByTestId("reason-input").fill("cancelled Friday, ₹300 sent back over UPI");
  await page.getByTestId("reason-confirm").click();
  await expect(page.getByTestId("action-result")).toContainText("Marked refunded");

  const [voided] = await sql("select state, note, coupon_no from attendees where id = $1", [before.id]);
  expect(voided.state).toBe("refunded");
  expect(voided.note).toContain("sent back over UPI");
  expect(voided.coupon_no).toBe(before.coupon_no); // [R5] retired, not recycled
});

test("the dashboard tiles and the public link are live", async ({ page }) => {
  await seedEvent({ confirmed: 6 });
  await login(page);

  await expect(page.getByTestId("tile-confirmed")).toHaveText("6");
  await expect(page.getByTestId("tile-drinks")).toHaveText("0");
  await expect(page.getByTestId("tile-seats-left")).toHaveText("44");

  const [{ pass_code }] = await sql("select pass_code from attendees where coupon_no = 1");
  await page.request.post("/api/claim", { data: { pass_code } });

  await page.reload();
  await expect(page.getByTestId("tile-drinks")).toHaveText("1");

  // The registration link is derived from the request, not from a build-time
  // env var, so it always matches the host the admin is actually on.
  await expect(page.getByText("http://127.0.0.1:3200/", { exact: true })).toBeVisible();
});
