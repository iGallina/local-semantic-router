/**
 * Config Loader
 *
 * Loads and validates YAML configuration with security hardening:
 * - SEC-1: File permissions check (0600), API keys never in logs
 * - SEC-7: YAML parsed with CORE_SCHEMA (safe — no custom constructors like !!js/function)
 * - SEC-8: ${ENV_VAR} interpolation via regex, dotenv support
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { parse as parseYAML } from "yaml";
import { config as loadDotenv } from "dotenv";

import type {
  LocalRouterConfig,
  ResolvedConfig,
  ProviderConfig,
  TierMappingConfig,
  FallbackClassifierConfig,
} from "./config-types.js";

const DEFAULT_CONFIG_DIR = join(homedir(), ".local-semantic-router");
const DEFAULT_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, "config.yaml");

/**
 * Known top-level fields in the config schema.
 * Unknown fields are rejected (SEC-7).
 */
const KNOWN_TOP_LEVEL_FIELDS = new Set([
  "port",
  "bind",
  "routing_profile",
  "providers",
  "tiers",
  "fallback_classifier",
  "scoring",
]);

const KNOWN_PROVIDER_FIELDS = new Set(["api", "base_url", "api_key", "models"]);
const KNOWN_MODEL_FIELDS = new Set([
  "id",
  "name",
  "input_price",
  "output_price",
  "context_window",
  "max_tokens",
]);
const VALID_API_TYPES = new Set(["openai-completions", "anthropic-messages"]);
const VALID_PROFILES = new Set(["auto", "eco", "premium", "agentic"]);

/**
 * Mask an API key for safe logging.
 * Shows first 4 and last 4 characters only.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return "[key:****]";
  return `[key:${key.slice(0, 4)}...${key.slice(-4)}]`;
}

/**
 * Interpolate ${ENV_VAR_NAME} patterns in a string value.
 * SEC-8: Uses regex only, no eval.
 */
function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    const envValue = process.env[varName.trim()];
    if (envValue === undefined) {
      throw new Error(
        `Environment variable "${varName.trim()}" is not defined. ` +
          `Set it in your environment or .env file.`,
      );
    }
    return envValue;
  });
}

/**
 * Recursively interpolate env vars in all string values of an object.
 */
function interpolateDeep(obj: unknown): unknown {
  if (typeof obj === "string") {
    return interpolateEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateDeep);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = interpolateDeep(value);
    }
    return result;
  }
  return obj;
}

/**
 * Validate a URL string.
 */
