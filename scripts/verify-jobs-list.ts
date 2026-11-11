import "dotenv/config";
import { encode } from "next-auth/jwt";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { db } from "@/lib/db";
import { isoDateInZone, zonedParts, zonedWallTime } from "@/lib/datetime";
import { dayName } from "@/lib/job-list";

/**
 * The Jobs list in a real browser, as a tech, a supervisor and a manager.
 *
 * What it is for: who sees their own jobs set apart from everybody else's;
 * the search and the filters, which are asked of the server; the days, as
 * headings and as dividers inside a group that spans several; and that it
 * all still fits a 320 px screen.
 *
 * Its jobs live under paying companies, a customer and a site of their own,
 * so the filters can narrow the list to exactly them whatever else the
 * database holds. Writes to the database: a development one only.
 *
 *   QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1 npm run verify:jobs
 */
if (process.env.QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY !== "1") {
  console.error(
    "Refusing to run: this writes jobs, companies and a site.\n" +
      "Set QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1 on a development database to proceed.",
  );
  process.exit(1);
}

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const LA = "America/Los_Angeles";
const COMPANY_A = "Jobs List Co A";
const COMPANY_B = "Jobs List Co B";
const CUSTOMER_CODE = "JLC";
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n      got ${actual}${ok ? "" : `  want ${expected}`}`,
  );
}

async function tokenFor(email: string) {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return {
    user,
    token: await encode({
      token: { sub: user.nextcloudSub ?? user.id, userId: user.id },
      secret: process.env.AUTH_SECRET!,
      salt: "authjs.session-token",
      maxAge: 3600,
    }),
  };
}

/** Whatever an earlier run left, so the counts below are this run's. */
async function cleanup() {
  const customer = await db.customer.findUnique({ where: { code: CUSTOMER_CODE } });
  const companies = await db.client.findMany({
    where: { name: { in: [COMPANY_A, COMPANY_B] } },
    select: { id: true },
  });
  const companyIds = companies.map((one) => one.id);
  await db.job.deleteMany({
    where: {
      OR: [
        ...(customer ? [{ customerId: customer.id }] : []),
        { clientId: { in: companyIds } },
      ],
    },
  });
  if (customer) await db.customer.delete({ where: { id: customer.id } });
  await db.client.deleteMany({ where: { id: { in: companyIds } } });
}

async function main() {
  const boss = await tokenFor("boss@417group.org");
  const sup = await tokenFor("sup@417group.org");
  const tech = await tokenFor("tech@417group.org");

  await cleanup();

  const companyA = await db.client.create({ data: { name: COMPANY_A } });
  const companyB = await db.client.create({ data: { name: COMPANY_B } });
  const customer = await db.customer.create({
    data: { name: "Jobs List Customer", code: CUSTOMER_CODE },
  });
  const site = await db.site.create({
    data: {
      customerId: customer.id,
      siteNumber: "4401",
      addressLine1: "1 Test Way",
      city: "Lodi",
      state: "CA",
      postalCode: "95240",
      timeZone: LA,
    },
  });

  // Every date is counted from today on the site's calendar, so the suite
  // means the same thing whenever it runs.
  const now = new Date();
  const today = zonedParts(now, LA);
  const at = (offset: number, hour: number, minute = 0) =>
    zonedWallTime(today.year, today.month, today.day + offset, hour, minute, LA);
  const dayOf = (offset: number) => isoDateInZone(at(offset, 12), LA);
  const named = (offset: number) => dayName(at(offset, 12), LA, now);

  let sequence = 9000 + Math.floor(Math.random() * 900);
  async function job(
    title: string,
    start: Date | null,
    options: {
      lifecycle?: "SCHEDULED" | "IN_PROGRESS" | "PENDING_REVIEW" | "APPROVED";
      outcome?: "COMPLETED";
      client?: string;
      crew?: { userId: string; isLead: boolean }[];
    } = {},
  ) {
    sequence += 1;
    const created = await db.job.create({
      data: {
        intWoId: `JL-${sequence}`,
        intWoSequence: sequence,
        title,
        clientId: options.client ?? companyA.id,
        customerId: customer.id,
        siteId: site.id,
        // Raised by the supervisor, which is what lets them see the tech's.
        createdById: sup.user.id,
        scheduledStart: start,
        lifecycle: options.lifecycle ?? "SCHEDULED",
        outcome: options.outcome ?? null,
      },
    });
    for (const member of options.crew ?? []) {
      await db.jobAssignment.create({
        data: {
          jobId: created.id,
          userId: member.userId,
          isLead: member.isLead,
          payType: "HOURLY",
        },
      });
    }
    return created;
  }

  const S = sup.user.id;
  const T = tech.user.id;
  const techLead = [{ userId: T, isLead: true }];
  const todaySup = await job("JL Today sup", at(0, 9), {
    crew: [
      { userId: S, isLead: true },
      { userId: T, isLead: false },
    ],
  });
  const tomorrowTech = await job("JL Tomorrow tech", at(1, 8), { crew: techLead });
  const earlierOne = await job("JL Earlier one", at(-3, 7), {
    lifecycle: "PENDING_REVIEW",
    outcome: "COMPLETED",
    crew: techLead,
  });
  const earlierTwo = await job("JL Earlier two", at(-3, 15), {
    lifecycle: "PENDING_REVIEW",
    outcome: "COMPLETED",
    crew: techLead,
  });
  const earlierThree = await job("JL Earlier three", at(-10, 8), { crew: techLead });
  const inProgress = await job("JL In progress", at(-2, 7, 30), {
    lifecycle: "IN_PROGRESS",
    crew: techLead,
  });
  const noDate = await job("JL No date", null);
  const approved = await job("JL Approved", at(-5, 9), {
    lifecycle: "APPROVED",
    outcome: "COMPLETED",
    crew: techLead,
  });
  const otherCompany = await job("JL Other company", at(1, 10), {
    client: companyB.id,
    crew: techLead,
  });
  const ours = [
    todaySup,
    tomorrowTech,
    earlierOne,
    earlierTwo,
    earlierThree,
    inProgress,
    noDate,
    approved,
    otherCompany,
  ];
  const nameOf = new Map(ours.map((one) => [`/jobs/${one.id}`, one.title]));

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  async function pageFor(browser: Browser, token: string, width = 390) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      timezoneId: LA,
    });
    await context.addCookies([
      { name: "authjs.session-token", value: token, url: BASE },
    ]);
    return context.newPage();
  }

  async function open(page: Page, path: string) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("main h1", { timeout: 20_000 });
  }

  /** This suite's jobs on the page, or in one part of it, in list order. */
  async function listed(where: Page | Locator, within = "main") {
    const scope = "goto" in where ? where.locator(within) : where;
    const hrefs = await scope
      .locator('a[href^="/jobs/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    return hrefs.filter((href) => nameOf.has(href)).map((href) => nameOf.get(href));
  }

  /** A heading's own words, without the count beside them. */
  async function headings(page: Page, within: string, tag: string) {
    return page
      .locator(`${within} ${tag}`)
      .evaluateAll((nodes) => nodes.map((node) => node.firstChild?.textContent ?? ""));
  }

  const card = (page: Page, id: string) => page.locator(`a[href="/jobs/${id}"]`).first();
  const onA = `company=${companyA.id}`;

  // --- a supervisor: their own first, then everybody else's -----------------
  const supPage = await pageFor(browser, sup.token);
  await open(supPage, `/jobs?${onA}`);

  check(
    "a supervisor's own jobs come first, under their own heading",
    await supPage.getByRole("heading", { name: /^Your jobs/ }).isVisible(),
    true,
  );
  check(
    "and everybody else's after the divider",
    await supPage.getByRole("heading", { name: /^Other jobs/ }).isVisible(),
    true,
  );
  check(
    "their job is in their part",
    (await listed(supPage, 'section[aria-label="Your jobs"]')).join(", "),
    "JL Today sup",
  );
  check(
    "nothing is listed twice",
    await supPage.locator(`a[href="/jobs/${todaySup.id}"]`).count(),
    1,
  );
  check(
    "the rest run: on a job now, the days to come, no date, then the stragglers",
    (await headings(supPage, 'section[aria-label="Other jobs"]', "h3")).join(" | "),
    `In progress | Tomorrow · ${named(1)} | No date yet | Earlier — still open`,
  );
  check(
    "the stragglers are cut by day, newest first",
    (await headings(supPage, 'section[aria-label="Other jobs"]', "h4"))
      .filter((label) => label !== named(-2))
      .join(" | "),
    `${named(-3)} | ${named(-10)}`,
  );
  check(
    "two jobs on one day share one divider, morning first",
    (
      await listed(
        supPage
          .locator('section[aria-label="Other jobs"] h4', { hasText: named(-3) })
          .locator("xpath=.."),
      )
    ).join(", "),
    "JL Earlier one, JL Earlier two",
  );
  check(
    "a job on now says which day it was booked for, above it and on it",
    `${await supPage.locator('section[aria-label="Other jobs"] h4', { hasText: named(-2) }).count()} ${(await card(supPage, inProgress.id).innerText()).includes(named(-2))}`,
    "1 true",
  );
  check(
    "on their own job, the supervisor is 'You'",
    (await card(supPage, todaySup.id).innerText()).includes("You +1"),
    true,
  );
  check(
    "a job with nobody on it says so",
    (await card(supPage, noDate.id).innerText()).includes("Nobody assigned"),
    true,
  );
  check(
    "no 'Scheduled' under a day still to come",
    (await card(supPage, tomorrowTech.id).innerText()).includes("Scheduled"),
    false,
  );
  check(
    "but a straggler that never started still says it",
    (await card(supPage, earlierThree.id).innerText()).includes("Scheduled"),
    true,
  );
  check(
    "the other paying company's job is not in this list",
    (await listed(supPage)).includes("JL Other company"),
    false,
  );

  // --- the filters, through the address ----------------------------------------
  await open(supPage, `/jobs?${onA}&tech=${S}`);
  check(
    "one tech's jobs",
    (await listed(supPage)).join(", "),
    "JL Today sup",
  );
  check(
    "and with nobody else's, no divider to draw",
    await supPage.getByRole("heading", { name: /^Other jobs/ }).count(),
    0,
  );
  check(
    "each filter in use is a chip, and there is a way to clear them all",
    (
      await supPage
        .locator('nav[aria-label="Filters in use"] a')
        .evaluateAll((links) => links.map((link) => (link.textContent ?? "").replace("(remove)", "").trim()))
    ).join(" | "),
    // In the panel's order: days, tech, company, customer.
    `Sam Super | ${COMPANY_A} | Clear all`,
  );
  await supPage
    .locator('nav[aria-label="Filters in use"] a', { hasText: "Sam Super" })
    .click();
  await supPage.waitForURL((url) => !url.search.includes("tech="), { timeout: 15_000 });
  check(
    "a chip takes away only its own filter",
    new URL(supPage.url()).searchParams.get("company"),
    companyA.id,
  );

  await open(supPage, `/jobs?${onA}&from=${dayOf(-3)}&to=${dayOf(-3)}`);
  check(
    "one day, on the site's calendar",
    (await listed(supPage)).join(", "),
    "JL Earlier one, JL Earlier two",
  );
  await open(supPage, `/jobs?${onA}&from=${dayOf(-3)}&to=${dayOf(-10)}`);
  check(
    "dates typed the wrong way round still mean the days between",
    (await listed(supPage)).sort().join(", "),
    "JL Earlier one, JL Earlier three, JL Earlier two",
  );

  await open(supPage, `/jobs?${onA}&q=earlier+three`);
  check("every word has to be found", (await listed(supPage)).join(", "), "JL Earlier three");
  await open(supPage, `/jobs?${onA}&q=terry+tomorrow`);
  check(
    "but each anywhere on the job — a word of the title, a name on the crew",
    (await listed(supPage)).join(", "),
    "JL Tomorrow tech",
  );
  await open(supPage, `/jobs?q=${tomorrowTech.intWoId}`);
  check("a work order number finds its job", (await listed(supPage)).join(", "), "JL Tomorrow tech");
  check(
    "and the count of what was found is said",
    await supPage.locator("text=1 job found").isVisible(),
    true,
  );
  await open(supPage, `/jobs?customer=${customer.id}`);
  check(
    "a customer, whoever pays",
    (await listed(supPage)).length,
    8,
  );
  await open(supPage, `/jobs?${onA}&q=nothing-like-this`);
  check(
    "nothing found says so",
    await supPage.getByText("Nothing matches", { exact: true }).isVisible(),
    true,
  );

  // --- the tabs keep the filters --------------------------------------------
  await open(supPage, `/jobs?${onA}&q=earlier`);
  const allTab = await supPage
    .locator('nav[aria-label="Which jobs"] a', { hasText: "All" })
    .getAttribute("href");
  check(
    "a tab carries the search and the filters over",
    `${allTab?.includes(onA)} ${allTab?.includes("q=earlier")}`,
    "true true",
  );
  await open(supPage, `/jobs?filter=all&${onA}`);
  check(
    "the history reads back from today a day at a time",
    (await headings(supPage, 'section[aria-label="Other jobs"]', "h3")).join(" | "),
    [
      `Tomorrow · ${named(1)}`,
      "No date yet",
      named(-2),
      named(-3),
      named(-5),
      named(-10),
    ].join(" | "),
  );
  await open(supPage, `/jobs?filter=approved&${onA}`);
  check(
    "the Approved tab does not say 'Approved' on every card",
    `${(await listed(supPage)).join(", ")} / ${await card(supPage, approved.id).getByText("Approved", { exact: true }).count()}`,
    "JL Approved / 0",
  );

  // --- the panel ---------------------------------------------------------------
  await open(supPage, "/jobs");
  const toggle = supPage.getByRole("button", { name: /^Filters/ });
  await toggle.click();
  check("Filters opens the panel", await supPage.locator("#job-filters").isVisible(), true);
  check("and says it is open", await toggle.getAttribute("aria-expanded"), "true");
  await supPage.locator("#jobs-company").click();
  await supPage.locator("#jobs-company").fill(COMPANY_B);
  await supPage.locator("#jobs-company").press("Enter");
  await supPage.locator("#jobs-from").fill(dayOf(1));
  await supPage.locator("#jobs-to").fill(dayOf(1));
  await supPage.getByRole("button", { name: "Show jobs" }).click();
  await supPage.waitForURL((url) => url.search.includes(`company=${companyB.id}`), {
    timeout: 15_000,
  });
  await supPage.waitForTimeout(500);
  check(
    "Show jobs asks for exactly what was picked",
    `${(await listed(supPage)).join(", ")} / ${new URL(supPage.url()).searchParams.get("from")}`,
    `JL Other company / ${dayOf(1)}`,
  );
  check("and closes the panel", await supPage.locator("#job-filters").count(), 0);
  check(
    "the button counts the filters in use",
    await toggle.locator("span.tabular").textContent(),
    "2 in use",
  );

  // --- 320 px --------------------------------------------------------------------
  const narrow = await pageFor(browser, sup.token, 320);
  await open(narrow, `/jobs?${onA}&tech=${T}&from=${dayOf(-10)}&to=${dayOf(1)}`);
  await narrow.getByRole("button", { name: /^Filters/ }).click();
  check(
    "at 320 px, with the panel open and chips in use, nothing runs off the side",
    await narrow.evaluate(() => document.documentElement.scrollWidth <= 320),
    true,
  );

  // --- a tech: their own, and nothing to split ----------------------------------
  const techPage = await pageFor(browser, tech.token);
  await open(techPage, `/jobs?${onA}`);
  check(
    "a tech's list has no 'Your jobs' heading — it is all theirs",
    await techPage.getByRole("heading", { name: /^(Your|Other) jobs/ }).count(),
    0,
  );
  check(
    "it holds the jobs they are on, and not the supervisor's own",
    (await listed(techPage)).includes("JL Tomorrow tech") &&
      (await listed(techPage)).includes("JL Today sup") &&
      !(await listed(techPage)).includes("JL No date"),
    true,
  );
  await techPage.getByRole("button", { name: /^Filters/ }).click();
  check("a tech is not offered a tech to pick", await techPage.locator("#jobs-tech").count(), 0);
  await open(techPage, `/jobs?${onA}&tech=${S}`);
  check(
    "and one in the address changes nothing for them",
    `${(await listed(techPage)).includes("JL Tomorrow tech")} ${await techPage.locator('nav[aria-label="Filters in use"] a', { hasText: "Sam Super" }).count()}`,
    "true 0",
  );

  // --- a manager with none of their own ----------------------------------------
  const bossPage = await pageFor(browser, boss.token);
  await open(bossPage, `/jobs?${onA}`);
  check(
    "a manager with no jobs of their own in it gets the list without the split",
    `${await bossPage.getByRole("heading", { name: /^(Your|Other) jobs/ }).count()} ${(await listed(bossPage)).length}`,
    "0 7",
  );

  await browser.close();
  await cleanup();

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
