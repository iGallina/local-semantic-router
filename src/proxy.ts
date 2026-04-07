/**
 * Local Semantic Router Proxy Server
 *
 * OpenAI-compatible HTTP proxy that routes requests to configured providers
 * based on prompt complexity classification.
 *
 * Adapted from ClawRouter's proxy.ts:
 * - KEPT: HTTP server, request parsing, route() call, model replacement,
 *         fallback chain, SSE streaming, response transforms, health check,
 *         socket lifecycle, graceful shutdown, port retry logic
 * - REMOVED: All x402/payment imports, payFetch, wallet setup, balance monitors,
 *            payment callbacks, Solana/EVM signing, partner proxying,
 *            image generation, session journal, response cache, dedup,
 *            compression, /debug command, stats endpoints
 *
 * Security:
 * - SEC-1: API keys never in logs
 * - SEC-2: Binds 127.0.0.1 by default, explicit --bind for network
 * - SEC-3: LLM classifier disabled by default, warns when enabled
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { finished } from "node:stream";
import type { AddressInfo } from "node:net";
import {
  route,
  getFallbackChain,
  calculateModelCost,
  DEFAULT_ROUTING_CONFIG,
  type RouterOptions,
  type RoutingDecision,
  type RoutingConfig,
  type ModelPricing,
  type Tier,
  type TierConfig,
} from "./router/index.js";
import { configureRouter } from "./router/index.js";
import { dispatchRequest, parseProviderModel } from "./dispatch.js";
import { resolveModelAlias, buildModelPricing } from "./models.js";
import type { ResolvedConfig } from "./config-types.js";
import type { SpendControl } from "./spend-control.js";
import { logUsage } from "./usage-logger.js";

const MAX_MESSAGES = 200;
const HEARTBEAT_INTERVAL_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000; // 3 minutes
const MAX_FALLBACK_ATTEMPTS = 5;
const PORT_RETRY_ATTEMPTS = 5;
const PORT_RETRY_DELAY_MS = 1_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;

// Routing profile models - virtual models that trigger intelligent routing
// Prefixed with "lsr-" to avoid collisions when registered as an OpenClaw provider
// (e.g. OpenClaw sees "local-semantic-router/lsr-auto" instead of ambiguous "auto")
const ROUTING_PROFILES = new Set([
  "lsr-auto",
  "lsr-eco",
  "lsr-premium",
  "lsr-agentic",
  // Keep unprefixed for backwards compatibility
  "auto",
  "eco",
  "premium",
  "agentic",
]);

/**
 * Error patterns that indicate a provider-side issue (not user's fault).
 * These errors should trigger fallback to the next model in the chain.
 */
const PROVIDER_ERROR_PATTERNS = [
  /billing/i,
  /insufficient.*balance/i,
  /credits/i,
  /quota.*exceeded/i,
  /rate.*limit/i,
  /model.*unavailable/i,
  /model.*not.*available/i,
  /service.*unavailable/i,
  /capacity/i,
  /overloaded/i,
  /temporarily.*unavailable/i,
  /api.*key.*invalid/i,
  /authentication.*failed/i,
  /request too large/i,
  /request.*size.*exceeds/i,
  /payload too large/i,
  /model.*not.*allowed/i,
  /unknown.*model/i,
];

/**
 * HTTP status codes that indicate provider issues worth retrying with fallback.
 */
const FALLBACK_STATUS_CODES = [
  400, 401, 402, 403, 413, 429, 500, 502, 503, 504,
];

/**
 * "Successful" response bodies that are actually provider degradation placeholders.
 */
const DEGRADED_RESPONSE_PATTERNS = [
  /the ai service is temporarily overloaded/i,
  /service is temporarily overloaded/i,
  /please try again in a moment/i,
];

// ─── Rate Limiting ───

const rateLimitedModels = new Map<string, number>();
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 300_000; // 5 minutes