function isValidUrl(urlStr: string): boolean {
  try {
    new URL(urlStr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check for unknown fields in an object.
 * Allows x- prefixed custom fields for extensibility.
 */
function checkUnknownFields(
  obj: Record<string, unknown>,
  knownFields: Set<string>,
  context: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!knownFields.has(key) && !key.startsWith("x-")) {
      throw new Error(`Unknown field "${key}" in ${context}. ` +
        `Known fields: ${[...knownFields].join(", ")}`);
    }
  }
}

/**
 * Validate the parsed config structure.
 */
function validateConfig(config: Record<string, unknown>): void {
  // Check top-level unknown fields
  checkUnknownFields(config, KNOWN_TOP_LEVEL_FIELDS, "config");

  // Validate port
  if (config.port !== undefined) {
    if (typeof config.port !== "number" || config.port < 1 || config.port > 65535) {
      throw new Error("Config field 'port' must be a number between 1 and 65535");
    }
  }

  // Validate bind
  if (config.bind !== undefined && typeof config.bind !== "string") {
    throw new Error("Config field 'bind' must be a string");
  }

  // Validate routing_profile
  if (config.routing_profile !== undefined) {
    if (typeof config.routing_profile !== "string" || !VALID_PROFILES.has(config.routing_profile)) {
      throw new Error(
        `Config field 'routing_profile' must be one of: ${[...VALID_PROFILES].join(", ")}`,
      );
    }
  }

  // Validate providers (required)
  if (!config.providers || typeof config.providers !== "object" || Array.isArray(config.providers)) {
    throw new Error("Config must have a 'providers' object");
  }

  const providers = config.providers as Record<string, unknown>;
  for (const [name, providerRaw] of Object.entries(providers)) {
    if (!providerRaw || typeof providerRaw !== "object") {
      throw new Error(`Provider '${name}' must be an object`);
    }
    const provider = providerRaw as Record<string, unknown>;
    checkUnknownFields(provider, KNOWN_PROVIDER_FIELDS, `providers.${name}`);

    if (!provider.api || !VALID_API_TYPES.has(provider.api as string)) {
      throw new Error(
        `Provider '${name}' must have 'api' set to one of: ${[...VALID_API_TYPES].join(", ")}`,
      );
    }
    if (!provider.base_url || typeof provider.base_url !== "string") {
      throw new Error(`Provider '${name}' must have a 'base_url' string`);
    }
    // Validate URL (before interpolation it may contain ${...}, so only validate if no interpolation)
    if (
      !(provider.base_url as string).includes("${") &&
      !isValidUrl(provider.base_url as string)
    ) {
      throw new Error(`Provider '${name}' has an invalid 'base_url': ${provider.base_url}`);
    }
    if (!provider.api_key || typeof provider.api_key !== "string") {
      throw new Error(`Provider '${name}' must have an 'api_key' string`);
    }
    if (!Array.isArray(provider.models)) {
      throw new Error(`Provider '${name}' must have a 'models' array`);
    }

    for (const model of provider.models as Array<Record<string, unknown>>) {
      if (!model || typeof model !== "object") {
        throw new Error(`Provider '${name}' has an invalid model entry`);
      }
      checkUnknownFields(model, KNOWN_MODEL_FIELDS, `providers.${name}.models[]`);
      if (!model.id || typeof model.id !== "string") {
        throw new Error(`Provider '${name}' model must have an 'id' string`);
      }
    }
  }

  // Validate tiers (required)
  if (!config.tiers || typeof config.tiers !== "object") {
    throw new Error("Config must have a 'tiers' object");
  }
}

/**
 * Check file permissions (SEC-1).
 * Warns if config file is readable by others.
 */
function checkFilePermissions(filePath: string): void {
  try {
    const stats = statSync(filePath);
    const mode = stats.mode & 0o777;
    if (mode !== 0o600) {
      console.warn(
        `[local-semantic-router] WARNING: Config file has insecure permissions ` +
          `(${mode.toString(8)}). Expected 0600. File: ${filePath}`,
      );
    }
  } catch {
    // If we can't stat the file, skip permission check
  }
}

/**
 * Load and validate the YAML configuration file.
 *
 * @param configPath - Path to config.yaml. Defaults to ~/.local-semantic-router/config.yaml
 * @returns Resolved configuration with all interpolations applied
 */
export function loadConfig(configPath?: string): ResolvedConfig {
  const resolvedPath = configPath ?? DEFAULT_CONFIG_PATH;

  // Load .env files (SEC-8)
  // Try cwd first, then config dir
  loadDotenv({ path: join(process.cwd(), ".env") });
  loadDotenv({ path: join(dirname(resolvedPath), ".env") });

  // Read config file
  let rawYaml: string;
  try {
    rawYaml = readFileSync(resolvedPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Cannot read config file at ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}. ` +
        `Run 'local-semantic-router init' to create one.`,
    );
  }

  // Check file permissions (SEC-1)
  checkFilePermissions(resolvedPath);

  // Parse YAML with CORE_SCHEMA (SEC-7)
  // Core schema handles standard YAML scalars but prevents arbitrary
  // type constructors like !!js/function — safe for untrusted input
  let parsed: unknown;
  try {
    parsed = parseYAML(rawYaml, { schema: "core" });
  } catch (err) {
    throw new Error(
      `Failed to parse YAML config: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Config file must contain a YAML mapping (object)");
  }

  // Validate structure before interpolation
  validateConfig(parsed as Record<string, unknown>);

  // Interpolate environment variables (SEC-8)
  const interpolated = interpolateDeep(parsed) as Record<string, unknown>;

  // Validate URLs after interpolation
  const providers = interpolated.providers as Record<string, Record<string, unknown>>;
  for (const [name, provider] of Object.entries(providers)) {
    if (!isValidUrl(provider.base_url as string)) {
      throw new Error(
        `Provider '${name}' has an invalid 'base_url' after interpolation: ${provider.base_url}`,
      );
    }
  }

  // Build resolved config with defaults
  const config: ResolvedConfig = {
    port: (interpolated.port as number) ?? 8402,
    bind: (interpolated.bind as string) ?? "127.0.0.1",
    routing_profile:
      (interpolated.routing_profile as ResolvedConfig["routing_profile"]) ?? "auto",
    providers: interpolated.providers as ResolvedConfig["providers"],
    tiers: interpolated.tiers as TierMappingConfig,
    fallback_classifier: {
      enabled: false,
      ...(interpolated.fallback_classifier as Partial<FallbackClassifierConfig> | undefined),
    },
    scoring: interpolated.scoring as ResolvedConfig["scoring"],
  };

  return config;
}
