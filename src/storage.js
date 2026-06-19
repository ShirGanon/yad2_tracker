import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { config, buildItemUrl } from "../config.js";

// The tracking DB is a single JSON file, keyed by yad2 item id, so each run can
// diff against the previous one: append price changes, mark new/relisted cars,
// and flag listings that have disappeared. The schema below is intentionally
// flat and id-keyed so it maps cleanly onto a Supabase/Mongo table later.

const emptyDb = () => ({ schemaVersion: 1, lastRun: null, cars: {} });

export async function loadDb() {
  try {
    const text = await readFile(config.dataFile, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err.code === "ENOENT") return emptyDb();
    throw err;
  }
}

export async function saveDb(db) {
  await mkdir(dirname(config.dataFile), { recursive: true });
  await writeFile(config.dataFile, JSON.stringify(db, null, 2));
}

// Merge a freshly scraped car into the DB, recording price history and
// first/last-seen timestamps. `car` is a normalized object from parse.js.
export function upsertCar(db, car, now) {
  const existing = db.cars[car.id];

  if (!existing) {
    db.cars[car.id] = {
      id: car.id,
      adNumber: car.adNumber, // yad2 "מספר מודעה" — secondary numeric id
      url: buildItemUrl(car.id),
      title: car.title,
      publishedAt: car.publishedAt, // "פורסם ב" — when the ad was first posted
      updatedAt: car.updatedAt,
      manufacturer: car.manufacturer,
      model: car.model,
      subModel: car.subModel,
      year: car.year,
      hand: car.hand,
      km: car.km,
      location: car.location,
      description: car.description,
      gearbox: car.gearbox,
      engineType: car.engineType,
      engineVolume: car.engineVolume,
      horsePower: car.horsePower,
      color: car.color,
      ownership: car.ownership,
      currentPrice: car.price,
      priceHistory: car.price != null ? [{ date: now, price: car.price }] : [],
      firstSeen: now,
      lastSeen: now,
      active: true,
    };
    return { status: "new" };
  }

  // Update mutable fields and the price-history trail.
  let status = "unchanged";
  if (car.price != null && car.price !== existing.currentPrice) {
    existing.priceHistory.push({ date: now, price: car.price });
    existing.previousPrice = existing.currentPrice;
    existing.currentPrice = car.price;
    status = "price-changed";
  }

  // Refresh detail fields when the detail scrape filled them in.
  for (const key of [
    "adNumber", "title", "manufacturer", "model", "subModel", "year", "hand", "km",
    "location", "description", "publishedAt", "updatedAt", "gearbox", "engineType",
    "engineVolume", "horsePower", "color", "ownership",
  ]) {
    if (car[key] != null) existing[key] = car[key];
  }

  if (existing.active === false) status = status === "unchanged" ? "relisted" : status;
  existing.active = true;
  existing.lastSeen = now;
  return { status };
}

// Any tracked car not seen in this run is considered delisted/sold.
export function markMissingInactive(db, seenIds, now) {
  const gone = [];
  for (const [id, car] of Object.entries(db.cars)) {
    if (!seenIds.has(id) && car.active) {
      car.active = false;
      car.delistedAt = now;
      gone.push(id);
    }
  }
  return gone;
}
