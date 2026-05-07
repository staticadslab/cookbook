# Agent guide — reviews-to-benefit-image-ads

## Audience and tone

The reader is a boutique ads agency owner using Cursor or Claude Code, not a backend engineer. Explain outcomes in plain language; put protocol detail in code comments only.

## Read in this order

1. <https://www.staticadslab.com/llms.txt> — Static Ads Lab rules when touching generation or polling.
2. [`src/main.ts`](./src/main.ts) — top-of-file algorithm header.
3. This file — file map below.

## Files most users want to edit

- [`src/config/recipe-constants.ts`](./src/config/recipe-constants.ts) — SAL ids, template pool, chunk size.
- [`prompts/extract-review-signals.md`](./prompts/extract-review-signals.md) — extraction stage (signals + evidence).
- [`prompts/discover-benefits.md`](./prompts/discover-benefits.md) — benefit clustering stage (runs after extraction in the same analyze request).
- [`src/lib/generate-benefit-ads.ts`](./src/lib/generate-benefit-ads.ts) — image-ad **prompt** assembly (benefit + highlighted review); no node overrides.

## Files to read for context if needed

- [`src/lib/env.ts`](./src/lib/env.ts) — dotenv load; async env-status payload (SAL name lookups for the workspace card).
- [`src/workflow.ts`](./src/workflow.ts) — `runBenefitAnalyze` chains extraction → discovery.
- [`src/http/server.ts`](./src/http/server.ts) — routes; review analysis is `POST /api/benefits/analyze`; template thumbnails for the picker come from `GET /api/design-templates/pool` (server uses `RECIPE_IDS.designTemplateIds` + SAL; browser shows **reference** image first when both exist, else **preview**).
- [`public/app.js`](./public/app.js) — staged UI, chart, polling.

## Safety

Never ship `.env` or API keys. The Static Ads Lab key stays on the server.
