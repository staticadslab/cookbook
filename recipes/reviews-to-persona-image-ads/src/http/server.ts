import express from 'express';
import { join } from 'node:path';
import { z } from 'zod';
import { recipeLog, recipeWarn } from '../lib/debug-log.js';
import { getRecipeEnvStatus } from '../lib/env.js';
import { selectedPersonasRequestSchema } from '../lib/generate-personas.js';
import {
  cleanReviewsFromCsvText,
  enqueueAdsForSelectedPersonas,
  getGenerationStatus,
  inferPersonasFromReviews,
} from '../workflow.js';

const cleanBodySchema = z.object({
  csvText: z.string().min(1, 'csvText is required'),
});

const personasBodySchema = z.object({
  reviews: z.array(z.string()).min(1, 'at least one review string required'),
});

const queuedRowSchema = z.object({
  imageAdId: z.string().min(1),
  jobId: z.string().optional(),
  personaShortLabel: z.string(),
  designTemplateId: z.string(),
});

const generationStatusBodySchema = z.object({
  rows: z.array(queuedRowSchema).min(1, 'at least one row required'),
});

export function createServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  const publicDir = join(process.cwd(), 'public');

  /** Which required env vars are unset (names only — never values). */
  app.get('/api/config/env-status', (_req, res) => {
    res.json(getRecipeEnvStatus());
  });

  app.use(express.static(publicDir));

  app.post('/api/reviews/clean', (req, res) => {
    try {
      const body = cleanBodySchema.parse(req.body);
      recipeLog('POST /api/reviews/clean', {
        csvChars: body.csvText.length,
      });
      const result = cleanReviewsFromCsvText(body.csvText);
      recipeLog('POST /api/reviews/clean ok', {
        reviewCount: result.reviews.length,
        skippedByRating: result.skippedByRating,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recipeWarn('POST /api/reviews/clean failed', message);
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/personas', async (req, res) => {
    try {
      const body = personasBodySchema.parse(req.body);
      recipeLog('POST /api/personas', { reviewCount: body.reviews.length });
      const personas = await inferPersonasFromReviews(body.reviews);
      recipeLog('POST /api/personas ok', { personaCount: personas.length });
      res.json({ personas });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recipeWarn('POST /api/personas failed', message);
      res.status(400).json({ error: message });
    }
  });

  /** Create audiences + enqueue all image ads; returns row metadata for client polling. */
  app.post('/api/generate/start', async (req, res) => {
    try {
      const body = selectedPersonasRequestSchema.parse(req.body);
      recipeLog('POST /api/generate/start', {
        personaSlots: body.personas.length,
        personaLabels: body.personas.map((p) => p.shortLabel),
      });
      const rows = await enqueueAdsForSelectedPersonas(body.personas);
      recipeLog('POST /api/generate/start ok', { rowCount: rows.length });
      res.json({ rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recipeWarn('POST /api/generate/start failed', message);
      res.status(400).json({ error: message });
    }
  });

  /**
   * Batched progress: one `GET /v1/image-ads?ids=...` on the server per request.
   * The browser adapts poll interval; no per-id SAL calls from the client.
   */
  app.post('/api/generate/status', async (req, res) => {
    try {
      const body = generationStatusBodySchema.parse(req.body);
      recipeLog('POST /api/generate/status', { rowCount: body.rows.length });
      const { rows, allTerminal } = await getGenerationStatus(body.rows);
      const completed = rows.filter((r) => r.imageAd?.status === 'completed').length;
      const failed = rows.filter((r) => r.imageAd?.status === 'failed').length;
      recipeLog('POST /api/generate/status ok', {
        allTerminal,
        completed,
        failed,
        missingImageAd: rows.filter((r) => !r.imageAd).length,
      });
      res.json({ rows, allTerminal });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recipeWarn('POST /api/generate/status failed', message);
      res.status(400).json({ error: message });
    }
  });

  return app;
}
