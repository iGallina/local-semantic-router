---
title: 'local-semantic-router'
slug: 'local-semantic-router'
created: '2026-03-15'
status: 'done'
stepsCompleted: [1, 2, 3, 4]
baseline_commit: '7bfafad479acdbb18200a960c1ff145f13901b3b'
tech_stack: ['typescript', 'node-esm', 'yaml', 'vitest', 'tsup']
files_to_modify: ['src/router/types.ts', 'src/router/config.ts', 'src/router/rules.ts', 'src/router/selector.ts', 'src/router/strategy.ts', 'src/router/llm-classifier.ts', 'src/router/index.ts', 'src/proxy.ts', 'src/provider.ts', 'src/config-loader.ts', 'src/cli.ts', 'src/index.ts']
code_patterns: ['strategy-pattern', 'openai-compatible-proxy', 'openclaw-provider-plugin', 'sse-streaming', 'fallback-chain-retry']
test_patterns: ['vitest-describe-it', 'unit-test-per-module', 'mock-pricing-maps']
---

# Tech-Spec: local-semantic-router

**Created:** 2026-03-15

## Overview

### Problem Statement

There is no simple, wallet-free, SaaS-free solution to automatically route LLM prompts to the cheapest capable model based on task complexity. ClawRouter does this well but is tightly coupled to crypto/x402 payments. Users who want automatic cost optimization with their own API keys and local LLMs have no option.

### Solution

Extract ClawRouter's pure routing engine (~2100 lines, zero crypto dependencies) and replace the crypto/payment proxy with a direct-dispatch proxy that uses API keys and local LLM endpoints. Ship as an OpenClaw-compatible provider plugin + local proxy, exactly mirroring the original integration pattern (OpenAI-compatible proxy that registers as a provider).

### Scope

**In Scope:**
- Router core extraction (types, config, rules, selector, strategy, llm-classifier) — strip all crypto/payment references
- Provider plugin that registers with OpenClaw (same pattern as original `provider.ts` + `index.ts`)
- Local OpenAI-compatible proxy that routes requests to configured providers via direct API forwarding
- YAML-based tier-to-model config with 4 routing profiles (auto/eco/premium/agentic)
- Configurable fallback LLM classifier (not hardcoded to any specific model)
- CLI setup wizard that generates initial YAML config + `.env` with guided steps
- Default suggestions: Kimi on Groq (SIMPLE), Sonnet 4.6 (MEDIUM), Opus 4.6 (COMPLEX/REASONING)
- Security hardening (SEC-1, SEC-2, SEC-3, SEC-7, SEC-8)

**Out of Scope:**
- Crypto/wallet/x402 payment layer
- Web UI
- npm publish (for now)
- Custom routing strategies beyond rules-based
- Multi-user/shared-server deployment hardening (documented as future work)

## Security Requirements (v1 mandatory)

### SEC-1: Secure Config File
- Config YAML created with 0600 file permissions
- `.gitignore` template ships with `*.env`, `config.yaml` patterns
- API keys never appear in logs at any verbosity level

### SEC-2: Localhost-Only Binding
- Proxy binds to `127.0.0.1` by default
- Network binding requires explicit `--bind 0.0.0.0` flag + warning printed to stderr

### SEC-3: LLM Classifier Opt-In
- Fallback LLM classifier is disabled by default
- When enabled via YAML (`fallback_classifier.enabled: true`), a startup message warns that prompts may be forwarded to the configured classifier LLM for tier classification
- When disabled and confidence is low, router defaults to MEDIUM tier

### SEC-7: Safe YAML Parsing
- Use `yaml` npm package with `JSON_SCHEMA` only
- Config validated against a JSON Schema on load
- Unknown fields rejected, URLs validated, no arbitrary type constructors

### SEC-8: Flexible Secrets
- Support three paths: environment variables (`ANTHROPIC_API_KEY`), `.env` file, and YAML `apiKey: ${ENV_VAR_NAME}` interpolation
- `${ENV_VAR_NAME}` resolved via regex replace at config load time — no eval, no dynamic execution
- Document that `.env` is for dev convenience only, not production

## Security Considerations (documented, deferred to future versions)

