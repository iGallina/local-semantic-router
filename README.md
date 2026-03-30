# local-semantic-router

> Smart LLM router without wallets, crypto, or SaaS. Just your API keys.

**local-semantic-router** classifies prompts by complexity and routes them to the cheapest capable model — no wallet, no subscription, no hosted proxy. It runs locally as an OpenAI-compatible HTTP server.

## Why

Every LLM router either:

- Requires a crypto wallet + micropayments
- Is a closed SaaS you can't self-host
- Adds operational overhead you don't need

This project gives you intelligent routing using only API keys you already have.

## How It Works

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

The rules engine scores each prompt across 14 dimensions (token count, code indicators, reasoning markers, etc.) and assigns a tier. Each tier maps to a model from your configured providers — simple prompts go to fast/cheap models, complex ones to more capable (and expensive) models.

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
