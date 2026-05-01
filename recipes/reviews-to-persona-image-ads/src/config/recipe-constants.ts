/**
 * Static Ads Lab resource IDs for this recipe (not secrets).
 *
 * Fill in real ids from your Static Ads Lab workspace (brands, products, design
 * templates, etc.). The repo ships with empty values so forks get a clear UI
 * hint until you configure them. See the recipe README for BYO guidance.
 */
export const RECIPE_IDS = {
  /** Brand that owns the product and templates. */
  brandId: "",

  /** Product used when creating audiences and image ads (required by SAL API). */
  productId: "",

  /**
   * Optional: pass through to image-ad creation when your pipeline expects a variant.
   * Leave as empty string and the client will omit the field if you do not use variants.
   */
  productVariantId: "",

  /**
   * One entry per "creative" in this POC: each id is a different design template.
   * Default grid: PERSONA_SLOT_COUNT personas × length of this list image ads.
   */
  designTemplateIds: [] as const,
} as const;

/**
 * How many personas the user must select in the UI before generation.
 *
 * The total number of image ads generated per run is:
 *   PERSONA_SLOT_COUNT × designTemplateIds.length
 *
 * Bump this if your agency workflow wants more variants per run; lower it for
 * quicker / cheaper runs while iterating on personas. The browser reads this
 * value back from `GET /api/config/env-status` so the checkbox limit stays in
 * sync with whatever you set here.
 */
export const PERSONA_SLOT_COUNT = 5;
