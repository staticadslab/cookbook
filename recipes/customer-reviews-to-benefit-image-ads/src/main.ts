/**
 * Recipe: customer-reviews-to-benefit-image-ads
 *
 * High-level algorithm (proof-of-concept):
 *
 * 1. LOAD CONFIG — API keys from `.env` (Gemini + Static Ads Lab). SAL ids in
 *    `src/config/recipe-constants.ts`. GET /api/config/env-status also reads brand, product, variant,
 *    and audience **names** from SAL (when the key and ids validate) for the workspace summary card.
 *
 * 2. INGEST — Parse reviews CSV (`rating`, `review` required; optional `customer_name`, `date`); keep 4–5★;
 *    assign stable `review_index` per row.
 *
 * 3. ANALYZE — `POST /api/benefits/analyze` runs two Gemini stages back-to-back: batched structured extraction
 *    per review (`signals` + `evidence_substrings`; server scrubs evidence not in text), then one discovery call
 *    for benefit `label`s and `source_review_indices` (counts for the chart).
 *
 * 4. UI — Bar chart + benefit picks + visual template cards. Thumbnail metadata for the card grid is loaded
 *    read-only from SAL via a small pool route (ids from `recipe-constants.ts`); see `src/http/server.ts`.
 *
 * 5. GENERATE — For each selected benefit × template: flat image ad whose `prompt` carries the benefit theme
 *    plus the strongest source review (full text + voice snippet). No `node_overrides` — SAL pipeline writes
 *    layout copy from that prompt. Batched server-side polling.
 */

import { createServer } from './http/server.js';
import { recipeLog } from './lib/debug-log.js';
import { loadEnvFromDotenvFile } from './lib/env.js';

loadEnvFromDotenvFile();

/** Default avoids clashing with the persona recipe on 9000 when both run locally. */
const DEFAULT_PORT = 9001;
const port = Number(process.env.PORT) || DEFAULT_PORT;
recipeLog('Boot', {
  port,
  cwd: process.cwd(),
  geminiKeySet: Boolean(process.env.API_KEY_GOOGLE_GEMINI?.trim()),
  salKeySet: Boolean(process.env.API_KEY_STATIC_ADS_LAB?.trim()),
});

const app = createServer();

app.listen(port, () => {
  console.log(`Recipe server listening on http://localhost:${port}`);
  recipeLog('Filter terminal output with: rg "customer-reviews-to-benefit-image-ads"');
});
