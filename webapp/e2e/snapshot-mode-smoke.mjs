// Manual E2E smoke test: switches to "Einzelfoto" mode, starts the camera
// against Chromium's fake video device, and checks that nothing processes
// until "Foto aufnehmen" is clicked (unlike live mode, which starts
// processing immediately).
//
// Usage: node e2e/snapshot-mode-smoke.mjs <url>
// Requires `npm run dev` (or preview) running at <url> first.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:5173";
const executablePath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

const browser = await chromium.launch({
  executablePath,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, permissions: ["camera"] });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto(url, { waitUntil: "networkidle" });

await page.click("#mode-snapshot");
await page.click("#start-camera");
await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("Foto aufnehmen"), {
  timeout: 15000,
});
const statusBeforeCapture = await page.textContent("#status");
const captureVisible = await page.isVisible("#capture-photo");

await page.click("#capture-photo");
await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("erkannt"), {
  timeout: 15000,
});
const statusAfterCapture = await page.textContent("#status");

await page.click("#stop-camera");
await page.waitForTimeout(200);
const statusAfterStop = await page.textContent("#status");

console.log("CAPTURE_BUTTON_VISIBLE_IN_SNAPSHOT_MODE:", captureVisible);
console.log("STATUS_BEFORE_CAPTURE:", statusBeforeCapture);
console.log("STATUS_AFTER_CAPTURE:", statusAfterCapture);
console.log("STATUS_AFTER_STOP:", statusAfterStop);
console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors));

await browser.close();

if (consoleErrors.length > 0) process.exit(1);
if (!captureVisible) process.exit(1);
