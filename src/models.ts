/**
 * Model Aliases and Catalog
 *
 * Provides model alias resolution and pricing map construction
 * from YAML config provider model definitions.
 *
 * Adapted from ClawRouter's models.ts:
 * - Kept: resolveModelAlias(), alias map structure
 * - Removed: BlockRun-specific aliases, OPENCLAW_MODELS, buildProviderModels()
 * - Added: buildModelPricing() from config
 */

import type { ResolvedConfig } from "./config-types.js";
import type { ModelPricing } from "./router/index.js";

/**
 * Model aliases for convenient shorthand access.
 * Users can type "sonnet" instead of "anthropic/claude-sonnet-4-6-20260315".
 */
export const MODEL_ALIASES: Record<string, string> = {
  // Claude aliases
  claude: "anthropic/claude-sonnet-4-6-20260315",
  sonnet: "anthropic/claude-sonnet-4-6-20260315",
  "sonnet-4.6": "anthropic/claude-sonnet-4-6-20260315",
  opus: "anthropic/claude-opus-4-6-20260315",
  "opus-4.6": "anthropic/claude-opus-4-6-20260315",
  haiku: "anthropic/claude-haiku-4-5-20251001",
  "haiku-4.5": "anthropic/claude-haiku-4-5-20251001",

  // Groq / Llama aliases
  llama: "groq/llama-3.3-70b-versatile",
  "llama-70b": "groq/llama-3.3-70b-versatile",
  groq: "groq/llama-3.3-70b-versatile",

  // Routing profile aliases (accept both prefixed and unprefixed)
  "auto-router": "auto",
  router: "auto",
  "lsr-auto": "auto",
  "lsr-eco": "eco",
  "lsr-premium": "premium",
  "lsr-agentic": "agentic",
};

/**
 * Resolve a model alias to its full "provider/model-id" string.
 * Also strips common prefixes for direct model paths.
 *
 * Examples:
 *   - "claude" -> "anthropic/claude-sonnet-4-6-20260315" (alias)
 *   - "sonnet" -> "anthropic/claude-sonnet-4-6-20260315" (alias)
 *   - "anthropic/claude-sonnet-4-6-20260315" -> unchanged (already full path)
 *   - "auto" -> "auto" (routing profile)
 */
export function resolveModelAlias(model: string): string {
  const normalized = model.trim().toLowerCase();

  // Check alias map
  const resolved = MODEL_ALIASES[normalized];
  if (resolved) return resolved;

  // Return as-is (already a full provider/model path or routing profile)
  return model;
}

/**
 * Build a model pricing map from the resolved YAML config.
 * Maps "provider/model-id" to { inputPrice, outputPrice }.
 */
export function buildModelPricing(config: ResolvedConfig): Map<string, ModelPricing> {
  const map = new Map<string, ModelPricing>();

  for (const [providerName, provider] of Object.entries(config.providers)) {
    for (const model of provider.models) {
      const fullId = `${providerName}/${model.id}`;
      map.set(fullId, {
        inputPrice: model.input_price ?? 0,
        outputPrice: model.output_price ?? 0,
      });
    }
  }

  return map;
}
