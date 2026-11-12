import { isLocalEndpoint } from "../config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  /** Ask the model to answer with valid JSON only. */
  json?: boolean;
}

/** The only thing the review engine knows about a model (ADR-0007). */
export interface LlmProvider {
  /** Shown in the review output, e.g. "qwen2.5-coder:7b". */
  name: string;
  complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
}

export class LlmError extends Error {}

export interface OllamaOptions {
  endpoint: string;
  model: string;
  /** Replaced in tests so no real network is used. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Ollama's default context is small; the review prompt needs more room. */
const NUM_CTX = 8192;

/**
 * Talks to a local Ollama server. It refuses any non-local endpoint, so code
 * can never leave the machine through this provider.
 */
export function createOllamaProvider(options: OllamaOptions): LlmProvider {
  if (!isLocalEndpoint(options.endpoint)) {
    throw new LlmError("The LLM endpoint must be on this machine (localhost or 127.0.0.1).");
  }
  const doFetch = options.fetchImpl ?? fetch;
  const url = `${options.endpoint.replace(/\/+$/, "")}/api/chat`;

  return {
    name: options.model,
    async complete(messages, opts = {}) {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: options.model,
            stream: false,
            messages,
            ...(opts.json ? { format: "json" } : {}),
            options: { temperature: 0.1, num_ctx: NUM_CTX },
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 5 * 60_000),
        });
      } catch (err) {
        const name = (err as Error).name;
        if (name === "TimeoutError" || name === "AbortError") {
          throw new LlmError(`The model did not answer in time. A smaller diff or a smaller model may help.`);
        }
        throw new LlmError(`Could not reach Ollama at ${options.endpoint}. Start it (see https://ollama.com) and try again.`);
      }
      if (res.status === 404) {
        throw new LlmError(`Ollama does not have the model "${options.model}". Run: ollama pull ${options.model}`);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new LlmError(`Ollama returned an error (${res.status}). ${detail.slice(0, 200)}`.trim());
      }
      const data = (await res.json().catch(() => null)) as { message?: { content?: unknown } } | null;
      const content = data?.message?.content;
      if (typeof content !== "string") throw new LlmError("Ollama returned an answer in an unexpected format.");
      return content;
    },
  };
}
