import { parse } from 'csv-parse/sync';
import { recipeLog } from './debug-log.js';

export type ParseReviewsResult = {
  reviews: string[];
  /** Rows skipped because rating was not 4 or 5. */
  skippedByRating: number;
};

/**
 * Parse a reviews export CSV, keep only 4★ and 5★ rows, return review text only.
 *
 * Expected columns include `rating` and `review` (Loox-style exports match this).
 * Real-world CSVs differ: seller replies, duplicates, and noisy text may still
 * need manual cleanup in the sheet before or after this step — this recipe only
 * does the minimal filter.
 */
export function parseReviewsFromCsvText(csvText: string): ParseReviewsResult {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    return { reviews: [], skippedByRating: 0 };
  }

  const first = records[0];
  if (!('review' in first) || !('rating' in first)) {
    throw new Error(
      'CSV must include "review" and "rating" columns (check your export headers).',
    );
  }

  const reviews: string[] = [];
  let skippedByRating = 0;

  for (const row of records) {
    const ratingRaw = String(row.rating ?? '').trim();
    const reviewText = String(row.review ?? '').trim();
    if (!reviewText) continue;

    const rating = Number(ratingRaw);
    if (!Number.isFinite(rating)) {
      skippedByRating++;
      continue;
    }
    // POC: only integer 4★ and 5★ rows (adjust if your export uses half-stars).
    if (rating !== 4 && rating !== 5) {
      skippedByRating++;
      continue;
    }

    reviews.push(reviewText);
  }

  recipeLog('parseReviews', {
    dataRows: records.length,
    keptReviews: reviews.length,
    skippedByRating,
  });

  return { reviews, skippedByRating };
}
