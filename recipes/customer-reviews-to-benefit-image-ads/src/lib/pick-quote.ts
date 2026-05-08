import type { Pass1Extraction } from './benefit-extraction-pass1.js';
import type { DiscoveredBenefit } from './benefit-discover-pass2.js';
import type { ReviewRow } from './parse-reviews.js';

/** One review row chosen to ground the image-ad prompt (no node overrides — SAL writes on-template copy). */
export type QuotePick = {
  /** Longest validated evidence span, or an excerpt — useful tone anchor for the prompt. */
  quote: string;
  customerName: string;
  reviewIndex: number;
  /** Full review body passed through to the image-ad prompt for faithful copywriting. */
  reviewText: string;
  rating: number;
};

/**
 * Pick the review to highlight for a benefit: prefer the row with the strongest verbatim evidence span.
 * POC tradeoff: if no evidence survived scrubbing, falls back to a short prefix of the review text.
 */
export function pickQuoteForBenefit(
  benefit: DiscoveredBenefit,
  rows: ReviewRow[],
  extractionsByIndex: Map<number, Pass1Extraction>,
): QuotePick {
  let best: QuotePick | null = null;

  for (const idx of benefit.source_review_indices) {
    const row = rows.find((r) => r.review_index === idx);
    if (!row) continue;
    const ex = extractionsByIndex.get(idx);
    const candidates: string[] = [];
    if (ex) {
      for (const s of ex.evidence_substrings) {
        if (s && row.review_text.includes(s)) candidates.push(s);
      }
    }
    if (candidates.length === 0) {
      const text = row.review_text.trim();
      if (text.length > 220) candidates.push(`${text.slice(0, 217)}…`);
      else if (text.length > 0) candidates.push(text);
    }

    for (const quote of candidates) {
      if (!best || quote.length > best.quote.length) {
        best = {
          quote,
          customerName: row.customer_name || 'Customer',
          reviewIndex: idx,
          reviewText: row.review_text.trim(),
          rating: row.rating,
        };
      }
    }
  }

  if (!best) {
    throw new Error(`Could not pick a quote for benefit "${benefit.label}" — no source reviews.`);
  }

  return best;
}
