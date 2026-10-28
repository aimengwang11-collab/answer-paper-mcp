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
 */

import type { ContentBlock } from "@modelcontextprotocol/client";
import { App, type McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import {
  ERASER_WIDTH,
  EXPORT_MAX_EDGE,
  LIMITS,
  PEN_WIDTH,
  SUBMIT_TOOL,
  type InkPoint,
  type InkStroke,
} from "./ink.js";

const app = new App(
  { name: "Ink Answer Paper", version: "0.1.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
  // Hosts size the iframe from ui/notifications/size-changed. The sheet's
  // 720px min-height is what that measurement must include.
  { autoResize: true },
);

app.ontoolresult = () => {
  // The host opens a blank sheet. Questions stay in the chat transcript.
};

const connected = app
  .connect()
  .then(() => true)
  .catch(() => false);

const penButton = requiredElement<HTMLButtonElement>("pen");
const eraserButton = requiredElement<HTMLButtonElement>("eraser");
const undoButton = requiredElement<HTMLButtonElement>("undo");
const clearButton = requiredElement<HTMLButtonElement>("clear");
const submitButton = requiredElement<HTMLButtonElement>("submit");
const status = requiredElement<HTMLElement>("status");
const canvas = requiredElement<HTMLCanvasElement>("paper");
const context: CanvasRenderingContext2D =
  canvas.getContext("2d") ??
  (() => {
    throw new Error("Canvas is unavailable.");
  })();

const strokes: InkStroke[] = [];
let eraser = false;
let activePointer: number | null = null;
let submitting = false;

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

new ResizeObserver(() => redraw()).observe(canvas);
window.addEventListener("resize", () => redraw());
redraw();
refreshControls();

function setEraser(next: boolean): void {
  eraser = next;
  penButton.setAttribute("aria-pressed", next ? "false" : "true");
  eraserButton.setAttribute("aria-pressed", next ? "true" : "false");
  canvas.style.cursor = next ? "cell" : "crosshair";
}

function onPointerDown(event: PointerEvent): void {
  if (activePointer !== null) return;
  if (event.button !== 0 && event.button !== 5) return;
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
  redraw();
  refreshControls();
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return;
  const stroke = strokes[strokes.length - 1];
  if (!stroke) return;
  event.preventDefault();
  if (pushPoints(stroke, pointsFrom(event))) redraw();
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return;
  const stroke = strokes[strokes.length - 1];
  if (stroke) pushPoints(stroke, pointsFrom(event));
  if (stroke && stroke.points.length === 0) strokes.pop();
  activePointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
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
  return source.map((item) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((item.clientX - rect.left) * 100) / 100,
      y: Math.round((item.clientY - rect.top) * 100) / 100,
    };
  });
}

function resizeBitmap(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function redraw(): void {
  resizeBitmap();
  const cssWidth = canvas.getBoundingClientRect().width;
  if (cssWidth < 1) return;
  paint(context, canvas.width, canvas.height, canvas.width / cssWidth);
}

function paint(
  target: CanvasRenderingContext2D,
  bitmapWidth: number,
  bitmapHeight: number,
  scale: number,
): void {
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, bitmapWidth, bitmapHeight);
  target.setTransform(scale, 0, 0, scale, 0, 0);
  target.fillStyle = "#ffffff";
  target.fillRect(0, 0, bitmapWidth / scale, bitmapHeight / scale);
  for (const stroke of strokes) drawStroke(target, stroke);
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
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, rect.width);
  const cssHeight = Math.max(1, rect.height);
  const scale = Math.min(2, EXPORT_MAX_EDGE / Math.max(cssWidth, cssHeight));
  const width = Math.max(1, Math.round(cssWidth * scale));
  const height = Math.max(1, Math.round(cssHeight * scale));
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const offscreenContext = offscreen.getContext("2d");
  if (!offscreenContext) throw new Error("Could not export the paper.");
  paint(offscreenContext, width, height, width / cssWidth);
  const url = offscreen.toDataURL("image/png");
  const comma = url.indexOf(",");
  return { image: url.slice(comma + 1), width, height };
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
