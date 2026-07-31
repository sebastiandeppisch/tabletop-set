// Manual E2E smoke test: starts the live camera path against Chromium's
// fake video device and checks the processing loop runs without error
// (the fake device has no real cards in it, so 0 detections is expected --
// this checks stability, not detection accuracy).
//
// Usage: node e2e/camera-smoke.mjs <url>
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
await page.click("#start-camera");

await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("erkannt"), {
  timeout: 15000,
});
const statusWhileRunning = await page.textContent("#status");

// let a couple of processing cycles run to check for stability
await page.waitForTimeout(1500);
await page.click("#stop-camera");
await page.waitForTimeout(300);
const statusAfterStop = await page.textContent("#status");

console.log("STATUS_WHILE_RUNNING:", statusWhileRunning);
console.log("STATUS_AFTER_STOP:", statusAfterStop);
console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors));

await browser.close();

if (consoleErrors.length > 0) process.exit(1);
