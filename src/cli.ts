#!/usr/bin/env node

/**
 * local-semantic-router CLI
 *
 * Commands:
 *   local-semantic-router          Start proxy with config
 *   local-semantic-router init     Interactive setup wizard
 *   local-semantic-router --version  Version info
 *
 * Flags:
 *   --port <number>      Custom port (default: 8402)
 *   --bind <address>     Bind address (default: 127.0.0.1) (SEC-2)
 *   --config <path>      Custom config path
 */

import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir, platform, userInfo } from "node:os";
import { loadConfig } from "./config-loader.js";
import { startProxy } from "./proxy.js";
import type { ResolvedConfig } from "./config-types.js";

const VERSION = "0.1.0";
const DEFAULT_CONFIG_DIR = join(homedir(), ".local-semantic-router");
const DEFAULT_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, "config.yaml");

// ─── Argument Parsing ───

function parseArgs(args: string[]): {
  command: string | null;
  port?: number;
  bind?: string;
  configPath?: string;
  version?: boolean;
  help?: boolean;
} {
  let command: string | null = null;
  let port: number | undefined;
  let bind: string | undefined;
  let configPath: string | undefined;
  let version = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "init":
        command = "init";
        break;
      case "--port":
        port = parseInt(args[++i] ?? "", 10);
        break;
      case "--bind":
        bind = args[++i];
        break;
      case "--config":
        configPath = args[++i];
        break;
      case "--version":
      case "-v":
        version = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
    }
  }

  return { command, port, bind, configPath, version, help };
}

// ─── ANSI Colors ───

const isTTY = process.stdout.isTTY ?? false;
const c = {
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
};

// ─── Provider Catalog ───

type TierHint = "simple" | "medium" | "complex" | "reasoning";

interface CatalogModel {
  id: string;
  name: string;
  inputPrice: number;
  outputPrice: number;
  contextWindow: number;
  maxTokens: number;
  tierHint: TierHint;
}

interface CatalogProvider {
  label: string;
  api: "openai-completions" | "anthropic-messages";
  baseUrl: string;
  envVar: string | null;
  defaultOn: boolean;
  models: CatalogModel[];
}

// ─── Known Pricing (for providers whose APIs don't return pricing) ───

const KNOWN_PRICING: Record<string, { inputPrice: number; outputPrice: number; contextWindow: number; maxTokens: number; tierHint: TierHint }> = {
  // Anthropic
  "claude-haiku-4-5-20251001": { inputPrice: 0.80, outputPrice: 4.0, contextWindow: 200000, maxTokens: 8192, tierHint: "simple" },
  "claude-sonnet-4-5-20251001": { inputPrice: 3.0, outputPrice: 15.0, contextWindow: 200000, maxTokens: 64000, tierHint: "medium" },
  "claude-sonnet-4-6-20260315": { inputPrice: 3.0, outputPrice: 15.0, contextWindow: 200000, maxTokens: 64000, tierHint: "medium" },
  "claude-opus-4-5-20251001": { inputPrice: 5.0, outputPrice: 25.0, contextWindow: 200000, maxTokens: 32000, tierHint: "complex" },
  "claude-opus-4-6-20260315": { inputPrice: 5.0, outputPrice: 25.0, contextWindow: 1000000, maxTokens: 128000, tierHint: "complex" },
  // OpenAI
  "gpt-4o": { inputPrice: 2.5, outputPrice: 10.0, contextWindow: 128000, maxTokens: 16384, tierHint: "medium" },
  "gpt-4o-mini": { inputPrice: 0.15, outputPrice: 0.6, contextWindow: 128000, maxTokens: 16384, tierHint: "simple" },
  "gpt-4.1": { inputPrice: 2.0, outputPrice: 8.0, contextWindow: 1047576, maxTokens: 32768, tierHint: "medium" },
  "gpt-4.1-mini": { inputPrice: 0.4, outputPrice: 1.6, contextWindow: 1047576, maxTokens: 32768, tierHint: "simple" },
  "gpt-4.1-nano": { inputPrice: 0.1, outputPrice: 0.4, contextWindow: 1047576, maxTokens: 32768, tierHint: "simple" },
  "o3": { inputPrice: 10.0, outputPrice: 40.0, contextWindow: 200000, maxTokens: 100000, tierHint: "reasoning" },
  "o3-mini": { inputPrice: 1.1, outputPrice: 4.4, contextWindow: 200000, maxTokens: 100000, tierHint: "reasoning" },
  "o4-mini": { inputPrice: 1.1, outputPrice: 4.4, contextWindow: 200000, maxTokens: 100000, tierHint: "reasoning" },
};

