import type { Rule } from "../types.js";
import { configRule, httpsRule } from "./config-rules.js";
import { depsRule } from "./deps.js";
import { injectionRule } from "./injection.js";
import { authRule, rateLimitRule, validationRule } from "./routes.js";
import { secretsRule } from "./secrets.js";

export const RULES: Rule[] = [secretsRule, injectionRule, validationRule, authRule, configRule, httpsRule, rateLimitRule, depsRule];
