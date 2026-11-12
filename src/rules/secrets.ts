import { spawnSync } from "node:child_process";
import { gitProgram, gitSpawnOptions, safeGitArgs } from "../git.js";
import fs from "node:fs";
import path from "node:path";
import { lineOf } from "../ast.js";
import { ENV_FILE } from "../loader.js";
import type { RawFinding, Rule } from "../types.js";
import { DEFAULT_CREDENTIALS, NOT_A_SECRET_NAME, SECRET_NAME, redact, stringAssignments } from "./shared.js";

export const KEY_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "AWS access key ID", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: "Stripe live secret key", re: /\b[sr]k_live_[0-9a-zA-Z]{16,}\b/ },
  { label: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { label: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: "SendGrid API key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
  { label: "npm access token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { label: "Private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
];

/*
 * The two matchers below are written as bounded walks, not as one pattern over
 * the whole line. A project being scanned may be hostile, and a single pattern
 * of the form "run of characters, then something that is missing" takes time
 * in proportion to the square of the line length: one 250 KB line cost seven
 * seconds. Each walk below looks at every character a fixed number of times.
 */

/** How far to look on each side of a "://"; real connection strings are far shorter. */
const URL_SCHEME_CHARS = 32;
const URL_USERINFO_CHARS = 300;
const URL_SCHEME = /\b[a-z][a-z0-9+.-]*$/i;
const URL_USERINFO = /^[^\s:/@'"`]+:([^\s@/'"`]+)@/;

/** The password in "scheme://user:password@host", or null when the line has none. */
export function urlPassword(line: string): string | null {
  for (let at = line.indexOf("://"); at !== -1; at = line.indexOf("://", at + 3)) {
    if (!URL_SCHEME.test(line.slice(Math.max(0, at - URL_SCHEME_CHARS), at))) continue;
    const m = URL_USERINFO.exec(line.slice(at + 3, at + 3 + URL_USERINFO_CHARS));
    if (m) return m[1]!;
  }
  return null;
}

const JWT_HEAD = /\beyJ[A-Za-z0-9_-]{8,}/g;
const JWT_REST = /\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/y;

/** True when the line holds a JSON Web Token: three base64url parts, the first two starting with an encoded "{". */
export function hasJwt(line: string): boolean {
  JWT_HEAD.lastIndex = 0;
  for (let m = JWT_HEAD.exec(line); m; m = JWT_HEAD.exec(line)) {
    JWT_REST.lastIndex = m.index + m[0].length;
    if (JWT_REST.test(line)) return true;
  }
  return false;
}

const PLACEHOLDER = /your|example|placeholder|changeme|xxxx|<.*>|\*\*\*|todo|dummy|sample|replace|insert|\$\{/i;
const EXAMPLE_ENV = /\.(example|sample|template|dist|defaults?)$/i;

/** "RESET_PASSWORD" and "resetPassword" are the same word: an enum, not a secret. */
function sameWord(name: string, value: string): boolean {
  const norm = (s: string): string => s.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return norm(name) === norm(value);
}

function looksLikeSecretValue(value: string, envFallback: boolean): boolean {
  if (value.length < 8 || /\s/.test(value)) return false;
  // A value made only of letters is usually a label or an enum member. As the
  // fallback for a secret environment variable it is still a real secret.
  if (!envFallback && /^[A-Za-z]+$/.test(value)) return false;
  if (/^(https?:|\/|\.\.?\/)/.test(value)) return false;
  // All-lowercase words are almost always a name ("authorization", "x-api-key").
  if (/^[a-z]+(?:[-_.:][a-z]+)*$/.test(value)) return false;
  if (/^(.)\1+$/.test(value)) return false;
  // Only the start is tested: a placeholder says so early, and the pattern is slow on a very long value.
  return !PLACEHOLDER.test(value.slice(0, 256));
}

function git(root: string, args: string[]): number | null {
  const program = gitProgram(root);
  if (!program) return null;
  const res = spawnSync(program, safeGitArgs(root, args), { ...gitSpawnOptions(), stdio: "ignore", timeout: 10_000 });
  return res.error ? null : res.status;
}

export const secretsRule: Rule = {
  ids: ["secrets/hardcoded-api-key", "secrets/hardcoded-password", "secrets/committed-env"],
  run(model) {
    const findings: RawFinding[] = [];

    // Well-known key formats, anywhere in source or config files. Env files
    // are handled below: a git-ignored .env is where secrets belong.
    const scannable = [...model.files, ...model.textFiles.filter((f) => !ENV_FILE.test(path.basename(f.path)))];
    for (const file of scannable) {
      const lines = file.text.split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const { label, re } of KEY_PATTERNS) {
          const m = re.exec(line);
          if (!m) continue;
          const shown = label === "Private key" ? "private key block" : redact(m[0]);
          findings.push({ ruleId: "secrets/hardcoded-api-key", file: file.path, line: i + 1, message: `${label} in source: ${shown}.` });
          return;
        }
        if (hasJwt(line)) {
          findings.push({ ruleId: "secrets/hardcoded-api-key", file: file.path, line: i + 1, message: "JSON Web Token in source: [masked]." });
          return;
        }
        const password = urlPassword(line);
        if (password && !/^(\$\{|<|%7B|\{)/.test(password) && !PLACEHOLDER.test(password) && password.length >= 4 && !DEFAULT_CREDENTIALS.has(password.toLowerCase())) {
          findings.push({ ruleId: "secrets/hardcoded-password", file: file.path, line: i + 1, message: "A connection string contains a hardcoded password: [masked]." });
        }
      });
    }

    for (const file of model.files) {
      for (const a of stringAssignments(file.ast)) {
        if (!SECRET_NAME.test(a.name) || NOT_A_SECRET_NAME.test(a.name)) continue;
        if (DEFAULT_CREDENTIALS.has(a.value.toLowerCase())) continue; // config/default-credentials
        if (sameWord(a.name, a.value) || !looksLikeSecretValue(a.value, a.envFallback)) continue;
        if (KEY_PATTERNS.some((p) => p.re.test(a.value))) continue; // already reported above
        findings.push({
          ruleId: "secrets/hardcoded-password",
          file: file.path,
          line: lineOf(file.ast, a.node),
          message: a.envFallback
            ? `"${a.name}" falls back to a hardcoded value (${redact(a.value)}) when the environment variable is missing.`
            : `"${a.name}" is assigned a hardcoded value (${redact(a.value)}).`,
        });
      }
    }

    const envFiles = model.textFiles.filter((f) => ENV_FILE.test(path.basename(f.path)) && !EXAMPLE_ENV.test(f.path));
    if (envFiles.length > 0) {
      const isRepo = git(model.root, ["rev-parse", "--is-inside-work-tree"]) === 0;
      let ignoreText = "";
      try {
        ignoreText = fs.readFileSync(path.join(model.root, ".gitignore"), "utf8");
      } catch {
        // no .gitignore
      }
      const ignoredByFile = /^\s*\/?\.env(\*|\.\*)?\s*$/m.test(ignoreText);
      for (const env of envFiles) {
        if (isRepo && git(model.root, ["ls-files", "--error-unmatch", "--", env.path]) === 0) {
          findings.push({ ruleId: "secrets/committed-env", file: env.path, line: 1, message: `${env.path} is tracked by git.` });
        } else if (isRepo ? git(model.root, ["check-ignore", "-q", "--", env.path]) !== 0 : !ignoredByFile) {
          findings.push({
            ruleId: "secrets/committed-env",
            file: env.path,
            line: 1,
            confidence: "medium",
            message: `${env.path} exists and is not git-ignored, so it can be committed by accident.`,
          });
        }
      }
    }

    return findings;
  },
};