- **Routing manipulation**: Keyword stuffing to game tier classification — mitigate with rate limits, cost ceilings, anomaly detection
- **No proxy authentication**: Localhost-only is acceptable for single-user; optional bearer token needed for multi-user
- **Malicious classifier URL**: Config could point classifier to attacker endpoint — mitigate with URL allowlisting
- **Fallback timing side-channel**: Failed provider cascades leak provider configuration — document for shared deployments
- **Supply chain integrity**: Signed releases / checksums for npm package

## Context for Development

### Codebase Patterns

- Source router code: `clawrouter-ref/src/router/` (7 files, ~2100 lines, zero crypto deps)
- Router uses pluggable strategy pattern (`RouterStrategy` interface, registry)
- Integration pattern: plugin registers provider → starts local proxy → proxy calls `route()` → modifies `parsed.model` → forwards to upstream API → streams response back
- All router logic is synchronous except the optional LLM classifier fallback
- Proxy pattern: Node.js `createServer()` with socket lifecycle, timeout management, graceful shutdown
- Request normalization: tool ID sanitization, message role mapping, thinking-enabled normalization
- Error handling: `FALLBACK_STATUS_CODES` + `PROVIDER_ERROR_PATTERNS` regex matching → fallback chain retry
- Streaming: SSE simulation (upstream non-streaming → chunked SSE to client)
- ~60% of proxy.ts is generic proxy pattern (keep), ~40% is payment/x402 (remove)

### Files to Reference

| File | Purpose | Action |
| ---- | ------- | ------ |
| `clawrouter-ref/src/router/types.ts` | Core types: Tier, ScoringResult, RoutingDecision, RoutingConfig (120 lines) | Copy as-is |
| `clawrouter-ref/src/router/config.ts` | DEFAULT_ROUTING_CONFIG, scoring weights, tier configs, multilingual keywords (1200 lines) | Copy, update default model IDs |
| `clawrouter-ref/src/router/rules.ts` | 14-dimensional scoring engine, classifyByRules() (327 lines) | Copy as-is |
| `clawrouter-ref/src/router/selector.ts` | selectModel(), getFallbackChain(), cost calculation (193 lines) | Copy as-is |
| `clawrouter-ref/src/router/strategy.ts` | RouterStrategy interface, RulesStrategy, profile selection (144 lines) | Copy as-is |
| `clawrouter-ref/src/router/llm-classifier.ts` | Fallback LLM classifier, in-memory cache (127 lines) | Copy, make model configurable from YAML |
| `clawrouter-ref/src/router/index.ts` | route() entry point, re-exports (42 lines) | Copy as-is |
| `clawrouter-ref/src/proxy.ts` | Original proxy (~3000 lines) | Adapt: keep 60%, remove 40% payment code |
| `clawrouter-ref/src/provider.ts` | Original provider registration (54 lines) | Rewrite: same interface, no wallet |
| `clawrouter-ref/src/index.ts` | Original plugin entry point | Rewrite: same pattern, no wallet/balance |
| `clawrouter-ref/src/models.ts` | Model aliases and definitions (200+ lines) | Adapt: keep alias pattern, update model catalog |
| `clawrouter-ref/src/router/selector.test.ts` | Selector unit tests (78 lines) | Adapt: update model IDs |
| `clawrouter-ref/src/router/strategy.test.ts` | Strategy unit tests (151 lines) | Adapt: update model IDs |

### Technical Decisions

- **Config format**: YAML file (not JSON) — user-friendly, supports comments
- **Secrets interpolation**: `${ENV_VAR_NAME}` pattern in YAML values, resolved via regex at load time — no eval
- **YAML parser**: `yaml` npm package with `JSON_SCHEMA` schema only (SEC-7)
- **Proxy pattern**: OpenAI-compatible HTTP proxy on localhost, same as original
- **Classifier default**: Disabled; when disabled, ambiguous prompts default to MEDIUM tier
- **Provider dispatch**: Direct HTTP forwarding to provider APIs using configured API keys
- **Build system**: tsup (same as original)
- **Test framework**: vitest (same as original)
- **Module system**: ESM (`"type": "module"`)
- **Upstream dispatch**: Replace `payFetch` with plain `fetch` + API key headers
- **Fallback chain**: Keep provider error detection + retry logic, remove payment error handling

