/** Optional iframe smoke test: CHROME_BIN=/path/to/chrome npm run test:browser. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const html = await readFile(new URL("../dist/mcp-app.html", import.meta.url));
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(req.url === "/paper" ? html : '<iframe src="/paper" style="width:800px;height:740px;border:0"></iframe>');
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const profile = await mkdtemp(join(tmpdir(), "answer-paper-browser-"));
const chrome = spawn(process.env.CHROME_BIN || "google-chrome", [
  "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run",
  `--user-data-dir=${profile}`, "--remote-debugging-pipe", "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
let sequence = 0;
let buffer = "";
const pending = new Map();
chrome.stdio[4].on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\0")) !== -1) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  }
});
chrome.on("error", (error) => {
  for (const request of pending.values()) request.reject(error);
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`Chrome timeout: ${method}`)), 10000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
}
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` }, sessionId);
  let ready = false;
  for (let tries = 0; tries < 100 && !ready; tries++) {
    ready = await evaluate('!!document.querySelector("iframe")?.contentDocument?.querySelector(".tile")');
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(ready, "iframe loaded and rendered");
  const results = await evaluate(`(${async (w) => {
    const d = w.document;
    const sheet = d.querySelector("#sheet");
    const paper = d.querySelector("#length");
    const rect = sheet.getBoundingClientRect();
    const transform = () => new w.DOMMatrix(w.getComputedStyle(paper).transform);
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const frame = () => new Promise((resolve) => w.requestAnimationFrame(() => w.requestAnimationFrame(resolve)));
    const pointer = (name, id, type, x, y) => sheet.dispatchEvent(new w.PointerEvent(name, {
      pointerId: id, pointerType: type, clientX: rect.left + x, clientY: rect.top + y,
      button: type === "pen" ? -1 : 0, buttons: name === "pointerup" ? 0 : 1,
      bubbles: true, cancelable: true,
    }));
    const inkAt = (x, y) => {
      const tile = [...d.querySelectorAll(".tile")].find((tile) => y >= parseFloat(tile.style.top) && y < parseFloat(tile.style.top) + parseFloat(tile.style.height));
      if (!tile) return false;
      const scale = tile.width / paper.clientWidth;
      const data = tile.getContext("2d").getImageData(Math.round(x * scale), Math.round((y - parseFloat(tile.style.top)) * scale), 1, 1).data;
      return data[3] > 0 && data[0] < 100;
    };
    // Second contact during ink must not move the paper or interrupt the line.
    pointer("pointerdown", 1, "pen", 100, 250);
    pointer("pointermove", 1, "pen", 200, 250);
    pointer("pointerdown", 2, "touch", 200, 400);
    pointer("pointermove", 2, "touch", 200, 200);
    pointer("pointercancel", 2, "touch", 0, 0);
    pointer("pointermove", 1, "pen", 400, 250);
    check(d.querySelector("#zoom-in").disabled, "zoom cannot shift an active tip");
    check(transform().f === 0, "palm did not move paper");
    pointer("pointerup", 1, "pen", 500, 250);
    await frame();
    for (let x = 110; x < 490; x += 10) check(inkAt(x, 250), "continuous pen line at " + x);
    // A finger navigates without adding a mark. Returning restores existing ink.
    pointer("pointerdown", 3, "touch", 200, 450);
    pointer("pointermove", 3, "touch", 200, 150);
    check(transform().f === -300, "single finger pans");
    pointer("pointerup", 3, "touch", 200, 150);
    pointer("pointerdown", 3, "touch", 200, 150);
    pointer("pointermove", 3, "touch", 200, 450);
    pointer("pointerup", 3, "touch", 200, 450);
    // Pinch then place Pencil without lifting fingers (the old gesture blocked it).
    pointer("pointerdown", 4, "touch", 200, 300);
    pointer("pointerdown", 5, "touch", 400, 300);
    pointer("pointermove", 5, "touch", 500, 300);
    check(transform().a === 1.5, "pinch changes zoom");
    const start = transform();
    pointer("pointerdown", 6, "pen", 300, 300);
    pointer("pointermove", 4, "touch", 100, 100);
    pointer("pointermove", 6, "pen", 450, 300);
    pointer("pointerup", 6, "pen", 450, 300);
    pointer("pointerup", 4, "touch", 100, 100);
    pointer("pointerup", 5, "touch", 500, 300);
    await frame();
    check(inkAt((375 - start.e) / start.a, (300 - start.f) / start.a), "pen after pinch maps correctly");
    for (const id of ["zoom-in", "zoom-out"]) {
      d.querySelector("#" + id).click();
      const t = transform();
      pointer("pointerdown", 7, "pen", 300, 350);
      pointer("pointermove", 7, "pen", 450, 350);
      pointer("pointerup", 7, "pen", 450, 350);
      await frame();
      check(inkAt((375 - t.e) / t.a, (350 - t.f) / t.a), id + " then pen coordinates");
    }
    // Scroll to the end and grow in the middle of a horizontal stroke.
    sheet.dispatchEvent(new w.WheelEvent("wheel", { deltaY: 100000, cancelable: true }));
    const bottom = transform();
    const oldHeight = paper.clientHeight;
    const y = rect.height - 20;
    pointer("pointerdown", 8, "pen", 100, y);
    for (let x = 110; x <= 500; x += 10) pointer("pointermove", 8, "pen", x, y);
    check(paper.clientHeight > oldHeight, "writing near bottom grows paper");
    check(transform().f === bottom.f, "growth leaves active tip fixed");
    pointer("pointerup", 8, "pen", 500, y);
    await frame();
    check(transform().f < bottom.f, "lift reveals blank space");
    const inkY = (y - bottom.f) / bottom.a;
    for (let x = 110; x <= 490; x += 10) check(inkAt((x - bottom.e) / bottom.a, inkY), "growth line has no drift");
    // Cancellation must not draw a line back to zero; controls must recover.
    pointer("pointerdown", 9, "pen", 200, 200);
    pointer("pointercancel", 9, "pen", 0, 0);
    check(!d.querySelector("#zoom-in").disabled, "cancel releases drawing ownership");
    sheet.dispatchEvent(new w.WheelEvent("wheel", { deltaY: -100000, cancelable: true }));
    await frame();
    check(transform().f === 0 && inkAt(200, 250), "pan back to old ink after growth");
    return ["continuous pen + palm", "single finger pan", "pinch → pen", "zoom buttons → pen", "grow without drift + reveal", "cancel cleanup + browse old ink"];
  }})(document.querySelector("iframe").contentWindow)`);
  // Browser-generated touches also exercise touchstart cancellation and capture.
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
  await evaluate('document.querySelector("iframe").contentDocument.querySelector("#clear").click()');
  const bounds = await evaluate(`(() => {
    const f = document.querySelector("iframe");
    const r = f.contentDocument.querySelector("#sheet").getBoundingClientRect();
    return { x: f.getBoundingClientRect().left + r.left, y: f.getBoundingClientRect().top + r.top };
  })()`);
  const point = (id, x, y) => ({ id, x: bounds.x + x, y: bounds.y + y });
  const touch = (type, touchPoints) => send("Input.dispatchTouchEvent", { type, touchPoints }, sessionId);
  const matrix = () => evaluate('Array.from(document.querySelector("iframe").contentWindow.getComputedStyle(document.querySelector("iframe").contentDocument.querySelector("#length")).transform.matchAll(/-?[0-9.]+/g), m => Number(m[0]))');
  const startZoom = (await matrix())[0];
  await touch("touchStart", [point(1, 300, 400)]);
  await touch("touchMove", [point(1, 300, 200)]);
  await touch("touchEnd", []);
  assert.equal((await matrix())[5], -200, "browser-generated finger pans");
  await touch("touchStart", [point(1, 200, 300), point(2, 400, 300)]);
  await touch("touchMove", [point(1, 150, 300), point(2, 450, 300)]);
  await touch("touchEnd", []);
  assert.equal((await matrix())[0], startZoom * 1.5, "browser-generated pinch zooms");
  const button = await evaluate(`(() => {
    const f = document.querySelector("iframe");
    const r = f.contentDocument.querySelector("#zoom-in").getBoundingClientRect();
    return { id: 1, x: f.getBoundingClientRect().left + r.left + r.width / 2,
      y: f.getBoundingClientRect().top + r.top + r.height / 2 };
  })()`);
  await touch("touchStart", [button]);
  await touch("touchEnd", []);
  assert.equal((await matrix())[0], startZoom * 1.5 * 1.25, "touch tap activates zoom button");
  console.log("Iframe checks passed:", [...results, "browser-generated pan/pinch/toolbar tap"].join(", "));
} finally {
  for (const request of pending.values()) clearTimeout(request.timer);
  const exited = once(chrome, "exit");
  chrome.kill("SIGTERM");
  await exited;
  server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
