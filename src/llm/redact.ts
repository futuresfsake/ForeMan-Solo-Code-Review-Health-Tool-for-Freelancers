import { KEY_PATTERNS } from "../rules/secrets.js";

/**
 * How sure we are that a line holds a secret:
 * - "flagged": the scan reported a secret on this line, so string values are masked;
 * - "clean": the scan reported nothing, so only well-known key formats are masked;
 * - "guess": no scan information (removed lines, reply snippets), so lines that
 *   look secret-related are masked as well.
 */
export type Mode = "flagged" | "clean" | "guess";

const SECRETISH = /pass(?:word|wd)?|secret|token|credential|api[_-]?key|private/i;
const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const KEY_GLOBAL = KEY_PATTERNS.filter((p) => p.label !== "Private key").map((p) => ({ label: p.label, re: new RegExp(p.re.source, "g") }));
const BEGIN_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const END_KEY = /-----END [A-Z ]*PRIVATE KEY-----/;

export interface Redactor {
  /** How many values were masked so far. */
  readonly count: number;
  /** Call between files: a private key block never continues into the next file. */
  reset(): void;
  /** Masks one line. Lines of a private key block are masked whatever the mode. */
  line(text: string, mode: Mode): string;
  /** Masks a whole text; `flagged` holds the line numbers the scan reported. */
  text(text: string, flagged?: Set<number>): string;
}

/**
 * Masks secrets before anything goes into a prompt. This is a safety net, not a
 * guarantee: a secret the scan cannot recognise is not masked.
 */
export function createRedactor(): Redactor {
  let count = 0;
  let inKey = false;

  function line(text: string, mode: Mode): string {
    if (inKey || BEGIN_KEY.test(text)) {
      if (!inKey) count++;
      inKey = !END_KEY.test(text);
      return "[REDACTED private key]";
    }
    let out = text;
    for (const { label, re } of KEY_GLOBAL) {
      out = out.replace(re, () => {
        count++;
        return `[REDACTED ${label}]`;
      });
    }
    if (mode === "flagged" || (mode === "guess" && SECRETISH.test(out))) {
      out = out.replace(STRING_LITERAL, (whole, quote: string, value: string) => {
        if (value.length < 8 || value.startsWith("[REDACTED")) return whole;
        count++;
        return `${quote}[REDACTED]${quote}`;
      });
    }
    return out;
  }

  return {
    get count() {
      return count;
    },
    reset() {
      inKey = false;
    },
    line,
    text(text, flagged) {
      inKey = false;
      return text
        .split("\n")
        .map((raw, i) => {
          const hadCr = raw.endsWith("\r");
          const out = line(hadCr ? raw.slice(0, -1) : raw, flagged?.has(i + 1) ? "flagged" : flagged ? "clean" : "guess");
          return hadCr ? `${out}\r` : out;
        })
        .join("\n");
    },
  };
}