// ─── Fallback Provider Catalog (used when live API query fails or no key) ───

const PROVIDER_CATALOG: Record<string, CatalogProvider> = {
  groq: {
    label: "Groq (Ultra-fast inference)",
    api: "openai-completions",
    baseUrl: "https://api.groq.com/openai/v1",
    envVar: "GROQ_API_KEY",
    defaultOn: true,
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", inputPrice: 0.59, outputPrice: 0.79, contextWindow: 131072, maxTokens: 32768, tierHint: "simple" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", inputPrice: 0.05, outputPrice: 0.08, contextWindow: 131072, maxTokens: 131072, tierHint: "simple" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", inputPrice: 0.27, outputPrice: 0.81, contextWindow: 32768, maxTokens: 32768, tierHint: "simple" },
      { id: "llama-3.1-405b-reasoning", name: "Llama 3.1 405B (Reasoning)", inputPrice: 5.35, outputPrice: 10.70, contextWindow: 131072, maxTokens: 32768, tierHint: "reasoning" },
    ],
  },
  anthropic: {
    label: "Anthropic (Claude)",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com/v1",
    envVar: "ANTHROPIC_API_KEY",
    defaultOn: true,
    models: [
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", inputPrice: 0.80, outputPrice: 4.0, contextWindow: 200000, maxTokens: 8192, tierHint: "simple" },
      { id: "claude-sonnet-4-6-20260315", name: "Claude Sonnet 4.6", inputPrice: 3.0, outputPrice: 15.0, contextWindow: 200000, maxTokens: 64000, tierHint: "medium" },
      { id: "claude-opus-4-6-20260315", name: "Claude Opus 4.6", inputPrice: 5.0, outputPrice: 25.0, contextWindow: 1000000, maxTokens: 128000, tierHint: "complex" },
    ],
  },
  openai: {
    label: "OpenAI (GPT)",
    api: "openai-completions",
    baseUrl: "https://api.openai.com/v1",
    envVar: "OPENAI_API_KEY",
    defaultOn: false,
    models: [
      { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", inputPrice: 0.1, outputPrice: 0.4, contextWindow: 1047576, maxTokens: 32768, tierHint: "simple" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", inputPrice: 0.4, outputPrice: 1.6, contextWindow: 1047576, maxTokens: 32768, tierHint: "simple" },
      { id: "gpt-4.1", name: "GPT-4.1", inputPrice: 2.0, outputPrice: 8.0, contextWindow: 1047576, maxTokens: 32768, tierHint: "medium" },
      { id: "gpt-4o", name: "GPT-4o", inputPrice: 2.5, outputPrice: 10.0, contextWindow: 128000, maxTokens: 16384, tierHint: "medium" },
      { id: "o4-mini", name: "o4-mini", inputPrice: 1.1, outputPrice: 4.4, contextWindow: 200000, maxTokens: 100000, tierHint: "reasoning" },
      { id: "o3", name: "o3", inputPrice: 10.0, outputPrice: 40.0, contextWindow: 200000, maxTokens: 100000, tierHint: "reasoning" },
    ],
  },
  openrouter: {
    label: "OpenRouter (Multi-provider gateway)",
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    envVar: "OPENROUTER_API_KEY",
    defaultOn: false,
    models: [
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", inputPrice: 0.15, outputPrice: 0.6, contextWindow: 1048576, maxTokens: 65536, tierHint: "simple" },
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", inputPrice: 1.25, outputPrice: 10.0, contextWindow: 1048576, maxTokens: 65536, tierHint: "complex" },
      { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6 (via OR)", inputPrice: 3.0, outputPrice: 15.0, contextWindow: 200000, maxTokens: 64000, tierHint: "medium" },
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1", inputPrice: 0.55, outputPrice: 2.19, contextWindow: 163840, maxTokens: 163840, tierHint: "reasoning" },
    ],
  },
  ollama: {
    label: "Ollama (Local models, free)",
    api: "openai-completions",
    baseUrl: "http://localhost:11434/v1",
    envVar: null,
    defaultOn: false,
    models: [
      { id: "llama3.3", name: "Llama 3.3", inputPrice: 0, outputPrice: 0, contextWindow: 131072, maxTokens: 32768, tierHint: "simple" },
      { id: "qwen2.5-coder", name: "Qwen 2.5 Coder", inputPrice: 0, outputPrice: 0, contextWindow: 131072, maxTokens: 32768, tierHint: "medium" },
    ],
  },
};

// ─── API Key Auto-Detection ───

