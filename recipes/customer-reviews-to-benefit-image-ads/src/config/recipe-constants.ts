/**
 * Tuning knobs for this recipe. Workspace resources (brand, product, audience,
 * templates) are picked in the UI and loaded from Static Ads Lab with the API key.
 */

/** Gemini reviews per request in extraction (smaller batches = fewer structured-output failures). */
export const PASS1_REVIEWS_PER_CHUNK = 10;

/** User can select at most this many design templates per generation run. */
export const MAX_TEMPLATES_PER_RUN = 3;
