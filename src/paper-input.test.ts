import assert from "node:assert/strict";
import { test } from "node:test";
import { PaperInput, type Contact } from "./paper-input.js";

const contact = (id: number, type = "touch", x = 100, y = 200): Contact => ({ id, type, x, y });

test("one finger browses, two pinch, lifting one leaves a browsing finger", () => {
  const input = new PaperInput();
  assert.equal(input.down(contact(1)), "navigate");
  assert.equal(input.down(contact(2)), "navigate");
  assert.equal(input.drawing, null);
  input.up(1);
  assert.equal(input.move(contact(2, "touch", 100, 300)), "navigate");
  input.up(2);
  assert.equal(input.touches.size, 0);
  assert.equal(input.move(contact(2)), "ignore");
});

test("Pencil takes over a pinch, and held fingers remain palms until lifted", () => {
  const input = new PaperInput();
  input.down(contact(1));
  input.down(contact(2));
  assert.equal(input.down(contact(3, "pen")), "draw");
  assert.equal(input.touches.size, 0);
  assert.equal(input.move(contact(1)), "ignore");
  input.up(2);
  assert.equal(input.move(contact(3, "pen", 150, 300)), "draw");
  assert.equal(input.drawing?.id, 3);
  input.up(3);
  assert.equal(input.move(contact(1)), "ignore");
  assert.equal(input.down(contact(1)), "ignore");
  input.up(1);
  assert.equal(input.down(contact(1)), "navigate");
});

test("second touch and its cancellation cannot interrupt a continuous Pencil stroke", () => {
  const input = new PaperInput();
  input.down(contact(1, "pen"));
  for (let x = 0; x < 100; x++) {
    if (x === 20) assert.equal(input.down(contact(2)), "ignore");
    if (x === 50) input.up(2);
    assert.equal(input.move(contact(1, "pen", x, 300)), "draw");
    assert.equal(input.drawing?.id, 1);
  }
  input.up(1);
  assert.equal(input.drawing, null);
  assert.equal(input.down(contact(2)), "navigate");
});

test("mouse still draws, unknown moves do not create strokes, cancel cleans ownership", () => {
  const input = new PaperInput();
  assert.equal(input.move(contact(1, "pen")), "ignore");
  assert.equal(input.down(contact(1, "mouse")), "draw");
  assert.equal(input.down(contact(2, "pen")), "ignore");
  input.up(2);
  assert.equal(input.drawing?.id, 1);
  input.up(1);
  assert.equal(input.down(contact(2, "pen")), "draw");
  input.up(2);
  assert.equal(input.down(contact(3)), "navigate");
});
