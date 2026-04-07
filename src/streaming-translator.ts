/**
 * Anthropic SSE → OpenAI SSE Streaming Translator
 *
 * Reads Anthropic Messages API server-sent events from a streaming response
 * and re-emits them in OpenAI chat.completion.chunk format.
 *
 * Anthropic event reference:
 *   https://docs.anthropic.com/en/api/messages-streaming
 */

// ── Anthropic event types ────────────────────────────────────────────────────

interface AnthropicMessageStart {
  type: "message_start";
  message: {
    id: string;
    model: string;
    role: string;
    usage?: { input_tokens: number; output_tokens: number };
  };
}

interface AnthropicContentBlockStartText {
  type: "content_block_start";
  index: number;
  content_block: { type: "text"; text: string };
}

interface AnthropicContentBlockStartToolUse {
  type: "content_block_start";
  index: number;
  content_block: { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
}

type AnthropicContentBlockStart =
  | AnthropicContentBlockStartText
  | AnthropicContentBlockStartToolUse;

interface AnthropicContentBlockDeltaText {
  type: "content_block_delta";
  index: number;
  delta: { type: "text_delta"; text: string };
}

interface AnthropicContentBlockDeltaInputJson {
  type: "content_block_delta";
  index: number;
  delta: { type: "input_json_delta"; partial_json: string };
}

type AnthropicContentBlockDelta =
  | AnthropicContentBlockDeltaText
  | AnthropicContentBlockDeltaInputJson;

interface AnthropicContentBlockStop {
  type: "content_block_stop";
  index: number;
}

interface AnthropicMessageDelta {
  type: "message_delta";
  delta: { stop_reason: string; stop_sequence: string | null };
  usage?: { output_tokens: number };
}

interface AnthropicMessageStop {
  type: "message_stop";
}

interface AnthropicPing {
  type: "ping";
}

type AnthropicEvent =
  | AnthropicMessageStart
  | AnthropicContentBlockStart
  | AnthropicContentBlockDelta
  | AnthropicContentBlockStop
  | AnthropicMessageDelta
  | AnthropicMessageStop
  | AnthropicPing;

// ── OpenAI chunk types ────────────────────────────────────────────────────────

interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function: {
    name?: string;
    arguments: string;
  };
}

interface OpenAIDelta {
  role?: "assistant";
  content?: string | null;
  tool_calls?: OpenAIToolCallDelta[];
}

interface OpenAIChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: OpenAIDelta;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Translator state ──────────────────────────────────────────────────────────

interface TranslatorState {
  messageId: string;
  model: string;
  created: number;
  inputTokens: number;
  /** Tracks which tool-block indices have already had their id/type/name emitted. */
  toolBlockStarted: Set<number>;
  /** Maps Anthropic content-block index → 0-based OpenAI tool_calls index. */
  toolIndexMap: Map<number, number>;
  /** Next sequential tool call index to assign. */
  nextToolIndex: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapStopReason(anthropicReason: string): string {
  if (anthropicReason === "end_turn") return "stop";
  if (anthropicReason === "tool_use") return "tool_calls";
  if (anthropicReason === "max_tokens") return "length";
  return "stop";
}

function sseChunk(data: string): string {
  return `data: ${data}\n\n`;
}

function buildChunk(state: TranslatorState, delta: OpenAIDelta, finishReason: string | null = null): string {
  const chunk: OpenAIChunk = {
    id: state.messageId,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return sseChunk(JSON.stringify(chunk));
}

/**
 * Parse a single SSE event block (the text between two `\n\n` separators).
 * Returns `{ eventType, data }` or `null` if the block is not a valid event.
 */
function parseSseBlock(block: string): { eventType: string; data: string } | null {
  let eventType = "message";
  let data = "";

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data = line.slice("data:".length).trim();
    }
  }

  if (!data) return null;
  return { eventType, data };
}

/**
 * Translate a single parsed Anthropic SSE event into zero or more OpenAI SSE
 * lines. Mutates `state` in place.
 */