function isRateLimited(modelId: string): boolean {
  const hitTime = rateLimitedModels.get(modelId);
  if (!hitTime) return false;
  const elapsed = Date.now() - hitTime;
  if (elapsed >= RATE_LIMIT_COOLDOWN_MS) {
    rateLimitedModels.delete(modelId);
    return false;
  }
  return true;
}

function markRateLimited(modelId: string): void {
  rateLimitedModels.set(modelId, Date.now());
  console.log(`[local-semantic-router] Model ${modelId} rate-limited, will deprioritize for 60s`);
}

function purgeExpiredRateLimits(): void {
  const now = Date.now();
  for (const [model, hitTime] of rateLimitedModels) {
    if (now - hitTime >= RATE_LIMIT_COOLDOWN_MS) {
      rateLimitedModels.delete(model);
    }
  }
}

function prioritizeNonRateLimited(models: string[]): string[] {
  const available: string[] = [];
  const limited: string[] = [];
  for (const model of models) {
    if (isRateLimited(model)) {
      limited.push(model);
    } else {
      available.push(model);
    }
  }
  return [...available, ...limited];
}

// ─── Response Utilities ───

function canWrite(res: ServerResponse): boolean {
  return (
    !res.writableEnded &&
    !res.destroyed &&
    res.socket !== null &&
    !res.socket.destroyed &&
    res.socket.writable
  );
}

function safeWrite(res: ServerResponse, data: string | Buffer): boolean {
  if (!canWrite(res)) return false;
  return res.write(data);
}

function isProviderError(status: number, body: string): boolean {
  if (!FALLBACK_STATUS_CODES.includes(status)) return false;
  if (status >= 500) return true;
  return PROVIDER_ERROR_PATTERNS.some((pattern) => pattern.test(body));
}

