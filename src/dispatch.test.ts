import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseProviderModel } from "./dispatch.js";

describe("parseProviderModel", () => {
  it("parses provider/model format", () => {
    const result = parseProviderModel("anthropic/claude-sonnet-4-6-20260315");
    expect(result.providerName).toBe("anthropic");
    expect(result.modelId).toBe("claude-sonnet-4-6-20260315");
  });

  it("handles model with no slash", () => {
    const result = parseProviderModel("auto");
    expect(result.providerName).toBe("auto");
    expect(result.modelId).toBe("auto");
  });

  it("handles model with multiple slashes", () => {
    const result = parseProviderModel("provider/org/model-name");
    expect(result.providerName).toBe("provider");
    expect(result.modelId).toBe("org/model-name");
  });
});

describe("dispatchRequest headers", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("includes correct Authorization header for OpenAI-compatible providers", async () => {
    let capturedHeaders: Record<string, string> = {};

    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    });

    const { dispatchRequest } = await import("./dispatch.js");

    const config = {
      port: 8402,
      bind: "127.0.0.1",
      routing_profile: "auto" as const,
      providers: {
        groq: {
          api: "openai-completions" as const,
          base_url: "https://api.groq.com/openai/v1",
          api_key: "sk-test-key-12345",
          models: [{ id: "test-model" }],
        },
      },
      tiers: { auto: { simple: { primary: "groq/test-model" }, medium: { primary: "groq/test-model" }, complex: { primary: "groq/test-model" }, reasoning: { primary: "groq/test-model" } } },
      fallback_classifier: { enabled: false },
    };

    await dispatchRequest(
      "groq/test-model",
      Buffer.from(JSON.stringify({ model: "test-model", messages: [] })),
      config as any,
    );

    expect(capturedHeaders["Authorization"]).toBe("Bearer sk-test-key-12345");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });

  it("includes correct x-api-key and anthropic-version headers for Anthropic", async () => {
    let capturedHeaders: Record<string, string> = {};

    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify({ content: [] }), { status: 200 }));
    });

    const { dispatchRequest } = await import("./dispatch.js");

    const config = {
      port: 8402,
      bind: "127.0.0.1",
      routing_profile: "auto" as const,
      providers: {
        anthropic: {
          api: "anthropic-messages" as const,
          base_url: "https://api.anthropic.com/v1",
          api_key: "sk-ant-test-key",
          models: [{ id: "claude-sonnet-4-6-20260315" }],
        },
      },
      tiers: { auto: { simple: { primary: "anthropic/claude-sonnet-4-6-20260315" }, medium: { primary: "anthropic/claude-sonnet-4-6-20260315" }, complex: { primary: "anthropic/claude-sonnet-4-6-20260315" }, reasoning: { primary: "anthropic/claude-sonnet-4-6-20260315" } } },
      fallback_classifier: { enabled: false },
    };

    await dispatchRequest(
      "anthropic/claude-sonnet-4-6-20260315",
      Buffer.from(JSON.stringify({ model: "claude-sonnet-4-6-20260315", messages: [{ role: "user", content: "hello" }] })),
      config as any,
    );

    expect(capturedHeaders["x-api-key"]).toBe("sk-ant-test-key");
    expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });

  it("translates OpenAI tools to Anthropic format when dispatching to Anthropic", async () => {
    let capturedBody: Record<string, unknown> = {};

    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "msg_123",
            content: [{ type: "text", text: "hello" }],
            model: "claude-sonnet-4-6-20260315",
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });

    const { dispatchRequest } = await import("./dispatch.js");

    const config = {
      port: 8402,
      bind: "127.0.0.1",
      routing_profile: "auto" as const,
      providers: {
        anthropic: {
          api: "anthropic-messages" as const,
          base_url: "https://api.anthropic.com/v1",
          api_key: "sk-ant-test",
          models: [{ id: "claude-sonnet-4-6-20260315" }],
        },
      },
      tiers: { auto: { simple: { primary: "anthropic/claude-sonnet-4-6-20260315" }, medium: { primary: "anthropic/claude-sonnet-4-6-20260315" }, complex: { primary: "anthropic/claude-sonnet-4-6-20260315" }, reasoning: { primary: "anthropic/claude-sonnet-4-6-20260315" } } },
      fallback_classifier: { enabled: false },
    };

    const requestBody = {
      model: "claude-sonnet-4-6-20260315",
      messages: [{ role: "user", content: "What is the weather?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: { location: { type: "string" } } },
          },
        },
      ],
      tool_choice: "auto",
    };

    await dispatchRequest(
      "anthropic/claude-sonnet-4-6-20260315",
      Buffer.from(JSON.stringify(requestBody)),
      config as any,
    );

    // Verify tools were translated to Anthropic format
    const tools = capturedBody.tools as Array<Record<string, unknown>>;
    expect(tools[0].type).toBe("custom");
    expect(tools[0].name).toBe("get_weather");
    expect(tools[0].input_schema).toEqual({
      type: "object",
      properties: { location: { type: "string" } },
    });

    // Verify tool_choice was translated
    expect(capturedBody.tool_choice).toEqual({ type: "auto" });
  });

  it("translates Anthropic tool_use response back to OpenAI tool_calls format", async () => {
    global.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "msg_abc",
            content: [
              { type: "text", text: "Let me check." },
              {
                type: "tool_use",
                id: "toolu_01",
                name: "get_weather",
                input: { location: "NYC" },
              },
            ],
            model: "claude-sonnet-4-6-20260315",
            stop_reason: "tool_use",
            usage: { input_tokens: 20, output_tokens: 15 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });

    const { dispatchRequest } = await import("./dispatch.js");

    const config = {
      port: 8402,
      bind: "127.0.0.1",
      routing_profile: "auto" as const,
      providers: {
        anthropic: {
          api: "anthropic-messages" as const,
          base_url: "https://api.anthropic.com/v1",
          api_key: "sk-ant-test",
          models: [{ id: "claude-sonnet-4-6-20260315" }],
        },
      },
      tiers: { auto: { simple: { primary: "anthropic/claude-sonnet-4-6-20260315" }, medium: { primary: "anthropic/claude-sonnet-4-6-20260315" }, complex: { primary: "anthropic/claude-sonnet-4-6-20260315" }, reasoning: { primary: "anthropic/claude-sonnet-4-6-20260315" } } },
      fallback_classifier: { enabled: false },
    };

    const response = await dispatchRequest(
      "anthropic/claude-sonnet-4-6-20260315",
      Buffer.from(JSON.stringify({
        model: "claude-sonnet-4-6-20260315",
        messages: [{ role: "user", content: "weather?" }],
        tools: [{ type: "function", function: { name: "get_weather", parameters: {} } }],
      })),
      config as any,
    );

    const result = await response.json() as Record<string, unknown>;

    // Should be in OpenAI format
    expect(result.object).toBe("chat.completion");
    const choices = result.choices as Array<Record<string, unknown>>;
    const message = choices[0].message as Record<string, unknown>;
    expect(message.content).toBe("Let me check.");
    expect(choices[0].finish_reason).toBe("tool_calls");

    const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].id).toBe("toolu_01");
    const fn = toolCalls[0].function as Record<string, unknown>;
    expect(fn.name).toBe("get_weather");
    expect(fn.arguments).toBe(JSON.stringify({ location: "NYC" }));

    // Usage should be translated
    const usage = result.usage as Record<string, number>;
    expect(usage.prompt_tokens).toBe(20);
    expect(usage.completion_tokens).toBe(15);
    expect(usage.total_tokens).toBe(35);
  });

  it("does NOT translate tools for OpenAI-compatible providers", async () => {
    let capturedBody: Record<string, unknown> = {};

    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return Promise.resolve(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    });

    const { dispatchRequest } = await import("./dispatch.js");

    const config = {
      port: 8402,
      bind: "127.0.0.1",
      routing_profile: "auto" as const,
      providers: {
        groq: {
          api: "openai-completions" as const,
          base_url: "https://api.groq.com/openai/v1",
          api_key: "sk-groq-test",
          models: [{ id: "test-model" }],
        },
      },
      tiers: { auto: { simple: { primary: "groq/test-model" }, medium: { primary: "groq/test-model" }, complex: { primary: "groq/test-model" }, reasoning: { primary: "groq/test-model" } } },
      fallback_classifier: { enabled: false },
    };

    await dispatchRequest(
      "groq/test-model",
      Buffer.from(JSON.stringify({
        model: "test-model",
        messages: [],
        tools: [{ type: "function", function: { name: "my_tool", parameters: {} } }],
      })),
      config as any,
    );

    // Tools should remain in OpenAI format (not translated)
    const tools = capturedBody.tools as Array<Record<string, unknown>>;
    expect(tools[0].type).toBe("function");
  });

  it("API keys never appear in error messages (SEC-1)", async () => {
    global.fetch = vi.fn().mockImplementation(() => {
      throw new Error("Connection refused");
    });

    const { dispatchRequest } = await import("./dispatch.js");

    const config = {
      port: 8402,
      bind: "127.0.0.1",
      routing_profile: "auto" as const,
      providers: {
        groq: {
          api: "openai-completions" as const,
          base_url: "https://api.groq.com/openai/v1",
          api_key: "sk-secret-key-do-not-leak",
          models: [{ id: "test-model" }],
        },
      },
      tiers: { auto: { simple: { primary: "groq/test-model" }, medium: { primary: "groq/test-model" }, complex: { primary: "groq/test-model" }, reasoning: { primary: "groq/test-model" } } },
      fallback_classifier: { enabled: false },
    };

    try {
      await dispatchRequest(
        "groq/test-model",
        Buffer.from(JSON.stringify({ model: "test-model", messages: [] })),
        config as any,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      expect(errorMsg).not.toContain("sk-secret-key-do-not-leak");
    }
  });
});
