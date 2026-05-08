import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { resolveGeminiModelId } from '../config/gemini-defaults.js';
import { recipeLog } from './debug-log.js';
import { requireEnv } from './env.js';
import type { Pass1Extraction } from './benefit-extraction-pass1.js';

export const discoveredBenefitSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe('Short benefit name an agency could put in an ad headline (customer-language, specific).'),
  source_review_indices: z
    .array(z.number().int().nonnegative())
    .describe('Which review_index values support this benefit (at most once per review in tallies).'),
});

export type DiscoveredBenefit = z.infer<typeof discoveredBenefitSchema>;

const pass2Schema = z.object({
  benefits: z.array(discoveredBenefitSchema).min(1),
});

function loadPass2Prompt(): string {
  return readFileSync(resolve(process.cwd(), 'prompts/discover-benefits.md'), 'utf8');
}

function normalizeBenefits(
  benefits: DiscoveredBenefit[],
  reviewCount: number,
): DiscoveredBenefit[] {
  const seenPairs = new Set<string>();
  const out: DiscoveredBenefit[] = [];

  for (const b of benefits) {
    const label = b.label.trim();
    if (!label) continue;
    const idxSet = new Set<number>();
    for (const raw of b.source_review_indices) {
      if (!Number.isInteger(raw) || raw < 0 || raw >= reviewCount) continue;
      idxSet.add(raw);
    }
    const source_review_indices = [...idxSet].sort((a, c) => a - c);
    if (source_review_indices.length === 0) continue;
    const key = `${label.toLowerCase()}|${source_review_indices.join(',')}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    out.push({ label, source_review_indices });
  }

  return out;
}

/**
 * Single discovery pass over all pass-1 extractions — benefit labels + which reviews support each.
 */
export async function discoverBenefitsFromExtractions(
  extractions: Pass1Extraction[],
  reviewCount: number,
): Promise<DiscoveredBenefit[]> {
  if (extractions.length === 0) {
    throw new Error('No extractions to cluster.');
  }
  if (reviewCount < 1) {
    throw new Error('reviewCount must be at least 1.');
  }

  const apiKey = requireEnv('API_KEY_GOOGLE_GEMINI');
  const google = createGoogleGenerativeAI({ apiKey });
  const modelId = resolveGeminiModelId();
  const system = loadPass2Prompt();

  const compact = extractions.map((e) => ({
    review_index: e.review_index,
    signals: e.signals,
    evidence_substrings: e.evidence_substrings,
  }));

  const payload = JSON.stringify(compact);
  recipeLog('pass2 discover start', {
    modelId,
    reviewCount,
    extractionCount: extractions.length,
    payloadChars: payload.length,
  });
  const started = Date.now();

  const { object } = await generateObject({
    model: google(modelId),
    schema: pass2Schema,
    system,
    prompt: `Discover benefit categories from these per-review extractions. Count each review at most once per benefit.\nTotal reviews indexed 0..${reviewCount - 1}.\n\nJSON input:\n${payload}`,
  });

  const normalized = normalizeBenefits(object.benefits, reviewCount);
  recipeLog('pass2 discover done', {
    ms: Date.now() - started,
    benefitCount: normalized.length,
  });

  if (normalized.length === 0) {
    throw new Error('Pass 2 returned no valid benefits after normalization.');
  }

  return normalized;
}
