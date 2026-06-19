# yad2 used-car tracker

Scrapes a yad2 used-car search, opens every listing, and tracks each car's
details and **price history** over time in a JSON file.

Example search being tracked (edit in `config.js`):
`manufacturer=19&model=10233&year=2008-2014&hand=0-3` (Toyota Land Cruiser).

## How it works

1. **Search pages** — loads the results pages and reads the embedded Next.js
   `__NEXT_DATA__` JSON to collect every listing's id.
2. **Detail pages** — opens each `/vehicles/item/<id>` page and extracts:
   price, hand (יד), kilometers, year, location, description, gearbox, fuel,
   engine, color, ownership, the publish date (פורסם ב / `publishedAt`), last
   update, and the yad2 ad number (מספר מודעה / `adNumber`, a secondary id).
3. **Tracking DB** — merges into `data/cars.json`, keyed by id. On every run it
   appends to each car's `priceHistory`, marks new/relisted cars, and flags
   listings that disappeared (`active: false`).

yad2 sits behind bot protection, so this uses **Playwright** (a real Chromium)
rather than plain HTTP, reusing one browser context so the protection cookie
earned on the first page carries to the rest.

## Setup

```bash
npm install              # also runs `playwright install chromium`
```

## Usage

```bash
npm run scrape           # scrape the configured search + update the tracker
npm run list             # show active listings, cheapest first
node src/index.js show <id>   # full record + price history for one car
```

## Data shape (`data/cars.json`)

```jsonc
{
  "schemaVersion": 1,
  "lastRun": "2026-06-19T…",
  "cars": {
    "hu3ed7ty": {
      "id": "hu3ed7ty",
      "adNumber": 86190517,
      "url": "https://www.yad2.co.il/vehicles/item/hu3ed7ty",
      "title": "טויוטה לנד קרוזר",
      "publishedAt": "2026-06-11T…", "updatedAt": "…",
      "year": 2013, "hand": 2, "km": 232000,
      "currentPrice": 132000,
      "previousPrice": 135000,
      "location": "…", "description": "…",
      "priceHistory": [{ "date": "…", "price": 135000 }, { "date": "…", "price": 132000 }],
      "firstSeen": "…", "lastSeen": "…", "active": true
    }
  }
}
```

The id-keyed, flat schema is designed to map directly onto a Supabase/Mongo
`cars` table (and `priceHistory` onto a child `price_events` table) when you
migrate off JSON.

## Tuning / debugging

- `config.js` — search params, `maxPages`, polite delays, headless on/off.
- Set `browser.headless: false` to watch the run and clear a bot challenge.
- Raw `__NEXT_DATA__` dumps land in `data/raw/` so you can inspect the real JSON
  shape if a field stops parsing (key names in `src/parse.js` may need updating).

## Notes

- Scraping yad2 may be against its Terms of Service; use responsibly, keep the
  delays generous, and only for personal use.
- If `scrape` reports "no `__NEXT_DATA__` found", you hit the bot wall — rerun
  with `headless:false`, solve the challenge once, and the cookie carries over.
