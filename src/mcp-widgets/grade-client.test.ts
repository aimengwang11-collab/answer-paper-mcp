import assert from "node:assert/strict";
import { test } from "node:test";
import { describeGrade, forwardToStudywam, normalizePngBase64, type GradePayload } from "./grade-client.js";

const ONE_PX_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function payload(): GradePayload {
  return {
    source: "ink-answer-paper",
    widget: "ink-answer-paper",
    action: "grade",
    submittedAt: "2026-01-01T00:00:00.000Z",
    width: 1,
    height: 1,
    mimeType: "image/png",
    image: ONE_PX_PNG,
    strokeCount: 1,
    strokes: [{ points: [{ x: 1, y: 1 }], width: 3, eraser: false }],
  };
}

test("normalizePngBase64 accepts a PNG and a data URL", () => {
  assert.equal(normalizePngBase64(ONE_PX_PNG), ONE_PX_PNG);
  assert.equal(normalizePngBase64(`data:image/png;base64,${ONE_PX_PNG}`), ONE_PX_PNG);
  assert.equal(normalizePngBase64("not-a-png"), null);
  assert.equal(normalizePngBase64("data:text/plain;base64,aaaa"), null);
});

test("forwardToStudywam stays local when STUDYWAM_GRADE_URL is unset", async () => {
  const previous = process.env.STUDYWAM_GRADE_URL;
  delete process.env.STUDYWAM_GRADE_URL;
  try {
    const result = await forwardToStudywam(payload());
    assert.deepEqual(result, { forwarded: false, reason: "not_configured" });
    assert.match(describeGrade(result), /STUDYWAM_GRADE_URL/);
  } finally {
    if (previous === undefined) delete process.env.STUDYWAM_GRADE_URL;
    else process.env.STUDYWAM_GRADE_URL = previous;
  }
});

test("forwardToStudywam rejects non-http URLs and embedded credentials", async () => {
  const fileUrl = await forwardToStudywam(payload(), { url: "file:///tmp/grade" });
  assert.equal(fileUrl.forwarded, false);
  const credentialUrl = await forwardToStudywam(payload(), {
    url: "https://user:secret@example.invalid/grade",
  });
  assert.equal(credentialUrl.forwarded, false);
  if (!credentialUrl.forwarded && credentialUrl.reason === "request_failed") {
    assert.match(credentialUrl.message, /credentials/);
  }
});

test("forwardToStudywam POSTs image plus strokes without an authorization header", async () => {
  let method = "";
  let authorization: string | null = null;
  let body: GradePayload | undefined;
  const result = await forwardToStudywam(payload(), {
    url: "https://grade.example/ink",
    fetchImpl: async (input, init) => {
      method = init?.method ?? "";
      const headers = new Headers(init?.headers);
      authorization = headers.get("authorization");
      body = JSON.parse(String(init?.body)) as GradePayload;
      assert.equal(String(input), "https://grade.example/ink");
      return new Response("{}", { status: 202 });
    },
  });
  assert.equal(method, "POST");
  assert.equal(authorization, null);
  assert.equal(body?.widget, "ink-answer-paper");
  assert.equal(body?.action, "grade");
  assert.equal(body?.image, ONE_PX_PNG);
  assert.equal(body?.strokes[0]?.eraser, false);
  assert.deepEqual(result, { forwarded: true, status: 202, ok: true });
});
