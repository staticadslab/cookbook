import { RECIPE_IDS } from '../config/recipe-constants.js';

/**
 * Detects unconfigured SAL id fields in `recipe-constants.ts`.
 * Empty values and stock `*_REPLACE_ME` strings surface in the env banner.
 */
function looksLikePlaceholder(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return v.toUpperCase().includes('REPLACE_ME');
}

/**
 * Returns user-facing lines for the status banner (no secrets — field names only).
 * Empty array means every checked field looks configured for this POC.
 */
export function getRecipeConstantsIssues(): string[] {
  const issues: string[] = [];

  if (looksLikePlaceholder(RECIPE_IDS.brandId)) {
    issues.push('`RECIPE_IDS.brandId` — replace with your Static Ads Lab brand id');
  }
  if (looksLikePlaceholder(RECIPE_IDS.productId)) {
    issues.push('`RECIPE_IDS.productId` — replace with your product id');
  }

  const pv = RECIPE_IDS.productVariantId?.trim() ?? '';
  if (pv && looksLikePlaceholder(pv)) {
    issues.push('`RECIPE_IDS.productVariantId` — replace or clear to "" if unused');
  }

  const templates = [...RECIPE_IDS.designTemplateIds];
  if (templates.length === 0) {
    issues.push('`RECIPE_IDS.designTemplateIds` — add at least one design template id');
  } else {
    const badCount = templates.filter((id) => looksLikePlaceholder(id)).length;
    if (badCount > 0) {
      issues.push(
        `\`RECIPE_IDS.designTemplateIds\` — ${badCount} id(s) still look like placeholders (edit src/config/recipe-constants.ts)`,
      );
    }
  }

  return issues;
}
