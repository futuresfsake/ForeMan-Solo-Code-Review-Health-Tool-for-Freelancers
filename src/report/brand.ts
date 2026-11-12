import fs from "node:fs";
import path from "node:path";

/** What the client report needs to carry the freelancer's branding. */
export interface Brand {
  /** A `data:` URI, so the report stays one file with no external requests. */
  logoDataUri?: string;
  /** `#rrggbb`, already validated by the config loader. */
  accentColor?: string;
}

export class BrandError extends Error {}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/** A logo is a few kilobytes; anything much larger is almost certainly the wrong file. */
export const MAX_LOGO_BYTES = 256 * 1024;

/**
 * Reads the logo named in the config (relative to the project) and returns it
 * as a data URI. It is shown through an `<img>` tag, where browsers do not run
 * scripts, even from an SVG file.
 *
 * The config may belong to a project you did not write, and the client report
 * is a file you send to someone else. So the logo must be a real file inside
 * the project: otherwise a config could copy any picture on this machine into
 * a report. `allowOutside` is for a config you chose yourself with `--config`.
 */
export function loadBrand(projectRoot: string, report: { logo: string; accentColor: string }, options: { allowOutside?: boolean } = {}): Brand {
  const brand: Brand = {};
  if (report.accentColor) brand.accentColor = report.accentColor;
  if (!report.logo) return brand;

  const base = path.resolve(projectRoot);
  const file = path.resolve(base, report.logo);
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new BrandError(`Logo must be a png, jpg, gif, webp or svg file: ${report.logo}`);
  let size: number;
  try {
    if (!options.allowOutside) {
      const rel = path.relative(fs.realpathSync(base), fs.realpathSync(file));
      if (rel.startsWith("..") || path.isAbsolute(rel) || fs.lstatSync(file).isSymbolicLink()) {
        throw new BrandError(`Logo must be a file inside the project folder: ${report.logo}. To use a logo kept elsewhere, pass your own config with --config.`);
      }
    }
    size = fs.statSync(file).size;
  } catch (err) {
    if (err instanceof BrandError) throw err;
    throw new BrandError(`Logo file not found: ${report.logo}`);
  }
  if (size > MAX_LOGO_BYTES) throw new BrandError(`Logo is larger than ${MAX_LOGO_BYTES / 1024} KB: ${report.logo}`);
  brand.logoDataUri = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  return brand;
}
