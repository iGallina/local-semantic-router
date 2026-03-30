# local-semantic-router

**TL;DR** — Stop paying Opus prices for "list all files in src/". This proxy sits between your tools and LLM providers, classifies every prompt by complexity in <1ms, and routes it to the cheapest model that can handle it. No wallet, no SaaS, no crypto. Just your API keys.

---

## What it does

You send all requests to `http://127.0.0.1:8402` (OpenAI-compatible). The router scores each prompt across 14 dimensions and picks a tier:

| Prompt | Tier | Routed to | Cost |
|--------|------|-----------|------|
| "list files in src/" | SIMPLE | Groq Llama 70B | $0.59/M in |
| "add error handling to this function" | MEDIUM | Claude Sonnet | $3/M in |
| "redesign the auth system with OAuth2 + RBAC" | COMPLEX | Claude Opus | $15/M in |
| "prove this algorithm is O(n log n)" | REASONING | Claude Opus | $15/M in |

**Result**: ~70% of prompts in a typical coding session are SIMPLE or MEDIUM — they never hit your most expensive model.

### Real-world example

A 100-request coding session without routing:
- 100 requests x Opus = **$15/M input tokens across all requests**

Same session with local-semantic-router:
- 50 SIMPLE requests x Groq Llama = **$0.59/M**
- 30 MEDIUM requests x Sonnet = **$3/M**
- 20 COMPLEX/REASONING x Opus = **$15/M**
- **Blended cost drops ~60%** with zero quality loss on complex tasks

Pair with [RTK](https://github.com/iGallina/rtk) (token-optimized CLI proxy) to also cut token volume 60-90% on dev operations — the savings compound.

---

## How it works

```
prompt
  |
  v
+-----------------------------+
|  Rules Engine (<1ms)        |  14-dimension scoring, no network call
|  SIMPLE / MEDIUM / COMPLEX  |
|  REASONING                  |
+-------------+---------------+
              |  low confidence?
              v
+-----------------------------+
|  LLM Classifier (optional)  |  fast cheap model as fallback
+-------------+---------------+
              |
              v
+-----------------------------+
|  Provider Map               |  your API keys, your models
|  groq / anthropic / openai  |
|  openrouter / ollama / ...  |
+-------------+---------------+
              |
              v
           response
```

Classification happens locally with zero network calls. Only the final routed request hits a provider API.

## Quick Start

```bash
# Install
npm install -g local-semantic-router

# Interactive setup (creates ~/.local-semantic-router/config.yaml)
local-semantic-router init

# Start the proxy
local-semantic-router
# => Listening on http://127.0.0.1:8402
```

Then point your tools at `http://127.0.0.1:8402` as an OpenAI-compatible endpoint.

## Configuration

The `init` command creates `~/.local-semantic-router/config.yaml`:

```yaml
port: 8402
bind: "127.0.0.1"
routing_profile: auto    # auto | eco | premium | agentic

providers:
  groq:
    api: openai-completions
    base_url: "https://api.groq.com/openai/v1"
    api_key: "${GROQ_API_KEY}"
    models:
      - id: "llama-3.3-70b-versatile"
        input_price: 0.59
        output_price: 0.79

  anthropic:
    api: anthropic-messages
    base_url: "https://api.anthropic.com/v1"
    api_key: "${ANTHROPIC_API_KEY}"
    models:
      - id: "claude-sonnet-4-6-20260315"
        input_price: 3.0
        output_price: 15.0

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
```

API keys use `${ENV_VAR}` interpolation — set them in a `.env` file or export them in your shell.

## Features

- **14-dimension scoring** — rules-based classification in <1ms, no network call
- **4 routing profiles** — auto, eco, premium, agentic
- **OpenAI-compatible proxy** — drop-in replacement for any tool expecting the OpenAI API
- **Tools format translation** — automatically converts between OpenAI and Anthropic tool calling formats
- **Streaming support** — SSE streaming pass-through
- **Fallback chains** — automatic retry with next provider on failure
- **Security defaults** — localhost-only binding, no eval, API keys masked in logs

## Development

```bash
git clone https://github.com/iGallina/local-semantic-router.git
cd local-semantic-router
npm install
cp .env.example .env   # fill in your API keys

npm run dev            # start with tsx (hot reload)
npm test               # run tests (vitest)
npm run typecheck      # type check
npm run build          # build for production
```

## Acknowledgments

Inspired by [ClawRouter](https://github.com/BlockRunAI/ClawRouter) (MIT) — the routing logic was extracted and rebuilt without crypto/wallet dependencies.

## License

[MIT](LICENSE)
