// Parsing helpers. yad2 is a Next.js app, so every page embeds a
// <script id="__NEXT_DATA__"> blob with the structured data the page rendered
// from. Reading that is far more stable than scraping the DOM, but the exact
// shape changes over time, so everything below is defensive and deep-searches
// the JSON tree rather than relying on fixed paths.

export function extractNextData(html) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// Walk every node in a parsed JSON tree, invoking `visit(node)` on each object.
function walk(node, visit, seen = new Set()) {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, seen);
    return;
  }
  visit(node);
  for (const key of Object.keys(node)) walk(node[key], visit, seen);
}

// Find the first defined, non-empty value for any of `keys`, searching the
// whole subtree (breadth-ish via walk).
function deepFind(node, keys) {
  let found;
  walk(node, (obj) => {
    if (found !== undefined) return;
    for (const key of keys) {
      const v = obj[key];
      if (v !== undefined && v !== null && v !== "") {
        found = v;
        return;
      }
    }
  });
  return found;
}

// Pull a number out of a value that might be "232,000" / "232000 ק\"מ" / 232000,
// or a yad2 { id, text } object (e.g. hand = { id: 2, text: "יד שניה" }).
function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    if (typeof v.id === "number") return v.id;
    return toNumber(v.text ?? v.value);
  }
  const digits = String(v).replace(/[^\d.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function textOf(v) {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  // Some yad2 fields are { text: "...", id: 19 } shaped.
  if (typeof v === "object") {
    return textOf(v.text ?? v.title ?? v.name ?? v.value);
  }
  return null;
}

// Looks like a yad2 item id: short alphanumeric token used in /item/<token>.
function looksLikeToken(v) {
  return typeof v === "string" && /^[a-z0-9]{6,12}$/i.test(v);
}

// ---- Search feed: collect all listings on a results page ------------------

export function parseSearchFeed(nextData) {
  const listings = new Map(); // token -> raw listing object

  walk(nextData, (obj) => {
    // A feed item has a token AND a price-ish field — that combination is
    // specific enough to avoid pulling in unrelated objects.
    const token = obj.token ?? obj.adNumber ?? obj.id;
    const hasPrice =
      obj.price !== undefined || obj.priceText !== undefined || obj.price_value !== undefined;
    if (looksLikeToken(token) && hasPrice) {
      if (!listings.has(token)) listings.set(token, { token, raw: obj });
    }
  });

  return [...listings.values()].map(({ token, raw }) => ({
    id: token,
    ...normalizeCar(raw),
    raw,
  }));
}

// ---- Item page: extract the detailed fields for one car -------------------

export function parseItemPage(nextData, fallbackId) {
  // Prefer the object that actually carries the item id; otherwise take the
  // richest object that has price + a couple of detail fields.
  let best = null;
  let bestScore = -1;

  walk(nextData, (obj) => {
    const token = obj.token ?? obj.adNumber ?? obj.id;
    let score = 0;
    if (looksLikeToken(token)) score += 2;
    if (token === fallbackId) score += 5;
    if ("price" in obj) score += 2;
    if ("km" in obj || "kilometers" in obj || "mileage" in obj) score += 2;
    if ("hand" in obj || "hand_num" in obj) score += 1;
    if ("description" in obj || "desc" in obj) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = obj;
    }
  });

  const source = best ?? nextData;
  return {
    id: fallbackId,
    ...normalizeCar(source),
    raw: best,
  };
}

// Map a raw yad2 object onto the fields we care about. Tries many possible key
// names (English + Hebrew) and falls back to deep search across the subtree.
export function normalizeCar(obj) {
  const price = toNumber(deepFind(obj, ["price", "price_value", "priceText"]));
  const year = toNumber(
    deepFind(obj, ["yearOfProduction", "year", "productionYear", "year_of_manufacture"])
  );
  const hand = toNumber(deepFind(obj, ["hand", "hand_num", "currentHand", "yad"]));
  const km = toNumber(
    deepFind(obj, ["km", "kilometers", "kilometer", "mileage", "kilometrage", "kilometer_text"])
  );

  const description = textOf(
    deepFind(obj, ["description", "desc", "info_text", "searchText", "freeText"])
  );

  const manufacturer = textOf(
    deepFind(obj, ["manufacturer", "manufacturerText", "manufacturer_eng", "make"])
  );
  const model = textOf(deepFind(obj, ["model", "modelText", "modelName"]));
  const subModel = textOf(deepFind(obj, ["subModel", "subModelText", "trimLevel"]));

  const city = textOf(deepFind(obj, ["city", "cityText", "city_text"]));
  const area = textOf(deepFind(obj, ["area", "areaText", "neighborhood"]));
  const location = [city, area].filter(Boolean).join(", ") || textOf(deepFind(obj, ["address"]));

  // Secondary id (yad2 "מספר מודעה" / report number) and listing timestamps.
  const adNumber = toNumber(deepFind(obj, ["adNumber"]));
  const publishedAt = textOf(deepFind(obj, ["createdAt", "publishDate", "publishedAt"]));
  const updatedAt = textOf(deepFind(obj, ["updatedAt"]));

  const gearbox = textOf(deepFind(obj, ["gearBox", "gearbox", "gear", "transmission"]));
  const engineType = textOf(deepFind(obj, ["engineType", "fuel", "engine_type"]));
  const engineVolume = toNumber(deepFind(obj, ["engineVolume", "engine_val", "cc"]));
  const horsePower = toNumber(deepFind(obj, ["horsePower", "hp", "power"]));
  const color = textOf(deepFind(obj, ["color", "colorText"]));
  const ownership = textOf(deepFind(obj, ["ownership", "owner", "currentOwner"]));

  return {
    title: [manufacturer, model].filter(Boolean).join(" ") || null,
    adNumber,
    publishedAt,
    updatedAt,
    manufacturer,
    model,
    subModel,
    year,
    hand,
    km,
    price,
    location,
    description,
    gearbox,
    engineType,
    engineVolume,
    horsePower,
    color,
    ownership,
  };
}