## Implementation Plan

### Tasks

#### Phase 1: Project Scaffold & Config Loader (foundation — no dependencies)

- [ ] Task 1: Initialize project structure
  - File: `package.json` (create)
  - Action: Initialize with `name: "local-semantic-router"`, `type: "module"`, scripts for build/test/start. Dependencies: `yaml`, `dotenv`. Dev deps: `typescript`, `tsup`, `vitest`, `eslint`, `prettier`.
  - File: `tsconfig.json` (create)
  - Action: ESM target, strict mode, `outDir: "dist"`, path aliases matching original.
  - File: `tsup.config.ts` (create)
  - Action: Entry points: `src/index.ts`, `src/cli.ts`. Format: ESM. DTS generation enabled.
  - File: `.gitignore` (create)
  - Action: Include `dist/`, `node_modules/`, `*.env`, `config.yaml`, `config.yml`, `.env*` patterns (SEC-1).

- [ ] Task 2: Create config schema and loader
  - File: `src/config-loader.ts` (create)
  - Action: Implement `loadConfig(configPath?: string): ResolvedConfig`.
    - Default path: `~/.local-semantic-router/config.yaml`
    - Parse YAML using `yaml` package with `JSON_SCHEMA` schema only (SEC-7)
    - Validate against JSON Schema (define inline): reject unknown fields, validate URLs
    - Resolve `${ENV_VAR_NAME}` interpolation via `/\$\{([^}]+)\}/g` regex (SEC-8)
    - Load `.env` file via `dotenv` if present in cwd or config dir (SEC-8)
    - Verify config file has 0600 permissions on read; warn if too permissive (SEC-1)
    - Never log resolved API key values — log `"[key:ANTH...PXYZ]"` masked format (SEC-1)
  - File: `src/config-types.ts` (create)
  - Action: Define TypeScript types for YAML config structure:
    ```typescript
    interface LocalRouterConfig {
      port?: number;                          // default 8402
      bind?: string;                          // default "127.0.0.1" (SEC-2)
      routing_profile?: "auto" | "eco" | "premium" | "agentic";
      providers: Record<string, ProviderConfig>;
      tiers: TierMappingConfig;               // tier → provider/model
      fallback_classifier?: {
        enabled: boolean;                     // default false (SEC-3)
        provider: string;                     // which provider to use
        model: string;                        // which model
        max_tokens?: number;
        temperature?: number;
      };
      scoring?: Partial<ScoringOverrides>;    // optional dimension weight overrides
    }
    interface ProviderConfig {
      api: "openai-completions" | "anthropic-messages";
      base_url: string;
      api_key: string;                        // supports ${ENV_VAR} interpolation
      models: ProviderModelConfig[];
    }
    interface ProviderModelConfig {
      id: string;
      name?: string;
      input_price?: number;                   // per 1M tokens
      output_price?: number;
      context_window?: number;
      max_tokens?: number;
    }
    interface TierMappingConfig {
      auto?: TierModels;
      eco?: TierModels;
      premium?: TierModels;
      agentic?: TierModels;
    }
    interface TierModels {
      simple: { primary: string; fallbacks?: string[] };
      medium: { primary: string; fallbacks?: string[] };
      complex: { primary: string; fallbacks?: string[] };
      reasoning: { primary: string; fallbacks?: string[] };
    }
    ```

