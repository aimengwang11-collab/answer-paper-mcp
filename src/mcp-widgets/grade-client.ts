import type { InkStroke } from "../ink.js";

const GRADE_ENV = "STUDYWAM_GRADE_URL";
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Grade hook meant to match a studywam `src/mcp-widgets` bridge.
 *
 * https://github.com/aimengwang11-collab/studywam was not readable from this
 * environment (GitHub 404), so the POST body follows the two public ink
 * handoffs instead: Petroglyphs sends `image` (base64 PNG) and PassPaper
 * sends the stroke list. No credentials are read or sent.
 *
 * https://github.com/surfndev/petroglyphs-mcp
 * https://github.com/Bin-H-17/passpaper
 */
export type GradePayload = {
  source: "ink-answer-paper";
  widget: "ink-answer-paper";
  action: "grade";
  submittedAt: string;
  mimeType: "image/png";
  image: string;
  width: number;
  height: number;
  strokeCount: number;
  strokes: InkStroke[];
};

export type GradeForwardResult =
  | { forwarded: false; reason: "not_configured" }
  | { forwarded: true; status: number; ok: boolean }
  | { forwarded: false; reason: "request_failed"; message: string };

export type GradeClientOptions = {
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function forwardToStudywam(
  payload: GradePayload,
  options: GradeClientOptions = {},
): Promise<GradeForwardResult> {
  const rawUrl = (options.url ?? process.env[GRADE_ENV] ?? "").trim();
  if (rawUrl === "") {
    return { forwarded: false, reason: "not_configured" };
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { forwarded: false, reason: "request_failed", message: "grade URL is invalid" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return {
      forwarded: false,
      reason: "request_failed",
      message: "grade URL must use http or https",
    };
  }
  if (target.username !== "" || target.password !== "") {
    return {
      forwarded: false,
      reason: "request_failed",
      message: "grade URL must not include credentials",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(target.toString(), {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { forwarded: true, status: response.status, ok: response.ok };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      forwarded: false,
      reason: "request_failed",
      message: timedOut ? "grade request timed out" : "grade request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Accept a raw base64 PNG or a `data:image/png;base64,...` URL. */
export function normalizePngBase64(input: string): string | null {
  let value = input.trim();
  if (value.startsWith("data:")) {
    const match = /^data:image\/png(?:;charset=[^;,]+)?;base64,/i.exec(value);
    if (!match) return null;
    value = value.slice(match[0].length);
  }
  value = value.replace(/\s/g, "");
  if (value.length < 32 || value.length > 6_000_000) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;

  const header = Buffer.from(value.slice(0, 24), "base64");
  if (header.length < 8) return null;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < png.length; i += 1) {
    if (header[i] !== png[i]) return null;
  }
  return value;
}

export function describeGrade(result: GradeForwardResult): string {
  if (result.forwarded) {
    return `Studywam grading returned HTTP ${result.status}.`;
  }
  if (result.reason === "not_configured") {
    return "Studywam grading is not configured. Set STUDYWAM_GRADE_URL to POST submissions.";
  }
  return `Studywam grading did not run (${result.message}).`;
}
