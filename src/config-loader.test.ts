import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, maskApiKey } from "./config-loader.js";

const TEST_DIR = join(tmpdir(), `lsr-test-${Date.now()}`);
const CONFIG_PATH = join(TEST_DIR, "config.yaml");

function writeConfig(content: string, mode = 0o600): void {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, content, { mode });
}

function validConfig(overrides = ""): string {
  return `
port: 8402
bind: "127.0.0.1"
routing_profile: auto

providers:
  test-provider:
    api: openai-completions
    base_url: "https://api.example.com/v1"
    api_key: "test-key-12345"
    models:
      - id: "test-model"
        name: "Test Model"
        input_price: 1.0
        output_price: 2.0

tiers:
  auto:
    simple:
      primary: "test-provider/test-model"
    medium:
      primary: "test-provider/test-model"
    complex:
      primary: "test-provider/test-model"
    reasoning:
      primary: "test-provider/test-model"

${overrides}
`;
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("loadConfig", () => {
  it("parses valid YAML correctly", () => {
    writeConfig(validConfig());
    const config = loadConfig(CONFIG_PATH);

    expect(config.port).toBe(8402);
    expect(config.bind).toBe("127.0.0.1");
    expect(config.routing_profile).toBe("auto");
    expect(config.providers["test-provider"]).toBeDefined();
    expect(config.providers["test-provider"].api).toBe("openai-completions");
    expect(config.providers["test-provider"].models[0].id).toBe("test-model");
  });

  it("resolves ${ENV_VAR} interpolation from process.env", () => {
    process.env.TEST_API_KEY_FOR_LSR = "sk-resolved-key";
    writeConfig(validConfig().replace("test-key-12345", "${TEST_API_KEY_FOR_LSR}"));

    const config = loadConfig(CONFIG_PATH);
    expect(config.providers["test-provider"].api_key).toBe("sk-resolved-key");

    delete process.env.TEST_API_KEY_FOR_LSR;
  });

  it("throws on undefined environment variable", () => {
    writeConfig(validConfig().replace("test-key-12345", "${UNDEFINED_VAR_XYZ_123}"));

    expect(() => loadConfig(CONFIG_PATH)).toThrow("UNDEFINED_VAR_XYZ_123");
  });

  it("rejects unknown top-level fields", () => {
    writeConfig(validConfig("foo: bar"));

    expect(() => loadConfig(CONFIG_PATH)).toThrow("Unknown field");
    expect(() => loadConfig(CONFIG_PATH)).toThrow("foo");
  });

  it("rejects missing providers field", () => {
    writeConfig(`
port: 8402
tiers:
  auto:
    simple:
      primary: "test/model"
    medium:
      primary: "test/model"
    complex:
      primary: "test/model"
    reasoning:
      primary: "test/model"
`);
    expect(() => loadConfig(CONFIG_PATH)).toThrow("providers");
  });

  it("rejects YAML with unsafe constructs (SEC-7)", () => {
    // JSON_SCHEMA mode should reject custom tags
    writeConfig(`
port: 8402
providers:
  test:
    api: openai-completions
    base_url: !!js/function "function() { return 'evil'; }"
    api_key: "key"
    models: []
tiers:
  auto:
    simple:
      primary: "test/model"
    medium:
      primary: "test/model"
    complex:
      primary: "test/model"
    reasoning:
      primary: "test/model"
`);
    expect(() => loadConfig(CONFIG_PATH)).toThrow();
  });

  it("validates invalid base_url values", () => {
    writeConfig(validConfig().replace("https://api.example.com/v1", "not-a-url"));

    expect(() => loadConfig(CONFIG_PATH)).toThrow("invalid");
  });

  it("returns default values for optional fields", () => {
    writeConfig(validConfig());
    const config = loadConfig(CONFIG_PATH);

    expect(config.fallback_classifier.enabled).toBe(false);
  });

  it("warns on insecure file permissions (SEC-1)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeConfig(validConfig(), 0o644);

    loadConfig(CONFIG_PATH);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("insecure permissions"),
    );

    warnSpy.mockRestore();
  });

  it("allows x- prefixed custom fields for extensibility", () => {
    writeConfig(validConfig("x-custom-field: some-value"));

    // Should NOT throw
    const config = loadConfig(CONFIG_PATH);
    expect(config).toBeDefined();
  });
});

describe("maskApiKey", () => {
  it("masks API key showing first and last 4 chars", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("[key:sk-1...cdef]");
  });

  it("fully masks short keys", () => {
    expect(maskApiKey("short")).toBe("[key:****]");
  });
});
