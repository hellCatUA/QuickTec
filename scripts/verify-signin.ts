import "dotenv/config";
import { encode } from "@auth/core/jwt";
import { chromium } from "playwright";
import { db } from "@/lib/db";
import {
  hashPassword,
  hashSetupToken,
  newSetupToken,
  verifyPassword,
} from "@/lib/password";

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
    select: { id: true, email: true },
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

  // --- unless somebody granted it a password --------------------------------
  //
  // The case this exists for: the site has no route to NextCloud, so OIDC
  // cannot run at all, and the crew still has to clock in. What is checked
  // here is which of the two things opens the door — the flag, or the hash.
  // They are tested apart on purpose, because a door that opens on the hash
  // alone would reopen itself on every account that ever had a password.
  const FALLBACK_PASSWORD = "the long way round the building";

  await db.user.update({
    where: { id: staff.id },
    data: {
      passwordHash: await hashPassword(FALLBACK_PASSWORD),
      passwordFallback: false,
      failedSignIns: 0,
      lockedUntil: null,
    },
  });

  const ungranted = await browser.newContext();
  const ungrantedPage = await ungranted.newPage();
  await ungrantedPage.goto(`${BASE}/signin?method=password`, {
    waitUntil: "load",
  });
  await ungrantedPage.waitForTimeout(800);
  await ungrantedPage.locator("#signin-email").fill(staff.email);
  await ungrantedPage.locator("#signin-password").fill(FALLBACK_PASSWORD);
  await ungrantedPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await ungrantedPage.waitForTimeout(2500);
  check(
    "a password on a company account is not a way in by itself",
    ungrantedPage.url().includes("/dashboard"),
    false,
  );
  check(
    "and the refusal is worded like any other",
    await ungrantedPage.getByText("Email or password is wrong.").isVisible(),
    true,
  );
  await ungranted.close();

  // Now granted, with the same password and the same account: the only thing
  // that changed is somebody's decision.
  await db.user.update({
    where: { id: staff.id },
    data: {
      passwordFallback: true,
      mustChangePassword: true,
      failedSignIns: 0,
      lockedUntil: null,
    },
  });

  const granted = await browser.newContext();
  const grantedPage = await granted.newPage();
  await grantedPage.goto(`${BASE}/signin?method=password`, {
    waitUntil: "load",
  });
  await grantedPage.waitForTimeout(800);
  await grantedPage.locator("#signin-email").fill(staff.email);
  await grantedPage.locator("#signin-password").fill(FALLBACK_PASSWORD);
  await grantedPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await grantedPage.waitForURL(/set-password/, { timeout: 30_000 });
  check(
    "granting it lets a company account in without NextCloud",
    grantedPage.url().includes("/set-password"),
    true,
  );

  // A password somebody else chose, on an account that is somebody's whole
  // working day. The same forced change applies as anywhere else.
  await grantedPage.waitForTimeout(1000);
  await grantedPage.locator("#current-password").fill(FALLBACK_PASSWORD);
  await grantedPage.locator("#new-password").fill("a password of their own");
  await grantedPage.locator("#confirm-password").fill("a password of their own");
  await grantedPage.getByRole("button", { name: "Set password" }).click();
  await grantedPage.waitForURL(/dashboard/, { timeout: 30_000 });
  check(
    "and they choose their own before anything else opens",
    grantedPage.url().includes("/dashboard"),
    true,
  );
  await granted.close();

  // Revoked. The password is still in the row for this one check, so what is
  // being proved is that taking the permission away is enough on its own.
  await db.user.update({
    where: { id: staff.id },
    data: { passwordFallback: false, failedSignIns: 0, lockedUntil: null },
  });

  const revoked = await browser.newContext();
  const revokedPage = await revoked.newPage();
  await revokedPage.goto(`${BASE}/signin?method=password`, {
    waitUntil: "load",
  });
  await revokedPage.waitForTimeout(800);
  await revokedPage.locator("#signin-email").fill(staff.email);
  await revokedPage.locator("#signin-password").fill("a password of their own");
  await revokedPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await revokedPage.waitForTimeout(2500);
  check(
    "revoking it closes the door again",
    revokedPage.url().includes("/dashboard"),
    false,
  );
  await revoked.close();

  // Put the company account back as it was found, whatever happened above.
  await db.user.update({
    where: { id: staff.id },
    data: {
      passwordFallback: false,
      passwordHash: null,
      mustChangePassword: false,
      failedSignIns: 0,
      lockedUntil: null,
    },
  });

  // --- granting it the way an administrator actually does -------------------
  // The checks above drove the database directly, which proves the door and
  // not the handle. This is the handle: the page somebody opens on the day
  // NextCloud is unreachable, pressed by somebody who may grant it.
  const target = await db.user.findUniqueOrThrow({
    where: { email: "tech@417group.org" },
    select: { id: true, name: true },
  });
  const manager = await db.user.findUniqueOrThrow({
    where: { email: "boss@417group.org" },
    select: { id: true, nextcloudSub: true },
  });

  // Audit rows are kept for good, so a second run would otherwise count the
  // first one's as well and read as granting twice.
  await db.auditEvent.deleteMany({
    where: {
      entityId: target.id,
      action: { in: ["password_fallback_granted", "password_fallback_revoked"] },
    },
  });

  const admin = await browser.newContext();
  await admin.addCookies([
    {
      name: "authjs.session-token",
      value: await encode({
        token: { sub: manager.nextcloudSub!, userId: manager.id },
        secret: process.env.AUTH_SECRET!,
        salt: "authjs.session-token",
        maxAge: 3600,
      }),
      url: BASE,
    },
  ]);
  const adminPage = await admin.newPage();
  await adminPage.goto(`${BASE}/settings/users`, { waitUntil: "load" });
  await adminPage.waitForTimeout(1200);

  /**
   * This one person's card, not whichever is drawn first.
   *
   * Every row carries the same buttons, so an unscoped click grants a second
   * way into whoever happens to sort to the top — which is both a wrong test
   * and, on a real screen, a wrong account.
   */
  const card = () =>
    adminPage.locator("form").filter({
      has: adminPage.locator(`input[name="userId"][value="${target.id}"]`),
    });

  check(
    "the page is open to somebody who may grant it",
    await card().count(),
    1,
  );

  await card()
    .getByRole("button", { name: "Allow a QuickTec password too" })
    .click();
  await adminPage.waitForTimeout(2500);

  check(
    "granting hands back a link rather than a password",
    await card()
      .getByText(/works once, expires in three days/i)
      .isVisible(),
    true,
  );

  const afterGrant = await db.user.findUniqueOrThrow({
    where: { id: target.id },
    select: { passwordFallback: true, passwordHash: true },
  });
  check("the account is granted it", afterGrant.passwordFallback, true);
  check(
    "and has no password until its owner chooses one",
    afterGrant.passwordHash,
    null,
  );
  check(
    "which is recorded against whoever granted it",
    await db.auditEvent.count({
      where: {
        entityId: target.id,
        action: "password_fallback_granted",
        actorId: manager.id,
      },
    }),
    1,
  );

  // And back off again, from the same page.
  await adminPage.reload({ waitUntil: "load" });
  await adminPage.waitForTimeout(1200);
  await card().getByRole("button", { name: "Remove the password" }).click();
  await adminPage.waitForTimeout(400);
  await card().getByRole("button", { name: "Remove", exact: true }).click();
  await adminPage.waitForTimeout(2500);

  const afterRevoke = await db.user.findUniqueOrThrow({
    where: { id: target.id },
    select: { passwordFallback: true, passwordChangedAt: true },
  });
  check("revoking takes it away", afterRevoke.passwordFallback, false);
  check(
    "and cuts whatever sessions were opened with it",
    afterRevoke.passwordChangedAt !== null,
    true,
  );
  await admin.close();

  // Every company account back as it was found. A run that granted one and
  // stopped would otherwise leave a way into it for good.
  await db.user.updateMany({
    where: { signInMethod: "SSO" },
    data: {
      passwordFallback: false,
      passwordHash: null,
      mustChangePassword: false,
      passwordChangedAt: null,
      failedSignIns: 0,
      lockedUntil: null,
    },
  });

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

  // Pages were the whole of it once, which is not the whole of the app: a
  // route handler renders no layout and a server action runs before anything
  // renders, so a password good for "one sign-in" was good for every export
  // in the building and refused only the screens.
  await db.user.update({
    where: { id: invitee.id },
    data: { baseRole: "ACCOUNTANT" },
  });
  check(
    "a password that has to be replaced reaches no route handler either",
    (await forcedPage.request.get(`${BASE}/api/pay/export?month=2026-07`))
      .status(),
    401,
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
  check(
    "and the rest of it with them",
    (await forcedPage.request.get(`${BASE}/api/pay/export?month=2026-07`))
      .status() !== 401,
    true,
  );
  await forced.close();

  // --- where a sign-in may send you -----------------------------------------
  // The old test was `startsWith("/") && !startsWith("//")`. The browser's URL
  // parser turns `\` into `/` and drops tabs, so every one of these passed it
  // and every one of them left the site — after a real password had been
  // typed into the real form, which is the whole of a phishing link.
  for (const sneaky of ["/\\evil.example", "/\t/evil.example", "/.//evil.example"]) {
    await db.user.update({
      where: { id: outsider.id },
      data: { failedSignIns: 0, lockedUntil: null },
    });
    const away = await browser.newContext();
    const awayPage = await away.newPage();

    // Watched as a request rather than read off the address bar afterwards.
    // The foreign host does not resolve in a test, the navigation fails, and
    // Playwright gives up waiting the moment it does — at which point the
    // address bar still shows the sign-in page. An earlier version of this
    // check read it there and passed against the very bug it was written for.
    const leftFor: string[] = [];
    awayPage.on("request", (request) => {
      if (
        request.isNavigationRequest() &&
        request.frame() === awayPage.mainFrame() &&
        !request.url().startsWith(BASE)
      ) {
        leftFor.push(request.url());
      }
    });

    await awayPage.goto(
      `${BASE}/signin?method=password&callbackUrl=${encodeURIComponent(sneaky)}`,
      { waitUntil: "load" },
    );
    await awayPage.waitForTimeout(800);
    await awayPage.locator("#signin-email").fill("dana@outside.test");
    await awayPage.locator("#signin-password").fill(PASSWORD);
    await awayPage.getByRole("button", { name: "Sign in", exact: true }).click();
    // Long enough for the redirect to be attempted whichever way it goes.
    await awayPage.waitForTimeout(4000);

    check(
      `a sign-in asked to go to ${JSON.stringify(sneaky)} stays on this site`,
      leftFor.join(" ") || "nowhere else",
      "nowhere else",
    );
    // And it did sign in. Without this, a sign-in that simply failed would
    // also have stayed on the site, and passed.
    check(
      `and lands somewhere real on it`,
      awayPage.url(),
      `${BASE}/dashboard`,
    );
    await away.close();
  }

  // --- what the form will spend time on --------------------------------------
  // Checking a password normalised it on the main thread before hashing, and a
  // server action accepts 25 MB. No password here is longer than 200, so
  // nothing longer is worth a millisecond.
  //
  // Asked of verifyPassword directly rather than through the form: twenty
  // megabytes through a browser is a test of the browser. Before the cap this
  // took about a second, half of it with the event loop held.
  {
    const stored = await hashPassword(PASSWORD);
    const started = Date.now();
    const matched = await verifyPassword("x".repeat(20 * 1024 * 1024), stored);
    const took = Date.now() - started;
    check("a twenty-megabyte password does not match", matched, false);
    check(
      "and is refused without being normalised or hashed",
      took < 50,
      true,
    );
  }

  // --- a link asked for twice ------------------------------------------------
  // `?token=a&token=b` arrives as an array, and hashing an array throws.
  {
    const twice = await browser.newContext();
    const twicePage = await twice.newPage();
    const response = await twicePage.goto(
      `${BASE}/set-password?token=a&token=b`,
      { waitUntil: "load" },
    );
    check(
      "a repeated token is an answer, not a crash",
      (response?.status() ?? 0) < 500,
      true,
    );
    await twice.close();
  }

  // --- too many wrong answers -----------------------------------------------
  // Eight is the budget. What is checked here is not only that it runs out,
  // but who is told that it has: saying "locked, 15 minutes" to somebody who
  // has not produced the right password is the one answer this form gives
  // that a wrong password cannot, and it would name every account that has a
  // password at all.
  await db.user.update({
    where: { id: outsider.id },
    data: { failedSignIns: 0, lockedUntil: null },
  });

  const guesser = await browser.newContext();
  const guesserPage = await guesser.newPage();
  await guesserPage.goto(`${BASE}/signin?method=password`, {
    waitUntil: "load",
  });
  await guesserPage.waitForTimeout(800);

  for (let attempt = 0; attempt < 8; attempt++) {
    await guesserPage.locator("#signin-email").fill("dana@outside.test");
    await guesserPage.locator("#signin-password").fill(`guess ${attempt}`);
    await guesserPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await guesserPage.waitForTimeout(1200);
  }

  check(
    "eight wrong answers shut the account",
    (
      await db.user.findUniqueOrThrow({
        where: { id: outsider.id },
        select: { lockedUntil: true },
      })
    ).lockedUntil !== null,
    true,
  );
  check(
    "and the ninth wrong one is still told only that it is wrong",
    await guesserPage.getByText("Email or password is wrong.").isVisible(),
    true,
  );

  // The right password, against a shut account: now it is worth saying so,
  // because whoever is reading it has proved they are not guessing.
  await guesserPage.locator("#signin-email").fill("dana@outside.test");
  await guesserPage.locator("#signin-password").fill(PASSWORD);
  await guesserPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await guesserPage.waitForTimeout(2000);
  check(
    "while the right one is told how long is left",
    await guesserPage.getByText(/Too many wrong passwords/).isVisible(),
    true,
  );
  check(
    "and still does not get in",
    guesserPage.url().includes("/dashboard"),
    false,
  );
  await guesser.close();

  await browser.close();
  await db.user.deleteMany({ where: { email: { endsWith: "@outside.test" } } });

  console.log(failures === 0 ? "\nALL SIGN-IN CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
