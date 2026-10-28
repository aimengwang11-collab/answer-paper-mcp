/**
 * Ink answer pad inside the MCP App iframe.
 *
 * Host connection uses `App` from `@modelcontextprotocol/ext-apps`, the same
 * bridge the Excalidraw MCP App widget uses (that repo calls it via `useApp`).
 * Submit goes through `callServerTool`, the same path as their share button.
 *
 * Strokes are PassPaper marks: `{ points, width, eraser }`. Eraser marks are
 * white and replayed in order, so undo and the PNG both come from the list.
 * The PNG is what the agent reads, which is the noteful-mcp page-image idea
 * without Noteful files or branding.
 *
 * Apple Pencil always draws. The sheet does not use native scrolling, which
 * WebKit steals from the stylus. One finger pans; two pinch-zoom. Pull taller
 * asks the host for a larger frame and, when the iframe will not grow, the
 * same sheet still zooms and pans inside the space Claude gives.
 */

import type { ContentBlock } from "@modelcontextprotocol/client";
import { App, type McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import {
  ERASER_WIDTH,
  LIMITS,
  PEN_WIDTH,
  SUBMIT_TOOL,
  type InkPoint,
  type InkStroke,
} from "./ink.js";
import {
  FRAME_MIN_PX,
  GROW_MARGIN_PX,
  MAX_PAPER_PX,
  clampPan,
  paperPointFromView,
  panZoomFromGesture,
  exportBitmapSize,
  grownLength,
  initialPaperLength,
  inkVerticalSpan,
  nextFrameHeight,
  panAfterInk,
  zoomAboutPoint,
} from "./paper-geometry.js";

import { PaperInput, type Contact } from "./paper-input.js";

const TILE_PX = 1200;

const app = new App(
  { name: "Ink Answer Paper", version: "0.1.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
  // The sheet fills the iframe. Automatic measurement would report that clamped
  // height and undo an explicit request for a taller frame.
  { autoResize: false },
);

app.ontoolresult = () => {
  // The host opens a blank sheet. Questions stay in the chat transcript.
};

const connected = app
  .connect()
  .then(() => true)
  .catch(() => false);

const header = requiredElement<HTMLElement>("header");
const penButton = requiredElement<HTMLButtonElement>("pen");
const eraserButton = requiredElement<HTMLButtonElement>("eraser");
const undoButton = requiredElement<HTMLButtonElement>("undo");
const clearButton = requiredElement<HTMLButtonElement>("clear");
const submitButton = requiredElement<HTMLButtonElement>("submit");
const status = requiredElement<HTMLElement>("status");
const sheet = requiredElement<HTMLElement>("sheet");
const lengthEl = requiredElement<HTMLElement>("length");
const tilesEl = requiredElement<HTMLElement>("tiles");
const canvas = requiredElement<HTMLCanvasElement>("paper");
const resizeHandle = requiredElement<HTMLElement>("resize");
const zoomOutButton = requiredElement<HTMLButtonElement>("zoom-out");
const zoomInButton = requiredElement<HTMLButtonElement>("zoom-in");
const zoomLabel = requiredElement<HTMLElement>("zoom-label");

type Gesture = {
  ids: number[];
  dist: number;
  zoom: number;
  panX: number;
  panY: number;
  focalX: number;
  focalY: number;
};

const strokes: InkStroke[] = [];
const tiles = new Map<number, HTMLCanvasElement>();
const input = new PaperInput();
let paperLength = initialPaperLength(FRAME_MIN_PX);
let zoom = 1;
let panX = 0;
let panY = 0;
let desiredSheetHeight = FRAME_MIN_PX;
let eraser = false;
let gesture: Gesture | null = null;
let submitting = false;
let resizeDrag: { y: number; height: number; askedFullscreen: boolean } | null = null;
let hostReady = false;

penButton.addEventListener("click", () => setEraser(false));
eraserButton.addEventListener("click", () => setEraser(true));
undoButton.addEventListener("click", () => {
  if (input.drawing !== null) return;
  strokes.pop();
  redraw();
  refreshControls();
  status.textContent = strokes.length === 0 ? "Cleared the last mark." : "";
});
clearButton.addEventListener("click", () => {
  if (input.drawing !== null) return;
  strokes.length = 0;
  paperLength = initialPaperLength(sheet.clientHeight || FRAME_MIN_PX);
  panX = 0;
  panY = 0;
  applyPaperLength();
  applyTransform();
  beginGesture();
  redraw();
  refreshControls();
  status.textContent = "Cleared.";
});
submitButton.addEventListener("click", () => {
  void submit();
});

sheet.addEventListener("pointerdown", onPointerDown);
sheet.addEventListener("pointermove", onPointerMove);
sheet.addEventListener("pointerup", onPointerUp);
sheet.addEventListener("pointercancel", (event) => endPointer(event, false));
sheet.addEventListener("lostpointercapture", (event) => endPointer(event, false));
sheet.addEventListener("contextmenu", (event) => event.preventDefault());
sheet.addEventListener("touchstart", blockBrowserGesture, { passive: false });
sheet.addEventListener("touchmove", blockBrowserGesture, { passive: false });
sheet.addEventListener("wheel", onWheel, { passive: false });
zoomOutButton.addEventListener("click", () => zoomBy(1 / 1.25));
zoomInButton.addEventListener("click", () => zoomBy(1.25));
new ResizeObserver(() => {
  if (!input.drawing) {
    panX = clampPan(panX, sheet.clientWidth, lengthEl.clientWidth * zoom);
    panY = clampPan(panY, sheet.clientHeight, paperLength * zoom);
    applyTransform();
    beginGesture();
  }
  redraw();
}).observe(sheet);

resizeHandle.addEventListener("pointerdown", onResizeDown);
resizeHandle.addEventListener("pointermove", onResizeMove);
resizeHandle.addEventListener("pointerup", endResize);
resizeHandle.addEventListener("pointercancel", endResize);
resizeHandle.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const delta = event.key === "ArrowDown" ? 80 : -80;
  desiredSheetHeight = nextFrameHeight(desiredSheetHeight, delta);
  publishFrame();
  void requestTallerHost();
});

