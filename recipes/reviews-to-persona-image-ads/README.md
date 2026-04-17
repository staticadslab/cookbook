# Reviews → persona image ads

Turn a **reviews export** (4★ and 5★ rows) into **buyer personas** with Gemini, then batch-create **Static Ads Lab audiences** and **Meta-ready image ads** (one PNG per ad). This is a **developer starter**: small Express server, vanilla UI, no database.

---

## For AI coding agents (Claude Code, Cursor, etc.)

**Intent:** Demonstrate a linear workflow: CSV → structured personas → SAL `audiences` + `image-ads`. Image ads are **POSTed in parallel** (SAL queues work). The **browser does not call SAL**; it persists **`imageAdId` / `jobId` rows in `localStorage`**, then polls **`POST /api/generate/status`**. Each status check triggers **one batched `GET /v1/image-ads?ids=…`** on the server (see [OpenAPI — list image ads](https://www.staticadslab.com/api/openapi)), so progress is **one aggregate read per tick**, not N requests per id. Fork by changing `src/config/recipe-constants.ts`, prompts in `prompts/`, or the grid logic in `src/lib/generate-image-ads.ts`.

**Entry / narrative:** Read `src/main.ts` (pseudocode comments) then `src/workflow.ts` and `src/http/server.ts`. The static UI is `public/index.html`, `public/app.js`, and `public/styles.css`.

**Secrets:** Only on the server. Never expose `API_KEY_*` to `public/`.

**State:** `sessionStorage` holds CSV + personas + checkbox selections. **`localStorage`** holds the current generation’s row ids so a refresh can reopen the **job table** and resume polling.

**UI polling:** ~**4s** while any row is still `processing`; when every row is **`completed`** or **`failed`**, one optional **~30s** follow-up request runs, then the timer **idles** (no steady polling while nothing is moving). Polling **pauses when the tab is hidden** and resumes when the tab is visible or the window gains **focus**.

**Dependencies:** `ai` (v6), `@ai-sdk/google`, `zod`, `express`, `csv-parse`, `tsx`, `typescript`.

---

## Prerequisites

- Node.js **20+** (for a modern `fetch` runtime; 22 is fine).
- A **Google AI Studio** key for Gemini (`API_KEY_GOOGLE_GEMINI`).
- A **Static Ads Lab** API key (`API_KEY_STATIC_ADS_LAB`).
- **BYO** brand id, product id, optional product variant id, and **design template ids** that already exist in your workspace.

## Environment variables

Copy `.env.example` to `.env` and fill in (optional: add **`.env.local`** for machine-specific keys — it is loaded after `.env` and overrides the same keys):

| Variable | Required | Purpose |
|----------|----------|---------|
| `API_KEY_GOOGLE_GEMINI` | Yes | Gemini API key (server-side only). |
| `API_KEY_STATIC_ADS_LAB` | Yes | Static Ads Lab API key (`X-API-Key` header). |
| `GEMINI_MODEL` | No | Override model id (default: `gemini-3.1-flash-lite-preview`). |
| `PORT` | No | HTTP port (default: `9000`; cookbook recipes use `9000+` so they stay off crowded ports like `3000`). |

The Static Ads Lab base URL is fixed to **`https://api.staticadslab.com`** in `src/lib/staticadslab-client.ts` (not an env var in this recipe).

## BYO data

1. **CSV:** Review-app export with **`rating`** and **`review`** columns (Loox-style exports work). This recipe keeps **4 and 5** star rows only. Messy text may still need manual cleanup — see comments in `src/lib/parse-reviews.ts`.
2. **Static Ads Lab ids:** Edit `src/config/recipe-constants.ts` and **fill in** your workspace values: `brandId`, `productId`, optional `productVariantId` (or leave empty to omit), and at least one id in `designTemplateIds`. The repo starts with empty ids so the UI banner lists what is missing; ids are **not** validated against the API until you run **Generate image ads**. Each string in `designTemplateIds` is one “creative” in the grid.

Default grid size: **`PERSONA_SLOT_COUNT` personas × number of template ids** (see `recipe-constants.ts`). Adjust constants to change the split.

## How to run

```bash
cd recipes/reviews-to-persona-image-ads
npm install
cp .env.example .env
# Edit .env and src/config/recipe-constants.ts
npm start
```

Watch mode (restart server on TypeScript changes): `npm run dev`.

Open **http://localhost:9000** (unless you set `PORT`) — paste or upload CSV, infer personas, select the required number of personas (`PERSONA_SLOT_COUNT`), generate ads.

The UI calls **`GET /api/config/env-status`** on load. The response includes **`personaSlotCount`** (same as `PERSONA_SLOT_COUNT` in `recipe-constants.ts` for how many personas to select), **`geminiModelId`**, **`recipeConstantsIssues`** (strings describing missing or empty SAL id fields in `recipe-constants.ts`), **`recipeConstantsReady`**, and **`canGenerateAds`** (false until env keys and constants look ready). The **strip at the very top** shows **green** only when env and constants pass these POC checks; **yellow** lists what’s missing; **red** if the request failed. **Step 2** shows the Gemini model id.

**Debugging:** Server logs use the prefix `[reviews-to-persona-image-ads]`; the browser console uses `[reviews-to-persona-image-ads UI]`. No API key values are logged—only counts, ids, and timings.

## Expected outputs

- **UI:** A **job table** (job / image-ad id, status, created time) plus thumbnails and **per-ad PNG** download links when `image_url` is available.
- **API:** JSON from `POST /api/reviews/clean`, `/api/personas`, **`/api/generate/start`** (enqueue), **`/api/generate/status`** (batched progress) — see `src/http/server.ts`.

## Troubleshooting

| Symptom | Things to check |
|--------|------------------|
| `Missing required environment variable` | `.env` present and loaded from the recipe directory; variable names match exactly. |
| `401` / SAL auth errors | `API_KEY_STATIC_ADS_LAB` and key header (`X-API-Key`) — see `src/lib/staticadslab-client.ts`. |
| Gemini errors | Model id (`GEMINI_MODEL`), billing, and `API_KEY_GOOGLE_GEMINI`. |
| `CSV must include "review" and "rating"` | Export headers; rename columns or adjust parser for your dialect (POC only supports this shape). |
| Status table stuck on “Waiting” | Network path to `https://api.staticadslab.com`; image ad ids in `localStorage` still valid. Jobs overview: [Static Ads Lab docs — Jobs](https://www.staticadslab.com/docs#tag/jobs). |
| Many duplicate audiences | Expected for a POC; production workflows might reuse audiences or delete stale ones. |

## Claude Code

See [`prompt.md`](prompt.md) in this folder for a short handoff template.
