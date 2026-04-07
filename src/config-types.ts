/**
 * Configuration Types for local-semantic-router
 *
 * Defines the YAML config structure and resolved config types.
 */

export interface ProviderModelConfig {
  id: string;
  name?: string;
  input_price?: number; // per 1M tokens
  output_price?: number;
  context_window?: number;
  max_tokens?: number;
}

export interface ProviderConfig {
  api: "openai-completions" | "anthropic-messages";
  base_url: string;
  api_key: string; // supports ${ENV_VAR} interpolation
  models: ProviderModelConfig[];
}

export interface TierModelMapping {
  primary: string; // "provider/model-id"
  fallbacks?: string[];
}

export interface TierModels {
  simple: TierModelMapping;
  medium: TierModelMapping;
  complex: TierModelMapping;
  reasoning: TierModelMapping;
}

export interface TierMappingConfig {
  auto?: TierModels;
  eco?: TierModels;
  premium?: TierModels;
  agentic?: TierModels;
}

export interface FallbackClassifierConfig {
  enabled: boolean; // default false (SEC-3)
  provider?: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface ScoringOverrides {
  dimension_weights?: Record<string, number>;
  tier_boundaries?: {
    simple_medium?: number;
    medium_complex?: number;
    complex_reasoning?: number;
  };
  confidence_threshold?: number;
}

export interface BudgetConfig {
  per_request?: number; // max USD per single request
  hourly?: number; // rolling 1-hour window USD
  daily?: number; // rolling 24-hour window USD
}

export interface LocalRouterConfig {
  port?: number; // default 8402
  bind?: string; // default "127.0.0.1" (SEC-2)
  routing_profile?: "auto" | "eco" | "premium" | "agentic";
  providers: Record<string, ProviderConfig>;
  tiers: TierMappingConfig;
  fallback_classifier?: FallbackClassifierConfig;
  scoring?: ScoringOverrides;
  budget?: BudgetConfig;
}

/**
 * Resolved config with all interpolations applied and defaults merged.
 */
export interface ResolvedConfig extends LocalRouterConfig {
  port: number;
  bind: string;
  routing_profile: "auto" | "eco" | "premium" | "agentic";
  fallback_classifier: FallbackClassifierConfig;
}
