#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { config, buildSearchUrl, buildItemUrl } from "../config.js";
import { launchBrowser, fetchHtml, randomDelay } from "./browser.js";
import { extractNextData, parseSearchFeed, parseItemPage } from "./parse.js";
import { loadDb, saveDb, upsertCar, markMissingInactive } from "./storage.js";

const ils = (n) => (n == null ? "—" : `₪${n.toLocaleString("en-US")}`);

async function dumpRaw(name, nextData) {
  if (!config.rawDumpDir || !nextData) return;
  await mkdir(config.rawDumpDir, { recursive: true });
  await writeFile(`${config.rawDumpDir}/${name}.json`, JSON.stringify(nextData, null, 2));
}

// Step 1: walk the search result pages and collect every listing's id.
async function collectListings(context) {
  const all = new Map(); // id -> listing summary from feed
  for (let page = 1; page <= config.search.maxPages; page++) {
    const url = buildSearchUrl(page);
    console.log(`\n[search] page ${page}: ${url}`);
    const html = await fetchHtml(context, url);
    const nextData = extractNextData(html);

    if (!nextData) {
      console.warn("[search] no __NEXT_DATA__ found — likely a bot-protection page. Stopping.");
      break;
    }
    await dumpRaw(`search-page-${page}`, nextData);

    const listings = parseSearchFeed(nextData);
    console.log(`[search] found ${listings.length} listings on this page`);
    if (listings.length === 0) break; // ran past the last page

    // yad2 clamps out-of-range page numbers and re-serves the last page, so
    // stop once a page contributes no new ids rather than looping to maxPages.
    let added = 0;
    for (const l of listings) if (!all.has(l.id)) { all.set(l.id, l); added++; }
    console.log(`[search] ${added} new (${all.size} total so far)`);
    if (added === 0) break;
    await randomDelay();
  }
  return [...all.values()];
}

// Step 2: open each car's page and extract full details.
async function scrapeDetails(context, listings, db, now) {
  const seenIds = new Set();
  let i = 0;
  for (const listing of listings) {
    i++;
    seenIds.add(listing.id);
    const url = buildItemUrl(listing.id);
    console.log(`[item ${i}/${listings.length}] ${listing.id}`);
    try {
      const html = await fetchHtml(context, url);
      const nextData = extractNextData(html);
      if (!nextData) {
        console.warn(`  ! no __NEXT_DATA__ for ${listing.id}; keeping feed summary only`);
        // Fall back to whatever the feed gave us.
        const { status } = upsertCar(db, listing, now);
        logCar(status, db.cars[listing.id]);
        await randomDelay();
        continue;
      }
      await dumpRaw(`item-${listing.id}`, nextData);
      const detail = parseItemPage(nextData, listing.id);
      // Prefer detail fields, but keep feed values where detail came up empty.
      const merged = { ...listing, ...Object.fromEntries(
        Object.entries(detail).filter(([, v]) => v != null && v !== "")
      ), id: listing.id };
      const { status } = upsertCar(db, merged, now);
      logCar(status, db.cars[listing.id]);
    } catch (err) {
      console.warn(`  ! failed ${listing.id}: ${err.message}`);
    }
    await randomDelay();
  }
  return seenIds;
}

function logCar(status, car) {
  const tag = { new: "🆕", "price-changed": "💱", relisted: "♻️", unchanged: "  " }[status] || "  ";
  const price = status === "price-changed" ? `${ils(car.previousPrice)} → ${ils(car.currentPrice)}` : ils(car.currentPrice);
  console.log(`  ${tag} ${car.title ?? car.id} | ${car.year ?? "?"} | יד ${car.hand ?? "?"} | ${car.km != null ? car.km.toLocaleString() + " km" : "?"} | ${price} | ${car.location ?? ""}`);
}

async function cmdScrape() {
  const now = new Date().toISOString();
  const db = await loadDb();
  const { browser, context } = await launchBrowser();
  try {
    const listings = await collectListings(context);

    // Guard: if we collected nothing, the search was blocked (bot protection)
    // or genuinely empty. Either way, do NOT touch the tracking state —
    // otherwise a single blocked run would mark every car as "delisted".
    if (listings.length === 0) {
      console.error(
        "\n[abort] collected 0 listings (likely bot-protection or a bad query). " +
        "Leaving the tracker unchanged. Not committing."
      );
      process.exitCode = 1;
      return;
    }

    console.log(`\n[scrape] ${listings.length} unique listings total. Fetching details…\n`);
    const seenIds = await scrapeDetails(context, listings, db, now);
    const gone = markMissingInactive(db, seenIds, now);
    db.lastRun = now;
    await saveDb(db);

    const summary = Object.values(db.cars);
    console.log(`\n[done] tracked: ${summary.length} | active: ${summary.filter(c => c.active).length} | newly delisted: ${gone.length}`);
    console.log(`[done] saved to ${config.dataFile}`);
  } finally {
    await browser.close();
  }
}

async function cmdList() {
  const db = await loadDb();
  const cars = Object.values(db.cars)
    .filter((c) => c.active)
    .sort((a, b) => (a.currentPrice ?? Infinity) - (b.currentPrice ?? Infinity));
  console.log(`Last run: ${db.lastRun ?? "never"} | ${cars.length} active listings\n`);
  for (const c of cars) {
    const trend = c.priceHistory?.length > 1 ? ` (${c.priceHistory.length} price points)` : "";
    console.log(`${ils(c.currentPrice).padStart(10)} | ${c.year ?? "?"} | יד ${c.hand ?? "?"} | ${(c.km != null ? c.km.toLocaleString() + "km" : "?").padStart(9)} | ${c.title ?? c.id}${trend}`);
    console.log(`           ${c.location ?? ""}  ${c.url}`);
  }
}

async function cmdShow(id) {
  const db = await loadDb();
  const car = db.cars[id];
  if (!car) return console.error(`No tracked car with id "${id}"`);
  console.log(JSON.stringify(car, null, 2));
}

const [, , cmd, arg] = process.argv;
const commands = {
  scrape: cmdScrape,
  list: cmdList,
  show: () => cmdShow(arg),
};
(commands[cmd] || (() => {
  console.log(`yad2-tracker

Usage:
  node src/index.js scrape     Scrape the configured search + track all listings
  node src/index.js list       Print active tracked listings (cheapest first)
  node src/index.js show <id>  Print the full record (incl. price history) for one car

Edit config.js to change the search query.`);
}))();
