---
name: local-semantic-router
description: Local semantic LLM router — routes prompts to the cheapest capable model using your own API keys. Supports Groq, OpenRouter, Anthropic, OpenAI, and Ollama.
homepage: https://github.com/iangallina/local-semantic-router
metadata: { "openclaw": { "emoji": "🧭" } }
---

# Local Semantic Router

Routes every request to the cheapest capable model across your configured providers, using your own API keys. No third-party payment layer required.

## Install

```bash
openclaw plugins install /path/to/local-semantic-router
```

## Setup

```bash
# Use the smart router (auto-picks cheapest model per request)
openclaw models set local-semantic-router/auto

# Or run standalone
local-semantic-router
```

## How Routing Works

Classifies each request into one of four tiers:

- **SIMPLE** — factual lookups, greetings, translations
- **MEDIUM** — summaries, explanations, data extraction
- **COMPLEX** — code generation, multi-step analysis
- **REASONING** — proofs, formal logic, multi-step math

Rules handle ~80% of requests in <1ms. Only ambiguous queries hit the LLM classifier.
