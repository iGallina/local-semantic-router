import { describe, expect, it } from "vitest";
import {
  translateToolsToAnthropic,
  translateToolChoiceToAnthropic,
  translateToolCallsFromAnthropic,
  translateMessagesToAnthropic,
} from "./tools-translator.js";

describe("translateToolsToAnthropic", () => {
  it("converts OpenAI function tool to Anthropic custom tool", () => {
    const input = [
      {
        type: "function" as const,
        function: {
          name: "get_weather",
          description: "Get weather for a location",
          parameters: {
            type: "object",
            properties: { location: { type: "string" } },
          },
        },
      },
    ];
    const output = translateToolsToAnthropic(input);
    expect(output).toEqual([
      {
        type: "custom",
        name: "get_weather",
        description: "Get weather for a location",
        input_schema: {
          type: "object",
          properties: { location: { type: "string" } },
        },
      },
    ]);
  });

  it("returns empty array for empty tools", () => {
    expect(translateToolsToAnthropic([])).toEqual([]);
  });

  it("converts multiple tools", () => {
    const input = [
      {
        type: "function" as const,
        function: {
          name: "tool_a",
          description: "Tool A",
          parameters: { type: "object", properties: {} },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "tool_b",
          description: "Tool B",
          parameters: { type: "object", properties: { x: { type: "number" } } },
        },
      },
    ];
    const output = translateToolsToAnthropic(input);
    expect(output).toHaveLength(2);
    expect(output[0].name).toBe("tool_a");
    expect(output[1].name).toBe("tool_b");
    expect(output[0].type).toBe("custom");
    expect(output[1].type).toBe("custom");
  });

  it("handles tool without description", () => {
    const input = [
      {
        type: "function" as const,
        function: {
          name: "no_desc",
          parameters: { type: "object", properties: {} },
        },
      },
    ];
    const output = translateToolsToAnthropic(input);
    expect(output[0].name).toBe("no_desc");
    expect(output[0].description).toBeUndefined();
  });

  it("ensures type: object when parameters omit it", () => {
    const input = [
      {
        type: "function" as const,
        function: {
          name: "read",
          description: "Read a file",
          parameters: {
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      },
    ];
    const output = translateToolsToAnthropic(input);
    expect(output[0].input_schema).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    });
  });

  it("provides default input_schema when parameters is undefined", () => {
    const input = [
      {
        type: "function" as const,
        function: {
          name: "no_params",
          description: "A tool with no parameters",
        },
      },
    ];
    const output = translateToolsToAnthropic(input);
    expect(output[0].input_schema).toEqual({
      type: "object",
      properties: {},
      required: [],
    });
  });
});

describe("translateToolChoiceToAnthropic", () => {
  it('maps "auto" to { type: "auto" }', () => {
    expect(translateToolChoiceToAnthropic("auto")).toEqual({ type: "auto" });
  });

  it('maps "none" to { type: "none" }', () => {
    expect(translateToolChoiceToAnthropic("none")).toEqual({ type: "none" });
  });

  it("maps function choice to { type: tool, name }", () => {
    const input = { type: "function" as const, function: { name: "get_weather" } };
    expect(translateToolChoiceToAnthropic(input)).toEqual({
      type: "tool",
      name: "get_weather",
    });
  });

  it("returns undefined for undefined input", () => {
    expect(translateToolChoiceToAnthropic(undefined)).toBeUndefined();
  });

  it('maps "required" to { type: "any" }', () => {
    expect(translateToolChoiceToAnthropic("required")).toEqual({ type: "any" });
  });
});

