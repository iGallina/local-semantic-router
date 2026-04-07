/**
 * Provider Dispatch Module
 *
 * Replaces the payFetch wrapper from the original ClawRouter.
 * Forwards requests directly to provider APIs using configured API keys.
 *
 * SEC-1: Never logs API key values — logs provider name and model only.
 */

import type { ResolvedConfig, ProviderConfig } from "./config-types.js";
import { maskApiKey } from "./config-loader.js";
import {
  translateToolsToAnthropic,
  translateToolChoiceToAnthropic,
  translateToolCallsFromAnthropic,
  translateMessagesToAnthropic,
} from "./tools-translator.js";
import type { OpenAITool, OpenAIToolChoice, OpenAIToolCall } from "./tools-translator.js";

/**
 * Parse a "provider/model" string into provider name and model ID.
 */
export function parseProviderModel(providerModel: string): {
  providerName: string;
  modelId: string;
} {
  const slashIdx = providerModel.indexOf("/");
  if (slashIdx === -1) {
    return { providerName: providerModel, modelId: providerModel };
  }
  return {
    providerName: providerModel.slice(0, slashIdx),
    modelId: providerModel.slice(slashIdx + 1),
  };
}

/**
 * Dispatch a request to the appropriate provider API.
 *
 * @param providerModel - "provider_name/model_id" from the routing decision
 * @param body - Raw request body buffer (OpenAI-compatible JSON)
 * @param config - Resolved config with provider credentials
 * @param isStreaming - Whether the request is a streaming request
 * @returns Provider response
 */
export async function dispatchRequest(
  providerModel: string,
  body: Buffer,
  config: ResolvedConfig,
  isStreaming: boolean = false,
): Promise<Response> {
  const { providerName, modelId } = parseProviderModel(providerModel);

  const provider = config.providers[providerName];
  if (!provider) {
    throw new Error(
      `Provider "${providerName}" not found in config. ` +
        `Available providers: ${Object.keys(config.providers).join(", ")}`,
    );
  }

  // SEC-1: Log provider and model only, never the API key
  console.log(`[local-semantic-router] Dispatching to ${providerName}/${modelId}`);

  if (provider.api === "anthropic-messages") {
    return dispatchAnthropic(provider, modelId, body, isStreaming);
  } else {
    return dispatchOpenAI(provider, modelId, body, isStreaming);
  }
}

/**
 * Dispatch to an OpenAI-compatible API.
 * POST ${base_url}/chat/completions with Authorization: Bearer ${apiKey}
 */
async function dispatchOpenAI(
  provider: ProviderConfig,
  modelId: string,
  body: Buffer,
  isStreaming: boolean,
): Promise<Response> {
  // Parse and update model in body
  let requestBody: string;
  try {
    const parsed = JSON.parse(body.toString()) as Record<string, unknown>;
    parsed.model = modelId;
    if (isStreaming) {
      parsed.stream = true;
    }
    requestBody = JSON.stringify(parsed);
  } catch {
    requestBody = body.toString();
  }

  const url = `${provider.base_url}/chat/completions`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.api_key}`,
    },
    body: requestBody,
  });
}

/**
 * Dispatch to the Anthropic Messages API.
 * POST ${base_url}/messages with x-api-key and anthropic-version headers.
 *
 * Transforms request body from OpenAI format to Anthropic format if needed.
 */
async function dispatchAnthropic(
  provider: ProviderConfig,
  modelId: string,
  body: Buffer,
  isStreaming: boolean,
): Promise<Response> {
  let requestBody: string;

  try {
    const parsed = JSON.parse(body.toString()) as Record<string, unknown>;

    // Transform from OpenAI format to Anthropic format
    const messages = (parsed.messages as Array<{ role: string; content: unknown }>) ?? [];

    // Extract system message (Anthropic uses a separate "system" field)
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const systemText = systemMessages
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n\n");

    // Translate multi-turn messages (tool role, assistant tool_calls)
    const translatedMessages = translateMessagesToAnthropic(
      nonSystemMessages as Array<{ role: string; content?: unknown; tool_calls?: OpenAIToolCall[]; tool_call_id?: string; [key: string]: unknown }>,
    );

    const anthropicBody: Record<string, unknown> = {
      model: modelId,
      messages: translatedMessages,
      max_tokens: (parsed.max_tokens as number) ?? 4096,
    };

    if (systemText) {
      anthropicBody.system = systemText;
    }

    if (isStreaming) {
      anthropicBody.stream = true;
    }

    if (parsed.temperature !== undefined) {
      anthropicBody.temperature = parsed.temperature;
    }

    if (parsed.tools) {
      anthropicBody.tools = translateToolsToAnthropic(
        parsed.tools as OpenAITool[],
      );
    }

    if (parsed.tool_choice !== undefined) {
      const translated = translateToolChoiceToAnthropic(
        parsed.tool_choice as OpenAIToolChoice,
      );
      if (translated) {
        anthropicBody.tool_choice = translated;
      }
    }

    requestBody = JSON.stringify(anthropicBody);
  } catch (err) {
    throw new Error(
      `Failed to transform request for Anthropic: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const url = `${provider.base_url}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.api_key,
      "anthropic-version": "2023-06-01",
    },
    body: requestBody,
  });

  // For non-streaming responses, translate tool_use blocks back to OpenAI format
  if (!isStreaming && response.ok) {
    return translateAnthropicResponse(response);
  }

  return response;
}

/**
 * Translate an Anthropic Messages API response into OpenAI-compatible format.
 * Converts tool_use content blocks to tool_calls and maps stop_reason.
 */
async function translateAnthropicResponse(response: Response): Promise<Response> {
  // Clone before consuming so we can fall back to the clone if parsing fails
  const cloned = response.clone();

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return cloned;
  }

  const content = body.content as Array<Record<string, unknown>> | undefined;
  if (!content) {
    return new Response(JSON.stringify(body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const toolCalls = translateToolCallsFromAnthropic(content);

  // Extract text content for the message
  const textParts = content
    .filter((b) => b.type === "text")
    .map((b) => b.text as string);
  const textContent = textParts.join("\n\n") || null;

  // Map Anthropic stop_reason to OpenAI finish_reason
  const stopReason = body.stop_reason as string | undefined;
  let finishReason = "stop";
  if (stopReason === "tool_use") finishReason = "tool_calls";
  else if (stopReason === "max_tokens") finishReason = "length";

  const openaiResponse = {
    id: body.id ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textContent,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: body.usage
      ? {
          prompt_tokens: (body.usage as Record<string, number>).input_tokens ?? 0,
          completion_tokens: (body.usage as Record<string, number>).output_tokens ?? 0,
          total_tokens:
            ((body.usage as Record<string, number>).input_tokens ?? 0) +
            ((body.usage as Record<string, number>).output_tokens ?? 0),
        }
      : undefined,
  };

  return new Response(JSON.stringify(openaiResponse), {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}
