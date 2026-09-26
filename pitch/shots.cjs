// Real screenshots of the live app for the pitch deck. Never edits or mocks what the page shows.
//   NODE_PATH=~/money/.cache/pitch/node_modules node pitch/shots.cjs
const { chromium } = require("playwright-core");
const path = require("node:path");

const APP = process.env.APP ?? "https://catalyst-event-launchpad.vercel.app";
const OUT = path.join(__dirname, "screenshots");
const GTA = "/t/2yo88dVedmHzJDY9NxGc7DMboFVF94cSmbGgzYVC3QiY"; // graduated event token (DAMM v2)
const BTC = "/t/CwL1HingkqetYGqXUdTkcD2D4m5nUdzGzWLvDJs7FNGa"; // event token still on its curve
const LIVE_ODDS = /YES\s*\d+%/;

// Panta's feed sometimes drops a price for a few seconds; reload until the real number is there.
async function withOdds(page, url, scope, tries = 8) {
  for (let i = 1; i <= tries; i++) {
    await page.goto(APP + url, { waitUntil: "networkidle" });
    try {
      await page.locator(scope).filter({ hasText: LIVE_ODDS }).first().waitFor({ timeout: 20_000 });
      return;
    } catch {
      console.log(`  ${url}: no live price yet (try ${i}/${tries})`);
      await page.waitForTimeout(5_000);
    }
  }
  throw new Error(`${url}: Panta never returned a live price; not taking this shot`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const shot = async (name, target) => {
    await page.waitForTimeout(1_500); // let charts and fonts settle
    await target.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`✓ ${name}.png`);
  };

  // 1. /launch with an event selected: event list, curve picker, summary with the event's data.
  await page.goto(APP + "/launch", { waitUntil: "networkidle" });
  const btcEvent = page.getByText("Will Bitcoin drop below 58k in 2026?").first();
  for (let i = 1; ; i++) {
    await btcEvent.waitFor({ timeout: 30_000 });
    await btcEvent.click();
    try {
      await page.locator("aside").filter({ hasText: LIVE_ODDS }).first().waitFor({ timeout: 15_000 });
      break;
    } catch {
      if (i >= 8) throw new Error("/launch: summary never showed a live price");
      console.log(`  /launch: no live price yet (try ${i}/8)`);
      await page.reload({ waitUntil: "networkidle" });
    }
  }
  await shot("launch", page);

  // 2. Token page with the linked event's live data from Panta.
  await withOdds(page, BTC, "section.card");
  await page.getByText("Raised toward graduation").first().waitFor({ timeout: 30_000 });
  await shot("token-page", page);

  // 3. The graduated token's DAMM v2 liquidity card (locks and fees per position).
  await page.goto(APP + GTA, { waitUntil: "networkidle" });
  const lp = page.locator("section.card").filter({ hasText: "Positions minted at graduation" }).first();
  await lp.getByText("Locked forever").first().waitFor({ timeout: 30_000 });
  await shot("damm-liquidity", lp);

  // 4. /presets: the preset marketplace.
  await page.goto(APP + "/presets", { waitUntil: "networkidle" });
  await page.getByText("Launch with Flat").first().waitFor({ timeout: 30_000 });
  await shot("presets", page);

  await browser.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
