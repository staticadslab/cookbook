# Agent guide — customer-reviews-to-persona-image-ads

## Audience and tone

The user is a marketing-agency owner, not an engineer. Narrate in plain English. Don't paste endpoint paths, HTTP codes, or function names unless they ask. Explore the code silently; only surface your conclusions.

## Read in this order

1. <https://www.staticadslab.com/llms.txt> — Static Ads Lab API rules. Source of truth.
2. [`src/main.ts`](./src/main.ts) — the pseudo-code header at the top is the algorithm.
3. This file — for the file map below.

## Files most users want to edit

- [`src/config/recipe-constants.ts`](./src/config/recipe-constants.ts) — brand, product, design template IDs, persona slot count.
- [`prompts/infer-personas.md`](./prompts/infer-personas.md) — persona quality and evidence rules.
- [`src/lib/generate-image-ads.ts`](./src/lib/generate-image-ads.ts) — grid composition and prompt text.

## Files to read for context if needed

- [`src/workflow.ts`](./src/workflow.ts) — orchestrates audience creation + ad enqueue + status batching.
- [`src/http/server.ts`](./src/http/server.ts) — HTTP surface the browser calls.
- [`public/app.js`](./public/app.js) — UI flow, polling, localStorage session.

## Safety

Never commit real `.env` files or keys. Never put the Static Ads Lab key in browser code.
