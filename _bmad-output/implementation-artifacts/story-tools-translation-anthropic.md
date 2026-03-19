---
title: 'Tools Format Translation for Anthropic Provider'
slug: 'tools-translation-anthropic'
created: '2026-03-18'
status: 'review'
story_id: 'LSR-002'
parent_spec: 'tech-spec-local-semantic-router.md'
epic: 'Anthropic Native Compatibility'
priority: 'high'
---

# Story LSR-002: Tools Format Translation for Anthropic Provider

## Context

When OpenClaw routes a request through the `local-semantic-router` proxy to an Anthropic model,
it sends tools in **OpenAI function-calling format** (`type: "function"`).

The Anthropic API rejects this with:

```
LLM request rejected: tools.0: Input tag 'function' found using 'type' does not match
any of the expected tags: 'bash_20250124', 'custom', 'computer_20250124', ...
```

This happens because the proxy uses `api: "openai-completions"` to forward to Anthropic,
but Claude expects its own native tool schema.

---

## Problem

```
OpenClaw → proxy (lsr-auto) → Anthropic API
                ↓
         sends tools as:
         { type: "function", function: { name, description, parameters } }
                ↓
         Anthropic rejects:
         expected type: "custom" | "bash_20250124" | ...
```

---

## Acceptance Criteria

- [x] When the target provider is `anthropic` (detected by `base_url` containing `api.anthropic.com`
      OR by provider name), the proxy transforms the request tools array before forwarding.
- [x] OpenAI tool format → Anthropic native format:
  ```
  // OpenAI (input)
  { type: "function", function: { name, description, parameters } }

  // Anthropic (output)
  { type: "custom", name, description, input_schema: parameters }
  ```
- [x] `tool_choice` is also translated:
  ```
  // OpenAI
  { type: "function", function: { name } }  →  { type: "tool", name }
  "auto"                                    →  { type: "auto" }
  "none"                                    →  { type: "none" }  (or omit)
  ```
- [x] `tool_calls` in assistant messages (for multi-turn) are translated back from Anthropic
      format to OpenAI format in the response.
- [x] Translation is **only applied** when the downstream provider is Anthropic — not for
      Groq, OpenRouter, or other OpenAI-compatible endpoints.
- [x] Existing tests still pass.
- [x] New unit tests cover the translation function (both directions).

---

## Technical Guidance

### Where to implement

**File:** `src/dispatch.ts` (or a new `src/tools-translator.ts` imported by dispatch)

In `dispatchRequest()`, before building the request body for Anthropic:

```typescript
// src/dispatch.ts
import { translateToolsToAnthropic, translateResponseFromAnthropic } from "./tools-translator.js";

// Detect Anthropic provider
const isAnthropic = providerConfig.baseUrl.includes("api.anthropic.com")
  || providerName === "anthropic";

if (isAnthropic && body.tools) {
  body = {
    ...body,
    tools: translateToolsToAnthropic(body.tools),
    tool_choice: translateToolChoiceToAnthropic(body.tool_choice),
  };
}
```

### Translation function skeleton

```typescript
// src/tools-translator.ts

export function translateToolsToAnthropic(tools: OpenAITool[]): AnthropicTool[] {
  return tools.map(t => ({
    type: "custom",
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

export function translateToolChoiceToAnthropic(
  choice: OpenAIToolChoice | undefined
): AnthropicToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return { type: "none" };
  if (typeof choice === "object" && choice.type === "function") {
    return { type: "tool", name: choice.function.name };
  }
  return undefined;
}
```

### Response translation (tool_calls → tool_use blocks)

Anthropic returns tool calls as `content` blocks of `type: "tool_use"`.
OpenAI expects them as `message.tool_calls`.

```typescript
export function translateResponseFromAnthropic(anthropicResponse: unknown): unknown {
  // If response contains tool_use content blocks,
  // map them to OpenAI tool_calls format
  // ...
}
```

### Detection heuristic

Provider is Anthropic if:
- `providerConfig.baseUrl` matches `/api\.anthropic\.com/`
- OR `providerName === "anthropic"`
- OR the proxy request to OpenClaw's own gateway (`127.0.0.1:18789`) — which proxies to Anthropic

> Note: the `openclaw-proxy` provider type (see SPEC.md) also routes through Anthropic.
> Apply the same translation if `baseUrl` is `http://127.0.0.1:18789`.

---

## Out of Scope

- Streaming tool_use translation (can be a follow-up story)
- Support for Anthropic-specific tool types (bash, computer_use) — those are Anthropic-only features
- Translation for non-Anthropic providers

---

## Test Cases

```typescript
describe("translateToolsToAnthropic", () => {
  it("converts OpenAI function tool to Anthropic custom tool", () => {
    const input = [{
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather for a location",
        parameters: { type: "object", properties: { location: { type: "string" } } }
      }
    }];
    const output = translateToolsToAnthropic(input);
    expect(output[0]).toEqual({
      type: "custom",
      name: "get_weather",
      description: "Get weather for a location",
      input_schema: { type: "object", properties: { location: { type: "string" } } }
    });
  });

  it("returns empty array for empty tools", () => {
    expect(translateToolsToAnthropic([])).toEqual([]);
  });
});

describe("translateToolChoiceToAnthropic", () => {
  it('maps "auto" → { type: "auto" }', () => { ... });
  it('maps "none" → { type: "none" }', () => { ... });
  it('maps function choice → { type: "tool", name }', () => { ... });
});
```

---

## Definition of Done

- [x] `translateToolsToAnthropic` implemented and exported from `src/tools-translator.ts`
- [x] `dispatch.ts` applies translation when provider is Anthropic
- [x] Response translation handles `tool_use` → `tool_calls` (at minimum non-streaming)
- [x] Unit tests passing (`npm test`)
- [ ] Manual test: `local-semantic-router/lsr-auto` via OpenClaw without tool errors
- [ ] Committed on `main`

---

## Dev Agent Record

### Implementation Plan
- Created `src/tools-translator.ts` with three pure translation functions
- Integrated into `dispatchAnthropic()` in `src/dispatch.ts` — translation only applied for `anthropic-messages` API type
- Added full Anthropic response → OpenAI response translation (non-streaming) including usage mapping and finish_reason translation

### File List
- `src/tools-translator.ts` — NEW: Tool format translation functions (OpenAI ↔ Anthropic)
- `src/tools-translator.test.ts` — NEW: 13 unit tests for all translation functions
- `src/dispatch.ts` — MODIFIED: Import translator, apply tool/tool_choice translation in dispatchAnthropic, add response translation
- `src/dispatch.test.ts` — MODIFIED: 3 new integration tests (tool translation, response translation, non-Anthropic passthrough)
- `_bmad-output/implementation-artifacts/story-tools-translation-anthropic.md` — MODIFIED: Status and checkboxes

### Completion Notes
- 58 tests pass (0 regressions, 16 new tests)
- Translation is cleanly scoped: only `anthropic-messages` API type triggers it
- Response translation maps `stop_reason: "tool_use"` → `finish_reason: "tool_calls"` and converts usage fields
- Also handles `"required"` → `{ type: "any" }` tool_choice mapping (bonus coverage)
- Streaming tool_use translation is out of scope per story spec

### Change Log
- 2026-03-18: Implemented LSR-002 — tools format translation for Anthropic provider