- [ ] Task 3: Create default config template
  - File: `src/default-config.yaml` (create, bundled as template)
  - Action: Create a well-commented YAML template with default suggestions:
    ```yaml
    port: 8402
    bind: "127.0.0.1"
    routing_profile: auto

    providers:
      groq:
        api: openai-completions
        base_url: "https://api.groq.com/openai/v1"
        api_key: "${GROQ_API_KEY}"
        models:
          - id: "llama-3.3-70b-versatile"
            name: "Llama 3.3 70B"
            input_price: 0.59
            output_price: 0.79
      anthropic:
        api: anthropic-messages
        base_url: "https://api.anthropic.com/v1"
        api_key: "${ANTHROPIC_API_KEY}"
        models:
          - id: "claude-sonnet-4-6-20260315"
            name: "Claude Sonnet 4.6"
            input_price: 3.0
            output_price: 15.0
          - id: "claude-opus-4-6-20260315"
            name: "Claude Opus 4.6"
            input_price: 5.0
            output_price: 25.0

    tiers:
      auto:
        simple:
          primary: "groq/llama-3.3-70b-versatile"
        medium:
          primary: "anthropic/claude-sonnet-4-6-20260315"
        complex:
          primary: "anthropic/claude-opus-4-6-20260315"
        reasoning:
          primary: "anthropic/claude-opus-4-6-20260315"

    fallback_classifier:
      enabled: false
      # provider: groq
      # model: "llama-3.3-70b-versatile"
    ```

#### Phase 2: Router Core Extraction (depends on Task 2 for config types)

- [ ] Task 4: Copy router core files
  - File: `src/router/types.ts` (create)
  - Action: Copy from `clawrouter-ref/src/router/types.ts` verbatim. No changes needed — zero crypto deps.
  - File: `src/router/rules.ts` (create)
  - Action: Copy from `clawrouter-ref/src/router/rules.ts` verbatim. Zero crypto deps.
  - File: `src/router/selector.ts` (create)
  - Action: Copy from `clawrouter-ref/src/router/selector.ts` verbatim. Zero crypto deps.
  - File: `src/router/strategy.ts` (create)
  - Action: Copy from `clawrouter-ref/src/router/strategy.ts` verbatim. Zero crypto deps.

- [ ] Task 5: Adapt config.ts with user-configurable defaults
  - File: `src/router/config.ts` (create)
  - Action: Copy from `clawrouter-ref/src/router/config.ts`. Modifications:
    - Update `DEFAULT_ROUTING_CONFIG.tiers` default model IDs to match the YAML template defaults (groq/llama for SIMPLE, anthropic/sonnet for MEDIUM, anthropic/opus for COMPLEX/REASONING)
    - Update eco/premium/agentic tier defaults similarly
    - Keep ALL multilingual keyword lists unchanged (EN, ZH, JA, RU, DE, ES, PT, KO, AR)
    - Keep ALL dimension weights and boundaries unchanged
    - Update `classifier.llmModel` to empty string (configured via YAML, SEC-3)
  - Notes: The 1200-line file is mostly keyword lists and weights — only the tier model IDs and classifier model change.

- [ ] Task 6: Adapt LLM classifier for configurable model
  - File: `src/router/llm-classifier.ts` (create)
  - Action: Copy from `clawrouter-ref/src/router/llm-classifier.ts`. Modifications:
    - Change `classifyByLLM` signature: replace `payFetch` with `fetchFn: typeof fetch` (plain fetch, no payment wrapper)
    - Change `apiBase` parameter to accept the resolved provider base URL from config
    - Add API key header injection: `Authorization: Bearer ${apiKey}` for OpenAI-compatible, `x-api-key: ${apiKey}` for Anthropic
    - Keep cache implementation unchanged
    - Keep error handling (default to MEDIUM on failure) unchanged

- [ ] Task 7: Create router entry point with config integration
  - File: `src/router/index.ts` (create)
  - Action: Copy from `clawrouter-ref/src/router/index.ts`. Add:
    - `configureRouter(yamlConfig: LocalRouterConfig): void` — merges YAML tier mappings into DEFAULT_ROUTING_CONFIG
    - When `fallback_classifier.enabled === false`, patch strategy to skip LLM classifier and default to MEDIUM (SEC-3)
    - Re-export all existing exports unchanged

#### Phase 3: Proxy Server (depends on Phase 2)

- [ ] Task 8: Create provider dispatch module
  - File: `src/dispatch.ts` (create)
  - Action: Implement upstream request forwarding:
    - `dispatchRequest(provider: string, model: string, body: Buffer, config: ResolvedConfig): Promise<Response>`
    - Resolve provider from config: get `base_url`, `api_key`, `api` type
    - For `openai-completions`: POST to `${base_url}/chat/completions` with `Authorization: Bearer ${apiKey}`
    - For `anthropic-messages`: POST to `${base_url}/messages` with `x-api-key: ${apiKey}`, `anthropic-version: 2023-06-01`
    - Transform request body between formats if needed (OpenAI ↔ Anthropic message format)
    - Never log API key values (SEC-1) — log provider name and model only
  - Notes: This replaces the `payFetch` wrapper from the original. No payment, just direct API forwarding.

