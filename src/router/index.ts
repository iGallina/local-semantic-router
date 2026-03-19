/**
 * Smart Router Entry Point
 *
 * Classifies requests and routes to the cheapest capable model.
 * Delegates to pluggable RouterStrategy (default: RulesStrategy, <1ms).
 *
 * Extended for local-semantic-router:
 * - configureRouter() merges YAML tier mappings into DEFAULT_ROUTING_CONFIG
 * - SEC-3: When fallback_classifier.enabled === false, skip LLM classifier and default to MEDIUM
 */

import type { RoutingDecision, RouterOptions, Tier, TierConfig, RoutingConfig } from "./types.js";
import { getStrategy } from "./strategy.js";
import { DEFAULT_ROUTING_CONFIG } from "./config.js";
import type { LocalRouterConfig, TierModels } from "../config-types.js";

/**
 * Route a request to the cheapest capable model.
 * Delegates to the registered "rules" strategy by default.
 */
export function route(
  prompt: string,
  systemPrompt: string | undefined,
  maxOutputTokens: number,
  options: RouterOptions,
): RoutingDecision {
  const strategy = getStrategy("rules");
  return strategy.route(prompt, systemPrompt, maxOutputTokens, options);
}

/**
 * Convert YAML tier models to internal TierConfig format.
 */
function toTierConfigs(
  tierModels: TierModels,
): Record<Tier, TierConfig> {
  return {
    SIMPLE: {
      primary: tierModels.simple.primary,
      fallback: tierModels.simple.fallbacks ?? [],
    },
    MEDIUM: {
      primary: tierModels.medium.primary,
      fallback: tierModels.medium.fallbacks ?? [],
    },
    COMPLEX: {
      primary: tierModels.complex.primary,
      fallback: tierModels.complex.fallbacks ?? [],
    },
    REASONING: {
      primary: tierModels.reasoning.primary,
      fallback: tierModels.reasoning.fallbacks ?? [],
    },
  };
}

/**
 * Configure the router with YAML config settings.
 * Merges tier mappings from the YAML config into DEFAULT_ROUTING_CONFIG.
 *
 * When fallback_classifier.enabled === false (SEC-3):
 * - The strategy skips LLM classifier and defaults ambiguous prompts to MEDIUM tier
 * - This is already the default behavior of RulesStrategy (ambiguousDefaultTier = "MEDIUM")
 */
export function configureRouter(yamlConfig: LocalRouterConfig): RoutingConfig {
  const config = { ...DEFAULT_ROUTING_CONFIG };

  // Merge tier mappings from YAML
  if (yamlConfig.tiers.auto) {
    config.tiers = toTierConfigs(yamlConfig.tiers.auto);
  }
  if (yamlConfig.tiers.eco) {
    config.ecoTiers = toTierConfigs(yamlConfig.tiers.eco);
  }
  if (yamlConfig.tiers.premium) {
    config.premiumTiers = toTierConfigs(yamlConfig.tiers.premium);
  }
  if (yamlConfig.tiers.agentic) {
    config.agenticTiers = toTierConfigs(yamlConfig.tiers.agentic);
  }

  // Configure classifier model from YAML (SEC-3)
  if (yamlConfig.fallback_classifier?.enabled && yamlConfig.fallback_classifier.model) {
    config.classifier = {
      ...config.classifier,
      llmModel: yamlConfig.fallback_classifier.model,
      llmMaxTokens: yamlConfig.fallback_classifier.max_tokens ?? config.classifier.llmMaxTokens,
      llmTemperature: yamlConfig.fallback_classifier.temperature ?? config.classifier.llmTemperature,
    };
  } else {
    // Classifier disabled — ensure empty model so it's never called
    config.classifier = {
      ...config.classifier,
      llmModel: "",
    };
  }

  // Apply scoring overrides from YAML
  if (yamlConfig.scoring) {
    if (yamlConfig.scoring.dimension_weights) {
      config.scoring = {
        ...config.scoring,
        dimensionWeights: {
          ...config.scoring.dimensionWeights,
          ...yamlConfig.scoring.dimension_weights,
        },
      };
    }
    if (yamlConfig.scoring.tier_boundaries) {
      config.scoring = {
        ...config.scoring,
        tierBoundaries: {
          simpleMedium: yamlConfig.scoring.tier_boundaries.simple_medium ?? config.scoring.tierBoundaries.simpleMedium,
          mediumComplex: yamlConfig.scoring.tier_boundaries.medium_complex ?? config.scoring.tierBoundaries.mediumComplex,
          complexReasoning: yamlConfig.scoring.tier_boundaries.complex_reasoning ?? config.scoring.tierBoundaries.complexReasoning,
        },
      };
    }
    if (yamlConfig.scoring.confidence_threshold !== undefined) {
      config.scoring = {
        ...config.scoring,
        confidenceThreshold: yamlConfig.scoring.confidence_threshold,
      };
    }
  }

  return config;
}

export { getStrategy, registerStrategy } from "./strategy.js";
export {
  getFallbackChain,
  getFallbackChainFiltered,
  filterByToolCalling,
  filterByVision,
  calculateModelCost,
} from "./selector.js";
export { DEFAULT_ROUTING_CONFIG } from "./config.js";
export type {
  RoutingDecision,
  Tier,
  RoutingConfig,
  RouterOptions,
  RouterStrategy,
  TierConfig,
} from "./types.js";
export type { ModelPricing } from "./selector.js";
