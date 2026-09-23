import fs from "node:fs/promises";
import { chromium } from "playwright";

const config = JSON.parse(await fs.readFile("config.json", "utf8"));
let state;
try {
  state = JSON.parse(await fs.readFile("state.json", "utf8"));
} catch {
  state = { bestPrices: {}, lastSuccessfulChecks: {} };
}
state.bestPrices ||= {};
state.lastSuccessfulChecks ||= {};

const alerts = [];
const diagnostics = [];
let stateChanged = false;

const money = /\$\s*([0-9]{1,4}(?:,[0-9]{3})*(?:\.\d{2})?)/g;
const normalize = value => (value || "").replace(/\s+/g, " ").trim().toUpperCase();

function parseListing(text, url, site) {
  const clean = text.replace(/\s+/g, " ").trim();
  const prices = [...clean.matchAll(money)]
    .map(match => Number(match[1].replace(/,/g, "")))
    .filter(price => price > 5 && price < 10000);
  if (!prices.length) return null;

  const sectionMatch = clean.match(/(?:SEC(?:TION)?|FLOOR)\s*[:#-]?\s*([A-Z0-9]+)/i);
  const rowMatch = clean.match(/ROW\s*[:#-]?\s*([A-Z0-9]+)/i);
  const seatMatch = clean.match(/SEATS?\s*[:#-]?\s*(\d+)(?:\s*[-–]\s*(\d+))?/i);

  return {
    site,
    url,
    price: Math.min(...prices),
    section: normalize(sectionMatch?.[1]),
    row: normalize(rowMatch?.[1]),
    seatStart: seatMatch ? Number(seatMatch[1]) : null,
    seatEnd: seatMatch ? Number(seatMatch[2] || seatMatch[1]) : null,
    text: clean.slice(0, 600)
  };
}

function matchesRule(listing, rule) {
  if (rule.anySection) return true;
  const section = normalize(listing.section);
  const row = normalize(listing.row);

  if (rule.section) {
    const allowed = rule.section.map(normalize);
    if (!allowed.includes(section) && !allowed.some(x => listing.text.toUpperCase().includes(`SECTION ${x}`) || listing.text.toUpperCase().includes(`FLOOR ${x}`))) return false;
  }
  if (rule.sectionPattern && !new RegExp(rule.sectionPattern, "i").test(section)) return false;
  if (rule.rows && rule.rows.length) {
    const allowedRows = rule.rows.map(normalize);
    if (!allowedRows.includes(row)) return false;
  }
  if (rule.preferredSeats?.length && listing.seatStart !== null) {
    const listingSeats = [];
    for (let seat = listing.seatStart; seat <= listing.seatEnd; seat++) listingSeats.push(seat);
    if (!listingSeats.some(seat => rule.preferredSeats.includes(seat))) return false;
  }
  return true;
}

async function collectListings(page, source, quantity) {
  const target = new URL(source.url);
  if (source.site === "Ticketmaster") target.searchParams.set("qty", String(quantity));
  await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(8000);

  for (const label of ["Accept All Cookies", "Accept Cookies", "Got it", "Close"]) {
    const button = page.getByRole("button", { name: new RegExp(label, "i") }).first();
    if (await button.isVisible().catch(() => false)) await button.click().catch(() => {});
  }

  if (source.site === "SeatGeek") {
    const includeFees = page.getByText(/include fees/i).first();
    if (await includeFees.isVisible().catch(() => false)) await includeFees.click().catch(() => {});
    await page.waitForTimeout(3000);
  }

  const texts = await page.locator("article, li, [role='button'], button, [data-testid*='listing'], [data-testid*='offer']").allInnerTexts();
  const unique = [...new Set(texts.map(t => t.trim()).filter(t => t.includes("$") && t.length >= 8 && t.length <= 1200))];
  const parsed = unique.map(text => parseListing(text, target.toString(), source.site)).filter(Boolean);

  if (!parsed.length) {
    const body = await page.locator("body").innerText().catch(() => "");
    const fallback = parseListing(body.slice(0, 120000), target.toString(), source.site);
    if (fallback) parsed.push(fallback);
  }
  return parsed;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "en-US",
  timezoneId: "America/Chicago",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
});

for (const event of config.events) {
  for (const source of event.urls) {
    const page = await context.newPage();
    try {
      const listings = await collectListings(page, source, event.quantity);
      state.lastSuccessfulChecks[`${event.id}:${source.site}`] = new Date().toISOString();
      for (const rule of event.rules) {
        const matching = listings.filter(listing => matchesRule(listing, rule)).sort((a, b) => a.price - b.price);
        if (!matching.length) continue;

        const best = matching[0];
        const key = `${event.id}:${rule.label}:${source.site}`;
        const previous = state.bestPrices[key];

        if (previous === undefined) {
          state.bestPrices[key] = best.price;
          stateChanged = true;
          diagnostics.push(`Baseline: ${key} = $${best.price}`);
        } else if (best.price < previous) {
          alerts.push({
            key,
            event: event.name,
            rule: rule.label,
            site: source.site,
            oldPrice: previous,
            newPrice: best.price,
            section: best.section || "Not shown",
            row: best.row || "Not shown",
            seats: best.seatStart ? `${best.seatStart}${best.seatEnd !== best.seatStart ? `-${best.seatEnd}` : ""}` : "Not shown",
            url: best.url,
            details: best.text
          });
          state.bestPrices[key] = best.price;
          stateChanged = true;
        }
      }
      diagnostics.push(`${event.name} / ${source.site}: ${listings.length} candidate listings`);
    } catch (error) {
      diagnostics.push(`${event.name} / ${source.site}: ERROR ${error.message}`);
    } finally {
      await page.close();
    }
  }
}

await browser.close();

if (stateChanged) await fs.writeFile("state.json", JSON.stringify(state, null, 2) + "\n");
await fs.writeFile("alerts.json", JSON.stringify(alerts, null, 2) + "\n");
await fs.writeFile("diagnostics.txt", diagnostics.join("\n") + "\n");

console.log(diagnostics.join("\n"));
console.log(`Alerts: ${alerts.length}`);
