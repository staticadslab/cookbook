import { parse } from 'csv-parse/sync';
import { recipeLog } from './debug-log.js';

export type ReviewRow = {
  review_index: number;
  review_text: string;
  rating: number;
  customer_name: string;
  date: string;
};

export type ParseReviewRowsResult = {
  rows: ReviewRow[];
  skippedByRating: number;
};

/**
 * Parse a Loox-style reviews CSV; keep 4★ and 5★ only; retain optional name/date columns.
 */
export function parseReviewRowsFromCsvText(csvText: string): ParseReviewRowsResult {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    return { rows: [], skippedByRating: 0 };
  }

  const first = records[0];
  if (!('review' in first) || !('rating' in first)) {
    throw new Error(
      'CSV must include "review" and "rating" columns (check your export headers).',
    );
  }

  const rows: ReviewRow[] = [];
  let skippedByRating = 0;
  let reviewIndex = 0;

  for (const row of records) {
    const ratingRaw = String(row.rating ?? '').trim();
    const reviewText = String(row.review ?? '').trim();
    if (!reviewText) continue;

    const rating = Number(ratingRaw);
    if (!Number.isFinite(rating)) {
      skippedByRating++;
      continue;
    }
    if (rating !== 4 && rating !== 5) {
      skippedByRating++;
      continue;
    }

    const customerName = String(row.customer_name ?? row.name ?? row.reviewer ?? '').trim();
    const date = String(row.date ?? row.created_at ?? '').trim();

    rows.push({
      review_index: reviewIndex,
      review_text: reviewText,
      rating,
      customer_name: customerName,
      date,
    });
    reviewIndex++;
  }

  recipeLog('parseReviewRows', {
    dataRows: records.length,
    keptRows: rows.length,
    skippedByRating,
  });

  return { rows, skippedByRating };
}
