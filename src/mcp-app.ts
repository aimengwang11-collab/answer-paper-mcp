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
 * The visible frame starts at 720px and can be dragged taller. The sheet
 * inside scrolls, and it grows as ink nears the bottom. Tiles paint only the
 * visible span so the length is not one giant bitmap.
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
  clientToPaper,
  exportBitmapSize,
  grownLength,
  initialPaperLength,
  inkVerticalSpan,
  nextFrameHeight,
  scrollTopForInk,
} from "./paper-geometry.js";

const TILE_PX = 1200;

const app = new App(
  { name: "Ink Answer Paper", version: "0.1.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
  // Hosts size the iframe from ui/notifications/size-changed. That size is the
  // frame (toolbar + visible sheet + drag handle), not the scrolled length.
  { autoResize: true },
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

const strokes: InkStroke[] = [];
const tiles = new Map<number, HTMLCanvasElement>();
const pointers = new Map<number, { x: number; y: number }>();
let paperLength = initialPaperLength(FRAME_MIN_PX);
let eraser = false;
let activePointer: number | null = null;
let panning = false;
let submitting = false;
let sheetSizedByUser = false;
let resizeDrag: { y: number; height: number } | null = null;

penButton.addEventListener("click", () => setEraser(false));
eraserButton.addEventListener("click", () => setEraser(true));
undoButton.addEventListener("click", () => {
  if (activePointer !== null) return;
  strokes.pop();
  redraw();
  refreshControls();
  status.textContent = strokes.length === 0 ? "Cleared the last mark." : "";
});
clearButton.addEventListener("click", () => {
  if (activePointer !== null) return;
  strokes.length = 0;
  paperLength = initialPaperLength(sheet.clientHeight || FRAME_MIN_PX);
  applyPaperLength();
  sheet.scrollTop = 0;
  redraw();
  refreshControls();
  status.textContent = "Cleared.";
});
submitButton.addEventListener("click", () => {
  void submit();
});

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
sheet.addEventListener("scroll", () => redraw(), { passive: true });
new ResizeObserver(() => redraw()).observe(sheet);

resizeHandle.addEventListener("pointerdown", onResizeDown);
resizeHandle.addEventListener("pointermove", onResizeMove);
resizeHandle.addEventListener("pointerup", endResize);
resizeHandle.addEventListener("pointercancel", endResize);
resizeHandle.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  sheetSizedByUser = true;
  const delta = event.key === "ArrowDown" ? 80 : -80;
  setSheetHeight(nextFrameHeight(sheet.clientHeight, delta));
});

window.addEventListener("resize", () => {
  fitSheetToViewport();
  redraw();
});

applyPaperLength();
fitSheetToViewport();
redraw();
refreshControls();
requestAnimationFrame(() => redraw());

function setEraser(next: boolean): void {
  eraser = next;
  penButton.setAttribute("aria-pressed", next ? "false" : "true");
  eraserButton.setAttribute("aria-pressed", next ? "true" : "false");
  canvas.style.cursor = next ? "cell" : "crosshair";
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0 && event.button !== 5) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    panning = true;
    dropActiveStroke();
    return;
  }
  if (activePointer !== null || panning) return;
  if (strokes.length >= LIMITS.maxStrokes) {
    status.textContent = "The sheet is full. Clear or submit before adding more ink.";
    return;
  }
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  activePointer = event.pointerId;
  const useEraser = event.button === 5 || eraser;
  const stroke: InkStroke = {
    points: [],
    width: useEraser ? ERASER_WIDTH : PEN_WIDTH,
    eraser: useEraser,
  };
  pushPoints(stroke, pointsFrom(event));
  strokes.push(stroke);
  followInk(stroke);
  redraw();
  refreshControls();
}

function onPointerMove(event: PointerEvent): void {
  const previous = pointers.get(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (panning && previous) {
    sheet.scrollTop -= event.clientY - previous.y;
    return;
  }
  if (event.pointerId !== activePointer) return;
  const stroke = strokes[strokes.length - 1];
  if (!stroke) return;
  event.preventDefault();
  if (!pushPoints(stroke, pointsFrom(event))) return;
  followInk(stroke);
  redraw();
}

function onPointerUp(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) panning = false;
  if (event.pointerId !== activePointer) return;
  const stroke = strokes[strokes.length - 1];
  if (stroke) {
    pushPoints(stroke, pointsFrom(event));
    followInk(stroke);
  }
  if (stroke && stroke.points.length === 0) strokes.pop();
  activePointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  redraw();
  refreshControls();
}

function dropActiveStroke(): void {
  if (activePointer === null) return;
  strokes.pop();
  activePointer = null;
  redraw();
  refreshControls();
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
  const rect = lengthEl.getBoundingClientRect();
  return source.map((item) => clientToPaper(item.clientX, item.clientY, rect));
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
  const top = scrollTopForInk(sheet.scrollTop, sheet.clientHeight, last.y);
  if (top !== sheet.scrollTop) sheet.scrollTop = top;
}

function applyPaperLength(): void {
  const px = `${paperLength}px`;
  lengthEl.style.height = px;
  lengthEl.style.minHeight = px;
}

function setSheetHeight(next: number): void {
  sheet.style.height = `${next}px`;
}

function fitSheetToViewport(): void {
  if (sheetSizedByUser) return;
  const available = Math.round(window.innerHeight - header.offsetHeight - resizeHandle.offsetHeight);
  const next = Math.max(FRAME_MIN_PX, available);
  if (Math.abs(next - sheet.clientHeight) <= 2) return;
  setSheetHeight(next);
}

function onResizeDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  resizeDrag = { y: event.clientY, height: sheet.clientHeight };
  resizeHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onResizeMove(event: PointerEvent): void {
  if (!resizeDrag) return;
  sheetSizedByUser = true;
  setSheetHeight(nextFrameHeight(resizeDrag.height, event.clientY - resizeDrag.y));
}

function endResize(): void {
  resizeDrag = null;
}

function redraw(): void {
  const cssWidth = lengthEl.clientWidth;
  if (cssWidth < 1) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewTop = sheet.scrollTop;
  const viewBottom = viewTop + sheet.clientHeight;
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
  const busy = submitting || activePointer !== null;
  undoButton.disabled = busy || strokes.length === 0;
  clearButton.disabled = busy || strokes.length === 0;
  submitButton.disabled = submitting;
  penButton.disabled = submitting;
  eraserButton.disabled = submitting;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
