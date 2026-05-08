/**
 * Static Ads Lab resource IDs for this recipe (not secrets).
 *
 * They are workspace-scoped: shipping real ids would point clones at the wrong
 * account or return 404s. This file ships **empty** values so forks get clear
 * UI hints until configured. See the recipe README for what to paste from your
 * workspace. Image-ad copy is prompt-driven (no per-node overrides in this recipe).
 */
export const RECIPE_IDS = {
  /** Brand that owns the product and templates. */
  brandId: "",

  /** Product used for image-ad generation (required by the SAL API). */
  productId: "",

  /** Audience that steers tone and copy for generated ads. */
  audienceId: "",

  /**
   * Optional SKU-level images; omit for this POC by leaving empty.
   * The server only sends `product_variant_id` when non-empty.
   */
  productVariantId: "",

  /**
   * Pool of layout templates the UI can offer; each id is one template.
   * Generation and previews both read from this list.
   */
  designTemplateIds: [] as string[],
};

/** Gemini reviews per request in extraction (smaller batches = fewer structured-output failures). */
export const PASS1_REVIEWS_PER_CHUNK = 10;

/** User can select at most this many design templates per run (must be ≤ designTemplateIds.length). */
export const MAX_TEMPLATES_PER_RUN = 3;