- [ ] Task 9: Create proxy server
  - File: `src/proxy.ts` (create)
  - Action: Adapt from `clawrouter-ref/src/proxy.ts`. Keep:
    - HTTP server creation with `createServer()` on configurable port
    - Socket lifecycle: connection tracking, 5min timeout, error handling
    - Graceful shutdown with connection draining
    - Port binding with retry logic (PORT_RETRY_ATTEMPTS=5)
    - Health check endpoint: `GET /health`
    - Request parsing: extract `model`, `messages`, `max_tokens`, `stream` from JSON body
    - Request normalization: tool ID sanitization, message role mapping (`developer` → `system`)
    - Routing call: `route(prompt, systemPrompt, maxTokens, routerOpts)`
    - Model replacement: `parsed.model = routingDecision.model`
    - Fallback chain: `FALLBACK_STATUS_CODES`, `PROVIDER_ERROR_PATTERNS`, retry with next model
    - Response streaming: SSE simulation (upstream full response → chunked SSE to client)
    - Response transformations: strip thinking tokens, usage passthrough
    - `onRouted` callback for logging
    Remove:
    - All x402 imports and payment client setup
    - `payFetch` wrapper — replace with `dispatchRequest()` from Task 8
    - Balance monitor checks and callbacks
    - `estimateAmount()` function
    - `transformPaymentError()` function
    - Insufficient funds fallback to FREE_MODEL
    - Solana/EVM signer setup
    - `onLowBalance`, `onInsufficientFunds`, `onPayment` callbacks
    - Wallet address display
    Enforce:
    - Bind to `127.0.0.1` by default; only allow `0.0.0.0` if explicitly passed via `--bind` (SEC-2)
    - When `--bind 0.0.0.0` used, print warning to stderr: `"⚠ WARNING: Proxy bound to 0.0.0.0 — accessible from network. Your API keys may be exposed."`
  - Notes: This is the largest task. The original proxy.ts is ~3000 lines; the adapted version should be ~1500-1800 lines.

- [ ] Task 10: Create model aliases and catalog
  - File: `src/models.ts` (create)
  - Action: Adapt from `clawrouter-ref/src/models.ts`:
    - Keep `resolveModelAlias()` function and pattern
    - Keep alias map structure but update entries for configured providers
    - Remove BlockRun-specific aliases
    - Add aliases: `sonnet` → `anthropic/claude-sonnet-4-6-20260315`, `opus` → `anthropic/claude-opus-4-6-20260315`, `llama` → `groq/llama-3.3-70b-versatile`
    - Keep virtual models: `auto`, `eco`, `premium` (routing profiles, not real models)
    - Build model pricing map from YAML config `providers[].models[]` pricing data

#### Phase 4: Plugin & CLI (depends on Phase 3)

- [ ] Task 11: Create OpenClaw provider plugin
  - File: `src/provider.ts` (create)
  - Action: Rewrite following `clawrouter-ref/src/provider.ts` pattern:
    - Export `localRouterProvider: ProviderPlugin` with `id: "local-router"`, `label: "Local Semantic Router"`
    - Dynamic `get models()` pointing to proxy base URL (`http://127.0.0.1:{port}/v1`)
    - `auth: []` — proxy handles auth internally via config
    - Export `setActiveProxy(proxy)` and `getActiveProxy()` — same interface as original
  - File: `src/index.ts` (create)
  - Action: Rewrite following `clawrouter-ref/src/index.ts` pattern:
    - Register `localRouterProvider` with OpenClaw
    - Auto-start proxy when plugin loads (gateway mode)
    - `injectModelsConfig()` — write provider config to OpenClaw's `openclaw.json`
    - `injectAuthProfile()` — create dummy auth profile (proxy handles real auth)
    - Remove all wallet/balance imports and logic

