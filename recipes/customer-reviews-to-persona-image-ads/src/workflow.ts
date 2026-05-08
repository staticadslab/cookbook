/**
 * Recipe workflow surface used by HTTP handlers.
 * The readable end-to-end story lives in comments on `main.ts`; this file only delegates.
 */

import type { SelectedPersonasGenerationRequest } from './lib/generate-personas.js';
import {
  enqueueImageAdsForPersonas,
  type PersonaWorkspacePick,
  type QueuedImageAdRow,
} from './lib/generate-image-ads.js';
import { generatePersonasFromReviews } from './lib/generate-personas.js';
import { requireEnv } from './lib/env.js';
import { parseReviewsFromCsvText } from './lib/parse-reviews.js';
import type { SalImageAd } from './lib/staticadslab-client.js';
import { listImageAdsByIds } from './lib/staticadslab-client.js';

export function cleanReviewsFromCsvText(csvText: string) {
  return parseReviewsFromCsvText(csvText);
}

export async function inferPersonasFromReviews(reviews: string[]) {
  return generatePersonasFromReviews(reviews);
}

export async function enqueueAdsForSelectedPersonas(
  body: SelectedPersonasGenerationRequest,
): Promise<QueuedImageAdRow[]> {
  const apiKey = requireEnv('API_KEY_STATIC_ADS_LAB');
  const pv = body.productVariantId?.trim() ?? '';
  const workspace: PersonaWorkspacePick = {
    brandId: body.brandId,
    productId: body.productId,
    templateIds: body.templateIds,
    ...(pv.length > 0 ? { productVariantId: pv } : {}),
  };
  return enqueueImageAdsForPersonas(apiKey, body.personas, workspace);
}

export type GenerationStatusRow = QueuedImageAdRow & {
  imageAd: SalImageAd | null;
};

/**
 * Single batched SAL read for all tracked image ads (`GET /v1/image-ads?ids=...`).
 */
export async function getGenerationStatus(rows: QueuedImageAdRow[]): Promise<{
  rows: GenerationStatusRow[];
  allTerminal: boolean;
}> {
  const apiKey = requireEnv('API_KEY_STATIC_ADS_LAB');
  const ids = rows.map((r) => r.imageAdId);
  const byId = await listImageAdsByIds(apiKey, ids);

  const merged: GenerationStatusRow[] = rows.map((row) => ({
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

export type { QueuedImageAdRow };
