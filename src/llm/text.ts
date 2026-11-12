/**
 * Control characters (which include the escape sequences a terminal obeys) and
 * the Unicode characters that reorder or hide text.
 */
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/**
 * Makes text from a model, or from a saved review file, safe to print: it can
 * no longer clear the screen, move the cursor, set the window title or hide
 * what it says. Line breaks and tabs become spaces so it stays on one line.
 */
export function printable(value: unknown): string {
  return typeof value === "string" ? value.replace(UNSAFE, "").replace(/\s+/g, " ").trim() : "";
}