- [ ] Task 12: Create CLI with setup wizard
  - File: `src/cli.ts` (create)
  - Action: Implement standalone CLI:
    - `local-semantic-router` — start proxy with config
    - `local-semantic-router init` — interactive setup wizard:
      1. Ask for providers to configure (checkboxes: Groq, Anthropic, OpenAI, Ollama, custom)
      2. For each selected provider, prompt for API key
      3. Suggest default tier mappings based on selected providers
      4. Generate `config.yaml` with 0600 permissions (SEC-1)
      5. Generate `.env` with API keys, 0600 permissions (SEC-1)
      6. Print next steps: "Run `local-semantic-router` to start"
    - `local-semantic-router --port <number>` — custom port
    - `local-semantic-router --bind <address>` — bind address (SEC-2)
    - `local-semantic-router --config <path>` — custom config path
    - `local-semantic-router --version` — version info
    - `onReady(port)`: print banner with configured tiers and providers
    - `onRouted(decision)`: print `[TIER] provider/model $cost (saved X%)`
    - When `fallback_classifier.enabled === true`, print startup warning (SEC-3)
  - Notes: Setup wizard uses Node.js `readline` — no external CLI framework needed for v1.

#### Phase 5: Tests (depends on all phases)

- [ ] Task 13: Port and adapt existing tests
  - File: `src/router/selector.test.ts` (create)
  - Action: Adapt from `clawrouter-ref/src/router/selector.test.ts`. Update model IDs and pricing to match new defaults.
  - File: `src/router/strategy.test.ts` (create)
  - Action: Adapt from `clawrouter-ref/src/router/strategy.test.ts`. Update model IDs. Verify all 4 profiles (auto/eco/premium/agentic) produce correct decisions.

- [ ] Task 14: Add new tests for local-semantic-router specific code
  - File: `src/config-loader.test.ts` (create)
  - Action: Test config loading:
    - Valid YAML parsed correctly
    - `${ENV_VAR}` interpolation resolves from process.env
    - Invalid YAML (unknown fields) rejected
    - Missing required fields produce clear errors
    - YAML with `!!js/function` rejected (SEC-7)
    - URL validation catches invalid base_url values
  - File: `src/dispatch.test.ts` (create)
  - Action: Test provider dispatch:
    - OpenAI-compatible request includes correct Authorization header
    - Anthropic request includes correct x-api-key and anthropic-version headers
    - API keys never appear in error messages or logs (SEC-1)
  - File: `src/proxy.test.ts` (create)
  - Action: Test proxy server:
    - Binds to 127.0.0.1 by default (SEC-2)
    - Routes request through `route()` and modifies model in body
    - Fallback chain retries on provider error
    - Health check endpoint returns 200
    - Classifier disabled by default → ambiguous prompts get MEDIUM (SEC-3)

### Acceptance Criteria

#### Routing Engine
- [ ] AC-1: Given a simple prompt like "what is the capital of France", when `route()` is called, then `tier` is `SIMPLE` and `model` matches the configured SIMPLE tier primary model.
- [ ] AC-2: Given a complex prompt with reasoning markers like "prove using mathematical induction that...", when `route()` is called, then `tier` is `REASONING` with confidence > 0.7.
- [ ] AC-3: Given the `eco` routing profile, when any prompt is routed, then the selected model comes from `config.tiers.eco` mappings.
- [ ] AC-4: Given all 4 routing profiles (auto/eco/premium/agentic), when configured via YAML, then each profile produces distinct model selections per tier.

#### Config Loader
- [ ] AC-5: Given a YAML config with `api_key: "${GROQ_API_KEY}"` and env var `GROQ_API_KEY=sk-test`, when config is loaded, then `api_key` resolves to `"sk-test"`.
- [ ] AC-6: Given a YAML file with `!!js/function` constructor, when config is loaded, then parsing fails with a clear security error (SEC-7).
- [ ] AC-7: Given a YAML config with an unknown field `foo: bar`, when config is loaded, then validation fails with "unknown field: foo".
- [ ] AC-8: Given a config file with permissions 0644, when loaded, then a warning is printed: "Config file has insecure permissions" (SEC-1).