window.addEventListener("resize", () => {
  publishFrame();
  redraw();
});

applyPaperLength();
applyTransform();
updateZoomLabel();
redraw();
refreshControls();
requestAnimationFrame(() => redraw());
void connected.then((ready) => {
  hostReady = ready;
  if (ready) publishFrame();
});

function setEraser(next: boolean): void {
  eraser = next;
  penButton.setAttribute("aria-pressed", next ? "false" : "true");
  eraserButton.setAttribute("aria-pressed", next ? "true" : "false");
  canvas.style.cursor = next ? "cell" : "crosshair";
}

function contactFrom(event: PointerEvent): Contact {
  return { id: event.pointerId, type: event.pointerType || "mouse", x: event.clientX, y: event.clientY };
}

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType !== "pen" && event.button !== 0 && event.button !== 5) return;
  event.preventDefault();
  const action = input.down(contactFrom(event));
  if (action === "ignore") return;
  try {
    // Capture fingers too: a pan/pinch must end cleanly outside the sheet.
    sheet.setPointerCapture(event.pointerId);
  } catch {
    // Some hosts do not expose capture; normal events still work on the sheet.
  }
  if (action === "draw") {
    gesture = null;
    beginStroke(event);
  } else {
    beginGesture();
  }
}

function onPointerMove(event: PointerEvent): void {
  const action = input.move(contactFrom(event));
  if (action === "ignore") return;
  event.preventDefault();
  if (action === "navigate") {
    updateGesture();
    return;
  }
  const stroke = strokes[strokes.length - 1];
  if (!stroke || !pushPoints(stroke, pointsFrom(event))) return;
  followInk(stroke);
  scheduleRedraw();
}

function onPointerUp(event: PointerEvent): void {
  endPointer(event, true);
}

function endPointer(event: PointerEvent, includePoint: boolean): void {
  const wasDrawing = input.drawing?.id === event.pointerId;
  const wasTouch = input.touches.has(event.pointerId);
  if (!wasDrawing && !wasTouch) {
    input.up(event.pointerId);
    return;
  }
  const stroke = wasDrawing ? strokes[strokes.length - 1] : undefined;
  // Cancel/lost-capture coordinates can be zero or unrelated to the pen tip.
  if (stroke && includePoint) pushPoints(stroke, pointsFrom(event));
  if (stroke) followInk(stroke);
  input.up(event.pointerId);
  if (wasDrawing && stroke) {
    const last = stroke.points[stroke.points.length - 1];
    if (last) {
      panY = panAfterInk(panY, zoom, sheet.clientHeight, paperLength, last.y);
      applyTransform();
    }
  }
  if (wasTouch) beginGesture();
  try {
    if (sheet.hasPointerCapture(event.pointerId)) sheet.releasePointerCapture(event.pointerId);
  } catch {
    // The browser may already have released the pointer.
  }
  scheduleRedraw();
  refreshControls();
}

