# local-semantic-router

> Smart LLM router without wallets, crypto, or SaaS. Just API keys.

Inspired by [ClawRouter](https://github.com/BlockRunAI/ClawRouter) (MIT).

## The Problem

Every LLM router either:
- Requires a crypto wallet + micropayments (ClawRouter, blockrun)
- Is a closed SaaS (OpenRouter auto, RouteLLM)
- Requires a running server (LiteLLM)

**local-semantic-router** routes requests to the cheapest capable model using only
API keys you already have — no wallet, no subscription, no server.

## Architecture (planned)

```
prompt
  │
  ▼
┌─────────────────────────────┐
│  Rules Engine (<1ms)        │  ← 14-dimension scoring, no network call
│  SIMPLE / MEDIUM / COMPLEX  │
│  REASONING                  │
└─────────────┬───────────────┘
              │  low confidence?
              ▼
┌─────────────────────────────┐
│  LLM Classifier (optional)  │  ← fast cheap model as fallback classifier
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Provider Map               │  ← your API keys, your models, your tiers
│  groq / anthropic / openai  │
│  openrouter / ollama / ...  │
└─────────────┬───────────────┘
              │
              ▼
           response
```

## Reference

- `clawrouter-ref/` — ClawRouter source (MIT, read-only reference)
- Key files to extract: `src/router/` (9 files, pure logic, no crypto deps)

## Status

🚧 Spec phase — not yet implemented
