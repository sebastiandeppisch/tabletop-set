import { boardToSetInput, confirmRemoval, createBoard, resolveSlot, setManualOverride, updateBoard, type Board } from "./lib/board";
import { classifyCard } from "./lib/classify";
import { detectCards } from "./lib/detection";
import type { ImageBuffer } from "./lib/geometry";
import { findSets } from "./lib/solver";
import { drawBoardOverlay } from "./boardOverlay";
import { syncBoardChips } from "./boardUI";
import { registerTabStop } from "./tabs";

const PROCESS_INTERVAL_MS = 600;

export function initBoardTab(): void {
  const video = document.querySelector<HTMLVideoElement>("#board-video")!;
  const overlay = document.querySelector<HTMLCanvasElement>("#board-overlay")!;
  const chipsEl = document.querySelector<HTMLDivElement>("#board-chips")!;
  const startBtn = document.querySelector<HTMLButtonElement>("#board-start-camera")!;
  const stopBtn = document.querySelector<HTMLButtonElement>("#board-stop-camera")!;
  const statusEl = document.querySelector<HTMLParagraphElement>("#board-status")!;
  const setsListEl = document.querySelector<HTMLUListElement>("#board-sets-list")!;

  const overlayCtx = overlay.getContext("2d")!;
  const workCanvas = document.createElement("canvas");
  const workCtx = workCanvas.getContext("2d", { willReadFrequently: true })!;

  let stream: MediaStream | null = null;
  let loopHandle = 0;
  let loopToken = 0;
  let board: Board = createBoard();

  function setStatus(text: string): void {
    statusEl.textContent = text;
  }

  function sizeCanvases(width: number, height: number): void {
    workCanvas.width = width;
    workCanvas.height = height;
    overlay.width = width;
    overlay.height = height;
  }

  function captureImageBuffer(width: number, height: number): ImageBuffer {
    workCtx.drawImage(video, 0, 0, width, height);
    const imageData = workCtx.getImageData(0, 0, width, height);
    return { width, height, data: imageData.data };
  }

  function renderBoard(): void {
    const { slotIds, labels } = boardToSetInput(board);
    const setIndexTriples = findSets(labels);
    const setSlotTriples: [number, number, number][] = setIndexTriples.map(([i, j, k]) => [slotIds[i], slotIds[j], slotIds[k]]);

    const resolvedSlots = board.slots.map(resolveSlot);
    drawBoardOverlay(overlayCtx, overlay.width, overlay.height, resolvedSlots, setSlotTriples);
    syncBoardChips(chipsEl, overlay, resolvedSlots, {
      onPick: (slotId, field, value) => {
        board = setManualOverride(board, slotId, field, value);
        renderBoard();
      },
      onConfirmRemoval: (slotId) => {
        board = confirmRemoval(board, slotId);
        renderBoard();
      },
    });

    const nCards = resolvedSlots.filter((s) => s.status === "active").length;
    const nSets = setSlotTriples.length;
    setStatus(`${nCards} Karte${nCards === 1 ? "" : "n"} auf dem Tisch, ${nSets} Set${nSets === 1 ? "" : "s"} gefunden.`);

    const slotsById = new Map(resolvedSlots.map((s) => [s.id, s]));
    setsListEl.innerHTML = "";
    setSlotTriples.forEach((triple, idx) => {
      const li = document.createElement("li");
      const parts = triple.map((id) => slotsById.get(id)?.label ?? "????");
      li.textContent = `Set ${idx + 1}: ${parts.join(", ")}`;
      setsListEl.appendChild(li);
    });
  }

  async function loop(token: number): Promise<void> {
    if (token !== loopToken) return;
    try {
      const buffer = captureImageBuffer(overlay.width, overlay.height);
      const candidates = detectCards(buffer);
      const attrs = candidates.map((c) => classifyCard(c.warped));
      board = updateBoard(board, candidates, attrs);
      renderBoard();
    } catch (err) {
      console.error("board frame processing failed", err);
    }
    if (token === loopToken) {
      loopHandle = window.setTimeout(() => void loop(token), PROCESS_INTERVAL_MS);
    }
  }

  function stopLoop(): void {
    loopToken += 1;
    window.clearTimeout(loopHandle);
  }

  function stopCamera(): void {
    stopLoop();
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    video.srcObject = null;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    chipsEl.innerHTML = "";
    setStatus("Kamera gestoppt.");
  }

  async function startCamera(): Promise<void> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      setStatus(`Kamera-Zugriff fehlgeschlagen: ${(err as Error).message}`);
      return;
    }

    video.srcObject = stream;
    await video.play();

    sizeCanvases(video.videoWidth, video.videoHeight);
    board = createBoard();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus("Kamera läuft – Spielfeld ins Bild halten.");

    loopToken += 1;
    void loop(loopToken);
  }

  startBtn.addEventListener("click", () => void startCamera());
  stopBtn.addEventListener("click", stopCamera);

  registerTabStop("board", stopCamera);
}
