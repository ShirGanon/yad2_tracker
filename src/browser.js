import { chromium } from "playwright";
import { config } from "../config.js";

// Launch a single browser context we reuse for the whole run, so the
// bot-protection cookie we earn on the first page is kept for later pages.
export async function launchBrowser() {
  const browser = await chromium.launch({
    headless: config.browser.headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    locale: config.browser.locale,
    userAgent: config.browser.userAgent,
    viewport: { width: 1440, height: 900 },
    timezoneId: "Asia/Jerusalem",
  });

  // Light stealth: hide the obvious `navigator.webdriver` automation flag.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  context.setDefaultNavigationTimeout(config.browser.navTimeoutMs);

  return { browser, context };
}

// Navigate to a URL and return the full HTML once the Next.js payload is present.
export async function fetchHtml(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Wait for the embedded Next.js data, which is where we read everything from.
    // If the bot-protection interstitial shows instead, this will time out.
    await page
      .waitForSelector("#__NEXT_DATA__", { timeout: config.browser.navTimeoutMs })
      .catch(() => null);

    return await page.content();
  } finally {
    await page.close();
  }
}

export function randomDelay() {
  const { minDelayMs, maxDelayMs } = config.browser;
  const ms = Math.floor(minDelayMs + Math.random() * (maxDelayMs - minDelayMs));
  return new Promise((resolve) => setTimeout(resolve, ms));
}
