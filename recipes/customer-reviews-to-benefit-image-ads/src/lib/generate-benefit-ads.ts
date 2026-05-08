import { recipeLog } from './debug-log.js';
import {
  createImageAd,
  type CreateImageAdPayload,
  type SalImageAd,
} from './staticadslab-client.js';
import type { DiscoveredBenefit } from './benefit-discover-pass2.js';
import type { Pass1Extraction } from './benefit-extraction-pass1.js';
import type { ReviewRow } from './parse-reviews.js';
import { pickQuoteForBenefit, type QuotePick } from './pick-quote.js';

export type RecipeWorkspacePick = {
  brandId: string;
  productId: string;
  audienceId: string;
  /** Omit or empty means do not send `product_variant_id`. */
  productVariantId?: string;
};

export type QueuedBenefitAdRow = {
  imageAdId: string;
  jobId?: string;
  benefitLabel: string;
  designTemplateId: string;
};

/**
 * Single natural-language instruction for SAL: benefit theme + full review context.
 * Recipe trusts the API to place and phrase on-template copy; no node_overrides.
 */
export function buildImageAdPrompt(benefitLabel: string, highlight: QuotePick): string {
  return [
    'Create a Meta-ready image ad: bold benefit-led headline and body copy that suit the design template layout.',
    'Tone: confident DTC / ecommerce brand. Keep claims grounded only in the customer review below — do not invent features, results, or quotes the reviewer did not say or clearly imply.',
    '',
    'Benefit theme (from aggregating many reviews):',
    benefitLabel,
    '',
    'Customer review to highlight (use as the primary truth source for messaging):',
    highlight.reviewText,
    '',
    `Reviewer label (optional use in copy): ${highlight.customerName}`,
    `Star rating: ${highlight.rating}`,
    '',
    'Strongest customer language from that review (match this voice where it fits):',
    highlight.quote,
  ].join('\n');
}

const MAX_PARALLEL_IMAGE_AD_POSTS = 8;

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * Enqueue flat image ads: one row per selected benefit × design template. Copy is prompt-driven only.
 */
export async function enqueueBenefitImageAds(
  apiKey: string,
  workspace: RecipeWorkspacePick,
  selectedBenefits: DiscoveredBenefit[],
  templateIds: string[],
  rows: ReviewRow[],
  extractions: Pass1Extraction[],
): Promise<QueuedBenefitAdRow[]> {
  if (selectedBenefits.length === 0) {
    throw new Error('Select at least one benefit before generating ads.');
  }
  if (templateIds.length === 0) {
    throw new Error('Select at least one design template.');
  }

  const byEx = new Map<number, Pass1Extraction>();
  for (const e of extractions) {
    byEx.set(e.review_index, e);
  }

  type Spec = {
    benefit: DiscoveredBenefit;
    designTemplateId: string;
    payload: CreateImageAdPayload;
  };

  const specs: Spec[] = [];
  const pv = workspace.productVariantId?.trim() ?? '';

  for (const benefit of selectedBenefits) {
    const highlight = pickQuoteForBenefit(benefit, rows, byEx);
    const prompt = buildImageAdPrompt(benefit.label, highlight);
    for (const designTemplateId of templateIds) {
      const payload: CreateImageAdPayload = {
        design_template_id: designTemplateId,
        brand_id: workspace.brandId,
        product_id: workspace.productId,
        audience_id: workspace.audienceId,
        prompt,
      };
      if (pv.length > 0) {
        payload.product_variant_id = pv;
      }
      specs.push({ benefit, designTemplateId, payload });
    }
  }

  recipeLog('enqueueBenefitImageAds', {
    benefits: selectedBenefits.length,
    templates: templateIds.length,
    totalCreates: specs.length,
  });

  const created = await mapWithLimit(specs, MAX_PARALLEL_IMAGE_AD_POSTS, async (spec) => {
    const row = await createImageAd(apiKey, spec.payload);
    return { spec, created: row };
  });

  return created.map((c) => ({
    imageAdId: c.created.id,
    jobId: c.created.job_id,
    benefitLabel: c.spec.benefit.label,
    designTemplateId: c.spec.designTemplateId,
  }));
}

export type BenefitGenerationStatusRow = QueuedBenefitAdRow & {
  imageAd: SalImageAd | null;
};
