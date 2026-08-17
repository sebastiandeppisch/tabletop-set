import "./style.css";
import { classifyCard, labelOf, type CardAttributes } from "./lib/classify";
import { detectCards, type CardCandidate } from "./lib/detection";
import type { ImageBuffer } from "./lib/geometry";
import { findSets } from "./lib/solver";
import { drawOverlay } from "./overlay";
import { initBoardTab } from "./boardMain";
import { initTabs, registerTabStop } from "./tabs";

const PROCESS_INTERVAL_MS = 600;

type Mode = "live" | "snapshot";

const video = document.querySelector<HTMLVideoElement>("#video")!;
const stillImage = document.querySelector<HTMLImageElement>("#still-image")!;
const overlay = document.querySelector<HTMLCanvasElement>("#overlay")!;
const startCameraBtn = document.querySelector<HTMLButtonElement>("#start-camera")!;
const stopCameraBtn = document.querySelector<HTMLButtonElement>("#stop-camera")!;
const capturePhotoBtn = document.querySelector<HTMLButtonElement>("#capture-photo")!;
const modeLiveBtn = document.querySelector<HTMLButtonElement>("#mode-live")!;
const modeSnapshotBtn = document.querySelector<HTMLButtonElement>("#mode-snapshot")!;
const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const setsListEl = document.querySelector<HTMLUListElement>("#sets-list")!;

const overlayCtx = overlay.getContext("2d")!;
const workCanvas = document.createElement("canvas");
const workCtx = workCanvas.getContext("2d", { willReadFrequently: true })!;

let stream: MediaStream | null = null;
let cameraLoopHandle = 0;
let cameraLoopToken = 0;
let mode: Mode = "live";

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function sizeCanvases(width: number, height: number): void {
  workCanvas.width = width;
  workCanvas.height = height;
  overlay.width = width;
  overlay.height = height;
}

function captureImageBuffer(source: CanvasImageSource, width: number, height: number): ImageBuffer {
  workCtx.drawImage(source, 0, 0, width, height);
  const imageData = workCtx.getImageData(0, 0, width, height);
  return { width, height, data: imageData.data };
}

interface ProcessResult {
  candidates: CardCandidate[];
  attrs: CardAttributes[];
  sets: [number, number, number][];
}

function runPipeline(image: ImageBuffer): ProcessResult {
  const candidates = detectCards(image);
  const attrs = candidates.map((c) => classifyCard(c.warped));
  const labels = attrs.map(labelOf);
  const sets = findSets(labels);
  return { candidates, attrs, sets };
}

function renderResult({ candidates, attrs, sets }: ProcessResult): void {
  drawOverlay(overlayCtx, overlay.width, overlay.height, candidates, attrs, sets);

  const nCards = candidates.length;
  const nSets = sets.length;
  setStatus(`${nCards} Karte${nCards === 1 ? "" : "n"} erkannt, ${nSets} Set${nSets === 1 ? "" : "s"} gefunden.`);

  setsListEl.innerHTML = "";
  sets.forEach(([i, j, k], idx) => {
    const li = document.createElement("li");
    const labels = [attrs[i], attrs[j], attrs[k]].map(labelOf).join(", ");
    li.textContent = `Set ${idx + 1}: ${labels}`;
    setsListEl.appendChild(li);
  });
}

function processStill(): void {
  const buffer = captureImageBuffer(stillImage, overlay.width, overlay.height);
  renderResult(runPipeline(buffer));
}

function capturePhoto(): void {
  setStatus("Foto wird ausgewertet…");
  setTimeout(() => {
    const buffer = captureImageBuffer(video, overlay.width, overlay.height);
    renderResult(runPipeline(buffer));
  }, 0);
}

async function cameraLoop(token: number): Promise<void> {
  if (token !== cameraLoopToken) return;
  try {
    const buffer = captureImageBuffer(video, overlay.width, overlay.height);
    renderResult(runPipeline(buffer));
  } catch (err) {
    console.error("frame processing failed", err);
  }
  if (token === cameraLoopToken) {
    cameraLoopHandle = window.setTimeout(() => void cameraLoop(token), PROCESS_INTERVAL_MS);
  }
}

function stopCameraLoop(): void {
  cameraLoopToken += 1;
  window.clearTimeout(cameraLoopHandle);
}

function applyModeToRunningCamera(): void {
  if (!stream) return;
  if (mode === "live") {
    capturePhotoBtn.classList.add("hidden");
    capturePhotoBtn.disabled = true;
    cameraLoopToken += 1;
    void cameraLoop(cameraLoopToken);
    setStatus("Kamera läuft – Karten ins Bild halten.");
  } else {
    stopCameraLoop();
    capturePhotoBtn.classList.remove("hidden");
    capturePhotoBtn.disabled = false;
    setStatus("Kamera bereit – Karten ausrichten und „Foto aufnehmen“ tippen.");
  }
}

function setMode(next: Mode): void {
  mode = next;
  modeLiveBtn.classList.toggle("active", mode === "live");
  modeLiveBtn.setAttribute("aria-pressed", String(mode === "live"));
  modeSnapshotBtn.classList.toggle("active", mode === "snapshot");
  modeSnapshotBtn.setAttribute("aria-pressed", String(mode === "snapshot"));
  applyModeToRunningCamera();
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

  stillImage.classList.add("hidden");
  video.classList.remove("hidden");

  sizeCanvases(video.videoWidth, video.videoHeight);
  startCameraBtn.disabled = true;
  stopCameraBtn.disabled = false;

  applyModeToRunningCamera();
}

function stopCamera(): void {
  stopCameraLoop();
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  video.srcObject = null;
  video.classList.add("hidden");
  startCameraBtn.disabled = false;
  stopCameraBtn.disabled = true;
  capturePhotoBtn.classList.add("hidden");
  capturePhotoBtn.disabled = true;
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  setStatus("Kamera gestoppt.");
}

function handleFileUpload(file: File): void {
  stopCamera();
  const url = URL.createObjectURL(file);
  stillImage.onload = () => {
    URL.revokeObjectURL(url);
    stillImage.classList.remove("hidden");
    sizeCanvases(stillImage.naturalWidth, stillImage.naturalHeight);
    setStatus("Foto wird ausgewertet…");
    setTimeout(processStill, 0);
  };
  stillImage.src = url;
}

modeLiveBtn.addEventListener("click", () => setMode("live"));
modeSnapshotBtn.addEventListener("click", () => setMode("snapshot"));
startCameraBtn.addEventListener("click", () => void startCamera());
stopCameraBtn.addEventListener("click", stopCamera);
capturePhotoBtn.addEventListener("click", capturePhoto);
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFileUpload(file);
});

registerTabStop("scan", stopCamera);
initBoardTab();
initTabs();
