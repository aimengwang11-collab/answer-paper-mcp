import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FRAME_MAX_PX,
  FRAME_MIN_PX,
  GROW_STEP_PX,
  MAX_PAPER_PX,
  clientToPaper,
  clampPan,
  paperPointFromView,
  panAfterInk,
  panZoomFromGesture,
  exportBitmapSize,
  grownLength,
  initialPaperLength,
  inkVerticalSpan,
  nextFrameHeight,
  revealInk,
  scrollTopForInk,
  zoomAboutPoint,
} from "./paper-geometry.js";

test("the sheet starts long enough to scroll and grows near the bottom", () => {
  assert.equal(initialPaperLength(720), 1600);
  assert.equal(initialPaperLength(2000), 2000 + GROW_STEP_PX);
  assert.equal(grownLength(1600, 100, MAX_PAPER_PX), 1600);
  assert.equal(grownLength(1600, 1500, MAX_PAPER_PX), 1600 + GROW_STEP_PX);
  assert.equal(grownLength(1600, 1500, 1800), 1800);
  assert.equal(grownLength(MAX_PAPER_PX, MAX_PAPER_PX - 10, MAX_PAPER_PX), MAX_PAPER_PX);
});

test("scrolling keeps the pen in view and coordinates survive scroll and zoom", () => {
  assert.equal(scrollTopForInk(0, 720, 100), 0);
  assert.equal(scrollTopForInk(0, 720, 600), 140);
  const scrolled = clientToPaper(30, 50, { left: 10, top: -400 });
  assert.deepEqual(scrolled, { x: 20, y: 450 });
  const zoomed = clientToPaper(
    110,
    80,
    { left: 10, top: 20, width: 200, height: 100 },
    { width: 100, height: 50 },
  );
  assert.deepEqual(zoomed, { x: 50, y: 30 });
  const revealed = revealInk(0, 1, 720, 700);
  assert.ok(revealed < 0);
  const zoomedView = zoomAboutPoint(1, 0, 100, 2, 400, 800);
  assert.equal(zoomedView.zoom, 2);
  assert.equal(zoomedView.pan + 100 * zoomedView.zoom, 100);
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

test("pan clamps at both ends, including content shorter than the view", () => {
  assert.equal(clampPan(20, 720, 1600), 0);
  assert.equal(clampPan(-2000, 720, 1600), -880);
  assert.equal(clampPan(-200, 720, 400), 0);
});

test("growing at a zoomed bottom keeps the tip fixed and reveals blank space on lift", () => {
  const view = { left: 10, top: 50 };
  for (const zoom of [0.5, 1, 2, 4]) {
    const panY = 720 - 1600 * zoom;
    const transform = { zoom, panX: -40, panY };
    const before = paperPointFromView(110, 750, view, transform);
    const length = grownLength(1600, before.y, MAX_PAPER_PX);
    assert.ok(length > 1600);
    const next = paperPointFromView(114, 750, view, transform);
    assert.equal(next.y, before.y);
    assert.equal(next.x - before.x, 4 / zoom);
    const liftedPan = panAfterInk(panY, zoom, 720, length, before.y);
    assert.ok(liftedPan < panY);
    assert.ok(liftedPan + before.y * zoom <= 540);
    assert.equal(clampPan(-Infinity, 720, length * zoom), 720 - length * zoom);
    assert.equal(panAfterInk(-100, zoom, 720, MAX_PAPER_PX, MAX_PAPER_PX), 720 - MAX_PAPER_PX * zoom);
  }
});

test("pinch translates its midpoint before clamping at an edge", () => {
  const next = panZoomFromGesture(1, 0, 100, 250, 2, 400, 800);
  assert.deepEqual(next, { zoom: 2, pan: 0 });
  // At the maximum zoom a moving midpoint still pans without changing scale.
  assert.deepEqual(panZoomFromGesture(4, -500, 200, 180, 2, 400, 800), { zoom: 4, pan: -520 });
  assert.deepEqual(zoomAboutPoint(1, -300, 200, 0.01, 400, 800), { zoom: 0.5, pan: 0 });
});

test("zoom buttons preserve the focal paper point and subsequent writing coordinates", () => {
  let zoom = 1;
  let pan = -400;
  const paperY = (300 - pan) / zoom;
  for (const factor of [1.25, 1.25, 0.8, 0.8]) {
    ({ zoom, pan } = zoomAboutPoint(zoom, pan, 300, factor, 720, 3000));
    assert.equal(paperPointFromView(100, 350, { left: 0, top: 50 }, { zoom, panX: 0, panY: pan }).y, paperY);
  }
});
