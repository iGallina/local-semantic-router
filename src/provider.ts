/**
 * OpenClaw Provider Plugin for local-semantic-router
 *
 * Registers as an LLM provider in OpenClaw.
 * Uses the local proxy to handle routing and API dispatch.
 *
 * Adapted from ClawRouter's provider.ts:
 * - Same interface pattern (ProviderPlugin, setActiveProxy, getActiveProxy)
 * - No wallet/payment logic
 * - auth: [] — proxy handles auth internally via YAML config
 */

import type { ProxyHandle } from "./proxy.js";

/**
 * OpenClaw ProviderPlugin interface (minimal definition for compatibility).
 */
export interface ProviderPlugin {
  id: string;
  label: string;
  docsPath?: string;
  aliases?: string[];
  envVars?: string[];
  models: ModelProviderConfig;
  auth: Array<{ field: string; label: string; type: string }>;
}

export interface ModelProviderConfig {
  baseUrl: string;
  api: string;
  models: ModelDefinitionConfig[];
}

export interface ModelDefinitionConfig {
  id: string;
  name: string;
  api: string;
  reasoning?: boolean;
  input?: string[];
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number;
  maxTokens?: number;
}

/**
 * State for the running proxy (set when the plugin activates).
 */
let activeProxy: ProxyHandle | null = null;

/**
 * Update the proxy handle (called from index.ts when the proxy starts).
 */
export function setActiveProxy(proxy: ProxyHandle): void {
  activeProxy = proxy;
}

export function getActiveProxy(): ProxyHandle | null {
  return activeProxy;
}

/**
 * Build provider models config pointing to the proxy.
 */
function buildProviderModels(baseUrl: string): ModelProviderConfig {
  return {
    baseUrl: `${baseUrl}/v1`,
    api: "openai-completions",
    models: [
      { id: "lsr-auto", name: "Auto (Smart Router - Balanced)", api: "openai-completions", contextWindow: 200000, maxTokens: 64000 },
      { id: "lsr-eco", name: "Eco (Smart Router - Cost Optimized)", api: "openai-completions", contextWindow: 200000, maxTokens: 64000 },
      { id: "lsr-premium", name: "Premium (Smart Router - Best Quality)", api: "openai-completions", contextWindow: 200000, maxTokens: 64000 },
    ],
  };
}

/**
 * Local Router provider plugin definition.
 */
export const localRouterProvider: ProviderPlugin = {
  id: "local-router",
  label: "Local Semantic Router",
  aliases: ["lr"],
  envVars: [],

  // Model definitions — dynamically set to proxy URL
  get models() {
    if (!activeProxy) {
      return buildProviderModels("http://127.0.0.1:8402");
    }
    return buildProviderModels(activeProxy.baseUrl);
  },

  // No auth required — the proxy handles auth internally via YAML config
  auth: [],
};
