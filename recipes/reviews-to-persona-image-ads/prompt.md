# Claude Code prompt stub — `reviews-to-persona-image-ads`

Use this file as a starting instruction when extending the recipe.

## Goal

This recipe shows: **reviews CSV → Gemini personas → Static Ads Lab audiences + image ads → PNG URLs**. Keep the orchestration in `src/main.ts` easy to skim; put logic in `src/lib/*` and the HTTP surface in `src/http/server.ts` / `src/workflow.ts`.

**Generate flow:** the browser calls **`POST /api/generate/start`** (enqueue all image ads), persists returned **`imageAdId` / `jobId` rows in `localStorage`**, then **`POST /api/generate/status`** on a timer. The server performs **batched `GET /v1/image-ads?ids=…`** per status request — not N SAL calls from the client.

## Likely edit points

- `src/config/recipe-constants.ts` — brand, product, variant, design template ids, and **`PERSONA_SLOT_COUNT`** (how many personas the user must select; also exposed as **`personaSlotCount`** on **`GET /api/config/env-status`** for `public/app.js`).
- `prompts/infer-personas.md` — persona quality and evidence rules.
- `src/lib/generate-image-ads.ts` — grid / prompt text; **enqueue only** (no blocking wait on the server).
- `src/lib/staticadslab-client.ts` — SAL HTTP helpers; base URL is fixed to **`https://api.staticadslab.com`** in this recipe.
- `src/workflow.ts` — `enqueueAdsForSelectedPersonas`, `getGenerationStatus` (batched list by ids).
- `public/app.js` — UX, **`localStorage`** generation session, adaptive polling (tab visibility / focus); **never** add API keys.
- `public/styles.css` — layout and components for the main UI (`index.html`).

## Safety

- Do not commit real `.env` files or keys.
- This is not production code: minimal validation, no auth. **CSV/persona picks** live in **`sessionStorage`** (tab-scoped). **Image-ad queue rows** live in **`localStorage`** until the user clears them or overwrites with a new run.

## Suggested next tasks for an agent

1. **Fill in** Static Ads Lab ids in `recipe-constants.ts` (`brandId`, `productId`, optional `productVariantId`, at least one `designTemplateIds` entry). The stock recipe uses empty values until you configure your workspace.
2. Tune **`PERSONA_SLOT_COUNT`** and persona inference (`TARGET_PERSONA_COUNT`, prompts) to match your agency workflow.
3. Add optional CLI entry that reads a CSV path (if you need automation without the browser).
