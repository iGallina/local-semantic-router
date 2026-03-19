import { describe, expect, it } from "vitest";

import { RulesStrategy, getStrategy, registerStrategy } from "./strategy.js";
import { DEFAULT_ROUTING_CONFIG } from "./config.js";
import type { RouterStrategy, RouterOptions } from "./types.js";
import type { ModelPricing } from "./selector.js";
import { route } from "./index.js";

const MODEL_PRICING = new Map<string, ModelPricing>([
  ["groq/llama-3.3-70b-versatile", { inputPrice: 0.59, outputPrice: 0.79 }],
  ["anthropic/claude-sonnet-4-6-20260315", { inputPrice: 3, outputPrice: 15 }],
  ["anthropic/claude-opus-4-6-20260315", { inputPrice: 5, outputPrice: 25 }],
  ["anthropic/claude-opus-4.6", { inputPrice: 5, outputPrice: 25 }],
]);

const baseOptions: RouterOptions = {
  config: DEFAULT_ROUTING_CONFIG,
  modelPricing: MODEL_PRICING,
};

describe("RulesStrategy", () => {
  it("returns tierConfigs in the decision", () => {
    const strategy = new RulesStrategy();
    const decision = strategy.route("hello", undefined, 100, baseOptions);

    expect(decision.tierConfigs).toBeDefined();
    expect(decision.tierConfigs!.SIMPLE).toBeDefined();
    expect(decision.tierConfigs!.MEDIUM).toBeDefined();
    expect(decision.tierConfigs!.COMPLEX).toBeDefined();
    expect(decision.tierConfigs!.REASONING).toBeDefined();
  });

  it("returns profile in the decision", () => {
    const strategy = new RulesStrategy();
    const decision = strategy.route("hello", undefined, 100, baseOptions);

    expect(decision.profile).toBeDefined();
    expect(["auto", "eco", "premium", "agentic"]).toContain(decision.profile);
  });

  it("sets eco profile when routingProfile is eco", () => {
    const strategy = new RulesStrategy();
    const decision = strategy.route("hello", undefined, 100, {
      ...baseOptions,
      routingProfile: "eco",
    });

    expect(decision.profile).toBe("eco");
    expect(decision.tierConfigs).toEqual(DEFAULT_ROUTING_CONFIG.ecoTiers);
  });

  it("sets premium profile when routingProfile is premium", () => {
    const strategy = new RulesStrategy();
    const decision = strategy.route("hello", undefined, 100, {
      ...baseOptions,
      routingProfile: "premium",
    });

    expect(decision.profile).toBe("premium");
    expect(decision.tierConfigs).toEqual(DEFAULT_ROUTING_CONFIG.premiumTiers);
  });

  it("sets agentic profile when tools are present", () => {
    const strategy = new RulesStrategy();
    const decision = strategy.route("hello", undefined, 100, {
      ...baseOptions,
      hasTools: true,
    });

    expect(decision.profile).toBe("agentic");
    expect(decision.tierConfigs).toEqual(DEFAULT_ROUTING_CONFIG.agenticTiers);
  });

  it("sets auto profile for default requests", () => {
    const strategy = new RulesStrategy();
    const decision = strategy.route("what is the capital of France", undefined, 100, baseOptions);

    expect(decision.profile).toBe("auto");
    expect(decision.tierConfigs).toEqual(DEFAULT_ROUTING_CONFIG.tiers);
  });
});

describe("Strategy Registry", () => {
  it("retrieves the default rules strategy", () => {
    const strategy = getStrategy("rules");
    expect(strategy).toBeInstanceOf(RulesStrategy);
    expect(strategy.name).toBe("rules");
  });

  it("throws for unknown strategy", () => {
    expect(() => getStrategy("nonexistent")).toThrow("Unknown routing strategy: nonexistent");
  });

  it("registers and retrieves a custom strategy", () => {
    const custom: RouterStrategy = {
      name: "custom-test",
      route: (_prompt, _sys, _max, options) => ({
        model: "test/model",
        tier: "SIMPLE" as const,
        confidence: 1,
        method: "rules" as const,
        reasoning: "custom strategy",
        costEstimate: 0,
        baselineCost: 0,
        savings: 0,
        tierConfigs: options.config.tiers,
        profile: "auto",
      }),
    };

    registerStrategy(custom);
    const retrieved = getStrategy("custom-test");
    expect(retrieved.name).toBe("custom-test");

    const decision = retrieved.route("test", undefined, 100, baseOptions);
    expect(decision.model).toBe("test/model");
    expect(decision.reasoning).toBe("custom strategy");
  });
});

describe("Backward compatibility", () => {
  it("route() produces same model/tier/method as before", () => {
    // Simple prompt → SIMPLE tier
    const simple = route("hello", undefined, 100, baseOptions);
    expect(simple.tier).toBe("SIMPLE");
    expect(simple.method).toBe("rules");
    expect(simple.model).toBeDefined();

    // Reasoning prompt → REASONING tier
    const reasoning = route(
      "prove the theorem step by step using mathematical induction",
      undefined,
      4096,
      baseOptions,
    );
    expect(reasoning.tier).toBe("REASONING");
    expect(reasoning.method).toBe("rules");

    // New fields are present
    expect(simple.tierConfigs).toBeDefined();
    expect(simple.profile).toBeDefined();
    expect(reasoning.tierConfigs).toBeDefined();
    expect(reasoning.profile).toBeDefined();
  });
});
