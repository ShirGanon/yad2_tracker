// Central configuration for the yad2 tracker.
// Edit the `search` block to change which listings are tracked.

export const config = {
  // The search query, expressed as yad2 URL parameters.
  // This corresponds to:
  // https://www.yad2.co.il/vehicles/cars?manufacturer=19&model=10233&year=2008-2014&hand=0-3
  search: {
    baseUrl: "https://www.yad2.co.il/vehicles/cars",
    params: {
      manufacturer: "19",
      model: "10233",
      year: "2008-2014",
      hand: "0-3",
    },
    // How many result pages to walk at most (yad2 paginates ~40 per page).
    maxPages: 10,
  },

  // Where the tracking database lives.
  dataFile: "data/cars.json",
  // Raw __NEXT_DATA__ dumps for debugging parsing (set to null to disable).
  rawDumpDir: "data/raw",

  browser: {
    // headless:false is useful while debugging the bot-protection challenge.
    headless: true,
    // Polite delays (ms) so we don't hammer the site / trip rate limits.
    minDelayMs: 2500,
    maxDelayMs: 6000,
    // Per-page navigation timeout.
    navTimeoutMs: 45000,
    locale: "he-IL",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  },
};

export function buildSearchUrl(page = 1) {
  const params = new URLSearchParams({ ...config.search.params, page: String(page) });
  return `${config.search.baseUrl}?${params.toString()}`;
}

export function buildItemUrl(id) {
  return `https://www.yad2.co.il/vehicles/item/${id}`;
}
