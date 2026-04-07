/**
 * Tools Format Translation — OpenAI ↔ Anthropic
 *
 * Translates tool definitions, tool_choice, and tool_call responses
 * between OpenAI function-calling format and Anthropic native format.
 *
 * Only applied when the downstream provider is Anthropic.
 */

// ── OpenAI types (input from proxy) ──────────────────────────────

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type OpenAIToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

// ── Anthropic types (output to API) ──────────────────────────────

export interface AnthropicTool {
  type: "custom";
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "none" }
  | { type: "any" }
  | { type: "tool"; name: string };

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function safeParseJson(json: string | undefined): Record<string, unknown> {
  try {
    return JSON.parse(json || "{}");
  } catch {
    return {};
  }
}

// ── Translation functions ────────────────────────────────────────

/**
 * Translate OpenAI function tools → Anthropic custom tools.
 */
export function translateToolsToAnthropic(tools: OpenAITool[]): AnthropicTool[] {
  return tools.map((t) => {
    // Anthropic requires input_schema to be a valid JSON Schema with type: "object".
    // OpenAI parameters may omit "type" or be undefined entirely.
    const params = t.function.parameters;
    const inputSchema: Record<string, unknown> = params && typeof params === "object"
      ? { type: "object", ...params }
      : { type: "object", properties: {}, required: [] };

    const result: AnthropicTool = {
      type: "custom",
      name: t.function.name,
      input_schema: inputSchema,
    };
    if (t.function.description !== undefined) {
      result.description = t.function.description;
    }
    return result;
  });
}

/**
 * Translate OpenAI tool_choice → Anthropic tool_choice.
 */
export function translateToolChoiceToAnthropic(
  choice: OpenAIToolChoice | undefined,
): AnthropicToolChoice | undefined {
  if (choice === undefined) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return { type: "none" };
  if (choice === "required") return { type: "any" };
  if (typeof choice === "object" && choice.type === "function") {
    return { type: "tool", name: choice.function.name };
  }
  return undefined;
}

/**
 * Translate Anthropic tool_use content blocks → OpenAI tool_calls array.
 */
export function translateToolCallsFromAnthropic(
  content: Array<Record<string, unknown>>,
): OpenAIToolCall[] {
  return content
    .filter((block): block is Record<string, unknown> & { type: "tool_use" } =>
      block.type === "tool_use" &&
      typeof block.id === "string" &&
      typeof block.name === "string",
    )
    .map((block) => ({
      id: block.id as string,
      type: "function" as const,
      function: {
        name: block.name as string,
        arguments: JSON.stringify(block.input ?? {}),
      },
    }));
}

// ── Multi-turn message translation (OpenAI → Anthropic) ─────────

interface OpenAIMessage {
  role: string;
  content?: unknown;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
  [key: string]: unknown;
}

interface AnthropicMessage {
  role: string;
  content: unknown;
}

/**
 * Translate OpenAI-format messages to Anthropic-format messages.
 * Handles:
 * - assistant messages with tool_calls → content blocks with tool_use
 * - tool role messages → user messages with tool_result content blocks
 */
export function translateMessagesToAnthropic(
  messages: OpenAIMessage[],
): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      // Assistant message with tool_calls → Anthropic content blocks
      const contentBlocks: Array<Record<string, unknown>> = [];

      // Preserve any text content
      if (typeof msg.content === "string" && msg.content) {
        contentBlocks.push({ type: "text", text: msg.content });
      }

      // Convert tool_calls to tool_use blocks
      for (const tc of msg.tool_calls) {
        contentBlocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: safeParseJson(tc.function.arguments),
        });
      }

      result.push({ role: "assistant", content: contentBlocks });
    } else if (msg.role === "tool") {
      // Tool result message → Anthropic tool_result content block
      const toolResultBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      };

      // Anthropic expects tool_result inside a user message.
      // Merge consecutive tool results into a single user message.
      const last = result[result.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as Array<Record<string, unknown>>).push(toolResultBlock);
      } else {
        result.push({ role: "user", content: [toolResultBlock] });
      }
    } else {
      // Pass through other messages (user, assistant without tool_calls)
      result.push({ role: msg.role, content: msg.content });
    }
  }

  return result;
}
