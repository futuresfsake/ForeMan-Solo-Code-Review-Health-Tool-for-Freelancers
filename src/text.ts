/**
 * Control characters (which include the escape sequences a terminal obeys) and
 * the Unicode characters that reorder or hide text.
 */
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/**
 * Makes text that did not come from this tool safe to print: a project's name,
 * file names and route paths, a saved review file, a model's answer. It can no
 * longer clear the screen, move the cursor, set the window title or hide what
 * it says. Line breaks and tabs become spaces so it stays on one line.
 */
export function printable(value: unknown): string {
  return typeof value === "string" ? value.replace(UNSAFE, "").replace(/\s+/g, " ").trim() : "";
}

/** `printable`, cut to a length that keeps one hostile value from flooding a report. */
export function clipped(value: unknown, max = 500): string {
  const text = printable(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
