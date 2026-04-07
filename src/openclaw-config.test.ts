/**
 * Tests for openclaw-config.ts
 *
 * Uses os.tmpdir() to create isolated temp directories per test.
 * Both functions accept an optional _openClawDir override for testing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { injectModelsConfig, injectAuthProfile } from "./openclaw-config.js";
import type { PluginLogger } from "./openclaw-types.js";

// ── Test helpers ──────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `lsr-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

const silentLogger: PluginLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ── injectModelsConfig ────────────────────────────────────────────

describe("injectModelsConfig", () => {
  let openClawDir: string;

  beforeEach(() => {
    openClawDir = makeTempDir();
  });

  it("creates openclaw.json with LSR provider and allowlist when no file exists", () => {
    injectModelsConfig(8402, silentLogger, openClawDir);

    const configPath = join(openClawDir, "openclaw.json");
    expect(existsSync(configPath)).toBe(true);

    const config = readJson<{
      models: { providers: Record<string, unknown> };
      agents: { defaults: { models: Record<string, unknown> } };
    }>(configPath);

    // Provider injected
    expect(config.models.providers["local-router"]).toBeDefined();
    const provider = config.models.providers["local-router"] as {
      baseUrl: string;
      api: string;
      apiKey: string;
      models: Array<{ id: string }>;
    };
    expect(provider.baseUrl).toBe("http://127.0.0.1:8402/v1");
    expect(provider.api).toBe("openai-completions");
    expect(provider.apiKey).toBe("lsr-proxy-handles-auth");
    expect(provider.models).toHaveLength(3);
    expect(provider.models.map((m) => m.id)).toEqual(["lsr-auto", "lsr-eco", "lsr-premium"]);

    // Allowlist injected
    expect(config.agents.defaults.models["local-router/lsr-auto"]).toBeDefined();
    expect(config.agents.defaults.models["local-router/lsr-eco"]).toBeDefined();
    expect(config.agents.defaults.models["local-router/lsr-premium"]).toBeDefined();
  });

  it("creates ~/.openclaw directory if it does not exist", () => {
    const nestedDir = join(openClawDir, "nested", "openclaw");
    injectModelsConfig(8402, silentLogger, nestedDir);

    expect(existsSync(nestedDir)).toBe(true);
    expect(existsSync(join(nestedDir, "openclaw.json"))).toBe(true);
  });

  it("preserves existing providers and adds LSR alongside them", () => {
    const configPath = join(openClawDir, "openclaw.json");
    writeJson(configPath, {
      models: {
        providers: {
          anthropic: {
            baseUrl: "https://api.anthropic.com",
            api: "anthropic-messages",
            apiKey: "sk-ant-existing",
            models: [],
          },
        },
      },
      agents: {
        defaults: {
          models: {
            "anthropic/claude-opus": {},
          },
        },
      },
    });

    injectModelsConfig(8402, silentLogger, openClawDir);

    const config = readJson<{
      models: { providers: Record<string, unknown> };
      agents: { defaults: { models: Record<string, unknown> } };
    }>(configPath);

    // Existing provider preserved
    expect(config.models.providers["anthropic"]).toBeDefined();
    const existing = config.models.providers["anthropic"] as { apiKey: string };
    expect(existing.apiKey).toBe("sk-ant-existing");

    // LSR added
    expect(config.models.providers["local-router"]).toBeDefined();

    // Existing allowlist entry preserved
    expect(config.agents.defaults.models["anthropic/claude-opus"]).toBeDefined();

    // LSR allowlist added
    expect(config.agents.defaults.models["local-router/lsr-auto"]).toBeDefined();
    expect(config.agents.defaults.models["local-router/lsr-eco"]).toBeDefined();
    expect(config.agents.defaults.models["local-router/lsr-premium"]).toBeDefined();
  });

  it("updates baseUrl and models when outdated LSR config exists", () => {
    const configPath = join(openClawDir, "openclaw.json");
    writeJson(configPath, {
      models: {
        providers: {
          "local-router": {
            baseUrl: "http://127.0.0.1:9999/v1",
            api: "openai-completions",
            apiKey: "lsr-proxy-handles-auth",
            models: [{ id: "lsr-old", name: "Old Model", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 32000 }],
          },
        },
      },
    });

    injectModelsConfig(8402, silentLogger, openClawDir);

    const config = readJson<{
      models: { providers: Record<string, { baseUrl: string; models: Array<{ id: string }> }> };
    }>(configPath);

    const provider = config.models.providers["local-router"];
    // Updated to new port
    expect(provider.baseUrl).toBe("http://127.0.0.1:8402/v1");
    // Updated to new models
    expect(provider.models.map((m) => m.id)).toEqual(["lsr-auto", "lsr-eco", "lsr-premium"]);
    expect(provider.models.some((m) => m.id === "lsr-old")).toBe(false);
  });

  it("backs up corrupt JSON file and writes fresh config", () => {
    const configPath = join(openClawDir, "openclaw.json");
    writeFileSync(configPath, "{ this is not valid json }", "utf-8");

    const warnMessages: string[] = [];
    const logger: PluginLogger = {
      ...silentLogger,
      warn: (...args) => warnMessages.push(args.join(" ")),
    };

    injectModelsConfig(8402, logger, openClawDir);

    // Backup created
    expect(warnMessages.some((m) => m.includes("backup"))).toBe(true);

    // Fresh config written with LSR provider
    const config = readJson<{ models: { providers: Record<string, unknown> } }>(configPath);
    expect(config.models.providers["local-router"]).toBeDefined();
  });

  it("is idempotent — calling twice does not duplicate entries", () => {
    injectModelsConfig(8402, silentLogger, openClawDir);
    injectModelsConfig(8402, silentLogger, openClawDir);

    const configPath = join(openClawDir, "openclaw.json");
    const config = readJson<{
      models: { providers: Record<string, unknown> };
      agents: { defaults: { models: Record<string, unknown> } };
    }>(configPath);

    expect(Object.keys(config.models.providers)).toHaveLength(1);
    const modelKeys = Object.keys(config.agents.defaults.models);
    expect(modelKeys.filter((k) => k.startsWith("local-router/"))).toHaveLength(3);
  });

  it("does not set agents.defaults.model.primary", () => {
    injectModelsConfig(8402, silentLogger, openClawDir);

    const configPath = join(openClawDir, "openclaw.json");
    const config = readJson<{ agents?: { defaults?: { model?: unknown } } }>(configPath);

    expect(config.agents?.defaults?.model).toBeUndefined();
  });
});

// ── injectAuthProfile ─────────────────────────────────────────────

describe("injectAuthProfile", () => {
  let openClawDir: string;

  beforeEach(() => {
    openClawDir = makeTempDir();
  });

  it("creates agents/main dir and injects LSR profile when no agents dir exists", () => {
    injectAuthProfile(silentLogger, openClawDir);

    const authPath = join(openClawDir, "agents", "main", "agent", "auth-profiles.json");
    expect(existsSync(authPath)).toBe(true);

    const file = readJson<{ version: number; profiles: Record<string, unknown> }>(authPath);
    expect(file.version).toBe(1);
    expect(file.profiles["local-router:default"]).toEqual({
      type: "api_key",
      provider: "local-router",
      key: "lsr-proxy-handles-auth",
    });
  });

  it("creates auth file for existing agent that has no auth file", () => {
    const agentDir = join(openClawDir, "agents", "my-agent");
    mkdirSync(agentDir, { recursive: true });

    injectAuthProfile(silentLogger, openClawDir);

    const authPath = join(openClawDir, "agents", "my-agent", "agent", "auth-profiles.json");
    expect(existsSync(authPath)).toBe(true);

    const file = readJson<{ profiles: Record<string, unknown> }>(authPath);
    expect(file.profiles["local-router:default"]).toBeDefined();
  });

  it("preserves existing non-LSR profiles and adds LSR alongside them", () => {
    const agentSubDir = join(openClawDir, "agents", "main", "agent");
    mkdirSync(agentSubDir, { recursive: true });

    const authPath = join(agentSubDir, "auth-profiles.json");
    writeJson(authPath, {
      version: 1,
      profiles: {
        "anthropic:default": {
          type: "api_key",
          provider: "anthropic",
          key: "sk-ant-existing",
        },
      },
    });

    injectAuthProfile(silentLogger, openClawDir);

    const file = readJson<{ profiles: Record<string, { key: string }> }>(authPath);

    // Existing profile preserved
    expect(file.profiles["anthropic:default"]?.key).toBe("sk-ant-existing");

    // LSR profile added
    expect(file.profiles["local-router:default"]).toEqual({
      type: "api_key",
      provider: "local-router",
      key: "lsr-proxy-handles-auth",
    });
  });

  it("is idempotent when LSR profile already exists", () => {
    const agentSubDir = join(openClawDir, "agents", "main", "agent");
    mkdirSync(agentSubDir, { recursive: true });

    const authPath = join(agentSubDir, "auth-profiles.json");
    const existing = {
      version: 1,
      profiles: {
        "local-router:default": {
          type: "api_key",
          provider: "local-router",
          key: "lsr-proxy-handles-auth",
        },
      },
    };
    writeJson(authPath, existing);

    const mtimeBefore = statSync(authPath).mtimeMs;

    injectAuthProfile(silentLogger, openClawDir);

    const mtimeAfter = statSync(authPath).mtimeMs;
    // File should not have been rewritten (no change needed)
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it("recreates auth file when existing file has invalid format", () => {
    const agentSubDir = join(openClawDir, "agents", "main", "agent");
    mkdirSync(agentSubDir, { recursive: true });

    const authPath = join(agentSubDir, "auth-profiles.json");
    writeFileSync(authPath, "{ not valid json }", "utf-8");

    const warnMessages: string[] = [];
    const logger: PluginLogger = {
      ...silentLogger,
      warn: (...args) => warnMessages.push(args.join(" ")),
    };

    injectAuthProfile(logger, openClawDir);

    const file = readJson<{ version: number; profiles: Record<string, unknown> }>(authPath);
    expect(file.version).toBe(1);
    expect(file.profiles["local-router:default"]).toBeDefined();
  });

  it("processes all existing agent directories", () => {
    const agentsDir = join(openClawDir, "agents");
    mkdirSync(join(agentsDir, "agent-a"), { recursive: true });
    mkdirSync(join(agentsDir, "agent-b"), { recursive: true });

    injectAuthProfile(silentLogger, openClawDir);

    for (const name of ["main", "agent-a", "agent-b"]) {
      const authPath = join(agentsDir, name, "agent", "auth-profiles.json");
      expect(existsSync(authPath)).toBe(true);
      const file = readJson<{ profiles: Record<string, unknown> }>(authPath);
      expect(file.profiles["local-router:default"]).toBeDefined();
    }
  });
});
