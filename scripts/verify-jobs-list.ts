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
const REP_NAME = "Jobs List Rep Co";
const PROJECT_CODE = "JLPRJ";
const PROJECT_NAME = "Jobs List Project";
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
  await db.project.deleteMany({ where: { code: PROJECT_CODE } });
  await db.repCompany.deleteMany({ where: { name: REP_NAME } });
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
  const siteAt = (siteNumber: string) =>
    db.site.create({
      data: {
        customerId: customer.id,
        siteNumber,
        addressLine1: "1 Test Way",
        city: "Lodi",
        state: "CA",
        postalCode: "95240",
        timeZone: LA,
      },
    });
  const site = await siteAt("4401");
  const otherSite = await siteAt("4402");
  const repCompany = await db.repCompany.create({ data: { name: REP_NAME } });
  const project = await db.project.create({
    data: { name: PROJECT_NAME, code: PROJECT_CODE, clientId: companyA.id },
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
      site?: string;
      rep?: string;
      project?: string;
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
        siteId: options.site ?? site.id,
        repCompanyId: options.rep ?? null,
        projectId: options.project ?? null,
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
  const tomorrowTech = await job("JL Tomorrow tech", at(1, 8), {
    crew: techLead,
    rep: repCompany.id,
    project: project.id,
  });
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
  const earlierThree = await job("JL Earlier three", at(-10, 8), {
    crew: techLead,
    site: otherSite.id,
  });
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

  const whose = (page: Page) => page.locator('nav[aria-label="Whose jobs"]');
  const current = (page: Page) =>
    whose(page).locator('a[aria-current="page"]').innerText();

  // --- a supervisor: My jobs or All jobs ----------------------------------------
  const supPage = await pageFor(browser, sup.token);
  await open(supPage, `/jobs?${onA}`);

  check("a supervisor can switch between their jobs and all", await whose(supPage).isVisible(), true);
  check("and starts on All jobs", await current(supPage), "All jobs");
  check(
    "which holds theirs and everybody else's",
    `${(await listed(supPage)).includes("JL Today sup")} ${(await listed(supPage)).includes("JL Tomorrow tech")}`,
    "true true",
  );
  await whose(supPage).getByRole("link", { name: "My jobs" }).click();
  await supPage.waitForURL((url) => url.searchParams.get("who") === "mine", { timeout: 15_000 });
  await supPage.waitForTimeout(400);
  check("My jobs is the jobs they are on", (await listed(supPage)).join(", "), "JL Today sup");
  check(
    "and keeps the filters",
    new URL(supPage.url()).searchParams.get("company"),
    companyA.id,
  );
  await open(supPage, `/jobs?${onA}`);
  check("the choice is remembered", await current(supPage), "My jobs");
  check("and so is what it shows", (await listed(supPage)).join(", "), "JL Today sup");
  await whose(supPage).getByRole("link", { name: "All jobs" }).click();
  await supPage.waitForURL((url) => url.searchParams.get("who") === "all", { timeout: 15_000 });
  await open(supPage, `/jobs?${onA}`);
  check("All jobs is remembered too", await current(supPage), "All jobs");

  // --- the days -----------------------------------------------------------------
  check(
    "on a job now first, then today and the days to come, no date, the stragglers",
    (await headings(supPage, "main", "h2")).join(" | "),
    `In progress | Today · ${named(0)} | Tomorrow · ${named(1)} | No date yet | Earlier — still open`,
  );
  check(
    "a group of several days is cut by day, the stragglers newest first",
    (await headings(supPage, "main", "h3")).join(" | "),
    `${named(-2)} | ${named(-3)} | ${named(-10)}`,
  );
  check(
    "two jobs on one day share one divider, morning first",
    (
      await listed(
        supPage.locator("main h3", { hasText: named(-3) }).locator("xpath=.."),
      )
    ).join(", "),
    "JL Earlier one, JL Earlier two",
  );
  check(
    "the day is on the card as well as above it",
    (await card(supPage, inProgress.id).innerText()).includes(named(-2)),
    true,
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
  check("one tech's jobs", (await listed(supPage)).join(", "), "JL Today sup");
  check(
    "each filter in use is a chip, the companies saying which they are",
    (
      await supPage
        .locator('nav[aria-label="Filters in use"] a')
        .evaluateAll((links) =>
          links.map((link) => (link.textContent ?? "").replace("(remove)", "").trim()),
        )
    ).join(" | "),
    // In the panel's order.
    `Paying: ${COMPANY_A} | Sam Super | Clear all`,
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
  await open(supPage, `/jobs?rep=${repCompany.id}`);
  check("a rep company", (await listed(supPage)).join(", "), "JL Tomorrow tech");
  await open(supPage, `/jobs?project=${project.id}`);
  check(
    "a project, said on its chip",
    `${(await listed(supPage)).join(", ")} / ${await supPage.locator('nav[aria-label="Filters in use"] a', { hasText: `Project: ${PROJECT_NAME}` }).count()}`,
    "JL Tomorrow tech / 1",
  );
  await open(supPage, `/jobs?customer=${customer.id}&site=4402`);
  check("a customer and a site ID", (await listed(supPage)).join(", "), "JL Earlier three");
  await open(supPage, `/jobs?customer=${customer.id}&site=440`);
  check("part of a site ID finds every site it is part of", (await listed(supPage)).length, 8);

  await open(supPage, `/jobs?${onA}&q=earlier+three`);
  check("every word has to be found", (await listed(supPage)).join(", "), "JL Earlier three");
  await open(supPage, `/jobs?${onA}&q=terry+tomorrow`);
  check(
    "but each anywhere on the job — a word of the title, a name on the crew",
    (await listed(supPage)).join(", "),
    "JL Tomorrow tech",
  );
  await open(supPage, `/jobs?q=${encodeURIComponent(PROJECT_NAME)}`);
  check("the search finds a project by its name", (await listed(supPage)).join(", "), "JL Tomorrow tech");
  await open(supPage, `/jobs?q=${tomorrowTech.intWoId}`);
  check("a work order number finds its job", (await listed(supPage)).join(", "), "JL Tomorrow tech");
  check(
    "and the count of what was found is said",
    await supPage.locator("text=1 job found").isVisible(),
    true,
  );
  await open(supPage, `/jobs?customer=${customer.id}`);
  check("a customer, whoever pays", (await listed(supPage)).length, 8);
  await open(supPage, `/jobs?${onA}&q=nothing-like-this`);
  check(
    "nothing found says so",
    await supPage.getByText("Nothing matches", { exact: true }).isVisible(),
    true,
  );

  // --- the tabs keep the filters --------------------------------------------
  await open(supPage, `/jobs?${onA}&q=earlier&who=all`);
  const allTab = await supPage
    .locator('nav[aria-label="Which jobs"] a', { hasText: "All" })
    .getAttribute("href");
  check(
    "a tab carries the search, the filters and whose jobs over",
    `${allTab?.includes(onA)} ${allTab?.includes("q=earlier")} ${allTab?.includes("who=all")}`,
    "true true true",
  );
  await open(supPage, `/jobs?filter=all&${onA}`);
  check(
    "the history reads back from today a day at a time",
    (await headings(supPage, "main", "h2")).join(" | "),
    [
      `Today · ${named(0)}`,
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
  const panel = supPage.locator("#job-filters");
  check("Filters opens the panel", await panel.isVisible(), true);
  check("and says it is open", await toggle.getAttribute("aria-expanded"), "true");
  check(
    "in the owner's order",
    (await panel.locator("label").evaluateAll((labels) => labels.map((label) => label.textContent))).join(" | "),
    "From | To | Paying company | Rep company | Project | Tech | Customer | Site ID",
  );
  const rows = await panel.evaluate((node) =>
    [...node.querySelectorAll("label")].map((label) =>
      Math.round(label.getBoundingClientRect().top),
    ),
  );
  check(
    "two to a row where the owner put two, the project and the tech a row each",
    [rows[0] === rows[1], rows[2] === rows[3], rows[4] < rows[5], rows[6] === rows[7]].join(" "),
    "true true true true",
  );
  await supPage.locator("#jobs-company").selectOption(companyB.id);
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
  check("and closes the panel", await panel.count(), 0);
  check(
    "the button counts the filters in use",
    await toggle.locator("span.tabular").textContent(),
    "2 in use",
  );
  await open(supPage, "/jobs");
  await toggle.click();
  await supPage.locator("#jobs-project").click();
  await supPage.locator("#jobs-project").fill(PROJECT_NAME);
  await supPage.locator("#jobs-project").press("Enter");
  await supPage.locator("#jobs-site").fill("4401");
  await supPage.getByRole("button", { name: "Show jobs" }).click();
  await supPage.waitForURL((url) => url.search.includes(`project=${project.id}`), {
    timeout: 15_000,
  });
  await supPage.waitForTimeout(500);
  check(
    "a project picked from the list, with a site ID typed",
    `${(await listed(supPage)).join(", ")} / ${new URL(supPage.url()).searchParams.get("site")}`,
    "JL Tomorrow tech / 4401",
  );

  // --- 320 px --------------------------------------------------------------------
  const narrow = await pageFor(browser, sup.token, 320);
  await open(
    narrow,
    `/jobs?${onA}&rep=${repCompany.id}&project=${project.id}&tech=${T}&customer=${customer.id}&site=4401&from=${dayOf(-10)}&to=${dayOf(1)}`,
  );
  await narrow.getByRole("button", { name: /^Filters/ }).click();
  check(
    "at 320 px, with the panel open and every chip in use, nothing runs off the side",
    await narrow.evaluate(() => document.documentElement.scrollWidth <= 320),
    true,
  );

  // --- a tech: their own, and nothing to split ----------------------------------
  const techPage = await pageFor(browser, tech.token);
  await open(techPage, `/jobs?${onA}`);
  check(
    "a tech has no My jobs and All jobs to choose between — it is all theirs",
    await whose(techPage).count(),
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
    "a manager starts on All jobs, and sees them all",
    `${await current(bossPage)} ${(await listed(bossPage)).length}`,
    "All jobs 7",
  );
  await open(bossPage, `/jobs?${onA}&who=mine`);
  check(
    "My jobs with none of theirs says so, and how to see the rest",
    await bossPage.getByText(/None of your jobs match\. Try All jobs/).isVisible(),
    true,
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
