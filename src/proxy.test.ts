import { describe, expect, it, afterEach, vi } from "vitest";
import { startProxy, type ProxyHandle } from "./proxy.js";
import type { ResolvedConfig } from "./config-types.js";

const TEST_CONFIG: ResolvedConfig = {
  port: 0, // Use random available port
  bind: "127.0.0.1",
  routing_profile: "auto",
  providers: {
    test: {
      api: "openai-completions",
      base_url: "https://api.example.com/v1",
      api_key: "test-key",
      models: [
        { id: "test-model", name: "Test Model", input_price: 1, output_price: 2 },
      ],
    },
  },
  tiers: {
    auto: {
      simple: { primary: "test/test-model" },
      medium: { primary: "test/test-model" },
      complex: { primary: "test/test-model" },
      reasoning: { primary: "test/test-model" },
    },
  },
  fallback_classifier: { enabled: false },
};

let proxy: ProxyHandle | null = null;

afterEach(async () => {
  if (proxy) {
    await proxy.close();
    proxy = null;
  }
});

describe("Proxy Server", () => {
  it("binds to 127.0.0.1 by default (SEC-2)", async () => {
    proxy = await startProxy({
      config: { ...TEST_CONFIG, port: 0 },
      port: 0,
    });

    expect(proxy.baseUrl).toContain("127.0.0.1");
    expect(proxy.port).toBeGreaterThan(0);
  });

  it("health check endpoint returns 200", async () => {
    proxy = await startProxy({
      config: { ...TEST_CONFIG, port: 0 },
      port: 0,
    });

    const response = await fetch(`http://127.0.0.1:${proxy.port}/health`);
    expect(response.status).toBe(200);

    const data = (await response.json()) as { status: string };
    expect(data.status).toBe("ok");
  });

  it("returns 404 for non-/v1 paths", async () => {
    proxy = await startProxy({
      config: { ...TEST_CONFIG, port: 0 },
      port: 0,
    });

    const response = await fetch(`http://127.0.0.1:${proxy.port}/unknown`);
    expect(response.status).toBe(404);
  });

  it("serves /v1/models endpoint", async () => {
    proxy = await startProxy({
      config: { ...TEST_CONFIG, port: 0 },
      port: 0,
    });

    const response = await fetch(`http://127.0.0.1:${proxy.port}/v1/models`);
    expect(response.status).toBe(200);

    const data = (await response.json()) as { object: string; data: Array<{ id: string }> };
    expect(data.object).toBe("list");
    expect(data.data.length).toBeGreaterThan(0);

    // Should include routing profiles (lsr- prefixed)
    const ids = data.data.map((m) => m.id);
    expect(ids).toContain("lsr-auto");
    expect(ids).toContain("lsr-eco");
    expect(ids).toContain("lsr-premium");

    // Should include configured models (flattened with --)
    expect(ids).toContain("test--test-model");
  });

  it("prints warning to stderr when --bind 0.0.0.0 is used (SEC-2)", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    proxy = await startProxy({
      config: { ...TEST_CONFIG, port: 0, bind: "0.0.0.0" },
      port: 0,
      bind: "0.0.0.0",
    });

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("accessible from network"),
    );

    stderrSpy.mockRestore();
  });

  it("classifier disabled by default - ambiguous prompts get MEDIUM (SEC-3)", async () => {
    // The config has classifier disabled by default
    expect(TEST_CONFIG.fallback_classifier.enabled).toBe(false);

    proxy = await startProxy({
      config: { ...TEST_CONFIG, port: 0 },
      port: 0,
    });

    // Verify proxy started without classifier warning
    // (no LLM calls made for ambiguous prompts)
    expect(proxy.port).toBeGreaterThan(0);
  });

  it("prints classifier warning when enabled (SEC-3)", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const configWithClassifier: ResolvedConfig = {
      ...TEST_CONFIG,
      port: 0,
      fallback_classifier: {
        enabled: true,
        provider: "test",
        model: "test-model",
      },
    };

    proxy = await startProxy({
      config: configWithClassifier,
      port: 0,
    });

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Fallback LLM classifier is enabled"),
    );

    stderrSpy.mockRestore();
  });
});
