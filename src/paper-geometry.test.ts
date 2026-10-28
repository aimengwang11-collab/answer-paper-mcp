import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FRAME_MAX_PX,
  FRAME_MIN_PX,
  GROW_STEP_PX,
  MAX_PAPER_PX,
  clientToPaper,
  exportBitmapSize,
  grownLength,
  initialPaperLength,
  inkVerticalSpan,
  nextFrameHeight,
  scrollTopForInk,
} from "./paper-geometry.js";

test("the sheet starts long enough to scroll and grows near the bottom", () => {
  assert.equal(initialPaperLength(720), 1600);
  assert.equal(initialPaperLength(2000), 2000 + GROW_STEP_PX);
  assert.equal(grownLength(1600, 100, MAX_PAPER_PX), 1600);
  assert.equal(grownLength(1600, 1500, MAX_PAPER_PX), 1600 + GROW_STEP_PX);
  assert.equal(grownLength(1600, 1500, 1800), 1800);
  assert.equal(grownLength(MAX_PAPER_PX, MAX_PAPER_PX - 10, MAX_PAPER_PX), MAX_PAPER_PX);
});

test("scrolling keeps the pen in view and coordinates survive a scrolled sheet", () => {
  assert.equal(scrollTopForInk(0, 720, 100), 0);
  assert.equal(scrollTopForInk(0, 720, 600), 140);
  const scrolled = clientToPaper(30, 50, { left: 10, top: -400 });
  assert.deepEqual(scrolled, { x: 20, y: 450 });
});

test("the visible frame drags taller without collapsing under 720px", () => {
  assert.equal(nextFrameHeight(720, 200), 920);
  assert.equal(nextFrameHeight(720, -400), FRAME_MIN_PX);
  assert.equal(nextFrameHeight(FRAME_MAX_PX, 500), FRAME_MAX_PX);
});

test("submit crops to the ink and still scales the whole crop into one image", () => {
  const span = inkVerticalSpan(
    [
      { points: [{ y: 400 }, { y: 480 }], width: 4 },
      { points: [{ y: 2200 }], width: 4 },
    ],
    32,
  );
  assert.equal(span.originY, 366);
  assert.ok(span.height < 2200);
  assert.ok(span.originY + span.height > 2200);

  const page = exportBitmapSize(400, span.height, 4096);
  assert.equal(page.scale, 2);
  const long = exportBitmapSize(400, 8000, 4096);
  assert.ok(long.height <= 4096);
  assert.ok(long.width < 400);
});