#### Proxy Server
- [ ] AC-9: Given a proxy started with default config, when checking the bound address, then it is `127.0.0.1` not `0.0.0.0` (SEC-2).
- [ ] AC-10: Given `--bind 0.0.0.0` flag, when proxy starts, then a warning is printed to stderr about network exposure (SEC-2).
- [ ] AC-11: Given a POST to `/v1/chat/completions` with `model: "auto"`, when the proxy receives it, then `route()` is called and the response comes from the tier-selected provider.
- [ ] AC-12: Given a provider returns 429 (rate limit), when the proxy detects the error, then it retries with the next model in the fallback chain.
- [ ] AC-13: Given `stream: true` in the request, when the upstream returns a full response, then the proxy converts it to SSE chunks streamed to the client.

#### LLM Classifier
- [ ] AC-14: Given `fallback_classifier.enabled: false` (default), when a prompt has low classification confidence, then `route()` returns `MEDIUM` tier without making any external LLM call (SEC-3).
- [ ] AC-15: Given `fallback_classifier.enabled: true`, when the proxy starts, then a warning message is printed about prompt forwarding (SEC-3).
- [ ] AC-16: Given the classifier is enabled and the classifier LLM fails, when classifying an ambiguous prompt, then `MEDIUM` tier is returned as safe default.

#### Security
- [ ] AC-17: Given any log verbosity level, when a request is processed, then no API key value appears in stdout or stderr (SEC-1).
- [ ] AC-18: Given the `init` command generates a config.yaml, when checking file permissions, then they are 0600 (SEC-1).
- [ ] AC-19: Given a `.env` file in the project root, when config loads, then env vars from `.env` are available for `${VAR}` interpolation (SEC-8).

#### OpenClaw Integration
- [ ] AC-20: Given the plugin is loaded by OpenClaw, when OpenClaw queries available providers, then `local-router` appears with models pointing to `http://127.0.0.1:{port}/v1`.
- [ ] AC-21: Given OpenClaw sends a request to `local-router/auto`, when the proxy receives it, then routing, dispatch, and response streaming work end-to-end identically to the original ClawRouter integration pattern.

## Additional Context

### Dependencies

**Runtime (npm):**
- `yaml` — YAML parsing with JSON_SCHEMA (SEC-7)
- `dotenv` — .env file loading (SEC-8)

**Dev (npm):**
- `typescript` — type checking
- `tsup` — build/bundle
- `vitest` — test framework
- `eslint` + `prettier` — code quality

**Removed from original:**
- `@scure/bip32`, `@scure/bip39` — BIP wallet derivation (crypto)
- `@x402/evm`, `@x402/fetch`, `@x402/svm` — micropayment protocol (crypto)
- `ethers`, `viem` — blockchain libraries (crypto)
- `@solana/kit` — Solana integration (crypto)

**Peer (optional):**
- `openclaw` >= 2025.1.0 — for plugin integration mode

### Testing Strategy

**Unit tests (vitest):**
- Router core: scoring engine, tier classification, model selection, strategy profiles
- Config loader: YAML parsing, interpolation, validation, permission checks
- Dispatch: header injection, format transformation, key masking

**Integration tests (vitest):**
- Proxy: end-to-end request → route → dispatch → response flow
- Fallback chain: provider error → retry with next model
- Streaming: SSE simulation correctness

**Manual testing:**
- CLI setup wizard flow
- OpenClaw plugin registration and request routing
- Real provider dispatch (Groq, Anthropic) with actual API keys

### Notes

- Original repo is MIT licensed — extraction is permitted
- The 1200-line config.ts contains multilingual keywords (EN, ZH, JA, RU, DE, ES, PT, KO, AR) — preserve all
- The user's primary use case is OpenClaw integration, but the library should be usable standalone
- High-risk item: proxy.ts adaptation is the largest task (~3000 lines → ~1500-1800 lines). Keep the original structure and delete payment code surgically rather than rewriting from scratch
- The `llm-classifier.ts` uses a generic `PayFetch` callback type — replacing with `fetch` is mechanical
- Config validation schema should be strict but extensible — allow `x-` prefixed custom fields for future extension
