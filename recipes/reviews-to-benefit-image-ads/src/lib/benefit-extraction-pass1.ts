import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { PASS1_REVIEWS_PER_CHUNK } from '../config/recipe-constants.js';
import { resolveGeminiModelId } from '../config/gemini-defaults.js';
import { recipeLog, recipeWarn } from './debug-log.js';
import { requireEnv } from './env.js';
import type { ReviewRow } from './parse-reviews.js';

/** Request/response shape after scrub — signals never empty (padded in scrub). */
export const pass1ExtractionSchema = z.object({
  review_index: z
    .number()
    .int()
    .describe('Must match the review_index provided for that review in the prompt.'),
  signals: z
    .array(z.string())
    .max(12)
    .describe('Short neutral phrases: what the customer cared about or praised.'),
  evidence_substrings: z
    .array(z.string())
    .max(6)
    .describe(
      'Verbatim excerpts from the review text when possible; may be empty after server validation.',
    ),
});

export type Pass1Extraction = z.infer<typeof pass1ExtractionSchema>;

function coerceStringArray(max: number) {
  return z
    .union([z.array(z.unknown()), z.null(), z.undefined()])
    .transform((v) => {
      if (!Array.isArray(v)) return [];
      return v
        .map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
        .filter(Boolean)
        .slice(0, max);
    });
}

/** Batch item — model echoes review_index (can be messy from Gemini). */
const pass1ExtractionLooseSchema = z.object({
  review_index: z.coerce.number().pipe(z.number().int().nonnegative()),
  signals: coerceStringArray(12),
  evidence_substrings: coerceStringArray(6),
});

const pass1ChunkLooseSchema = z.object({
  extractions: z.array(pass1ExtractionLooseSchema).min(1),
});

/**
 * Single-review extraction without review_index in the schema (fewer structured-output failures).
 * We attach `row.review_index` in code.
 */
const pass1ContentOnlySchema = z.object({
  signals: coerceStringArray(12),
  evidence_substrings: coerceStringArray(6),
});

function summarizeErr(err: unknown): string {
  if (err instanceof Error) {
    const parts = [err.name, err.message];
    let c: unknown = err.cause;
    let depth = 0;
    while (c instanceof Error && depth < 4) {
      parts.push(`cause: ${c.message}`);
      c = c.cause;
      depth++;
    }
    return parts.join(' | ');
  }
  return String(err);
}

function loadPass1Prompt(): string {
  return readFileSync(resolve(process.cwd(), 'prompts/extract-review-signals.md'), 'utf8');
}

function chunkIndices<T>(items: readonly T[], chunkSize: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize));
  }
  return out;
}

/** Deterministic row when the model skips a review or the whole chunk fails. */
function fallbackExtractionFromRow(row: ReviewRow): Pass1Extraction {
  const text = row.review_text.trim();
  const snippet =
    text.length <= 160 ? text : `${text.slice(0, 157).trim()}…`;
  return {
    review_index: row.review_index,
    signals: ['Customer feedback'],
    evidence_substrings: snippet ? [snippet] : [],
  };
}

/** Keep only evidence that actually appears in the review; ensure ≥1 signal for pass 2. */
export function scrubPass1Extraction(row: ReviewRow, extraction: Pass1Extraction): Pass1Extraction {
  const text = row.review_text;
  const evidence = extraction.evidence_substrings
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && text.includes(s));
  const uniqueEvidence = [...new Set(evidence)];
  const signals = extraction.signals.map((s) => s.trim()).filter(Boolean);
  const finalSignals = signals.length > 0 ? signals : ['General feedback'];
  return {
    review_index: extraction.review_index,
    signals: finalSignals,
    evidence_substrings: uniqueEvidence.length > 0 ? uniqueEvidence : [],
  };
}

/**
 * Map model output to one extraction per chunk row (first occurrence wins if duplicate indices).
 */
function alignExtractionsToChunk(
  chunk: ReviewRow[],
  modelRows: z.infer<typeof pass1ExtractionLooseSchema>[],
): Pass1Extraction[] {
  const byIndex = new Map<number, Pass1Extraction>();
  for (const raw of modelRows) {
    const normalized: Pass1Extraction = {
      review_index: raw.review_index,
      signals: raw.signals,
      evidence_substrings: raw.evidence_substrings,
    };
    if (!byIndex.has(normalized.review_index)) {
      byIndex.set(normalized.review_index, normalized);
    }
  }

  return chunk.map((row) => {
    const ex = byIndex.get(row.review_index) ?? fallbackExtractionFromRow(row);
    return scrubPass1Extraction(row, ex);
  });
}

/** One Gemini call per row — schema omits review_index. */
async function runPass1RowSolo(
  google: ReturnType<typeof createGoogleGenerativeAI>,
  modelId: string,
  system: string,
  row: ReviewRow,
): Promise<Pass1Extraction> {
  const userPrompt = `Extract signals and verbatim evidence from this single review only.\nrating=${row.rating}\nreview_text:\n${row.review_text}`;
  try {
    const { object } = await generateObject({
      model: google(modelId),
      schema: pass1ContentOnlySchema,
      system,
      prompt: userPrompt,
    });
    return scrubPass1Extraction(row, {
      review_index: row.review_index,
      signals: object.signals,
      evidence_substrings: object.evidence_substrings,
    });
  } catch (err) {
    recipeWarn('pass1 per-row generateObject failed', {
      review_index: row.review_index,
      detail: summarizeErr(err).slice(0, 240),
    });
    return scrubPass1Extraction(row, fallbackExtractionFromRow(row));
  }
}

