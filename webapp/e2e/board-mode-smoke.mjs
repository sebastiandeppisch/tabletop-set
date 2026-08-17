// Manual E2E smoke test: switches to the "Tisch" tab, starts the camera
// against Chromium's fake video device, and checks the board processing
// loop runs without error, then switches back to "Scan" and checks the
// board camera actually stopped (cross-tab stop coordination).
//
// Usage: node e2e/board-mode-smoke.mjs <url>
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

await page.click("#tab-board");
const boardPanelVisible = await page.isVisible("#board-panel");
const scanPanelVisible = await page.isVisible("#scan-panel");

await page.click("#board-start-camera");
await page.waitForFunction(() => document.querySelector("#board-status")?.textContent?.includes("Karte"), {
  timeout: 15000,
});
const statusWhileRunning = await page.textContent("#board-status");

await page.waitForTimeout(1500);

// switching tabs should stop the board camera without needing "Kamera stoppen"
await page.click("#tab-scan");
await page.waitForTimeout(300);
const boardStopBtnDisabled = await page.getAttribute("#board-stop-camera", "disabled");

console.log("BOARD_PANEL_VISIBLE_AFTER_TAB_CLICK:", boardPanelVisible);
console.log("SCAN_PANEL_HIDDEN_AFTER_TAB_CLICK:", !scanPanelVisible);
console.log("BOARD_STATUS_WHILE_RUNNING:", statusWhileRunning);
console.log("BOARD_STOP_BTN_DISABLED_AFTER_TAB_SWITCH:", boardStopBtnDisabled !== null);
console.log("CONSOLE_ERRORS:", JSON.stringify(consoleErrors));

await browser.close();

if (consoleErrors.length > 0) process.exit(1);
if (!boardPanelVisible || scanPanelVisible) process.exit(1);
if (boardStopBtnDisabled === null) process.exit(1);
