/**
 * local-semantic-router Plugin Entry Point
 *
 * Registers the localRouterProvider with OpenClaw and auto-starts
 * the proxy when the plugin loads (gateway mode).
 *
 * Adapted from ClawRouter's index.ts:
 * - Same pattern: register provider, start proxy, inject config
 * - Removed: wallet/balance imports, Solana/EVM signing, payment callbacks
 */

import { localRouterProvider, setActiveProxy } from "./provider.js";
import { startProxy } from "./proxy.js";
import { loadConfig } from "./config-loader.js";
import type { ResolvedConfig } from "./config-types.js";
import type { OpenClawPluginApi, OpenClawPluginDefinition, PluginLogger } from "./openclaw-types.js";

// Re-export for library usage
export { localRouterProvider, setActiveProxy, getActiveProxy } from "./provider.js";
export { startProxy } from "./proxy.js";
export { loadConfig, maskApiKey } from "./config-loader.js";
export { route, configureRouter, DEFAULT_ROUTING_CONFIG } from "./router/index.js";
export { resolveModelAlias, buildModelPricing } from "./models.js";
export type { ResolvedConfig, LocalRouterConfig, ProviderConfig } from "./config-types.js";
export type { ProxyHandle, ProxyOptions } from "./proxy.js";
export type { RoutingDecision, Tier, RoutingConfig, RouterOptions } from "./router/index.js";
export type { OpenClawPluginApi, OpenClawPluginDefinition } from "./openclaw-types.js";

/** Fallback logger when running outside OpenClaw (standalone mode). */
const consoleLogger: PluginLogger = {
  debug: (...args) => console.debug("[local-semantic-router]", ...args),
  info: (...args) => console.log("[local-semantic-router]", ...args),
  warn: (...args) => console.warn("[local-semantic-router]", ...args),
  error: (...args) => console.error("[local-semantic-router]", ...args),
};

/**
 * Wait for proxy health check to pass.
 */
async function waitForProxyHealth(port: number, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      // Proxy not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * OpenClaw plugin definition.
 * Auto-starts the proxy when registered in gateway mode.
 */
const plugin: OpenClawPluginDefinition = {
  id: "local-semantic-router",
  version: "0.1.0",
  providers: [localRouterProvider],

  async register(api: OpenClawPluginApi) {
    const log = api.logger ?? consoleLogger;

    api.registerProvider(localRouterProvider);

    try {
      const config = loadConfig();

      const proxy = await startProxy({
        config,
        onReady: (port) => {
          log.info(`Proxy ready on http://127.0.0.1:${port}`);
        },
        onRouted: (decision) => {
          const savings = (decision.savings * 100).toFixed(0);
          log.info(
            `[${decision.tier}] ${decision.model} ` +
              `$${decision.costEstimate.toFixed(4)} (saved ${savings}%)`,
          );
        },
        onError: (error) => {
          log.error(`Error: ${error.message}`);
        },
      });

      setActiveProxy(proxy);

      const healthy = await waitForProxyHealth(proxy.port);
      if (!healthy) {
        log.warn(`Proxy health check did not pass within 3s`);
      }
    } catch (error) {
      log.error(
        `Failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};

export default plugin;
