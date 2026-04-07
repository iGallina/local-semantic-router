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
import type { ProxyHandle } from "./proxy.js";
import { loadConfig } from "./config-loader.js";
import type { ResolvedConfig } from "./config-types.js";
import type { OpenClawPluginApi, OpenClawPluginDefinition, PluginLogger } from "./openclaw-types.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { injectModelsConfig, injectAuthProfile } from "./openclaw-config.js";
import { SpendControl } from "./spend-control.js";

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

// ── Mode Detection ──────────────────────────────────────────────

/** Detect if OpenClaw is running in gateway mode (proxy should start). */
function isGatewayMode(): boolean {
  return process.argv.some((a) => a === "gateway" || a === "serve");
}

/** Detect shell completion mode (skip heavy init to avoid stdout pollution). */
function isCompletionMode(): boolean {
  return process.argv.some((arg, i) => arg === "completion" && i >= 1 && i <= 3);
}

// ── Helpers ─────────────────────────────────────────────────────

/** Fallback logger when running outside OpenClaw (standalone mode). */
const consoleLogger: PluginLogger = {
  debug: (...args) => console.debug("[local-semantic-router]", ...args),
  info: (...args) => console.log("[local-semantic-router]", ...args),
  warn: (...args) => console.warn("[local-semantic-router]", ...args),
  error: (...args) => console.error("[local-semantic-router]", ...args),
};

/** Module-level proxy handle for service shutdown. */
let activeProxyHandle: ProxyHandle | null = null;

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

    // Always register the provider (needed for model listing, completion, etc.)
    api.registerProvider(localRouterProvider);

    // In completion mode, skip heavy init to avoid stdout pollution
    if (isCompletionMode()) return;

    // Only start the proxy in gateway mode — prevents blocking CLI commands
    if (!isGatewayMode()) {
      log.info("Not in gateway mode — skipping proxy startup");
      return;
    }

    // Register service for graceful shutdown (port released on gateway stop)
    api.registerService({
      id: "lsr-proxy",
      start: () => {},
      stop: async () => {
        if (activeProxyHandle) {
          try {
            await activeProxyHandle.close();
            log.info("Proxy closed");
          } catch (err) {
            log.warn(`Failed to close proxy: ${err instanceof Error ? err.message : String(err)}`);
          }
          activeProxyHandle = null;
        }
      },
    });

    try {
      const config = loadConfig();

      // Initialize spend control if budget limits are configured
      const dataDir = join(homedir(), ".local-semantic-router");
      const spendControl = config.budget
        ? new SpendControl(config.budget, dataDir)
        : undefined;

      if (spendControl) {
        const status = spendControl.getStatus();
        log.info(
          `Budget limits active — per-request: $${status.limits.perRequest ?? "∞"}, ` +
            `hourly: $${status.limits.hourly ?? "∞"}, daily: $${status.limits.daily ?? "∞"}`,
        );
      }

      const proxy = await startProxy({
        config,
        spendControl,
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

      activeProxyHandle = proxy;
      setActiveProxy(proxy);

      const healthy = await waitForProxyHealth(proxy.port);
      if (!healthy) {
        log.warn(`Proxy health check did not pass within 3s`);
      }

      // Inject LSR config into OpenClaw so models are immediately available
      injectModelsConfig(proxy.port, log);
      injectAuthProfile(log);

      // Mutate runtime config for immediate availability without file reload
      if (!api.config.models) api.config.models = { providers: {} };
      if (!api.config.models.providers) api.config.models.providers = {};
      api.config.models.providers["local-router"] = {
        baseUrl: `http://127.0.0.1:${proxy.port}/v1`,
        api: "openai-completions",
        apiKey: "lsr-proxy-handles-auth",
        models: localRouterProvider.models.models,
      };
    } catch (error) {
      log.error(
        `Failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};

export default plugin;
