/**
 * Paper size math shared by the widget.
 *
 * The visible frame is a fixed window the writer can drag taller. The sheet
 * inside that window is a long scrollport that grows as ink nears the bottom.
 * Coordinates stay in that sheet's CSS pixels, including after it scrolls.
 */

export const FRAME_MIN_PX = 720;
export const FRAME_MAX_PX = 3200;
export const INITIAL_PAPER_PX = 1600;
export const GROW_MARGIN_PX = 180;
export const GROW_STEP_PX = 720;
export const EXPORT_PAD_PX = 32;
/** Browser-safety ceiling for the scrollable sheet, not a page size. */
export const MAX_PAPER_PX = 240_000;

export function initialPaperLength(frameHeight: number): number {
  return Math.max(INITIAL_PAPER_PX, Math.round(frameHeight) + GROW_STEP_PX);
}

export function nextFrameHeight(startHeight: number, deltaY: number): number {
  const next = Math.round(startHeight + deltaY);
  return Math.min(FRAME_MAX_PX, Math.max(FRAME_MIN_PX, next));
}

/**
 * Extend the sheet when ink enters the bottom margin.
 * `current >= maxLength` stays put so the caller can tell the writer.
 */
export function grownLength(
  current: number,
  inkY: number,
  maxLength: number,
  step = GROW_STEP_PX,
  margin = GROW_MARGIN_PX,
): number {
  if (inkY <= current - margin || current >= maxLength) return current;
  return Math.min(maxLength, Math.max(current + step, Math.ceil(inkY + step)));
}

/** Keep the pen above the bottom of the visible scrollport. */
export function scrollTopForInk(
  scrollTop: number,
  viewHeight: number,
  inkY: number,
  margin = GROW_MARGIN_PX,
): number {
  const viewBottom = scrollTop + viewHeight;
  if (inkY <= viewBottom - margin) return scrollTop;
  return Math.max(0, inkY - viewHeight + margin + 80);
}

export function clientToPaper(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
): { x: number; y: number } {
  return {
    x: Math.round((clientX - rect.left) * 100) / 100,
    y: Math.round((clientY - rect.top) * 100) / 100,
  };
}

export function inkVerticalSpan(
  strokes: ReadonlyArray<{ points: ReadonlyArray<{ y: number }>; width: number }>,
  pad = EXPORT_PAD_PX,
): { originY: number; height: number } {
  let minY = Infinity;
  let maxY = 0;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      minY = Math.min(minY, point.y - stroke.width / 2);
      maxY = Math.max(maxY, point.y + stroke.width / 2);
    }
  }
  if (!Number.isFinite(minY)) return { originY: 0, height: 1 };
  const originY = Math.max(0, Math.floor(minY - pad));
  const bottom = Math.ceil(maxY + pad);
  return { originY, height: Math.max(1, bottom - originY) };
}

export function exportBitmapSize(
  cssWidth: number,
  cssHeight: number,
  maxEdge: number,
): { width: number; height: number; scale: number } {
  const width = Math.max(1, cssWidth);
  const height = Math.max(1, cssHeight);
  const long = Math.max(width, height);
  const scale = Math.min(2, maxEdge / long);
  return {
    scale,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