function detectExistingKeys(): Map<string, string> {
  const keys = new Map<string, string>();

  // Check environment variables
  const envMappings: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    groq: "GROQ_API_KEY",
  };

  for (const [provider, envVar] of Object.entries(envMappings)) {
    const value = process.env[envVar];
    if (value && value.length > 0) {
      keys.set(provider, value);
    }
  }

  return keys;
}

/**
 * Detect Anthropic subscription key from macOS Keychain (Claude Code credentials).
 * Returns the OAuth access token (sk-ant-oat01-*) if found, null otherwise.
 * Only works on macOS — returns null on other platforms.
 */
function detectKeychainSubscriptionKey(): string | null {
  if (platform() !== "darwin") return null;
  try {
    const username = userInfo().username;
    const raw = execSync(
      `security find-generic-password -s "Claude Code-credentials" -a "${username}" -w`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const parsed = JSON.parse(raw);
    const token = parsed?.claudeAiOauth?.accessToken;
    if (typeof token === "string" && token.startsWith("sk-ant-oat01-")) {
      return token;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate that an API key looks like a valid format for the given provider.
 * Recognizes Anthropic OAuth tokens (sk-ant-oat01-*) from Claude subscriptions.
 */
function isValidKeyFormat(provider: string, key: string): boolean {
  if (!key || key.length < 8) return false;
  switch (provider) {
    case "anthropic":
      return key.startsWith("sk-ant-api03-") || key.startsWith("sk-ant-oat01-");
    case "openai":
      return key.startsWith("sk-");
    case "openrouter":
      return key.startsWith("sk-or-");
    case "groq":
      return key.startsWith("gsk_");
    default:
      return true;
  }
}

// ─── Live Model Fetching ───

const FETCH_TIMEOUT_MS = 8000;

interface OpenAIModelResponse { data: Array<{ id: string; owned_by?: string }> }
interface AnthropicModelResponse { data: Array<{ id: string; display_name?: string; created_at?: string }> }
interface OpenRouterModelResponse { data: Array<{ id: string; name: string; pricing?: { prompt?: string; completion?: string }; context_length?: number; top_provider?: { max_completion_tokens?: number } }> }

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function inferTierHint(id: string, inputPrice: number, outputPrice: number): TierHint {
  const totalCost = inputPrice + outputPrice;
  // Reasoning models
  if (/^o[0-9]/.test(id) || id.includes("reasoning") || id.includes("-r1")) return "reasoning";
  // Simple — very cheap models
  if (totalCost < 1.0) return "simple";
  // Complex — expensive models
  if (totalCost > 15.0) return "complex";
  return "medium";
}

async function fetchOpenAIModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetchWithTimeout("https://api.openai.com/v1/models", {
    Authorization: `Bearer ${apiKey}`,
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
  const body = (await res.json()) as OpenAIModelResponse;
  const chatModelPattern = /^(gpt-|o[0-9]|chatgpt-)/;
  return body.data
    .filter((m) => chatModelPattern.test(m.id))
    .filter((m) => !m.id.includes("realtime") && !m.id.includes("audio") && !m.id.includes("search"))
    .map((m) => {
      const known = KNOWN_PRICING[m.id];
      return {
        id: m.id,
        name: m.id,
        inputPrice: known?.inputPrice ?? 0,
        outputPrice: known?.outputPrice ?? 0,
        contextWindow: known?.contextWindow ?? 128000,
        maxTokens: known?.maxTokens ?? 16384,
        tierHint: known?.tierHint ?? inferTierHint(m.id, 0, 0),
      };
    })
    .sort((a, b) => (a.inputPrice + a.outputPrice) - (b.inputPrice + b.outputPrice));
}

async function fetchAnthropicModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetchWithTimeout("https://api.anthropic.com/v1/models?limit=100", {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const body = (await res.json()) as AnthropicModelResponse;
  return body.data
    .filter((m) => m.id.startsWith("claude-"))
    .map((m) => {
      const known = KNOWN_PRICING[m.id];
      return {
        id: m.id,
        name: m.display_name ?? m.id,
        inputPrice: known?.inputPrice ?? 0,
        outputPrice: known?.outputPrice ?? 0,
        contextWindow: known?.contextWindow ?? 200000,
        maxTokens: known?.maxTokens ?? 8192,
        tierHint: known?.tierHint ?? inferTierHint(m.id, 0, 0),
      };
    })
    .sort((a, b) => (a.inputPrice + a.outputPrice) - (b.inputPrice + b.outputPrice));
}

async function fetchOpenRouterModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetchWithTimeout("https://openrouter.ai/api/v1/models", {
    Authorization: `Bearer ${apiKey}`,
  });
  if (!res.ok) throw new Error(`OpenRouter API ${res.status}`);
  const body = (await res.json()) as OpenRouterModelResponse;
  return body.data
    .filter((m) => {
      // Filter to chat-capable models with pricing
      const promptPrice = parseFloat(m.pricing?.prompt ?? "0");
      return promptPrice >= 0 && m.context_length && m.context_length > 0;
    })
    .map((m) => {
      const inputPricePerToken = parseFloat(m.pricing?.prompt ?? "0");
      const outputPricePerToken = parseFloat(m.pricing?.completion ?? "0");
      // OpenRouter pricing is per token, convert to per 1M tokens
      const inputPrice = inputPricePerToken * 1_000_000;
      const outputPrice = outputPricePerToken * 1_000_000;
      return {
        id: m.id,
        name: m.name || m.id,
        inputPrice,
        outputPrice,
        contextWindow: m.context_length ?? 128000,
        maxTokens: m.top_provider?.max_completion_tokens ?? 8192,
        tierHint: inferTierHint(m.id, inputPrice, outputPrice),
      };
    })
    .sort((a, b) => (a.inputPrice + a.outputPrice) - (b.inputPrice + b.outputPrice));
}

/**
 * Fetch live models from a provider API.
 * Returns null on failure (timeout, auth error, network error).
 */
async function fetchProviderModels(providerName: string, apiKey: string): Promise<CatalogModel[] | null> {
  if (!apiKey || apiKey.length === 0) return null;
  try {
    switch (providerName) {
      case "openai":
        return await fetchOpenAIModels(apiKey);
      case "anthropic":
        return await fetchAnthropicModels(apiKey);
      case "openrouter":
        return await fetchOpenRouterModels(apiKey);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ─── Setup Wizard ───

function createReadline(): ReturnType<typeof createInterface> {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

function detectOpenClawConfig(): Map<string, string> | null {
  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    if (!existsSync(configPath)) return null;
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const providers = parsed?.models?.providers;
    if (!providers || typeof providers !== "object") return null;
    const keys = new Map<string, string>();
    for (const [name, config] of Object.entries(providers)) {
      const apiKey = (config as Record<string, unknown>)?.apiKey;
      if (typeof apiKey === "string" && apiKey.length > 0 && !apiKey.includes("proxy-handles")) {
        keys.set(name, apiKey);
      }
    }
    return keys.size > 0 ? keys : null;
  } catch {
    return null;
  }
}

interface SelectedProvider {
  name: string;
  catalog: CatalogProvider;
  apiKey: string;
  baseUrl: string;
  selectedModels: CatalogModel[];
}

function generateTierMappings(
  providers: SelectedProvider[],
): { simple: { primary: string; fallbacks: string[] }; medium: { primary: string; fallbacks: string[] }; complex: { primary: string; fallbacks: string[] }; reasoning: { primary: string; fallbacks: string[] } } {
  // Flatten all selected models with their full ID
  const allModels = providers.flatMap((p) =>
    p.selectedModels.map((m) => ({
      fullId: `${p.name}/${m.id}`,
      ...m,
    })),
  );

  function pickBest(hint: TierHint, fallbackSort: "cheapest" | "expensive"): { primary: string; fallbacks: string[] } {
    // Prefer models with matching tierHint
    const hinted = allModels.filter((m) => m.tierHint === hint);
    const pool = hinted.length > 0 ? hinted : allModels;
    const sorted = [...pool].sort((a, b) => {
      const costA = a.inputPrice + a.outputPrice;
      const costB = b.inputPrice + b.outputPrice;
      return fallbackSort === "cheapest" ? costA - costB : costB - costA;
    });
    const primary = sorted[0]?.fullId ?? allModels[0].fullId;
    const fallbacks = sorted.slice(1).map((m) => m.fullId).slice(0, 2);
    return { primary, fallbacks };
  }

  return {
    simple: pickBest("simple", "cheapest"),
    medium: pickBest("medium", "cheapest"),
    complex: pickBest("complex", "expensive"),
    reasoning: pickBest("reasoning", "expensive"),
  };
}

function formatPrice(input: number, output: number): string {
  return `$${input.toFixed(2)}/$${output.toFixed(2)} per 1M tokens`;
}

async function runSetupWizard(): Promise<void> {
  const rl = createReadline();

  // ── Phase 0: Banner + overwrite check ──
  console.log("");
  console.log(`  ${c.bold("local-semantic-router")} v${VERSION} ${c.dim("— Setup Wizard")}`);
  console.log("  " + "─".repeat(45));
  console.log("");

  if (existsSync(DEFAULT_CONFIG_PATH)) {
    const overwrite = await ask(rl, `  ${c.yellow("!")} Existing config found. Overwrite? (y/N): `);
    if (overwrite.toLowerCase() !== "y") {
      console.log("  Aborted.\n");
      rl.close();
      return;
    }
    console.log("");
  }

  // ── Phase 1: Key detection (env vars, OpenClaw) ──
  let importedKeys = new Map<string, string>();

  // 1a. Detect keys from environment variables
  const envKeys = detectExistingKeys();
  if (envKeys.size > 0) {
    const providerNames = [...envKeys.entries()]
      .map(([name, key]) => {
        const format = name === "anthropic" && key.startsWith("sk-ant-oat01-")
          ? c.dim(" (OAuth/subscription)")
          : "";
        return `${c.bold(name)}${format}`;
      })
      .join(", ");
    console.log(`  ${c.green("*")} Found API keys in environment: ${providerNames}`);
    const doImport = await ask(rl, `  Use detected API keys? (Y/n): `);
    if (doImport.toLowerCase() !== "n") {
      importedKeys = envKeys;
      console.log(`  ${c.green("*")} Using ${importedKeys.size} key(s) from environment\n`);
    } else {
      console.log("");
    }
  }

  // 1b. Detect Anthropic subscription key from macOS Keychain
  if (!importedKeys.has("anthropic")) {
    const keychainKey = detectKeychainSubscriptionKey();
    if (keychainKey) {
      console.log(`  ${c.green("*")} Found Claude subscription key in macOS Keychain ${c.dim("(OAuth/subscription)")}`);
      const doImport = await ask(rl, `  Use subscription key? (Y/n): `);
      if (doImport.toLowerCase() !== "n") {
        importedKeys.set("anthropic", keychainKey);
        console.log(`  ${c.green("*")} Using Claude subscription key from Keychain\n`);
      } else {
        console.log("");
      }
    }
  }

  // 1c. Detect keys from OpenClaw config (merge, don't overwrite)
  const openClawKeys = detectOpenClawConfig();
  if (openClawKeys) {
    // Only show keys not already detected from env
    const newKeys = [...openClawKeys.entries()].filter(([name]) => !importedKeys.has(name));
    if (newKeys.length > 0) {
      const providerNames = newKeys.map(([name]) => name).join(", ");
      console.log(`  ${c.green("*")} Found OpenClaw config with keys for: ${c.bold(providerNames)}`);
      const doImport = await ask(rl, `  Import API keys from OpenClaw? (Y/n): `);
      if (doImport.toLowerCase() !== "n") {
        for (const [name, key] of newKeys) {
          importedKeys.set(name, key);
        }
        console.log(`  ${c.green("*")} Imported ${newKeys.length} additional key(s)\n`);
      } else {
        console.log("");
      }
    }
  }

  // ── Phase 2: Provider selection + API keys + model selection ──
  const selectedProviders: SelectedProvider[] = [];

  for (const [provName, catalog] of Object.entries(PROVIDER_CATALOG)) {
    const defaultChar = catalog.defaultOn ? "Y/n" : "y/N";
    const answer = await ask(rl, `  Configure ${c.bold(catalog.label)}? (${defaultChar}): `);
    const enabled = catalog.defaultOn
      ? answer.toLowerCase() !== "n"
      : answer.toLowerCase() === "y";

    if (!enabled) continue;

    // API key
    let apiKey = "";
    if (provName === "ollama") {
      const url = await ask(rl, `    Ollama URL ${c.dim(`(default: ${catalog.baseUrl})`)}: `);
      selectedProviders.push({
        name: provName,
        catalog,
        apiKey: "ollama",
        baseUrl: url || catalog.baseUrl,
        selectedModels: catalog.models,
      });
      console.log(`    ${c.green("+")} Ollama added with ${catalog.models.length} model(s)\n`);
      continue;
    }

    const imported = importedKeys.get(provName);

    // For Anthropic, ask key type before requesting the key
    if (provName === "anthropic" && !imported) {
      console.log(`\n    ${c.bold("Key type:")}`);
      console.log(`      ${c.bold("[1]")} Claude subscription key  ${c.dim("(sk-ant-oat01-...)")}`);
      console.log(`      ${c.bold("[2]")} API key                  ${c.dim("(sk-ant-api03-...)")}`);
      const keyType = await ask(rl, `    Select key type ${c.dim("(1/2, or Enter to set later in .env)")}: `);
      if (keyType === "1") {
        apiKey = await ask(rl, `    Subscription key: `);
      } else if (keyType === "2") {
        apiKey = await ask(rl, `    API key: `);
      }
      // else: empty — user will set later in .env
    } else if (imported) {
      const format = provName === "anthropic" && imported.startsWith("sk-ant-oat01-")
        ? c.dim(" (OAuth/subscription)")
        : "";
      const keyPrompt = await ask(rl, `    API key ${c.dim(`[detected: ${maskKey(imported)}]`)}${format} (Enter to keep, or paste new): `);
      apiKey = keyPrompt || imported;
    } else {
      apiKey = await ask(rl, `    API key (or Enter to set later in .env): `);
    }

    // Validate key format (warn, don't block)
    if (apiKey && !isValidKeyFormat(provName, apiKey)) {
      console.log(`    ${c.yellow("!")} Key format looks unusual for ${provName} — double-check it`);
    }

    // Fetch live models from provider API
    let availableModels = catalog.models;
    let liveModels = false;
    if (apiKey && ["openai", "anthropic", "openrouter"].includes(provName)) {
      process.stdout.write(`    ${c.dim("Fetching latest models...")}`);
      const fetched = await fetchProviderModels(provName, apiKey);
      if (fetched && fetched.length > 0) {
        availableModels = fetched;
        liveModels = true;
        process.stdout.write(` ${c.green(`${fetched.length} found`)}\n`);
      } else {
        process.stdout.write(` ${c.yellow("failed, using catalog")}\n`);
      }
    }

    // Model selection
    console.log(`\n    ${c.dim(liveModels ? "Live models:" : "Available models:")}`);
    for (let i = 0; i < availableModels.length; i++) {
      const m = availableModels[i];
      const price = m.inputPrice === 0 ? c.green("free") : c.dim(formatPrice(m.inputPrice, m.outputPrice));
      console.log(`      ${c.bold(`[${i + 1}]`)} ${m.name}  ${price}`);
    }

    const selection = await ask(rl, `    Select models ${c.dim("(comma-separated, or Enter for all)")}: `);
    let selectedModels: CatalogModel[];
    if (selection === "") {
      selectedModels = availableModels;
    } else {
      const indices = selection.split(",").map((s) => parseInt(s.trim(), 10) - 1);
      selectedModels = indices
        .filter((i) => i >= 0 && i < availableModels.length)
        .map((i) => availableModels[i]);
      if (selectedModels.length === 0) {
        console.log(`    ${c.yellow("!")} Invalid selection, using all models`);
        selectedModels = availableModels;
      }
    }

    selectedProviders.push({
      name: provName,
      catalog,
      apiKey,
      baseUrl: catalog.baseUrl,
      selectedModels,
    });
    console.log(`    ${c.green("+")} ${catalog.label.split(" (")[0]} added with ${selectedModels.length} model(s)\n`);
  }

  if (selectedProviders.length === 0) {
    console.log(`\n  ${c.yellow("!")} No providers configured. Exiting.\n`);
    rl.close();
    return;
  }

  // ── Phase 3: Routing profile ──
  console.log(`  ${c.bold("Routing profile:")}`);
  console.log(`    ${c.bold("[1]")} auto     ${c.dim("— Balanced cost/quality (default)")}`);
  console.log(`    ${c.bold("[2]")} eco      ${c.dim("— Always prefer cheapest option")}`);
  console.log(`    ${c.bold("[3]")} premium  ${c.dim("— Always prefer best quality")}`);
  console.log(`    ${c.bold("[4]")} agentic  ${c.dim("— Optimized for multi-step agent tasks")}`);

  const profileChoice = await ask(rl, `  Select profile (1-4, default: 1): `);
  const profiles = ["auto", "eco", "premium", "agentic"] as const;
  const routingProfile = profiles[parseInt(profileChoice, 10) - 1] ?? "auto";
  console.log("");

  // ── Phase 4: Tier mapping preview ──
  const tiers = generateTierMappings(selectedProviders);

  console.log(`  ${c.bold("Generated tier mappings:")}`);
  console.log(`    SIMPLE    ${c.dim("->")} ${c.cyan(tiers.simple.primary)}`);
  console.log(`    MEDIUM    ${c.dim("->")} ${c.cyan(tiers.medium.primary)}`);
  console.log(`    COMPLEX   ${c.dim("->")} ${c.cyan(tiers.complex.primary)}`);
  console.log(`    REASONING ${c.dim("->")} ${c.cyan(tiers.reasoning.primary)}`);
  console.log("");

  const acceptTiers = await ask(rl, `  Accept tier mappings? (Y/n): `);
  if (acceptTiers.toLowerCase() === "n") {
    // Manual override per tier
    const allModelIds = selectedProviders.flatMap((p) =>
      p.selectedModels.map((m) => `${p.name}/${m.id}`),
    );
    console.log(`\n    ${c.dim("Available models:")}`);
    for (let i = 0; i < allModelIds.length; i++) {
      console.log(`      ${c.bold(`[${i + 1}]`)} ${allModelIds[i]}`);
    }

    for (const tierName of ["simple", "medium", "complex", "reasoning"] as const) {
      const choice = await ask(rl, `    ${tierName.toUpperCase()} model (number, or Enter to keep ${tiers[tierName].primary}): `);
      const idx = parseInt(choice, 10) - 1;
      if (idx >= 0 && idx < allModelIds.length) {
        tiers[tierName].primary = allModelIds[idx];
      }
    }
    console.log("");
  }

  rl.close();

  // ── Phase 5: Write files ──
  const configLines: string[] = [
    "# local-semantic-router configuration",
    `# Generated by setup wizard on ${new Date().toISOString().split("T")[0]}`,
    "",
    "port: 8402",
    'bind: "127.0.0.1"',
    `routing_profile: ${routingProfile}`,
    "",
    "providers:",
  ];

  const envLines: string[] = [
    "# local-semantic-router environment variables",
    `# Generated by setup wizard on ${new Date().toISOString().split("T")[0]}`,
    "",
  ];

  for (const provider of selectedProviders) {
    const envVarName = `${provider.name.toUpperCase()}_API_KEY`;
    configLines.push(`  ${provider.name}:`);
    configLines.push(`    api: ${provider.catalog.api}`);
    configLines.push(`    base_url: "${provider.baseUrl}"`);

    if (provider.name === "ollama") {
      configLines.push(`    api_key: "ollama"`);
    } else {
      configLines.push(`    api_key: "\${${envVarName}}"`);
      envLines.push(`${envVarName}=${provider.apiKey}`);
    }

    configLines.push("    models:");
    for (const model of provider.selectedModels) {
      configLines.push(`      - id: "${model.id}"`);
      configLines.push(`        name: "${model.name}"`);
      configLines.push(`        input_price: ${model.inputPrice}`);
      configLines.push(`        output_price: ${model.outputPrice}`);
      configLines.push(`        context_window: ${model.contextWindow}`);
      configLines.push(`        max_tokens: ${model.maxTokens}`);
    }
    configLines.push("");
  }

  // Tier mappings
  configLines.push("tiers:");
  configLines.push(`  ${routingProfile}:`);
  for (const tierName of ["simple", "medium", "complex", "reasoning"] as const) {
    const tier = tiers[tierName];
    configLines.push(`    ${tierName}:`);
    configLines.push(`      primary: "${tier.primary}"`);
    if (tier.fallbacks.length > 0) {
      configLines.push(`      fallbacks: [${tier.fallbacks.map((f) => `"${f}"`).join(", ")}]`);
    }
  }

  // Fallback classifier — check if anthropic haiku is available
  configLines.push("");
  const hasHaiku = selectedProviders.some(
    (p) => p.name === "anthropic" && p.selectedModels.some((m) => m.id.includes("haiku")),
  );
  if (hasHaiku) {
    const haikuModel = selectedProviders
      .find((p) => p.name === "anthropic")!
      .selectedModels.find((m) => m.id.includes("haiku"))!;
    configLines.push("# Ambiguous prompts get classified by a cheap LLM");
    configLines.push("fallback_classifier:");
    configLines.push("  enabled: true");
    configLines.push('  provider: "anthropic"');
    configLines.push(`  model: "${haikuModel.id}"`);
    configLines.push("  max_tokens: 64");
    configLines.push("  temperature: 0.0");
  } else {
    configLines.push("fallback_classifier:");
    configLines.push("  enabled: false");
  }

  const configContent = configLines.join("\n") + "\n";
  const envContent = envLines.join("\n") + "\n";

  // Write files
  mkdirSync(DEFAULT_CONFIG_DIR, { recursive: true });
  writeFileSync(DEFAULT_CONFIG_PATH, configContent, { mode: 0o600 }); // SEC-1
  const envPath = join(DEFAULT_CONFIG_DIR, ".env");
  writeFileSync(envPath, envContent, { mode: 0o600 }); // SEC-1

  // Summary
  console.log(`  ${c.green("*")} ${c.bold("Files written:")}`);
  console.log(`    ${DEFAULT_CONFIG_PATH} ${c.dim("(0600)")}`);
  console.log(`    ${envPath} ${c.dim("(0600)")}`);
  console.log("");

  const totalModels = selectedProviders.reduce((n, p) => n + p.selectedModels.length, 0);
  const providerNames = selectedProviders.map((p) => p.name).join(", ");
  const keysSet = selectedProviders.filter((p) => p.apiKey && p.apiKey !== "ollama" && p.apiKey.length > 0).length;
  const keysTotal = selectedProviders.filter((p) => p.name !== "ollama").length;

  console.log(`  ${c.bold("Summary:")}`);
  console.log(`    Providers:  ${providerNames}`);
  console.log(`    Models:     ${totalModels} across ${selectedProviders.length} provider(s)`);
  console.log(`    Profile:    ${routingProfile}`);
  console.log(`    API keys:   ${keysSet}/${keysTotal} configured`);
  if (hasHaiku) {
    console.log(`    Classifier: ${c.green("enabled")} (Claude Haiku)`);
  }
  console.log("");

  if (keysSet < keysTotal) {
    console.log(`  ${c.yellow("!")} Some API keys are missing. Edit the .env file:`);
    console.log(`    ${c.dim(envPath)}`);
    console.log("");
  }

  console.log(`  ${c.bold("Next steps:")}`);
  console.log(`    ${c.dim("1.")} Start the router:  ${c.cyan("local-semantic-router")}`);
  console.log(`    ${c.dim("2.")} Test it:           ${c.cyan("curl http://127.0.0.1:8402/v1/chat/completions ...")}`);
  console.log("");
}

// ─── Print Banner ───

function printBanner(config: ResolvedConfig, port: number): void {
  console.log("");
  console.log("  local-semantic-router v" + VERSION);
  console.log("  ─────────────────────────────────");
  console.log(`  Proxy:    http://${config.bind}:${port}/v1`);
  console.log(`  Profile:  ${config.routing_profile}`);
  console.log(`  Providers: ${Object.keys(config.providers).join(", ")}`);

  // Show tier mapping
  const tiers = config.tiers[config.routing_profile] ?? config.tiers.auto;
  if (tiers) {
    console.log("  Tiers:");
    console.log(`    SIMPLE    -> ${tiers.simple.primary}`);
    console.log(`    MEDIUM    -> ${tiers.medium.primary}`);
    console.log(`    COMPLEX   -> ${tiers.complex.primary}`);
    console.log(`    REASONING -> ${tiers.reasoning.primary}`);
  }

  if (config.fallback_classifier.enabled) {
    console.log(
      `  Classifier: ${config.fallback_classifier.provider}/${config.fallback_classifier.model} (ENABLED)`,
    );
  } else {
    console.log("  Classifier: disabled (ambiguous -> MEDIUM)");
  }

  console.log("");
}

// ─── Main ───

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(`local-semantic-router v${VERSION}`);
    return;
  }

  if (args.help) {
    console.log(`
  local-semantic-router v${VERSION}

  Usage:
    local-semantic-router          Start proxy with config
    local-semantic-router init     Interactive setup wizard

  Options:
    --port <number>      Custom port (default: 8402)
    --bind <address>     Bind address (default: 127.0.0.1)
    --config <path>      Custom config path
    --version, -v        Show version
    --help, -h           Show this help
`);
    return;
  }

  if (args.command === "init") {
    await runSetupWizard();
    return;
  }

  // Start proxy
  let config: ResolvedConfig;
  try {
    config = loadConfig(args.configPath);
  } catch (error) {
    console.error(
      `[local-semantic-router] ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(`[local-semantic-router] Run 'local-semantic-router init' to create a config.`);
    process.exit(1);
  }

  // Apply CLI overrides
  if (args.port) config.port = args.port;
  if (args.bind) config.bind = args.bind;

  try {
    const proxy = await startProxy({
      config,
      port: config.port,
      bind: config.bind,
      onReady: (port) => {
        printBanner(config, port);
      },
      onRouted: (decision) => {
        const savings = (decision.savings * 100).toFixed(0);
        console.log(
          `  [${decision.tier}] ${decision.model} $${decision.costEstimate.toFixed(4)} (saved ${savings}%)`,
        );
      },
      onError: (error) => {
        console.error(`  [ERROR] ${error.message}`);
      },
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log("\n  Shutting down...");
      await proxy.close();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error(
      `[local-semantic-router] Failed to start: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[local-semantic-router] Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
