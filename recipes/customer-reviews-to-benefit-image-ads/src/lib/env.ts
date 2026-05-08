import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_TEMPLATES_PER_RUN, RECIPE_IDS } from '../config/recipe-constants.js';
import { getRecipeConstantsIssues } from './check-recipe-constants.js';
import {
  getAudience,
  getBrand,
  getProduct,
  getProductVariant,
} from './staticadslab-client.js';

function applyDotenvFile(filename: string, overrideExisting: boolean): void {
  const envPath = resolve(process.cwd(), filename);
  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (overrideExisting || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadEnvFromDotenvFile(): void {
  applyDotenvFile('.env', false);
  applyDotenvFile('.env.local', true);
}

function isSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

async function safeResourceName(
  label: string,
  warnings: string[],
  fetcher: () => Promise<{ name: string }>,
): Promise<string> {
  try {
    const r = await fetcher();
    return typeof r.name === 'string' ? r.name.trim() : '';
  } catch {
    warnings.push(`${label}: could not load from Static Ads Lab (check id or key).`);
    return '';
  }
}

/** Shape returned by GET /api/config/env-status — names only in missing/issue lists. */
export async function getRecipeEnvStatus(): Promise<{
  missing: string[];
  canRunGemini: boolean;
  canGenerateAds: boolean;
  recipeConstantsIssues: string[];
  recipeConstantsReady: boolean;
  designTemplatePoolSize: number;
  maxTemplatesPerRun: number;
  designTemplateIds: string[];
  /** Non-fatal: which workspace labels failed to resolve from the API. */
  recipeContextLabelWarnings: string[];
  /** True when we attempted SAL reads (key present + recipe ids valid). */
  recipeContextNamesFromSal: boolean;
  recipeContext: {
    brandLabel: string;
    brandId: string;
    productLabel: string;
    productId: string;
    productVariantLabel: string;
    productVariantId: string;
    audienceLabel: string;
    audienceId: string;
  };
}> {
  const geminiOk = isSet('API_KEY_GOOGLE_GEMINI');
  const salOk = isSet('API_KEY_STATIC_ADS_LAB');
  const missing: string[] = [];
  if (!geminiOk) missing.push('API_KEY_GOOGLE_GEMINI');
  if (!salOk) missing.push('API_KEY_STATIC_ADS_LAB');
  const recipeConstantsIssues = getRecipeConstantsIssues();
  const recipeConstantsReady = recipeConstantsIssues.length === 0;

  const brandId = RECIPE_IDS.brandId.trim();
  const productId = RECIPE_IDS.productId.trim();
  const audienceId = RECIPE_IDS.audienceId.trim();
  const pv = RECIPE_IDS.productVariantId?.trim() ?? '';

  const labelWarnings: string[] = [];
  let namesFromSal = false;
  let brandLabel = '';
  let productLabel = '';
  let productVariantLabel = '';
  let audienceLabel = '';

  const salKey = process.env.API_KEY_STATIC_ADS_LAB?.trim() ?? '';
  if (salKey && recipeConstantsReady) {
    namesFromSal = true;
    const variantFetch =
      pv.length > 0
        ? safeResourceName('Product variant', labelWarnings, () =>
            getProductVariant(salKey, pv),
          )
        : Promise.resolve('');

    [brandLabel, productLabel, audienceLabel, productVariantLabel] = await Promise.all([
      safeResourceName('Brand', labelWarnings, () => getBrand(salKey, brandId)),
      safeResourceName('Product', labelWarnings, () => getProduct(salKey, productId)),
      safeResourceName('Audience', labelWarnings, () => getAudience(salKey, audienceId)),
      variantFetch,
    ]);
  }

  return {
    missing,
    canRunGemini: geminiOk,
    canGenerateAds: geminiOk && salOk && recipeConstantsReady,
    recipeConstantsIssues,
    recipeConstantsReady,
    designTemplatePoolSize: RECIPE_IDS.designTemplateIds.length,
    maxTemplatesPerRun: MAX_TEMPLATES_PER_RUN,
    designTemplateIds: RECIPE_IDS.designTemplateIds,
    recipeContextLabelWarnings: labelWarnings,
    recipeContextNamesFromSal: namesFromSal,
    recipeContext: {
      brandLabel,
      brandId,
      productLabel,
      productId,
      productVariantLabel,
      productVariantId: pv,
      audienceLabel,
      audienceId,
    },
  };
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
