import { describe, expect, it } from "vitest";
import { translateAnthropicStream } from "./streaming-translator.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

interface SseEvent {
  event: string;
  data: unknown;
}

/** Build a raw Anthropic SSE string from a list of typed events. */
function makeAnthropicSSE(events: SseEvent[]): string {
  return events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}`)
    .join("\n\n") + "\n\n";
}

/** Wrap a raw SSE string in a Response whose body streams the bytes. */
function buildMockResponse(sseString: string, status = 200): Response {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(sseString);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * Read all SSE lines from a translated Response.
 * Returns the raw `data: …` payloads (without the `data: ` prefix).
 */
async function collectDataLines(response: Response): Promise<string[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
}

/** Parse all non-DONE data lines as JSON. */
async function collectChunks(response: Response): Promise<Record<string, unknown>[]> {
  const lines = await collectDataLines(response);
  return lines
    .filter((l) => l !== "[DONE]")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ── Canonical Anthropic event builders ───────────────────────────────────────

function messageStartEvent(id = "msg_test_01", model = "claude-test") {
  return {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id,
        model,
        role: "assistant",
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
  };
}

function pingEvent() {
  return { event: "ping", data: { type: "ping" } };
}

function textBlockStartEvent(index = 0) {
  return {
    event: "content_block_start",
    data: {
      type: "content_block_start",
      index,
      content_block: { type: "text", text: "" },
    },
  };
}

function textDeltaEvent(index: number, text: string) {
  return {
    event: "content_block_delta",
    data: {
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text },
    },
  };
}

function contentBlockStopEvent(index: number) {
  return {
    event: "content_block_stop",
    data: { type: "content_block_stop", index },
  };
}

function toolBlockStartEvent(index: number, id: string, name: string) {
  return {
    event: "content_block_start",
    data: {
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id, name, input: {} },
    },
  };
}

function inputJsonDeltaEvent(index: number, partialJson: string) {
  return {
    event: "content_block_delta",
    data: {
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: partialJson },
    },
  };
}

function messageDeltaEvent(stopReason: string, outputTokens = 20) {
  return {
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens },
    },
  };
}

function messageStopEvent() {
  return { event: "message_stop", data: { type: "message_stop" } };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("translateAnthropicStream", () => {
  it("returns response as-is when body is null", async () => {
    const emptyResponse = new Response(null, { status: 500 });
    const result = translateAnthropicStream(emptyResponse);
    expect(result.status).toBe(500);
  });

  it("text-only streaming: emits initial role chunk, content deltas, finish chunk, and [DONE]", async () => {
    const sse = makeAnthropicSSE([
      messageStartEvent("msg_001", "claude-test"),
      pingEvent(),
      textBlockStartEvent(0),
      textDeltaEvent(0, "Hello"),
      textDeltaEvent(0, ", world"),
      contentBlockStopEvent(0),
      messageDeltaEvent("end_turn", 5),
      messageStopEvent(),
    ]);

    const translated = translateAnthropicStream(buildMockResponse(sse));

    expect(translated.headers.get("Content-Type")).toBe("text/event-stream");

    const chunks = await collectChunks(translated);
    const dataLines = await collectDataLines(buildMockResponse(sse).clone
      ? buildMockResponse(sse)
      : translated);

    // Re-run on fresh response since we consumed the body above
    const translated2 = translateAnthropicStream(buildMockResponse(sse));
    const allLines = await collectDataLines(translated2);

    expect(allLines.at(-1)).toBe("[DONE]");

    const parsed = allLines
      .filter((l) => l !== "[DONE]")
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    // First chunk has role
    const firstChunk = parsed[0];
    expect(firstChunk.object).toBe("chat.completion.chunk");
    expect(firstChunk.id).toBe("msg_001");
    expect(firstChunk.model).toBe("claude-test");
    const firstChoices = firstChunk.choices as Array<Record<string, unknown>>;
    expect((firstChoices[0].delta as Record<string, unknown>).role).toBe("assistant");

    // Content delta chunks
    const textChunks = parsed.filter((c) => {
      const choices = c.choices as Array<Record<string, unknown>>;
      const delta = choices[0].delta as Record<string, unknown>;
      return typeof delta.content === "string" && delta.content !== "";
    });
    const combined = textChunks
      .map((c) => {
        const choices = c.choices as Array<Record<string, unknown>>;
        const delta = choices[0].delta as Record<string, unknown>;
        return delta.content as string;
      })
      .join("");
    expect(combined).toBe("Hello, world");

    // Finish reason chunk
    const finishChunk = parsed.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>>;
      return choices[0].finish_reason !== null;
    });
    expect(finishChunk).toBeDefined();
    const finishChoices = (finishChunk as Record<string, unknown>).choices as Array<Record<string, unknown>>;
    expect(finishChoices[0].finish_reason).toBe("stop");
  });

  it("tool use streaming: emits tool call start chunk with id/type/name, then argument deltas", async () => {
    const sse = makeAnthropicSSE([
      messageStartEvent("msg_002", "claude-test"),
      toolBlockStartEvent(0, "toolu_abc", "get_weather"),
      inputJsonDeltaEvent(0, '{"locat'),
      inputJsonDeltaEvent(0, 'ion": "NYC"}'),
      contentBlockStopEvent(0),
      messageDeltaEvent("tool_use", 10),
      messageStopEvent(),
    ]);

    const translated = translateAnthropicStream(buildMockResponse(sse));
    const allLines = await collectDataLines(translated);

    expect(allLines.at(-1)).toBe("[DONE]");

    const parsed = allLines
      .filter((l) => l !== "[DONE]")
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    // Find the chunk with tool call id/type/name (the first tool chunk)
    const firstToolChunk = parsed.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>>;
      const delta = choices[0].delta as Record<string, unknown>;
      const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (!toolCalls) return false;
      return toolCalls[0].id === "toolu_abc";
    });

    expect(firstToolChunk).toBeDefined();
    const ftChoices = (firstToolChunk as Record<string, unknown>).choices as Array<Record<string, unknown>>;
    const ftDelta = ftChoices[0].delta as Record<string, unknown>;
    const ftToolCalls = ftDelta.tool_calls as Array<Record<string, unknown>>;
    expect(ftToolCalls[0].index).toBe(0);
    expect(ftToolCalls[0].type).toBe("function");
    const ftFn = ftToolCalls[0].function as Record<string, unknown>;
    expect(ftFn.name).toBe("get_weather");

    // Argument delta chunks should NOT repeat id/type/name
    const argChunks = parsed.filter((c) => {
      const choices = c.choices as Array<Record<string, unknown>>;
      const delta = choices[0].delta as Record<string, unknown>;
      const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (!toolCalls) return false;
      const fn = toolCalls[0].function as Record<string, unknown>;
      return typeof fn.arguments === "string" && fn.arguments.length > 0;
    });
    expect(argChunks.length).toBeGreaterThan(0);

    const combinedArgs = argChunks
      .map((c) => {
        const choices = c.choices as Array<Record<string, unknown>>;
        const delta = choices[0].delta as Record<string, unknown>;
        const toolCalls = delta.tool_calls as Array<Record<string, unknown>>;
        const fn = toolCalls[0].function as Record<string, unknown>;
        return fn.arguments as string;
      })
      .join("");
    expect(combinedArgs).toBe('{"locat' + 'ion": "NYC"}');

    // Finish reason should be tool_calls
    const finishChunk = parsed.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>>;
      return choices[0].finish_reason !== null;
    });
    const finishChoices = (finishChunk as Record<string, unknown>).choices as Array<Record<string, unknown>>;
    expect(finishChoices[0].finish_reason).toBe("tool_calls");
  });

  it("mixed content: emits text deltas and tool call deltas in correct order", async () => {
    const sse = makeAnthropicSSE([
      messageStartEvent("msg_003", "claude-test"),
      textBlockStartEvent(0),
      textDeltaEvent(0, "Let me check."),
      contentBlockStopEvent(0),
      toolBlockStartEvent(1, "toolu_xyz", "search"),
      inputJsonDeltaEvent(1, '{"q": "ts"}'),
      contentBlockStopEvent(1),
      messageDeltaEvent("tool_use", 15),
      messageStopEvent(),
    ]);

    const translated = translateAnthropicStream(buildMockResponse(sse));
    const allLines = await collectDataLines(translated);
    const parsed = allLines
      .filter((l) => l !== "[DONE]")
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    // Verify text content appears
    const hasText = parsed.some((c) => {
      const choices = c.choices as Array<Record<string, unknown>>;
      const delta = choices[0].delta as Record<string, unknown>;
      return delta.content === "Let me check.";
    });
    expect(hasText).toBe(true);

    // Verify tool call appears with index 1
    const hasToolCall = parsed.some((c) => {
      const choices = c.choices as Array<Record<string, unknown>>;
      const delta = choices[0].delta as Record<string, unknown>;
      const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      return toolCalls?.[0]?.index === 1;
    });
    expect(hasToolCall).toBe(true);
  });

  it("stop reason mapping: end_turn → stop", async () => {
    const sse = makeAnthropicSSE([
      messageStartEvent(),
      messageDeltaEvent("end_turn"),
      messageStopEvent(),
    ]);
    const translated = translateAnthropicStream(buildMockResponse(sse));
    const chunks = await collectChunks(translated);
    const finishChunk = chunks.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>>;
      return choices[0].finish_reason !== null;
    });
    const choices = (finishChunk as Record<string, unknown>).choices as Array<Record<string, unknown>>;
    expect(choices[0].finish_reason).toBe("stop");
  });

  it("stop reason mapping: tool_use → tool_calls", async () => {
    const sse = makeAnthropicSSE([
      messageStartEvent(),
      messageDeltaEvent("tool_use"),
      messageStopEvent(),
    ]);
    const translated = translateAnthropicStream(buildMockResponse(sse));
    const chunks = await collectChunks(translated);
    const finishChunk = chunks.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>>;
      return choices[0].finish_reason !== null;
    });
    const choices = (finishChunk as Record<string, unknown>).choices as Array<Record<string, unknown>>;
    expect(choices[0].finish_reason).toBe("tool_calls");
  });

  it("stop reason mapping: max_tokens → length", async () => {
    const sse = makeAnthropicSSE([
      messageStartEvent(),
      messageDeltaEvent("max_tokens"),
      messageStopEvent(),
    ]);
    const translated = translateAnthropicStream(buildMockResponse(sse));
    const chunks = await collectChunks(translated);
    const finishChunk = chunks.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>>;
      return choices[0].finish_reason !== null;
    });
    const choices = (finishChunk as Record<string, unknown>).choices as Array<Record<string, unknown>>;
    expect(choices[0].finish_reason).toBe("length");
  });

  it("ping events are ignored — produce no output chunks", async () => {
    const sse = makeAnthropicSSE([
      pingEvent(),
      pingEvent(),
      pingEvent(),
      messageStartEvent(),
      messageStopEvent(),
    ]);
    const translated = translateAnthropicStream(buildMockResponse(sse));
    const allLines = await collectDataLines(translated);

    // Should only have the initial role chunk and [DONE] — no ping chunks
    const pingLines = allLines.filter((l) => l.includes('"type":"ping"'));
    expect(pingLines).toHaveLength(0);
  });

  it("usage tokens are included in the message_delta chunk", async () => {
    const sse = makeAnthropicSSE([
      messageStartEvent("msg_tokens", "claude-test"),
      messageDeltaEvent("end_turn", 42),
      messageStopEvent(),
    ]);
    const translated = translateAnthropicStream(buildMockResponse(sse));
    const chunks = await collectChunks(translated);

    const usageChunk = chunks.find((c) => c.usage !== undefined);
    expect(usageChunk).toBeDefined();
    const usage = (usageChunk as Record<string, unknown>).usage as Record<string, number>;
    expect(usage.completion_tokens).toBe(42);
    expect(usage.prompt_tokens).toBe(10); // from messageStartEvent default
    expect(usage.total_tokens).toBe(52);
  });

  it("[DONE] is the last data line", async () => {
    const sse = makeAnthropicSSE([
      messageStartEvent(),
      textBlockStartEvent(0),
      textDeltaEvent(0, "hi"),
      contentBlockStopEvent(0),
      messageDeltaEvent("end_turn"),
      messageStopEvent(),
    ]);
    const translated = translateAnthropicStream(buildMockResponse(sse));
    const allLines = await collectDataLines(translated);
    expect(allLines.at(-1)).toBe("[DONE]");
  });
});
