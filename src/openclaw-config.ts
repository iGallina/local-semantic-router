/**
 * OpenClaw Configuration Injector
 *
 * Injects LSR provider models and auth profiles into OpenClaw's config files
 * at plugin startup. All operations are synchronous (runs at startup, blocking is fine).
 *
 * Two exported functions:
 *   - injectModelsConfig: writes provider + model allowlist into openclaw.json
 *   - injectAuthProfile: writes placeholder auth into each agent's auth-profiles.json
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { PluginLogger } from "./openclaw-types.js";

// ── Types ─────────────────────────────────────────────────────────

interface OpenClawModelEntry {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

interface OpenClawProviderEntry {
  baseUrl: string;
  api: string;
  apiKey: string;
  models: OpenClawModelEntry[];
}

/** Minimal shape of ~/.openclaw/openclaw.json that we care about */
interface OpenClawConfig {
  models?: {
    providers?: Record<string, OpenClawProviderEntry>;
  };
  agents?: {
    defaults?: {
      models?: Record<string, Record<string, never>>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface AuthProfile {
  type: string;
  provider: string;
  key: string;
}

interface AuthProfilesFile {
  version: number;
  profiles: Record<string, AuthProfile>;
}

// ── LSR Provider Definition ───────────────────────────────────────

const LSR_PROVIDER_ID = "local-router";

const LSR_MODELS: OpenClawModelEntry[] = [
  {
    id: "lsr-auto",
    name: "Auto (Smart Router)",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: "lsr-eco",
    name: "Eco (Cost Optimized)",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: "lsr-premium",
    name: "Premium (Best Quality)",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
];

const LSR_ALLOWLIST_KEYS = ["local-router/lsr-auto", "local-router/lsr-eco", "local-router/lsr-premium"] as const;

const LSR_AUTH_PROFILE_KEY = "local-router:default";

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Resolve the ~/.openclaw directory path.
 * Accepts an optional override for testing purposes.
 */
function getOpenClawDir(override?: string): string {
  return override ?? join(homedir(), ".openclaw");
}

/**
 * Read and parse a JSON file. Returns null if the file does not exist.
 * Returns undefined if the file exists but contains invalid JSON.
 */
function readJsonFile<T>(filePath: string): T | null | undefined {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined; // signals corrupt/invalid JSON
  }
}

/**
 * Write JSON atomically: write to a temp file then rename into place.
 */
function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

/**
 * Back up a file by copying it to `{path}.backup.{timestamp}`.
 */
function backupFile(filePath: string, logger: PluginLogger): void {
  const backupPath = `${filePath}.backup.${Date.now()}`;
  try {
    copyFileSync(filePath, backupPath);
    logger.warn(`Backed up corrupt file to ${backupPath}`);
  } catch (err) {
    logger.warn(`Failed to back up ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── injectModelsConfig ────────────────────────────────────────────

/**
 * Inject LSR's provider and models into ~/.openclaw/openclaw.json.
 *
 * - Creates the file if it does not exist
 * - Backs up and starts fresh if the file contains corrupt JSON
 * - Injects the "local-router" provider at config.models.providers
 * - Injects model allowlist entries at config.agents.defaults.models
 * - Preserves all non-LSR entries
 * - Safe to call on every plugin load (idempotent)
 *
 * @param port - The port the LSR proxy is running on
 * @param logger - Plugin logger
 * @param _openClawDir - Optional override for ~/.openclaw (used in tests)
 */
export function injectModelsConfig(port: number, logger: PluginLogger, _openClawDir?: string): void {
  const openClawDir = getOpenClawDir(_openClawDir);
  const configPath = join(openClawDir, "openclaw.json");

  // Ensure ~/.openclaw exists
  if (!existsSync(openClawDir)) {
    mkdirSync(openClawDir, { recursive: true });
    logger.info(`Created OpenClaw config directory: ${openClawDir}`);
  }

  // Read existing config, handling corrupt JSON
  let config: OpenClawConfig;
  let needsWrite = false;
  const parsed = readJsonFile<OpenClawConfig>(configPath);

  if (parsed === null) {
    // File does not exist — start fresh
    config = {};
    needsWrite = true;
  } else if (parsed === undefined) {
    // File exists but contains invalid JSON — back up and skip writing.
    // Don't write — we'd lose other plugins' config.
    backupFile(configPath, logger);
    logger.warn("Skipping config injection due to corrupt openclaw.json");
    return;
  } else {
    config = parsed;
  }

  // ── Inject provider ──────────────────────────────────────────

  if (!config.models) { config.models = {}; needsWrite = true; }
  if (!config.models.providers) { config.models.providers = {}; needsWrite = true; }

  const expectedBaseUrl = `http://127.0.0.1:${port}/v1`;

  if (!config.models.providers[LSR_PROVIDER_ID]) {
    // First install: create provider entry
    config.models.providers[LSR_PROVIDER_ID] = {
      baseUrl: expectedBaseUrl,
      api: "openai-completions",
      apiKey: "lsr-proxy-handles-auth",
      models: LSR_MODELS,
    };
    needsWrite = true;
  } else {
    // Validate and fix individual fields on existing provider
    const existing = config.models.providers[LSR_PROVIDER_ID];

    if (existing.baseUrl !== expectedBaseUrl) {
      existing.baseUrl = expectedBaseUrl;
      needsWrite = true;
    }
    if (!existing.api) {
      existing.api = "openai-completions";
      needsWrite = true;
    }
    if (!existing.apiKey) {
      existing.apiKey = "lsr-proxy-handles-auth";
      needsWrite = true;
    }

    // Smart model list comparison by ID set
    const currentModelIds = new Set(
      Array.isArray(existing.models) ? existing.models.map((m) => m.id) : [],
    );
    const expectedModelIds = LSR_MODELS.map((m) => m.id);
    const needsModelUpdate =
      !existing.models ||
      !Array.isArray(existing.models) ||
      existing.models.length !== LSR_MODELS.length ||
      expectedModelIds.some((id) => !currentModelIds.has(id));

    if (needsModelUpdate) {
      existing.models = LSR_MODELS;
      needsWrite = true;
    }
  }

  // ── Inject model allowlist ───────────────────────────────────

  if (!config.agents) { config.agents = {}; needsWrite = true; }
  if (!config.agents.defaults) { config.agents.defaults = {}; needsWrite = true; }
  if (!config.agents.defaults.models) { config.agents.defaults.models = {}; needsWrite = true; }

  for (const key of LSR_ALLOWLIST_KEYS) {
    if (!(key in config.agents.defaults.models)) {
      config.agents.defaults.models[key] = {};
      needsWrite = true;
    }
  }

  // ── Atomic write (only when dirty) ──────────────────────────

  if (needsWrite) {
    writeJsonAtomic(configPath, config);
    logger.info(`Injected LSR provider into ${configPath} (port ${port})`);
  } else {
    logger.debug?.(`LSR config already up to date in ${configPath}`);
  }
}

// ── injectAuthProfile ─────────────────────────────────────────────

/**
 * Inject placeholder auth for LSR into each OpenClaw agent's auth-profiles.json.
 *
 * - Scans ~/.openclaw/agents/ for agent directories
 * - Always ensures the "main" agent directory exists
 * - For each agent dir, creates/updates {agentDir}/agent/auth-profiles.json
 * - Injects "local-router:default" profile with api_key type
 * - Additive only — never deletes or overwrites non-LSR entries
 * - If the existing file has invalid format, discards and recreates with just LSR profile
 *
 * @param logger - Plugin logger
 * @param _openClawDir - Optional override for ~/.openclaw (used in tests)
 */
export function injectAuthProfile(logger: PluginLogger, _openClawDir?: string): void {
  const openClawDir = getOpenClawDir(_openClawDir);
  const agentsDir = join(openClawDir, "agents");

  // Ensure agents dir exists
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true });
    logger.info(`Created OpenClaw agents directory: ${agentsDir}`);
  }

  // Collect agent directories to process
  const agentDirs = new Set<string>();

  // Always ensure "main" agent exists
  agentDirs.add("main");

  // Scan for existing agent directories
  try {
    const entries = readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        agentDirs.add(entry.name);
      }
    }
  } catch (err) {
    logger.warn(`Failed to scan agents directory: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Process each agent directory
  for (const agentName of agentDirs) {
    const agentDir = join(agentsDir, agentName);
    const agentSubDir = join(agentDir, "agent");
    const authProfilesPath = join(agentSubDir, "auth-profiles.json");

    // Ensure the agent/agent/ subdirectory exists
    if (!existsSync(agentSubDir)) {
      mkdirSync(agentSubDir, { recursive: true });
    }

    // Read existing auth profiles
    const parsed = readJsonFile<AuthProfilesFile>(authProfilesPath);

    let profilesFile: AuthProfilesFile;

    if (parsed === null) {
      // File does not exist — create fresh
      profilesFile = { version: 1, profiles: {} };
    } else if (
      parsed === undefined ||
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      !("profiles" in parsed) ||
      typeof (parsed as AuthProfilesFile).profiles !== "object"
    ) {
      // Invalid format — discard and recreate
      logger.warn(`Invalid auth-profiles.json for agent "${agentName}", recreating`);
      profilesFile = { version: 1, profiles: {} };
    } else {
      profilesFile = parsed;
      // Ensure version is set
      if (!profilesFile.version) profilesFile.version = 1;
    }

    // Inject LSR profile (additive — never overwrite existing non-LSR entries)
    if (!(LSR_AUTH_PROFILE_KEY in profilesFile.profiles)) {
      profilesFile.profiles[LSR_AUTH_PROFILE_KEY] = {
        type: "api_key",
        provider: "local-router",
        key: "lsr-proxy-handles-auth",
      };
      writeFileSync(authProfilesPath, JSON.stringify(profilesFile, null, 2), "utf-8");
      logger.info(`Injected LSR auth profile into agent "${agentName}"`);
    } else {
      logger.debug?.(`LSR auth profile already present in agent "${agentName}", skipping`);
    }
  }
}
