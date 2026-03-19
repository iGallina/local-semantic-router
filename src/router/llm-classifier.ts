/**
 * LLM Classifier (Fallback)
 *
 * When the rule-based classifier returns ambiguous (score 1-2),
 * we send a classification request to the configured classifier LLM.
 *
 * Adapted for local-semantic-router: replaces payFetch with plain fetch + API key headers.
 *
 * Cost per classification: ~$0.00003
 * Latency: ~200-400ms
 * Only triggered for ~20-30% of requests.
 */

import type { Tier } from "./types.js";

const CLASSIFIER_PROMPT = `You are a query complexity classifier. Classify the user's query into exactly one category.

Categories:
- SIMPLE: Factual Q&A, definitions, translations, short answers
- MEDIUM: Summaries, explanations, moderate code generation
- COMPLEX: Multi-step code, system design, creative writing, analysis
- REASONING: Mathematical proofs, formal logic, step-by-step problem solving

Respond with ONLY one word: SIMPLE, MEDIUM, COMPLEX, or REASONING.`;

// In-memory cache: hash → { tier, expires }
const cache = new Map<string, { tier: Tier; expires: number }>();

export type LLMClassifierConfig = {
  model: string;
  maxTokens: number;
  temperature: number;
  truncationChars: number;
  cacheTtlMs: number;
};

/**
 * Classify a prompt using a cheap LLM.
 * Returns tier and confidence. Defaults to MEDIUM on any failure.
 *
 * @param prompt - The user prompt to classify
 * @param config - Classifier configuration
 * @param fetchFn - Standard fetch function (replaces payFetch from original)
 * @param apiBase - Provider base URL (e.g., "https://api.groq.com/openai/v1")
 * @param apiKey - API key for the provider
 * @param apiType - API type: "openai-completions" or "anthropic-messages"
 */
export async function classifyByLLM(
  prompt: string,
  config: LLMClassifierConfig,
  fetchFn: typeof fetch,
  apiBase: string,
  apiKey: string,
  apiType: "openai-completions" | "anthropic-messages" = "openai-completions",
): Promise<{ tier: Tier; confidence: number }> {
  const truncated = prompt.slice(0, config.truncationChars);

  // Check cache
  const cacheKey = simpleHash(truncated);
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return { tier: cached.tier, confidence: 0.75 };
  }

  try {
    let response: Response;

    if (apiType === "anthropic-messages") {
      // Anthropic Messages API
      response = await fetchFn(`${apiBase}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model,
          system: CLASSIFIER_PROMPT,
          messages: [{ role: "user", content: truncated }],
          max_tokens: config.maxTokens,
          temperature: config.temperature,
        }),
      });

      if (!response.ok) {
        return { tier: "MEDIUM", confidence: 0.5 };
      }

      const data = (await response.json()) as {
        content?: Array<{ text?: string }>;
      };

      const content = data.content?.[0]?.text?.trim().toUpperCase() ?? "";
      const tier = parseTier(content);

      cache.set(cacheKey, { tier, expires: Date.now() + config.cacheTtlMs });
      if (cache.size > 1000) pruneCache();

      return { tier, confidence: 0.75 };
    } else {
      // OpenAI-compatible API
      response = await fetchFn(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: CLASSIFIER_PROMPT },
            { role: "user", content: truncated },
          ],
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          stream: false,
        }),
      });

      if (!response.ok) {
        return { tier: "MEDIUM", confidence: 0.5 };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? "";
      const tier = parseTier(content);

      // Cache result
      cache.set(cacheKey, { tier, expires: Date.now() + config.cacheTtlMs });

      // Prune if cache grows too large
      if (cache.size > 1000) {
        pruneCache();
      }

      return { tier, confidence: 0.75 };
    }
  } catch {
    // Any error → safe default
    return { tier: "MEDIUM", confidence: 0.5 };
  }
}

/**
 * Parse tier from LLM response. Handles "SIMPLE", "The query is SIMPLE", etc.
 */
function parseTier(text: string): Tier {
  if (/\bREASONING\b/.test(text)) return "REASONING";
  if (/\bCOMPLEX\b/.test(text)) return "COMPLEX";
  if (/\bMEDIUM\b/.test(text)) return "MEDIUM";
  if (/\bSIMPLE\b/.test(text)) return "SIMPLE";
  return "MEDIUM"; // safe default
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

function pruneCache(): void {
  const now = Date.now();
  for (const [key, value] of cache) {
    if (value.expires <= now) {
      cache.delete(key);
    }
  }
}