function detectDegradedSuccessResponse(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  if (DEGRADED_RESPONSE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return "degraded response: overloaded placeholder";
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const errorField = parsed.error;
    let errorText = "";
    if (typeof errorField === "string") {
      errorText = errorField;
    } else if (errorField && typeof errorField === "object") {
      const errObj = errorField as Record<string, unknown>;
      errorText = [
        typeof errObj.message === "string" ? errObj.message : "",
        typeof errObj.type === "string" ? errObj.type : "",
        typeof errObj.code === "string" ? errObj.code : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    if (errorText && PROVIDER_ERROR_PATTERNS.some((pattern) => pattern.test(errorText))) {
      return `degraded response: ${errorText.slice(0, 120)}`;
    }
  } catch {
    // Not JSON
  }
  return undefined;
}

// ─── Message Normalization ───

const VALID_ROLES = new Set(["system", "user", "assistant", "tool", "function"]);
const ROLE_MAPPINGS: Record<string, string> = {
  developer: "system",
  model: "assistant",
};

type ChatMessage = { role: string; content: string | unknown };

const VALID_TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function sanitizeToolId(id: string | undefined): string | undefined {
  if (!id || typeof id !== "string") return id;
  if (VALID_TOOL_ID_PATTERN.test(id)) return id;
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

type MessageWithTools = ChatMessage & {
  tool_calls?: Array<{ id?: string; type?: string; function?: unknown }>;
  tool_call_id?: string;
};

type ContentBlock = {
  type?: string;
  id?: string;
  tool_use_id?: string;
  [key: string]: unknown;
};

function sanitizeToolIds(messages: ChatMessage[]): ChatMessage[] {
  if (!messages || messages.length === 0) return messages;

  let hasChanges = false;
  const sanitized = messages.map((msg) => {
    const typedMsg = msg as MessageWithTools;
    let msgChanged = false;
    let newMsg = { ...msg } as MessageWithTools;

    if (typedMsg.tool_calls && Array.isArray(typedMsg.tool_calls)) {
      const newToolCalls = typedMsg.tool_calls.map((tc) => {
        if (tc.id && typeof tc.id === "string") {
          const s = sanitizeToolId(tc.id);
          if (s !== tc.id) {
            msgChanged = true;
            return { ...tc, id: s };
          }
        }
        return tc;
      });
      if (msgChanged) {
        newMsg = { ...newMsg, tool_calls: newToolCalls };
      }
    }

    if (typedMsg.tool_call_id && typeof typedMsg.tool_call_id === "string") {
      const s = sanitizeToolId(typedMsg.tool_call_id);
      if (s !== typedMsg.tool_call_id) {
        msgChanged = true;
        newMsg = { ...newMsg, tool_call_id: s };
      }
    }

    if (Array.isArray(typedMsg.content)) {
      const newContent = (typedMsg.content as ContentBlock[]).map((block) => {
        if (!block || typeof block !== "object") return block;
        let blockChanged = false;
        let newBlock = { ...block };

        if (block.type === "tool_use" && block.id && typeof block.id === "string") {
          const s = sanitizeToolId(block.id);
          if (s !== block.id) {
            blockChanged = true;
            newBlock = { ...newBlock, id: s };
          }
        }

        if (block.type === "tool_result" && block.tool_use_id && typeof block.tool_use_id === "string") {
          const s = sanitizeToolId(block.tool_use_id);
          if (s !== block.tool_use_id) {
            blockChanged = true;
            newBlock = { ...newBlock, tool_use_id: s };
          }
        }

        if (blockChanged) {
          msgChanged = true;
          return newBlock;
        }
        return block;
      });

      if (msgChanged) {
        newMsg = { ...newMsg, content: newContent };
      }
    }

    if (msgChanged) {
      hasChanges = true;
      return newMsg;
    }
    return msg;
  });

  return hasChanges ? sanitized : messages;
}

function normalizeMessageRoles(messages: ChatMessage[]): ChatMessage[] {
  if (!messages || messages.length === 0) return messages;
  let hasChanges = false;
  const normalized = messages.map((msg) => {
    if (VALID_ROLES.has(msg.role)) return msg;
    const mappedRole = ROLE_MAPPINGS[msg.role];
    if (mappedRole) {
      hasChanges = true;
      return { ...msg, role: mappedRole };
    }
    hasChanges = true;
    return { ...msg, role: "user" };
  });
  return hasChanges ? normalized : messages;
}

function truncateMessages<T extends { role: string }>(messages: T[]): T[] {
  if (!messages || messages.length <= MAX_MESSAGES) return messages;
  const systemMsgs = messages.filter((m) => m.role === "system");
  const conversationMsgs = messages.filter((m) => m.role !== "system");
  const maxConversation = MAX_MESSAGES - systemMsgs.length;
  const truncatedConversation = conversationMsgs.slice(-maxConversation);
  const result = [...systemMsgs, ...truncatedConversation];
  console.log(
    `[local-semantic-router] Truncated messages: ${messages.length} -> ${result.length}`,
  );
  return result;
}

// ─── Thinking Token Stripping ───

const KIMI_BLOCK_RE = /<[\uFF5C|][^<>]*begin[^<>]*[\uFF5C|]>[\s\S]*?<[\uFF5C|][^<>]*end[^<>]*[\uFF5C|]>/gi;
const KIMI_TOKEN_RE = /<[\uFF5C|][^<>]*[\uFF5C|]>/g;
const THINKING_TAG_RE = /<\s*\/?\s*(?:think(?:ing)?|thought|antthinking)\b[^>]*>/gi;
const THINKING_BLOCK_RE =
  /<\s*(?:think(?:ing)?|thought|antthinking)\b[^>]*>[\s\S]*?<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi;

function stripThinkingTokens(content: string): string {
  if (!content) return content;
  let cleaned = content.replace(KIMI_BLOCK_RE, "");
  cleaned = cleaned.replace(KIMI_TOKEN_RE, "");
  cleaned = cleaned.replace(THINKING_BLOCK_RE, "");
  cleaned = cleaned.replace(THINKING_TAG_RE, "");
  return cleaned;
}

// ─── Proxy Types ───

export type ProxyOptions = {
  config: ResolvedConfig;
  routingConfig?: RoutingConfig;
  port?: number;
  bind?: string;
  requestTimeoutMs?: number;
  onReady?: (port: number) => void;
  onError?: (error: Error) => void;
  onRouted?: (decision: RoutingDecision) => void;
  spendControl?: SpendControl;
  modelPricing?: Map<string, ModelPricing>;
};

export type ProxyHandle = {
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
};

// ─── Model Request ───

type ModelRequestResult = {
  success: boolean;
  response?: Response;
  errorBody?: string;
  errorStatus?: number;
  isProviderError?: boolean;
};

async function tryModelRequest(
  providerModel: string,
  body: Buffer,
  config: ResolvedConfig,
  isStreaming: boolean,
  signal: AbortSignal,
): Promise<ModelRequestResult> {
  // Normalize messages in the body
  let requestBody = body;
  try {
    const parsed = JSON.parse(body.toString()) as Record<string, unknown>;
    const { modelId } = parseProviderModel(providerModel);
    parsed.model = modelId;

    if (Array.isArray(parsed.messages)) {
      parsed.messages = normalizeMessageRoles(parsed.messages as ChatMessage[]);
      parsed.messages = truncateMessages(parsed.messages as ChatMessage[]);
      parsed.messages = sanitizeToolIds(parsed.messages as ChatMessage[]);
    }

    requestBody = Buffer.from(JSON.stringify(parsed));
  } catch {
    // If body isn't valid JSON, use as-is
  }

  try {
    const response = await dispatchRequest(providerModel, requestBody, config, isStreaming, signal);

    if (response.status !== 200) {
      const errorBody = await response.text();
      const isProviderErr = isProviderError(response.status, errorBody);

      return {
        success: false,
        errorBody,
        errorStatus: response.status,
        isProviderError: isProviderErr,
      };
    }

    // Detect degraded 200 responses
    const contentType = response.headers.get("content-type") || "";
    if (!isStreaming && (contentType.includes("json") || contentType.includes("text"))) {
      try {
        const clonedBody = await response.clone().text();
        const degradedReason = detectDegradedSuccessResponse(clonedBody);
        if (degradedReason) {
          return {
            success: false,
            errorBody: degradedReason,
            errorStatus: 503,
            isProviderError: true,
          };
        }
      } catch {
        // Ignore inspection failures
      }
    }

    return { success: true, response };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      errorBody: errorMsg,
      errorStatus: 500,
      isProviderError: true,
    };
  }
}

// ─── Model List ───

type ModelListEntry = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
};

function buildProxyModelList(config: ResolvedConfig): ModelListEntry[] {
  const createdAt = Math.floor(Date.now() / 1000);
  const entries: ModelListEntry[] = [];
  const seen = new Set<string>();

  // Add routing profile virtual models (lsr- prefixed for OpenClaw compatibility)
  for (const profile of ["lsr-auto", "lsr-eco", "lsr-premium", "lsr-agentic"]) {
    entries.push({
      id: profile,
      object: "model",
      created: createdAt,
      owned_by: "local-semantic-router",
    });
    seen.add(profile);
  }

  // Add models from all providers
  // Flatten "provider/model" → "provider--model" so OpenClaw doesn't parse
  // the slash as a second provider prefix (avoids "local-semantic-router/anthropic/model")
  for (const [providerName, provider] of Object.entries(config.providers)) {
    for (const model of provider.models) {
      const fullId = `${providerName}--${model.id}`;
      if (!seen.has(fullId)) {
        seen.add(fullId);
        entries.push({
          id: fullId,
          object: "model",
          created: createdAt,
          owned_by: providerName,
        });
      }
    }
  }

  return entries;
}

// ─── Main Proxy Request Handler ───

async function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedConfig,
  routerOpts: RouterOptions,
  options: ProxyOptions,
): Promise<void> {
  const startTime = Date.now();

  // Collect request body
  const bodyChunks: Buffer[] = [];
  for await (const chunk of req) {
    bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(bodyChunks);

  let routingDecision: RoutingDecision | undefined;
  let hasTools = false;
  let isStreaming = false;
  let modelId = "";
  let maxTokens = 4096;
  let routingProfile: "eco" | "auto" | "premium" | null = null;
  const isChatCompletion = req.url?.includes("/chat/completions");

  if (isChatCompletion && body.length > 0) {
    try {
      const parsed = JSON.parse(body.toString()) as Record<string, unknown>;
      isStreaming = parsed.stream === true;
      modelId = (parsed.model as string) || "";
      maxTokens = (parsed.max_tokens as number) || 4096;

      // Check for tools
      hasTools = Array.isArray(parsed.tools) && (parsed.tools as unknown[]).length > 0;

      // Resolve model alias
      modelId = resolveModelAlias(modelId);

      // Normalize flattened model IDs back to internal format:
      //   "lsr-auto" → "auto", "lsr-eco" → "eco", etc.
      //   "anthropic--claude-sonnet-4-6" → "anthropic/claude-sonnet-4-6"
      if (modelId.startsWith("lsr-")) {
        modelId = modelId.slice(4); // strip "lsr-" prefix
      }
      if (modelId.includes("--")) {
        modelId = modelId.replace("--", "/");
      }

      // Determine if this is a routing profile request
      if (ROUTING_PROFILES.has(modelId)) {
        routingProfile = modelId === "agentic" ? "auto" : modelId as "eco" | "auto" | "premium";

        // Extract prompt for routing
        const messages = parsed.messages as Array<{ role: string; content: unknown }> | undefined;
        const lastUserMsg = messages ? [...messages].reverse().find((m) => m.role === "user") : undefined;
        const prompt = typeof lastUserMsg?.content === "string"
          ? lastUserMsg.content
          : Array.isArray(lastUserMsg?.content)
            ? (lastUserMsg.content as Array<{ type: string; text?: string }>)
                .filter((b) => b.type === "text")
                .map((b) => b.text ?? "")
                .join(" ")
            : "";

        const systemMsg = messages?.find((m) => m.role === "system");
        const systemPrompt = typeof systemMsg?.content === "string" ? systemMsg.content : undefined;

        // Route the request
        routingDecision = route(prompt, systemPrompt, maxTokens, {
          ...routerOpts,
          routingProfile: routingProfile === null ? undefined : routingProfile,
          hasTools,
        });

        modelId = routingDecision.model;
        options.onRouted?.(routingDecision);
      }
    } catch {
      // Invalid JSON — pass through
    }
  }

  // If not a routing profile, use the model as-is
  if (!routingDecision && !modelId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Missing 'model' in request body", type: "invalid_request_error" } }));
    return;
  }

  // Spend limit check (before dispatch)
  if (options.spendControl) {
    const estimatedCost = routingDecision?.costEstimate ?? 0;
    const check = options.spendControl.check(estimatedCost);
    if (!check.allowed) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          message: check.reason,
          type: "spend_limit_exceeded",
          blocked_by: check.blockedBy,
        },
      }));
      return;
    }
  }

  // Timeout controller
  const controller = new AbortController();
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Heartbeat for streaming requests
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  if (isStreaming) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Routing-Tier": routingDecision?.tier ?? "direct",
      "X-Routing-Model": modelId,
      "X-Routing-Profile": routingDecision?.profile ?? "direct",
    });

    heartbeatInterval = setInterval(() => {
      if (canWrite(res)) {
        safeWrite(res, ": heartbeat\n\n");
      } else {
        clearInterval(heartbeatInterval);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  // Clean up on response close
  res.on("close", () => {
    clearTimeout(timeoutId);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  });

  try {
    // Build fallback chain
    let fallbackChain: string[];
    if (routingDecision?.tierConfigs) {
      fallbackChain = getFallbackChain(routingDecision.tier, routingDecision.tierConfigs);
      fallbackChain = prioritizeNonRateLimited(fallbackChain);
    } else {
      fallbackChain = [modelId];
    }

    // Limit fallback attempts
    fallbackChain = fallbackChain.slice(0, MAX_FALLBACK_ATTEMPTS);

    let lastError: string | undefined;
    let lastStatus = 500;

    for (const attemptModel of fallbackChain) {
      if (controller.signal.aborted) break;

      const result = await tryModelRequest(
        attemptModel,
        body,
        config,
        isStreaming,
        controller.signal,
      );

      if (result.success && result.response) {
        clearTimeout(timeoutId);
        if (heartbeatInterval) clearInterval(heartbeatInterval);

        const latencyMs = Date.now() - startTime;
        console.log(
          `[local-semantic-router] ${routingDecision?.tier ?? "DIRECT"} -> ${attemptModel} (${latencyMs}ms)`,
        );

        // Token usage tracking
        let inputTokens = 0;
        let outputTokens = 0;

        // Stream the response back
        if (isStreaming) {
          // Stream SSE from upstream, scanning for usage in final chunk
          if (result.response.body) {
            const reader = result.response.body.getReader();
            const decoder = new TextDecoder();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                // Scan for usage data in SSE lines (typically in final chunk)
                for (const line of chunk.split("\n")) {
                  if (line.startsWith("data: ") && line !== "data: [DONE]") {
                    try {
                      const sseData = JSON.parse(line.slice(6)) as Record<string, unknown>;
                      const usage = sseData.usage as Record<string, number> | undefined;
                      if (usage) {
                        inputTokens = usage.prompt_tokens ?? inputTokens;
                        outputTokens = usage.completion_tokens ?? outputTokens;
                      }
                    } catch {
                      // partial chunk or non-JSON, skip
                    }
                  }
                }
                if (!safeWrite(res, chunk)) break;
              }
            } catch {
              // Stream ended
            } finally {
              reader.releaseLock();
            }
          }
          if (canWrite(res)) {
            res.end();
          }
        } else {
          // Non-streaming: read full response and forward
          const responseBody = await result.response.text();

          // Strip thinking tokens from response content
          let finalBody = responseBody;
          try {
            const parsed = JSON.parse(responseBody) as Record<string, unknown>;

            // Extract token usage
            const usage = parsed.usage as Record<string, number> | undefined;
            if (usage) {
              inputTokens = usage.prompt_tokens ?? 0;
              outputTokens = usage.completion_tokens ?? 0;
            }

            if (parsed.choices && Array.isArray(parsed.choices)) {
              const choices = parsed.choices as Array<Record<string, unknown>>;
              for (const choice of choices) {
                const message = choice.message as Record<string, unknown> | undefined;
                if (message && typeof message.content === "string") {
                  message.content = stripThinkingTokens(message.content);
                }
              }
              // Add routing info to response
              if (routingDecision) {
                (parsed as Record<string, unknown>)["x_routing"] = {
                  tier: routingDecision.tier,
                  model: attemptModel,
                  profile: routingDecision.profile,
                  confidence: routingDecision.confidence,
                  savings: routingDecision.savings,
                  latencyMs,
                };
              }
              finalBody = JSON.stringify(parsed);
            }
          } catch {
            // Not JSON, pass through
          }

          res.writeHead(200, {
            "Content-Type": "application/json",
            "X-Routing-Tier": routingDecision?.tier ?? "direct",
            "X-Routing-Model": attemptModel,
            "X-Routing-Profile": routingDecision?.profile ?? "direct",
          });
          res.end(finalBody);
        }

        // Fire-and-forget: log usage and record spend
        const { providerName } = parseProviderModel(attemptModel);
        const pricing = options.modelPricing?.get(attemptModel);
        const actualCost = pricing
          ? (inputTokens * pricing.inputPrice + outputTokens * pricing.outputPrice) / 1_000_000
          : 0;

        options.spendControl?.record(actualCost, attemptModel);

        logUsage({
          timestamp: new Date().toISOString(),
          model: attemptModel,
          tier: routingDecision?.tier ?? "DIRECT",
          provider: providerName,
          streaming: isStreaming,
          inputTokens,
          outputTokens,
          actualCost,
          estimatedCost: routingDecision?.costEstimate ?? 0,
          latencyMs,
        }).catch(() => {});

        return;
      }

      // Handle error — try fallback
      lastError = result.errorBody;
      lastStatus = result.errorStatus ?? 500;

      if (result.errorStatus === 429) {
        markRateLimited(attemptModel);
      }

      if (!result.isProviderError) {
        // Not a provider error — don't retry
        break;
      }

      console.log(
        `[local-semantic-router] Fallback: ${attemptModel} failed (${result.errorStatus}), trying next model`,
      );
    }

    // All fallbacks exhausted
    clearTimeout(timeoutId);
    if (heartbeatInterval) clearInterval(heartbeatInterval);

    if (isStreaming) {
      const errorEvent = JSON.stringify({
        error: { message: lastError ?? "All models failed", type: "provider_error" },
      });
      safeWrite(res, `data: ${errorEvent}\n\n`);
      safeWrite(res, "data: [DONE]\n\n");
      if (canWrite(res)) res.end();
    } else if (!res.headersSent) {
      res.writeHead(lastStatus, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: lastError ?? "All models failed", type: "provider_error" },
        }),
      );
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    throw err;
  }
}