function beginStroke(event: PointerEvent): void {
  if (strokes.length >= LIMITS.maxStrokes) {
    input.up(event.pointerId);
    status.textContent = "The sheet is full. Clear or submit before adding more ink.";
    return;
  }
  const useEraser = eraser || (event.button === 5 && event.pointerType !== "pen");
  const stroke: InkStroke = {
    points: [],
    width: useEraser ? ERASER_WIDTH : PEN_WIDTH,
    eraser: useEraser,
  };
  pushPoints(stroke, pointsFrom(event));
  strokes.push(stroke);
  followInk(stroke);
  scheduleRedraw();
  refreshControls();
}

function beginGesture(): void {
  const fingers = [...input.touches.values()].slice(0, 2);
  const first = fingers[0];
  if (!first) {
    gesture = null;
    return;
  }
  const second = fingers[1] ?? first;
  const rect = sheet.getBoundingClientRect();
  gesture = {
    ids: fingers.map((finger) => finger.id),
    dist: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    zoom, panX, panY,
    focalX: (first.x + second.x) / 2 - rect.left,
    focalY: (first.y + second.y) / 2 - rect.top,
  };
}

function updateGesture(): void {
  if (!gesture || input.drawing) return;
  const first = input.touches.get(gesture.ids[0]!);
  const second = input.touches.get(gesture.ids[1]!) ?? first;
  if (!first || !second) return;
  const dist = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
  const rect = sheet.getBoundingClientRect();
  const focalX = (first.x + second.x) / 2 - rect.left;
  const focalY = (first.y + second.y) / 2 - rect.top;
  const factor = gesture.ids.length === 2 ? dist / gesture.dist : 1;
  // Translate the focal point before clamping, so a boundary cannot introduce
  // an extra jump during a pinch that also pans.
  const nextX = panZoomFromGesture(gesture.zoom, gesture.panX, gesture.focalX,
    focalX, factor, sheet.clientWidth, lengthEl.clientWidth);
  const nextY = panZoomFromGesture(gesture.zoom, gesture.panY, gesture.focalY,
    focalY, factor, sheet.clientHeight, paperLength);
  zoom = nextY.zoom;
  panX = nextX.pan;
  panY = nextY.pan;
  applyTransform();
  updateZoomLabel();
  scheduleRedraw();
}

