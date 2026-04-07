/**
 * OpenClaw Plugin API Types
 *
 * Typed interface for the OpenClaw plugin system.
 * Based on the OpenClaw provider plugin contract.
 */

export interface PluginLogger {
  debug?: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: Record<string, unknown> & {
    models?: { providers?: Record<string, unknown> };
    agents?: Record<string, unknown>;
  };
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  registerProvider: (provider: unknown) => void;
  registerTool?: (tool: unknown, opts?: unknown) => void;
  registerHook?: (events: string | string[], handler: unknown, opts?: unknown) => void;
  registerHttpRoute?: (params: { path: string; handler: unknown }) => void;
  registerService: (service: { id: string; start: () => void; stop?: () => void | Promise<void> }) => void;
  registerCommand?: (command: unknown) => void;
  resolvePath?: (input: string) => string;
  on?: (hookName: string, handler: unknown, opts?: unknown) => void;
}

export interface OpenClawPluginDefinition {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  providers?: unknown[];
  commands?: unknown[];
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
  activate?: (api: OpenClawPluginApi) => void | Promise<void>;
}
