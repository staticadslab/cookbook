# Reviews to persona image ads

Turn a **reviews export** (4★ and 5★ rows) into **buyer personas** with Gemini, then batch-create **Static Ads Lab audiences** and **Meta-ready image ads** (one PNG per ad). This is a **developer starter**: small Express server, vanilla UI, no database.

**API rules and behavior:** [https://www.staticadslab.com/llms.txt](https://www.staticadslab.com/llms.txt) (source of truth for this recipe).

---

## For AI coding agents (Claude Code, Cursor, etc.)

**Intent:** Linear workflow: CSV to structured personas to SAL `audiences` + `image-ads`. Image-ad creates use **bounded parallel POSTs** (up to **8** at a time per [llms.txt](https://www.staticadslab.com/llms.txt)); enlarge the persona × template grid only if you also cap or stagger traffic. The **browser does not call SAL**; it stores **`imageAdId` / `jobId`** in **`localStorage`**, then polls **`POST /api/generate/status`**. Each status check triggers **one batched `GET /v1/image-ads?ids=…`** on the server (batch-poll in llms.txt), so progress is **one aggregate SAL read per tick**, not N requests per id.

High-level map: `src/main.ts` to `src/workflow.ts`, `src/http/server.ts`. **Where to edit:** see [`prompt.md`](prompt.md) (keeps this README short).

**Entry / narrative:** Read `src/main.ts` (pseudocode comments) then `src/workflow.ts` and `src/http/server.ts`. UI: `public/index.html`, `public/app.js`, `public/styles.css`.

**Secrets:** Server only — never expose `API_KEY_*` under `public/`.

**State:** `sessionStorage`: CSV, personas, checkbox selections. **`localStorage`:** current generation row ids (refresh resumes the job table + polling).

**UI polling:** ~**4s** while any row is non-terminal; when all are **`completed`** or **`failed`**, one optional **~30s** follow-up, then idle. **Pauses** when the tab is hidden; **resumes** on visibility or window **focus**.

**Dependencies:** `ai` (v6), `@ai-sdk/google`, `zod`, `express`, `csv-parse`, `tsx`, `typescript`.

---

## Prerequisites

- Node.js **20+** (modern `fetch`; 22 is fine).
- **Google AI Studio** key: `API_KEY_GOOGLE_GEMINI`.
- **Static Ads Lab** key: `API_KEY_STATIC_ADS_LAB` (`X-API-Key` header — see llms.txt).
- **BYO** SAL ids: brand, product, optional variant, **completed** design template ids in your workspace.

## Environment variables

Copy `.env.example` to `.env` (optional **`.env.local`** after `.env` for overrides):

| Variable | Required | Purpose |
|----------|----------|---------|
| `API_KEY_GOOGLE_GEMINI` | Yes | Gemini (server-side only). |
| `API_KEY_STATIC_ADS_LAB` | Yes | Static Ads Lab (`X-API-Key`). |
| `GEMINI_MODEL` | No | Default: `gemini-3.1-flash-lite-preview`. |
| `PORT` | No | Default `9000`. |

SAL base URL is fixed in `src/lib/staticadslab-client.ts` to **`https://api.staticadslab.com`** (llms.txt Base URL).

## BYO data

1. **CSV:** Columns **`rating`** and **`review`** (Loox-style works). Keeps **4–5★** only. Parser notes: `src/lib/parse-reviews.ts`.
2. **SAL ids:** `src/config/recipe-constants.ts` — `brandId`, `productId`, optional `productVariantId`, `designTemplateIds` (≥1). Shipped empty until you configure; **Generate image ads** validates against the API.

Grid: **`PERSONA_SLOT_COUNT` × `designTemplateIds.length`** image ads (adjust in `recipe-constants.ts`).

## How to run

```bash
cd recipes/reviews-to-persona-image-ads
npm install
cp .env.example .env
# Edit .env and src/config/recipe-constants.ts
npm start
```

Watch mode: `npm run dev`.

Open **http://localhost:9000** (or **`PORT`**) — CSV to infer personas to select **`PERSONA_SLOT_COUNT`** personas to generate.

### `GET /api/config/env-status`

On load the UI fetches env/config status. Response includes:

- **`personaSlotCount`** — must match `PERSONA_SLOT_COUNT` for checkbox rules
- **`geminiModelId`** — shown in step 2
- **`recipeConstantsIssues`** / **`recipeConstantsReady`** — POC checks on `recipe-constants.ts`
- **`canGenerateAds`** — true when env + constants look ready

**Banner:** green if checks pass; yellow lists gaps; red if the request failed.

**Debugging:** Server logs `[reviews-to-persona-image-ads]`; browser `[reviews-to-persona-image-ads UI]`. Keys are never logged.

## Expected outputs

- **UI:** Job table + thumbnails and **PNG** download when `image_url` is set.
- **API:** `POST /api/reviews/clean`, `/api/personas`, `/api/generate/start`, `/api/generate/status` — see `src/http/server.ts`.

## Troubleshooting

| Symptom | Things to check |
|--------|------------------|
| `Missing required environment variable` | `.env` in recipe directory; exact variable names. |
| `401` / SAL auth | Key and `X-API-Key` header (llms.txt). |
| `402` / insufficient balance | Wallet top-up — error payload / response may include a top-up URL (llms.txt). |
| Gemini errors | `GEMINI_MODEL`, billing, `API_KEY_GOOGLE_GEMINI`. |
| `CSV must include "review" and "rating"` | Headers / export dialect; PO supports this shape only. |
| Status stuck on “Waiting” | Reachability of `api.staticadslab.com`; stale ids in `localStorage`. Async pattern: [Async jobs guide](https://www.staticadslab.com/docs/guides/async-jobs.mdx). |
| Many duplicate audiences | Expected for this POC; production may reuse or clean up audiences. |

## Claude Code

See [`prompt.md`](prompt.md) for a short handoff template.