function translateEvent(
  eventType: string,
  rawData: string,
  state: TranslatorState,
): string[] {
  let event: AnthropicEvent;
  try {
    event = JSON.parse(rawData) as AnthropicEvent;
  } catch {
    return [];
  }

  // Normalise: Anthropic puts the event type in the JSON object AND as the
  // SSE `event:` field. Use the JSON `type` field as the canonical source.
  const evType = event.type ?? eventType;

  switch (evType) {
    case "ping":
      return [];

    case "message_start": {
      const e = event as AnthropicMessageStart;
      state.messageId = e.message.id;
      state.model = e.message.model;
      state.inputTokens = e.message.usage?.input_tokens ?? 0;
      // Emit initial chunk with role
      return [buildChunk(state, { role: "assistant", content: "" })];
    }

    case "content_block_start": {
      const e = event as AnthropicContentBlockStart;
      if (e.content_block.type === "tool_use") {
        const block = e.content_block;
        state.toolBlockStarted.add(e.index);
        // Assign a sequential 0-based tool index for the OpenAI tool_calls array
        const toolIdx = state.nextToolIndex++;
        state.toolIndexMap.set(e.index, toolIdx);
        const toolDelta: OpenAIToolCallDelta = {
          index: toolIdx,
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: "" },
        };
        return [buildChunk(state, { tool_calls: [toolDelta] })];
      }
      // text block start — no output needed
      return [];
    }

    case "content_block_delta": {
      const e = event as AnthropicContentBlockDelta;
      if (e.delta.type === "text_delta") {
        return [buildChunk(state, { content: e.delta.text })];
      }
      if (e.delta.type === "input_json_delta") {
        const toolIdx = state.toolIndexMap.get(e.index) ?? e.index;
        const toolDelta: OpenAIToolCallDelta = {
          index: toolIdx,
          function: { arguments: e.delta.partial_json },
        };
        return [buildChunk(state, { tool_calls: [toolDelta] })];
      }
      return [];
    }

    case "content_block_stop":
      return [];

    case "message_delta": {
      const e = event as AnthropicMessageDelta;
      const finishReason = mapStopReason(e.delta.stop_reason);
      const outputTokens = e.usage?.output_tokens ?? 0;
      const chunk: OpenAIChunk = {
        id: state.messageId,
        object: "chat.completion.chunk",
        created: state.created,
        model: state.model,
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
        usage: {
          prompt_tokens: state.inputTokens,
          completion_tokens: outputTokens,
          total_tokens: state.inputTokens + outputTokens,
        },
      };
      return [sseChunk(JSON.stringify(chunk))];
    }

    case "message_stop":
      return ["data: [DONE]\n\n"];

    default:
      return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wrap an Anthropic streaming `Response` and return a new `Response` whose
 * body emits OpenAI-compatible `chat.completion.chunk` SSE events.
 */
export function translateAnthropicStream(response: Response): Response {
  const sourceBody = response.body;
  if (!sourceBody) {
    // No body — return as-is (error responses, etc.)
    return response;
  }

  const state: TranslatorState = {
    messageId: `chatcmpl-${Date.now()}`,
    model: "unknown",
    created: Math.floor(Date.now() / 1000),
    inputTokens: 0,
    toolBlockStarted: new Set(),
    toolIndexMap: new Map(),
    nextToolIndex: 0,
  };

  const decoder = new TextDecoder();
  let buffer = "";

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = sourceBody.getReader();
      const encoder = new TextEncoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE events are delimited by double newlines
          const blocks = buffer.split("\n\n");
          // Keep the last (potentially incomplete) block in the buffer
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            const trimmed = block.trim();
            if (!trimmed) continue;

            const parsed = parseSseBlock(trimmed);
            if (!parsed) continue;

            const lines = translateEvent(parsed.eventType, parsed.data, state);
            for (const line of lines) {
              controller.enqueue(encoder.encode(line));
            }
          }
        }

        // Flush any remaining buffer content
        const remaining = buffer.trim();
        if (remaining) {
          const parsed = parseSseBlock(remaining);
          if (parsed) {
            const lines = translateEvent(parsed.eventType, parsed.data, state);
            for (const line of lines) {
              controller.enqueue(encoder.encode(line));
            }
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    status: response.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