// ─── Check Existing Proxy ───

async function checkExistingProxy(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Start Proxy ───

/**
 * Start the local proxy server.
 *
 * SEC-2: Binds to 127.0.0.1 by default.
 * SEC-3: Warns when fallback classifier is enabled.
 */
export async function startProxy(options: ProxyOptions): Promise<ProxyHandle> {
  const { config } = options;
  const listenPort = options.port ?? config.port;
  const bindAddress = options.bind ?? config.bind;

  // SEC-2: Warn about network binding
  if (bindAddress === "0.0.0.0") {
    console.error(
      `[local-semantic-router] WARNING: Proxy bound to 0.0.0.0 -- accessible from network. Your API keys may be exposed.`,
    );
  }

  // SEC-3: Warn about LLM classifier
  if (config.fallback_classifier.enabled) {
    console.error(
      `[local-semantic-router] WARNING: Fallback LLM classifier is enabled. ` +
        `Prompts may be forwarded to ${config.fallback_classifier.provider}/${config.fallback_classifier.model} for tier classification.`,
    );
  }

  // Check for existing proxy
  const existing = await checkExistingProxy(listenPort);
  if (existing) {
    console.log(`[local-semantic-router] Existing proxy on port ${listenPort}, reusing`);
    const baseUrl = `http://127.0.0.1:${listenPort}`;
    options.onReady?.(listenPort);
    return {
      port: listenPort,
      baseUrl,
      close: async () => {},
    };
  }

  // Build router options
  const routingConfig = options.routingConfig ?? configureRouter(config);
  const modelPricing = buildModelPricing(config);
  const routerOpts: RouterOptions = {
    config: routingConfig,
    modelPricing,
  };

  // Make model pricing available for usage cost calculation
  if (!options.modelPricing) {
    options.modelPricing = modelPricing;
  }

  // Periodic cleanup of expired rate-limit entries
  const rateLimitCleanup = setInterval(purgeExpiredRateLimits, RATE_LIMIT_CLEANUP_INTERVAL_MS);

  // Track active connections
  const connections = new Set<import("net").Socket>();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Error handlers
    req.on("error", (err) => {
      console.error(`[local-semantic-router] Request stream error: ${err.message}`);
    });
    res.on("error", (err) => {
      console.error(`[local-semantic-router] Response stream error: ${err.message}`);
    });
    finished(res, (err) => {
      if (err && err.code !== "ERR_STREAM_DESTROYED") {
        console.error(`[local-semantic-router] Response finished with error: ${err.message}`);
      }
    });

    // Health check
    if (req.url === "/health" || req.url?.startsWith("/health?")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: "0.1.0" }));
      return;
    }

    // Models endpoint
    if (req.url === "/v1/models" && req.method === "GET") {
      const models = buildProxyModelList(config);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: models }));
      return;
    }

    // Stats endpoint
    if (req.url === "/v1/stats" && req.method === "GET") {
      const { readUsageLogs } = await import("./usage-logger.js");
      const entries = await readUsageLogs(7);
      const spending = options.spendControl?.getStatus() ?? null;

      // Aggregate by day and model
      const byDay: Record<string, { cost: number; requests: number }> = {};
      const byModel: Record<string, { cost: number; requests: number; inputTokens: number; outputTokens: number }> = {};
      let totalCost = 0;

      for (const e of entries) {
        const day = e.timestamp.slice(0, 10);
        if (!byDay[day]) byDay[day] = { cost: 0, requests: 0 };
        byDay[day].cost += e.actualCost;
        byDay[day].requests++;

        if (!byModel[e.model]) byModel[e.model] = { cost: 0, requests: 0, inputTokens: 0, outputTokens: 0 };
        byModel[e.model].cost += e.actualCost;
        byModel[e.model].requests++;
        byModel[e.model].inputTokens += e.inputTokens;
        byModel[e.model].outputTokens += e.outputTokens;

        totalCost += e.actualCost;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ totalCost, totalRequests: entries.length, byDay, byModel, spending }, null, 2));
      return;
    }

    // Only proxy /v1 paths
    if (!req.url?.startsWith("/v1")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    try {
      await proxyRequest(req, res, config, routerOpts, options);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      options.onError?.(error);

      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: `Proxy error: ${error.message}`, type: "proxy_error" },
          }),
        );
      } else if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({ error: { message: error.message, type: "proxy_error" } })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }
  });

  // Port binding with retry logic
  const tryListen = (attempt: number): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener("error", onError);
        if (err.code === "EADDRINUSE" && attempt < PORT_RETRY_ATTEMPTS) {
          reject({ code: "RETRY", attempt });
        } else {
          reject(err);
        }
      };

      server.once("error", onError);
      server.listen(listenPort, bindAddress, () => {
        server.removeListener("error", onError);
        resolve();
      });
    });
  };

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= PORT_RETRY_ATTEMPTS; attempt++) {
    try {
      await tryListen(attempt);
      break;
    } catch (err: unknown) {
      const error = err as { code?: string; attempt?: number };
      if (error.code === "RETRY") {
        console.log(
          `[local-semantic-router] Port ${listenPort} in use, retrying (${attempt}/${PORT_RETRY_ATTEMPTS})`,
        );
        await new Promise((r) => setTimeout(r, PORT_RETRY_DELAY_MS));
        continue;
      }
      lastError = err as Error;
      break;
    }
  }

  if (lastError) throw lastError;

  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const baseUrl = `http://${bindAddress}:${port}`;

  options.onReady?.(port);

  // Runtime error handler
  server.on("error", (err) => {
    console.error(`[local-semantic-router] Server runtime error: ${err.message}`);
    options.onError?.(err);
  });

  server.on("clientError", (err, socket) => {
    console.error(`[local-semantic-router] Client error: ${err.message}`);
    if (socket.writable && !socket.destroyed) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
  });

  // Track connections
  server.on("connection", (socket) => {
    connections.add(socket);
    socket.setTimeout(300_000);
    socket.on("timeout", () => {
      socket.destroy();
    });
    socket.on("error", (err) => {
      console.error(`[local-semantic-router] Socket error: ${err.message}`);
    });
    socket.on("close", () => {
      connections.delete(socket);
    });
  });

  return {
    port,
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        clearInterval(rateLimitCleanup);
        const timeout = setTimeout(() => {
          reject(new Error("[local-semantic-router] Close timeout after 4s"));
        }, 4000);

        for (const socket of connections) {
          socket.destroy();
        }
        connections.clear();
        server.close((err) => {
          clearTimeout(timeout);
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