async function runPass1ChunkWithPerRowRecovery(
  google: ReturnType<typeof createGoogleGenerativeAI>,
  modelId: string,
  system: string,
  chunk: ReviewRow[],
): Promise<Pass1Extraction[]> {
  const idxMin = chunk[0]?.review_index;
  const idxMax = chunk[chunk.length - 1]?.review_index;
  const lines = chunk
    .map(
      (r) =>
        `--- review_index=${r.review_index} ---\nrating=${r.rating}\nreview_text:\n${r.review_text}`,
    )
    .join('\n\n');

  const userPrompt = `For EACH review below, output exactly one extraction object with the matching review_index.\nTry to include 1–4 evidence_substrings copied verbatim from that review's review_text.\nBatch size: ${chunk.length} reviews.\n\n${lines}`;

  let modelRows: z.infer<typeof pass1ExtractionLooseSchema>[] | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const stricter =
        attempt > 0
          ? `\n\nIMPORTANT: Return JSON matching the schema. Each item must have review_index (integer), signals (string array), evidence_substrings (string array, verbatim from that row's review_text or empty).`
          : '';
      const { object } = await generateObject({
        model: google(modelId),
        schema: pass1ChunkLooseSchema,
        system,
        prompt: `${userPrompt}${stricter}`,
      });
      modelRows = object.extractions;
      recipeLog('pass1 batch generateObject ok', {
        attempt: attempt + 1,
        chunkSize: chunk.length,
        idxMin,
        idxMax,
        got: modelRows.length,
      });
      break;
    } catch (err) {
      recipeWarn('pass1 batch generateObject failed', {
        attempt: attempt + 1,
        chunkSize: chunk.length,
        idxMin,
        idxMax,
        detail: summarizeErr(err).slice(0, 320),
      });
      if (attempt === 2) {
        modelRows = null;
      }
    }
  }

  if (!modelRows?.length) {
    recipeLog('pass1 chunk falling back to per-row calls', {
      chunkSize: chunk.length,
      idxMin,
      idxMax,
    });
    const out: Pass1Extraction[] = [];
    for (const row of chunk) {
      out.push(await runPass1RowSolo(google, modelId, system, row));
    }
    return out;
  }

  if (modelRows.length !== chunk.length) {
    recipeLog('pass1 chunk length mismatch; aligning with fallbacks', {
      expected: chunk.length,
      got: modelRows.length,
      idxMin,
      idxMax,
    });
  }

  try {
    return alignExtractionsToChunk(chunk, modelRows);
  } catch (err) {
    recipeWarn('pass1 alignExtractionsToChunk failed; per-row recovery', {
      detail: summarizeErr(err).slice(0, 240),
      idxMin,
      idxMax,
    });
    const out: Pass1Extraction[] = [];
    for (const row of chunk) {
      out.push(await runPass1RowSolo(google, modelId, system, row));
    }
    return out;
  }
}

async function runPass1Chunk(
  google: ReturnType<typeof createGoogleGenerativeAI>,
  modelId: string,
  system: string,
  chunk: ReviewRow[],
): Promise<Pass1Extraction[]> {
  try {
    return await runPass1ChunkWithPerRowRecovery(google, modelId, system, chunk);
  } catch (err) {
    recipeWarn('pass1 chunk fatal error; deterministic fallback only', {
      chunkSize: chunk.length,
      firstIndex: chunk[0]?.review_index,
      detail: summarizeErr(err).slice(0, 400),
    });
    return chunk.map((row) => scrubPass1Extraction(row, fallbackExtractionFromRow(row)));
  }
}

/**
 * Per-review structured extraction (cheap model). Batched to limit prompt size.
 */
export async function extractSignalsPerReview(rows: ReviewRow[]): Promise<Pass1Extraction[]> {
  if (rows.length === 0) {
    throw new Error('No reviews to extract — check your CSV and rating filter.');
  }

  const apiKey = requireEnv('API_KEY_GOOGLE_GEMINI');
  const google = createGoogleGenerativeAI({ apiKey });
  const modelId = resolveGeminiModelId();
  const system = loadPass1Prompt();

  const chunks = chunkIndices(rows, PASS1_REVIEWS_PER_CHUNK);
  recipeLog('pass1 chunks', { reviewCount: rows.length, chunkCount: chunks.length });

  const all: Pass1Extraction[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const started = Date.now();
    recipeLog('pass1 chunk start', {
      chunkIndex: i + 1,
      size: chunk.length,
      indexRange: [chunk[0]?.review_index, chunk[chunk.length - 1]?.review_index],
    });
    const part = await runPass1Chunk(google, modelId, system, chunk);
    for (const ex of part) {
      if (ex.evidence_substrings.length === 0) {
        recipeLog('pass1 row has no evidence after scrub', { review_index: ex.review_index });
      }
    }
    all.push(...part);
    recipeLog('pass1 chunk done', { chunkIndex: i + 1, ms: Date.now() - started });
  }

  all.sort((a, b) => a.review_index - b.review_index);
  return all;
}
