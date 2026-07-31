// Manual E2E smoke test: uploads a photo through the file input and checks
// the pipeline runs end-to-end in a real browser with no console errors.
//
// Usage: node e2e/upload-smoke.mjs <url> <path-to-photo> [screenshot-path]
// Requires `npm run dev` (or preview) running at <url> first.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:5173";
const imagePath = process.argv[3];
const screenshotPath = process.argv[4] ?? "e2e/upload-smoke.png";

if (!imagePath) {
  console.error("usage: node e2e/upload-smoke.mjs <url> <path-to-photo> [screenshot-path]");
  process.exit(1);
}

// This sandbox's Chromium build doesn't match the installed Playwright
// version's expected revision, so point at the pre-installed binary
// directly. CHROMIUM_PATH lets this run unmodified elsewhere.
const executablePath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto(url, { waitUntil: "networkidle" });

const fileInput = await page.$("#file-input");
await fileInput.setInputFiles(imagePath);

// wait for the status text to change from the initial placeholder
await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("erkannt"), {
  timeout: 15000,
});

const status = await page.textContent("#status");
const setsList = await page.$$eval("#sets-list li", (els) => els.map((e) => e.textContent));

await page.screenshot({ path: screenshotPath });

console.log("STATUS:", status);
console.log("SETS:", JSON.stringify(setsList));
console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors));

await browser.close();

if (consoleErrors.length > 0) process.exit(1);