function blockBrowserGesture(event: TouchEvent): void {
  event.preventDefault();
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  if (input.drawing) return;
  if (event.ctrlKey) {
    zoomBy(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    return;
  }
  panX = clampPan(panX - event.deltaX, sheet.clientWidth, lengthEl.clientWidth * zoom);
  panY = clampPan(panY - event.deltaY, sheet.clientHeight, paperLength * zoom);
  applyTransform();
  beginGesture();
  scheduleRedraw();
}

function zoomBy(factor: number, clientX?: number, clientY?: number): void {
  if (input.drawing) return;
  const rect = sheet.getBoundingClientRect();
  const focalX = (clientX ?? rect.left + rect.width / 2) - rect.left;
  const focalY = (clientY ?? rect.top + rect.height / 2) - rect.top;
  const nextX = zoomAboutPoint(zoom, panX, focalX, factor, rect.width, Math.max(1, lengthEl.clientWidth));
  const nextY = zoomAboutPoint(zoom, panY, focalY, factor, rect.height, paperLength);
  zoom = nextY.zoom;
  panX = nextX.pan;
  panY = nextY.pan;
  applyTransform();
  updateZoomLabel();
  beginGesture();
  scheduleRedraw();
}

function pushPoints(stroke: InkStroke, points: InkPoint[]): boolean {
  let added = false;
  for (const point of points) {
    if (stroke.points.length >= LIMITS.maxPoints) break;
    const last = stroke.points[stroke.points.length - 1];
    if (last) {
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (dx * dx + dy * dy < 0.16) continue;
    }
    stroke.points.push(point);
    added = true;
  }
  return added;
}

function pointsFrom(event: PointerEvent): InkPoint[] {
  const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
  const source = coalesced.length > 0 ? coalesced : [event];
  const rect = sheet.getBoundingClientRect();
  return source.map((item) => paperPointFromView(
    item.clientX, item.clientY, rect, { zoom, panX, panY },
  ));
}

function followInk(stroke: InkStroke): void {
  const last = stroke.points[stroke.points.length - 1];
  if (!last) return;
  const next = grownLength(paperLength, last.y, MAX_PAPER_PX);
  if (next !== paperLength) {
    paperLength = next;
    applyPaperLength();
  } else if (last.y > paperLength - GROW_MARGIN_PX && paperLength >= MAX_PAPER_PX) {
    status.textContent = "This sheet is as long as the browser can hold. Submit or clear to continue.";
  }
  // Growth never moves the paper under an active tip. Reveal only on lift.
}

function applyPaperLength(): void {
  const px = `${paperLength}px`;
  lengthEl.style.height = px;
  lengthEl.style.minHeight = px;
}

function applyTransform(): void {
  lengthEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

function updateZoomLabel(): void {
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function availableSheetHeight(): number {
  return Math.max(160, Math.round(window.innerHeight - header.offsetHeight - resizeHandle.offsetHeight));
}

function publishFrame(): void {
  desiredSheetHeight = Math.max(desiredSheetHeight, availableSheetHeight());
  if (!hostReady) return;
  const height = Math.round(header.offsetHeight + desiredSheetHeight + resizeHandle.offsetHeight);
  void app.sendSizeChanged({ height }).catch(() => {
    // /preview has no host listening for the frame size.
  });
}

async function requestTallerHost(): Promise<void> {
  if (window.innerHeight + 8 >= header.offsetHeight + desiredSheetHeight + resizeHandle.offsetHeight) return;
  try {
    await app.requestDisplayMode({ mode: "fullscreen" });
  } catch {
    // The host can refuse fullscreen. Pinch and the zoom buttons still scale the sheet.
  }
}

function onResizeDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  resizeDrag = { y: event.clientY, height: desiredSheetHeight, askedFullscreen: false };
  resizeHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onResizeMove(event: PointerEvent): void {
  if (!resizeDrag) return;
  const delta = event.clientY - resizeDrag.y;
  desiredSheetHeight = nextFrameHeight(resizeDrag.height, delta);
  publishFrame();
  if (!resizeDrag.askedFullscreen && delta > 24) {
    resizeDrag.askedFullscreen = true;
    void requestTallerHost();
  }
}

function endResize(): void {
  resizeDrag = null;
}

let redrawPending = false;
function scheduleRedraw(): void {
  if (redrawPending) return;
  redrawPending = true;
  requestAnimationFrame(() => {
    redrawPending = false;
    redraw();
  });
}

function redraw(): void {
  const cssWidth = lengthEl.clientWidth;
  if (cssWidth < 1) return;
  const dpr = Math.min(3, (window.devicePixelRatio || 1) * zoom);
  const viewTop = -panY / zoom;
  const viewBottom = viewTop + sheet.clientHeight / zoom;
  const first = Math.max(0, Math.floor((viewTop - TILE_PX) / TILE_PX));
  const last = Math.min(
    Math.ceil(paperLength / TILE_PX) - 1,
    Math.floor((viewBottom + TILE_PX) / TILE_PX),
  );
  const needed = new Set<number>();
  for (let index = first; index <= last; index += 1) needed.add(index);
  for (const [index, tile] of tiles) {
    if (needed.has(index)) continue;
    tile.remove();
    tiles.delete(index);
  }
  for (const index of needed) {
    const top = index * TILE_PX;
    const cssHeight = Math.min(TILE_PX, paperLength - top);
    if (cssHeight <= 0) continue;
    let tile = tiles.get(index);
    if (!tile) {
      tile = document.createElement("canvas");
      tile.className = "tile";
      tile.style.top = `${top}px`;
      tiles.set(index, tile);
      tilesEl.appendChild(tile);
    }
    tile.style.height = `${cssHeight}px`;
    const bitmapWidth = Math.max(1, Math.round(cssWidth * dpr));
    const bitmapHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (tile.width !== bitmapWidth || tile.height !== bitmapHeight) {
      tile.width = bitmapWidth;
      tile.height = bitmapHeight;
    }
    const context = tile.getContext("2d");
    if (!context) continue;
    paint(context, bitmapWidth, bitmapHeight, bitmapWidth / cssWidth, top, top + cssHeight);
  }
}

function paint(
  target: CanvasRenderingContext2D,
  bitmapWidth: number,
  bitmapHeight: number,
  scale: number,
  originY = 0,
  endY = bitmapHeight / scale,
): void {
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, bitmapWidth, bitmapHeight);
  target.setTransform(scale, 0, 0, scale, 0, -originY * scale);
  target.fillStyle = "#ffffff";
  target.fillRect(0, originY, bitmapWidth / scale, endY - originY);
  for (const stroke of strokes) {
    if (!strokeIntersects(stroke, originY, endY)) continue;
    drawStroke(target, stroke);
  }
}

function strokeIntersects(stroke: InkStroke, top: number, bottom: number): boolean {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of stroke.points) {
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minY)) return false;
  return maxY >= top - stroke.width && minY <= bottom + stroke.width;
}

