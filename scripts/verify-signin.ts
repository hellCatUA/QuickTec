import "dotenv/config";
import { chromium } from "playwright";
import { db } from "@/lib/db";
import { hashPassword, hashSetupToken, newSetupToken } from "@/lib/password";

/**
 * The way in for people who are not in NextCloud.
 *
 * Everything here is about who is let in and who is not, which is the one part
 * of the app where being approximately right is being wrong. Needs the app
 * running on BASE_URL with the same AUTH_SECRET.
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PASSWORD = "correct horse battery staple";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual}${ok ? "" : `  want ${expected}`}`,
  );
}

async function main() {
  if (process.env.QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY !== "1") {
    console.log("Refusing to run: this writes test accounts.");
    console.log("Set QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1 on a development database.");
    process.exit(1);
  }

  await db.user.deleteMany({ where: { email: { endsWith: "@outside.test" } } });

  const outsider = await db.user.create({
    data: {
      name: "Dana Outside",
      email: "dana@outside.test",
      baseRole: "TECH",
      signInMethod: "LOCAL",
      passwordHash: await hashPassword(PASSWORD),
    },
  });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  // --- the fork -------------------------------------------------------------
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  check(
    "the page asks which kind of account this is rather than assuming",
    await page.getByText(/SSO account\?/).isVisible(),
    true,
  );
  const sso = page.getByRole("link", { name: /Yes .* sign in with SSO/ });
  check("SSO is offered", await sso.isVisible(), true);

  // Signing out asks for /signin?reauth=1, and the SSO half has to carry that
  // to /api/auth/start or NextCloud silently reuses the previous session — the
  // next person on a shared van phone lands on somebody else's dashboard.
  await page.goto(`${BASE}/signin?reauth=1`, { waitUntil: "load" });
  await page.waitForTimeout(500);
  check(
    "and signing out still means the next person is asked who they are",
    await page
      .getByRole("link", { name: /Yes .* sign in with SSO/ })
      .getAttribute("href"),
    "/api/auth/start?reauth=1",
  );

  await page.goto(`${BASE}/signin`, { waitUntil: "load" });
  await page.waitForTimeout(500);

  await page.getByRole("link", { name: /No .* QuickTec password/ }).click();
  await page.waitForSelector("#signin-password", { timeout: 15_000 });
  await page.waitForTimeout(800);

  // --- a wrong password -----------------------------------------------------
  await page.locator("#signin-email").fill("dana@outside.test");
  await page.locator("#signin-password").fill("not the password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForTimeout(2500);

  check(
    "a wrong password says so and nothing more",
    await page.getByText("Email or password is wrong.").isVisible(),
    true,
  );
  check(
    "an address nobody has gets the identical answer",
    await (async () => {
      await page.locator("#signin-email").fill("nobody@outside.test");
      await page.locator("#signin-password").fill("not the password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForTimeout(2500);
      return page.getByText("Email or password is wrong.").isVisible();
    })(),
    true,
  );
  check(
    "and the wrong answers are counted against the real account only",
    (
      await db.user.findUniqueOrThrow({
        where: { id: outsider.id },
        select: { failedSignIns: true },
      })
    ).failedSignIns,
    1,
  );

  // --- the right one --------------------------------------------------------
  await page.locator("#signin-email").fill("dana@outside.test");
  await page.locator("#signin-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

  check("the right password gets them in", page.url().includes("/dashboard"), true);
  check(
    "and the failure count is cleared",
    (
      await db.user.findUniqueOrThrow({
        where: { id: outsider.id },
        select: { failedSignIns: true, lastLoginAt: true },
      })
    ).failedSignIns,
    0,
  );

  // --- an SSO account cannot be entered here --------------------------------
  const staff = await db.user.findFirstOrThrow({
    where: { signInMethod: "SSO" },
    select: { email: true },
  });

  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(`${BASE}/signin?method=password`, {
    waitUntil: "load",
  });
  await strangerPage.waitForTimeout(800);
  await strangerPage.locator("#signin-email").fill(staff.email);
  await strangerPage.locator("#signin-password").fill(PASSWORD);
  await strangerPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await strangerPage.waitForTimeout(2500);
  check(
    "a company account typed into the password form is refused",
    await strangerPage.getByText("Email or password is wrong.").isVisible(),
    true,
  );
  check(
    "and is told apart from a wrong password by nothing at all",
    strangerPage.url().includes("/dashboard"),
    false,
  );
  await stranger.close();

  // --- a one-time link ------------------------------------------------------
  const invitee = await db.user.create({
    data: {
      name: "Sam Invited",
      email: "sam@outside.test",
      baseRole: "TECH",
      signInMethod: "LOCAL",
    },
  });
  const { token, tokenHash } = newSetupToken();
  await db.passwordSetupToken.create({
    data: {
      userId: invitee.id,
      tokenHash,
      createdById: outsider.id,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });

  const invited = await browser.newContext();
  const invitedPage = await invited.newPage();
  await invitedPage.goto(`${BASE}/set-password?token=${token}`, {
    waitUntil: "load",
  });
  // The form is server-rendered and then hydrated, and filling it in the gap
  // detaches the node mid-keystroke.
  await invitedPage.waitForTimeout(1000);
  await invitedPage.locator("#new-password").fill(PASSWORD);
  await invitedPage.locator("#confirm-password").fill(PASSWORD);
  await invitedPage.getByRole("button", { name: "Set password" }).click();
  await invitedPage.waitForTimeout(2500);

  check(
    "a link lets somebody choose their own password",
    (
      await db.user.findUniqueOrThrow({
        where: { id: invitee.id },
        select: { passwordHash: true },
      })
    ).passwordHash !== null,
    true,
  );
  check(
    "and is spent",
    (
      await db.passwordSetupToken.findUniqueOrThrow({
        where: { tokenHash: hashSetupToken(token) },
        select: { usedAt: true },
      })
    ).usedAt !== null,
    true,
  );

  // Pressing the same link again — a second tab, a forwarded message — must
  // not hand the account to whoever gets there next.
  await invitedPage.goto(`${BASE}/set-password?token=${token}`, {
    waitUntil: "domcontentloaded",
  });
  check(
    "a spent link is refused",
    await invitedPage.getByText(/used already or has expired/).isVisible(),
    true,
  );
  await invited.close();

  // --- a password somebody else chose ---------------------------------------
  await db.user.update({
    where: { id: invitee.id },
    data: { mustChangePassword: true },
  });

  const forced = await browser.newContext();
  const forcedPage = await forced.newPage();
  await forcedPage.goto(`${BASE}/signin?method=password`, {
    waitUntil: "load",
  });
  await forcedPage.waitForTimeout(800);
  await forcedPage.locator("#signin-email").fill("sam@outside.test");
  await forcedPage.locator("#signin-password").fill(PASSWORD);
  await forcedPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await forcedPage.waitForURL(/set-password/, { timeout: 30_000 });

  check(
    "a password an administrator typed has to be replaced first",
    forcedPage.url().includes("/set-password"),
    true,
  );

  // And the app itself is closed until they do.
  await forcedPage.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  check(
    "and nothing else opens until it is",
    forcedPage.url().includes("/set-password"),
    true,
  );

  await forcedPage.waitForTimeout(1000);
  await forcedPage.locator("#current-password").fill(PASSWORD);
  await forcedPage.locator("#new-password").fill("a different long password");
  await forcedPage.locator("#confirm-password").fill("a different long password");
  await forcedPage.getByRole("button", { name: "Set password" }).click();
  await forcedPage.waitForURL(/dashboard/, { timeout: 30_000 });
  check(
    "changing it opens the app",
    forcedPage.url().includes("/dashboard"),
    true,
  );
  await forced.close();

  await browser.close();
  await db.user.deleteMany({ where: { email: { endsWith: "@outside.test" } } });

  console.log(failures === 0 ? "\nALL SIGN-IN CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
