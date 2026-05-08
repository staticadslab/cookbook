/**
 * Recipe: customer-reviews-to-persona-image-ads
 *
 * High-level algorithm (proof-of-concept — not production-grade):
 *
 * 1. LOAD CONFIG
 *    - API keys from environment (Gemini + Static Ads Lab).
 *    - Resource ids from `src/config/recipe-constants.ts` (brand, product, variant, design templates).
 *
 * 2. INGEST REVIEWS (CSV TEXT)
 *    - Parse with real CSV rules; require `rating` + `review` columns.
 *    - Keep 4★ and 5★ rows only; output review strings for the model.
 *    - Exporters vary — noisy text / duplicates / seller replies may need manual cleanup (out of scope).
 *
 * 3. INFER PERSONAS (GEMINI, STRUCTURED OUTPUT)
 *    - Produce TARGET_PERSONA_COUNT personas with shortLabel, narrative, confidence, testimonials[].
 *
 * 4. SELECT PERSONAS (BROWSER)
 *    - User picks PERSONA_SLOT_COUNT personas; selections live in sessionStorage (data may be lost on refresh).
 *
 * 5. CREATE ONE SAL AUDIENCE PER SELECTED PERSONA
 *    - name = shortLabel; description = narrative + testimonial bullets.
 *
 * 6. GENERATE IMAGE ADS (GRID)
 *    - POST every persona × design_template_id row in parallel (SAL queues work server-side).
 *    - Server returns row ids immediately; browser persists them in localStorage and polls
 *      POST /api/generate/status, which issues one batched GET /v1/image-ads?ids=... per tick.
 *    - Default grid size = PERSONA_SLOT_COUNT × designTemplateIds.length (see recipe-constants).
 *
 * 7. PREVIEW + DOWNLOAD
 *    - Static UI lists `image_url` per ad for download (no ZIP in this POC).
 */

import { createServer } from './http/server.js';
import { recipeLog } from './lib/debug-log.js';
import { loadEnvFromDotenvFile } from './lib/env.js';

loadEnvFromDotenvFile();

/** Cookbook default: recipes use 9000+ to avoid clashing with common dev ports (e.g. 3000). */
const DEFAULT_PORT = 9000;
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
  recipeLog('Filter terminal output with: rg "customer-reviews-to-persona-image-ads"');
});