function drawStroke(target: CanvasRenderingContext2D, stroke: InkStroke): void {
  const points = stroke.points;
  const first = points[0];
  if (!first) return;
  target.save();
  target.lineCap = "round";
  target.lineJoin = "round";
  target.strokeStyle = stroke.eraser ? "#ffffff" : "#161616";
  target.fillStyle = target.strokeStyle;
  target.lineWidth = stroke.width;
  if (points.length === 1) {
    target.beginPath();
    target.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
    target.fill();
    target.restore();
    return;
  }
  target.beginPath();
  target.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (point) target.lineTo(point.x, point.y);
  }
  target.stroke();
  target.restore();
}

function exportSnapshot(): { image: string; width: number; height: number } {
  const cssWidth = Math.max(1, lengthEl.clientWidth);
  const span = inkVerticalSpan(strokes);
  let maxEdge: number = LIMITS.maxEdge;
  let bitmap = exportBitmapSize(cssWidth, span.height, maxEdge);
  let image = renderPng(cssWidth, span.originY, bitmap);
  while (image.length > LIMITS.maxImageChars && maxEdge > 320) {
    maxEdge = Math.floor(maxEdge * 0.75);
    bitmap = exportBitmapSize(cssWidth, span.height, maxEdge);
    image = renderPng(cssWidth, span.originY, bitmap);
  }
  return { image, width: bitmap.width, height: bitmap.height };
}

function renderPng(
  cssWidth: number,
  originY: number,
  bitmap: { width: number; height: number },
): string {
  const offscreen = document.createElement("canvas");
  offscreen.width = bitmap.width;
  offscreen.height = bitmap.height;
  const offscreenContext = offscreen.getContext("2d");
  if (!offscreenContext) throw new Error("Could not export the paper.");
  const scale = bitmap.width / cssWidth;
  paint(offscreenContext, bitmap.width, bitmap.height, scale, originY, originY + bitmap.height / scale);
  const url = offscreen.toDataURL("image/png");
  const comma = url.indexOf(",");
  return url.slice(comma + 1);
}

async function submit(): Promise<void> {
  if (submitting) return;
  if (strokes.length === 0 || strokes.every((stroke) => stroke.points.length === 0)) {
    status.textContent = "Draw an answer before submitting.";
    return;
  }
  submitting = true;
  refreshControls();
  status.textContent = "Submitting…";
  try {
    const hostReady = await Promise.race([
      connected,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    if (!hostReady) {
      status.textContent = "Open this paper from the host chat. The page is not connected.";
      return;
    }
    const snapshot = exportSnapshot();
    const result = await app.callServerTool({
      name: SUBMIT_TOOL,
      arguments: {
        image: snapshot.image,
        width: snapshot.width,
        height: snapshot.height,
        strokes,
      },
    });
    if (result.isError) {
      status.textContent = textOf(result) || "Submit failed.";
      return;
    }
    await handoff(textOf(result), snapshot.image);
    status.textContent = "Submitted.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Submit failed.";
  } finally {
    submitting = false;
    refreshControls();
  }
}

async function handoff(summary: string, image: string): Promise<void> {
  const caps = app.getHostCapabilities();
  const messageAllowsImage = Boolean(caps?.message?.image);
  const contextBlocks = contentBlocks(caps?.updateModelContext, summary, image, !messageAllowsImage);
  const messageBlocks = contentBlocks(caps?.message, "I submitted my handwritten answer.", image, true);
  if (contextBlocks.length > 0) {
    await app.updateModelContext({ content: contextBlocks });
  }
  if (messageBlocks.length > 0) {
    const sent = await app.sendMessage({ role: "user", content: messageBlocks });
    if (sent.isError) throw new Error("The host rejected the submitted answer.");
  }
}

function contentBlocks(
  modality: McpUiHostCapabilities["message"] | undefined,
  text: string,
  image: string,
  includeImage: boolean,
): ContentBlock[] {
  if (!modality) return [];
  const blocks: ContentBlock[] = [];
  if (modality.text || (!modality.image && !modality.text)) {
    blocks.push({ type: "text", text });
  }
  if (includeImage && modality.image) {
    blocks.push({ type: "image", data: image, mimeType: "image/png" });
  }
  return blocks;
}

function textOf(result: { content?: ReadonlyArray<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");
}

function refreshControls(): void {
  const busy = submitting || input.drawing !== null;
  undoButton.disabled = busy || strokes.length === 0;
  clearButton.disabled = busy || strokes.length === 0;
  submitButton.disabled = busy;
  zoomOutButton.disabled = busy;
  zoomInButton.disabled = busy;
  penButton.disabled = submitting;
  eraserButton.disabled = submitting;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
