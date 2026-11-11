import type { Adapter, AdapterModel, Framework, ParsedFile } from "../types.js";
import { buildExpressModel } from "./express.js";
import { buildNestModel } from "./nestjs.js";

/**
 * Add a framework by adding an entry here; the scanner and rules do not change.
 * Order matters: Nest apps usually run on Express underneath, so NestJS goes first.
 */
export const ADAPTERS: Adapter[] = [
  { framework: "nestjs", label: "NestJS", build: buildNestModel },
  { framework: "express", label: "Express", build: buildExpressModel },
];

export interface Detected extends AdapterModel {
  framework: Framework;
  label: string;
}

/** Uses the first adapter that recognizes the project. */
export function detectFramework(files: ParsedFile[], packageJson: Record<string, unknown> | null): Detected {
  for (const a of ADAPTERS) {
    const model = a.build(files, packageJson);
    if (model.detected) return { ...model, framework: a.framework, label: a.label };
  }
  return { detected: false, routes: [], appMiddleware: [], warnings: [], framework: "unknown", label: "" };
}

export function supportedLabels(): string {
  return ADAPTERS.map((a) => a.label).join(" or ");
}
