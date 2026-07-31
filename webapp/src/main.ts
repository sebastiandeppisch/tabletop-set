import "./style.css";
import { classifyCard, labelOf, type CardAttributes } from "./lib/classify";
import { detectCards, type CardCandidate } from "./lib/detection";
import type { ImageBuffer } from "./lib/geometry";
import { findSets } from "./lib/solver";
import { drawOverlay } from "./overlay";

const PROCESS_INTERVAL_MS = 600;

const video = document.querySelector<HTMLVideoElement>("#video")!;
const stillImage = document.querySelector<HTMLImageElement>("#still-image")!;
const overlay = document.querySelector<HTMLCanvasElement>("#overlay")!;
const startCameraBtn = document.querySelector<HTMLButtonElement>("#start-camera")!;
const stopCameraBtn = document.querySelector<HTMLButtonElement>("#stop-camera")!;
const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const setsListEl = document.querySelector<HTMLUListElement>("#sets-list")!;

const overlayCtx = overlay.getContext("2d")!;
const workCanvas = document.createElement("canvas");
const workCtx = workCanvas.getContext("2d", { willReadFrequently: true })!;

let stream: MediaStream | null = null;
let cameraLoopHandle = 0;
let cameraLoopToken = 0;

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
  setStatus("Kamera läuft – Karten ins Bild halten.");

  cameraLoopToken += 1;
  void cameraLoop(cameraLoopToken);
}

function stopCamera(): void {
  cameraLoopToken += 1;
  window.clearTimeout(cameraLoopHandle);
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  video.srcObject = null;
  video.classList.add("hidden");
  startCameraBtn.disabled = false;
  stopCameraBtn.disabled = true;
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

startCameraBtn.addEventListener("click", () => void startCamera());
stopCameraBtn.addEventListener("click", stopCamera);
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFileUpload(file);
});
