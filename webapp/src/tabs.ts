/** Top-level Scan / Tisch tab switching. Kept separate from both main.ts and
 * boardMain.ts so neither has to import the other -- each just registers how
 * to stop its own camera, and this module makes sure switching tabs never
 * leaves two getUserMedia streams fighting over the same camera. */

export type TabId = "scan" | "board";

type StopFn = () => void;

const stopFns: Partial<Record<TabId, StopFn>> = {};
let current: TabId = "scan";

export function registerTabStop(tab: TabId, fn: StopFn): void {
  stopFns[tab] = fn;
}

export function initTabs(): void {
  const scanBtn = document.querySelector<HTMLButtonElement>("#tab-scan")!;
  const boardBtn = document.querySelector<HTMLButtonElement>("#tab-board")!;
  const scanPanel = document.querySelector<HTMLElement>("#scan-panel")!;
  const boardPanel = document.querySelector<HTMLElement>("#board-panel")!;

  function setTab(next: TabId): void {
    if (next === current) return;
    stopFns[current]?.();
    current = next;
    scanBtn.classList.toggle("active", next === "scan");
    scanBtn.setAttribute("aria-selected", String(next === "scan"));
    boardBtn.classList.toggle("active", next === "board");
    boardBtn.setAttribute("aria-selected", String(next === "board"));
    scanPanel.classList.toggle("hidden", next !== "scan");
    boardPanel.classList.toggle("hidden", next !== "board");
  }

  scanBtn.addEventListener("click", () => setTab("scan"));
  boardBtn.addEventListener("click", () => setTab("board"));
}