describe("translateToolCallsFromAnthropic", () => {
  it("translates tool_use content blocks to OpenAI tool_calls", () => {
    const anthropicContent = [
      { type: "text", text: "I will check the weather." },
      {
        type: "tool_use",
        id: "toolu_01A",
        name: "get_weather",
        input: { location: "San Francisco" },
      },
    ];
    const result = translateToolCallsFromAnthropic(anthropicContent);
    expect(result).toEqual([
      {
        id: "toolu_01A",
        type: "function",
        function: {
          name: "get_weather",
          arguments: JSON.stringify({ location: "San Francisco" }),
        },
      },
    ]);
  });

  it("returns empty array when no tool_use blocks", () => {
    const content = [{ type: "text", text: "Just text" }];
    expect(translateToolCallsFromAnthropic(content)).toEqual([]);
  });

  it("handles multiple tool_use blocks", () => {
    const content = [
      { type: "tool_use", id: "t1", name: "a", input: {} },
      { type: "text", text: "middle" },
      { type: "tool_use", id: "t2", name: "b", input: { x: 1 } },
    ];
    const result = translateToolCallsFromAnthropic(content);
    expect(result).toHaveLength(2);
    expect(result[0].function.name).toBe("a");
    expect(result[1].function.name).toBe("b");
  });

  it("returns empty array for empty content", () => {
    expect(translateToolCallsFromAnthropic([])).toEqual([]);
  });

  it("skips tool_use blocks with non-string id or name", () => {
    const content = [
      { type: "tool_use", id: null, name: "a", input: {} },
      { type: "tool_use", id: "t1", name: null, input: {} },
      { type: "tool_use", id: "t2", name: "valid", input: { x: 1 } },
    ];
    const result = translateToolCallsFromAnthropic(content);
    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe("valid");
  });
});

describe("translateMessagesToAnthropic", () => {
  it("passes through regular user and assistant messages", () => {
    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];
    const result = translateMessagesToAnthropic(messages);
    expect(result).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
  });

  it("translates assistant messages with tool_calls to Anthropic tool_use blocks", () => {
    const messages = [
      {
        role: "assistant",
        content: "Let me check.",
        tool_calls: [
          {
            id: "toolu_01",
            type: "function" as const,
            function: { name: "get_weather", arguments: '{"location":"NYC"}' },
          },
        ],
      },
    ];
    const result = translateMessagesToAnthropic(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");

    const content = result[0].content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "Let me check." });
    expect(content[1]).toEqual({
      type: "tool_use",
      id: "toolu_01",
      name: "get_weather",
      input: { location: "NYC" },
    });
  });

  it("translates tool role messages to Anthropic tool_result in user messages", () => {
    const messages = [
      {
        role: "tool",
        tool_call_id: "toolu_01",
        content: "72°F and sunny",
      },
    ];
    const result = translateMessagesToAnthropic(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");

    const content = result[0].content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_01",
      content: "72°F and sunny",
    });
  });

  it("merges consecutive tool results into a single user message", () => {
    const messages = [
      { role: "tool", tool_call_id: "t1", content: "result 1" },
      { role: "tool", tool_call_id: "t2", content: "result 2" },
    ];
    const result = translateMessagesToAnthropic(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");

    const content = result[0].content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0].tool_use_id).toBe("t1");
    expect(content[1].tool_use_id).toBe("t2");
  });

  it("handles full multi-turn tool conversation", () => {
    const messages = [
      { role: "user", content: "What's the weather in NYC and LA?" },
      {
        role: "assistant",
        content: "I'll check both.",
        tool_calls: [
          { id: "t1", type: "function" as const, function: { name: "get_weather", arguments: '{"location":"NYC"}' } },
          { id: "t2", type: "function" as const, function: { name: "get_weather", arguments: '{"location":"LA"}' } },
        ],
      },
      { role: "tool", tool_call_id: "t1", content: "72°F" },
      { role: "tool", tool_call_id: "t2", content: "85°F" },
    ];
    const result = translateMessagesToAnthropic(messages);

    expect(result).toHaveLength(3); // user, assistant, user(tool_results)
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("user");

    // Assistant should have text + 2 tool_use blocks
    const assistantContent = result[1].content as Array<Record<string, unknown>>;
    expect(assistantContent).toHaveLength(3);
    expect(assistantContent[0].type).toBe("text");
    expect(assistantContent[1].type).toBe("tool_use");
    expect(assistantContent[2].type).toBe("tool_use");

    // Tool results should be merged
    const toolResults = result[2].content as Array<Record<string, unknown>>;
    expect(toolResults).toHaveLength(2);
  });

  it("handles assistant tool_calls with no text content", () => {
    const messages = [
      {
        role: "assistant",
        tool_calls: [
          { id: "t1", type: "function" as const, function: { name: "do_thing", arguments: "{}" } },
        ],
      },
    ];
    const result = translateMessagesToAnthropic(messages);
    const content = result[0].content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("tool_use");
  });
});
