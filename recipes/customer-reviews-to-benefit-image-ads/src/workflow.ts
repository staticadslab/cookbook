/**
 * HTTP-facing workflow: CSV clean, Gemini passes, SAL enqueue + batched status reads.
 */

import type { DiscoveredBenefit } from './lib/benefit-discover-pass2.js';
import { discoverBenefitsFromExtractions } from './lib/benefit-discover-pass2.js';
import type { Pass1Extraction } from './lib/benefit-extraction-pass1.js';
import { extractSignalsPerReview } from './lib/benefit-extraction-pass1.js';
import {
  enqueueBenefitImageAds,
  type BenefitGenerationStatusRow,
  type QueuedBenefitAdRow,
} from './lib/generate-benefit-ads.js';
import { requireEnv } from './lib/env.js';
import { parseReviewRowsFromCsvText } from './lib/parse-reviews.js';
import type { ReviewRow } from './lib/parse-reviews.js';
import { listImageAdsByIds } from './lib/staticadslab-client.js';

export function cleanRowsFromCsvText(csvText: string) {
  return parseReviewRowsFromCsvText(csvText);
}

/**
 * One HTTP round-trip from the UI: batched per-review extraction, then one benefit-discovery call.
 * (Still two Gemini stages server-side — see `benefit-extraction-pass1` / `benefit-discover-pass2`.)
 */
export async function runBenefitAnalyze(rows: ReviewRow[]): Promise<{
  extractions: Pass1Extraction[];
  benefits: DiscoveredBenefit[];
}> {
  const extractions = await extractSignalsPerReview(rows);
  const benefits = await discoverBenefitsFromExtractions(extractions, rows.length);
  return { extractions, benefits };
}

export async function enqueueAdsForSelectedBenefits(
  selectedBenefits: DiscoveredBenefit[],
  templateIds: string[],
  rows: ReviewRow[],
  extractions: Pass1Extraction[],
): Promise<QueuedBenefitAdRow[]> {
  const apiKey = requireEnv('API_KEY_STATIC_ADS_LAB');
  return enqueueBenefitImageAds(apiKey, selectedBenefits, templateIds, rows, extractions);
}

export async function getBenefitGenerationStatus(
  rows: QueuedBenefitAdRow[],
): Promise<{ rows: BenefitGenerationStatusRow[]; allTerminal: boolean }> {
  const apiKey = requireEnv('API_KEY_STATIC_ADS_LAB');
  const ids = rows.map((r) => r.imageAdId);
  const byId = await listImageAdsByIds(apiKey, ids);

  const merged: BenefitGenerationStatusRow[] = rows.map((row) => ({
    ...row,
    imageAd: byId.get(row.imageAdId) ?? null,
  }));

  const allTerminal = merged.every(
    (m) =>
      m.imageAd !== null &&
      (m.imageAd.status === 'completed' || m.imageAd.status === 'failed'),
  );

  return { rows: merged, allTerminal };
}

export type { QueuedBenefitAdRow, BenefitGenerationStatusRow };
