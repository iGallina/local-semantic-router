import { describe, expect, it } from "vitest";

import {
  calculateModelCost,
  filterByToolCalling,
  selectModel,
  type ModelPricing,
} from "./selector.js";
import type { TierConfig } from "./types.js";

const TIER_CONFIGS: Record<"SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING", TierConfig> = {
  SIMPLE: { primary: "groq/llama-3.3-70b-versatile", fallback: [] },
  MEDIUM: { primary: "anthropic/claude-sonnet-4-6-20260315", fallback: [] },
  COMPLEX: { primary: "anthropic/claude-opus-4-6-20260315", fallback: [] },
  REASONING: { primary: "anthropic/claude-opus-4-6-20260315", fallback: [] },
};

const MODEL_PRICING = new Map<string, ModelPricing>([
  ["groq/llama-3.3-70b-versatile", { inputPrice: 0.59, outputPrice: 0.79 }],
  ["anthropic/claude-sonnet-4-6-20260315", { inputPrice: 3, outputPrice: 15 }],
  ["anthropic/claude-opus-4-6-20260315", { inputPrice: 5, outputPrice: 25 }],
  ["anthropic/claude-opus-4.6", { inputPrice: 5, outputPrice: 25 }],
]);

describe("selectModel", () => {
  it("uses claude-opus-4.6 as baseline ID when computing savings", () => {
    const decision = selectModel(
      "SIMPLE",
      0.95,
      "rules",
      "test",
      TIER_CONFIGS,
      MODEL_PRICING,
      1000,
      1000,
    );

    expect(decision.baselineCost).toBeGreaterThan(0);
    expect(decision.savings).toBeGreaterThan(0);
  });

  it("selects the correct primary model for each tier", () => {
    const simple = selectModel("SIMPLE", 0.9, "rules", "test", TIER_CONFIGS, MODEL_PRICING, 100, 100);
    expect(simple.model).toBe("groq/llama-3.3-70b-versatile");

    const medium = selectModel("MEDIUM", 0.9, "rules", "test", TIER_CONFIGS, MODEL_PRICING, 100, 100);
    expect(medium.model).toBe("anthropic/claude-sonnet-4-6-20260315");

    const complex = selectModel("COMPLEX", 0.9, "rules", "test", TIER_CONFIGS, MODEL_PRICING, 100, 100);
    expect(complex.model).toBe("anthropic/claude-opus-4-6-20260315");
  });
});

describe("filterByToolCalling", () => {
  const supportsToolCalling = (modelId: string) =>
    !["nvidia/gpt-oss-120b"].includes(modelId);

  it("removes models without tool calling support when request has tools", () => {
    const models = ["groq/llama-3.3-70b-versatile", "nvidia/gpt-oss-120b", "anthropic/claude-sonnet-4-6-20260315"];
    const filtered = filterByToolCalling(models, true, supportsToolCalling);
    expect(filtered).toEqual(["groq/llama-3.3-70b-versatile", "anthropic/claude-sonnet-4-6-20260315"]);
  });

  it("keeps all models when request has no tools", () => {
    const models = ["groq/llama-3.3-70b-versatile", "nvidia/gpt-oss-120b"];
    const filtered = filterByToolCalling(models, false, supportsToolCalling);
    expect(filtered).toEqual(models);
  });

  it("returns original list unchanged when all models support tool calling", () => {
    const models = ["groq/llama-3.3-70b-versatile", "anthropic/claude-sonnet-4-6-20260315"];
    const filtered = filterByToolCalling(models, true, supportsToolCalling);
    expect(filtered).toEqual(models);
  });

  it("returns full list unchanged when no models support tool calling, to avoid empty chain", () => {
    const models = ["nvidia/gpt-oss-120b"];
    const filtered = filterByToolCalling(models, true, supportsToolCalling);
    expect(filtered).toEqual(models);
  });
});

describe("calculateModelCost", () => {
  it("uses claude-opus-4.6 as baseline ID when recomputing fallback costs", () => {
    const costs = calculateModelCost("groq/llama-3.3-70b-versatile", MODEL_PRICING, 1000, 1000);

    expect(costs.baselineCost).toBeGreaterThan(0);
    expect(costs.savings).toBeGreaterThan(0);
  });
});
