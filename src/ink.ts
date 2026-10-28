/**
 * Handwriting stroke list.
 *
 * Shape adapted from PassPaper (MIT), which stores each mark as points plus
 * width and an eraser flag, and paints eraser marks in white:
 * https://github.com/Bin-H-17/passpaper
 *
 * The page-image idea (the agent reads handwriting from a PNG of the page)
 * is the one used by noteful-mcp. This pad does not read or write Noteful files.
 */

export const OPEN_TOOL = "open_answer_paper";
export const SUBMIT_TOOL = "submit_ink_answer";
export const RESOURCE_URI = "ui://ink-answer-paper/mcp-app.html";

export const PEN_WIDTH = 3;
export const ERASER_WIDTH = 28;

/** PassPaper caps the snapshot's long edge at 1568px. */
export const EXPORT_MAX_EDGE = 1568;

export const LIMITS = {
  maxStrokes: 400,
  maxPoints: 8_000,
  maxImageChars: 6_000_000,
  maxEdge: 4_096,
} as const;

export type InkPoint = {
  x: number;
  y: number;
};

export type InkStroke = {
  points: InkPoint[];
  width: number;
  eraser: boolean;
};
