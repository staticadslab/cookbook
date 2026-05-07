import { RECIPE_IDS } from '../config/recipe-constants.js';

function looksLikePlaceholder(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return v.toUpperCase().includes('REPLACE_ME');
}

export function getRecipeConstantsIssues(): string[] {
  const issues: string[] = [];

  if (looksLikePlaceholder(RECIPE_IDS.brandId)) {
    issues.push('`RECIPE_IDS.brandId` — replace with your Static Ads Lab brand id');
  }
  if (looksLikePlaceholder(RECIPE_IDS.productId)) {
    issues.push('`RECIPE_IDS.productId` — replace with your product id');
  }
  if (looksLikePlaceholder(RECIPE_IDS.audienceId)) {
    issues.push('`RECIPE_IDS.audienceId` — replace with an audience id for this product');
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
        `\`RECIPE_IDS.designTemplateIds\` — ${badCount} id(s) still look like placeholders`,
      );
    }
  }

  return issues;
}
