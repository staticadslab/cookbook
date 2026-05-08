import express from 'express';
import { join } from 'node:path';
import { z } from 'zod';
import { MAX_TEMPLATES_PER_RUN, RECIPE_IDS } from '../config/recipe-constants.js';
import { discoveredBenefitSchema } from '../lib/benefit-discover-pass2.js';
import { pass1ExtractionSchema } from '../lib/benefit-extraction-pass1.js';
import { recipeLog, recipeWarn } from '../lib/debug-log.js';
import { getRecipeEnvStatus } from '../lib/env.js';
import { getDesignTemplate } from '../lib/staticadslab-client.js';
import {
  cleanRowsFromCsvText,
  enqueueAdsForSelectedBenefits,
  getBenefitGenerationStatus,
  runBenefitAnalyze,
} from '../workflow.js';

const cleanBodySchema = z.object({
  csvText: z.string().min(1, 'csvText is required'),
});

const reviewRowSchema = z.object({
  review_index: z.number().int().nonnegative(),
  review_text: z.string().min(1),
  rating: z.number(),
  customer_name: z.string(),
  date: z.string(),
});

const analyzeRowsBodySchema = z.object({
  rows: z.array(reviewRowSchema).min(1),
});

const generateBodySchema = z.object({
  rows: z.array(reviewRowSchema).min(1),
  extractions: z.array(pass1ExtractionSchema).min(1),
  selectedBenefits: z.array(discoveredBenefitSchema).min(1),
  templateIds: z.array(z.string().min(1)).min(1).max(MAX_TEMPLATES_PER_RUN),
});

const queuedRowSchema = z.object({
  imageAdId: z.string().min(1),
  jobId: z.string().optional(),
  benefitLabel: z.string(),
  designTemplateId: z.string(),
});

const generationStatusBodySchema = z.object({
  rows: z.array(queuedRowSchema).min(1),
});

export function createServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  const publicDir = join(process.cwd(), 'public');

  app.get('/api/config/env-status', async (_req, res) => {
    res.json(await getRecipeEnvStatus());
  });

  app.get('/api/design-templates/pool', async (_req, res) => {
    const ids = [...RECIPE_IDS.designTemplateIds];
    const key = process.env.API_KEY_STATIC_ADS_LAB?.trim();
    if (!key) {
      res.json({
        salKeyMissing: true,
        templates: ids.map((id) => ({
          id,
          status: null,
          preview_url: null,
          reference_image_url: null,
          aspect_ratio: null,
          ad_format: null,
        })),
      });
      return;
    }

    try {
      const settled = await Promise.allSettled(
        ids.map((id) => getDesignTemplate(key, id)),
      );
      const templates = ids.map((id, i) => {
        const r = settled[i];
        if (r.status === 'fulfilled') {
          const d = r.value;
          return {
            id: d.id,
            status: d.status,
            preview_url: d.preview_url,
            reference_image_url: d.reference_image_url,
            aspect_ratio: d.aspect_ratio,
            ad_format: d.ad_format,
          };
        }
        recipeWarn('GET /api/design-templates/pool item failed', id, String(r.reason));
        return {
          id,
          status: null,
          preview_url: null,
          reference_image_url: null,
          aspect_ratio: null,
          ad_format: null,
          fetchError:
            r.reason instanceof Error ? r.reason.message : String(r.reason),
        };
      });
      recipeLog('GET /api/design-templates/pool ok', { count: templates.length });
      res.json({ salKeyMissing: false, templates });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recipeWarn('GET /api/design-templates/pool failed', message);
      res.status(400).json({
        error: message,
        salKeyMissing: false,
        templates: ids.map((id) => ({
          id,
          status: null,
          preview_url: null,
          reference_image_url: null,
          aspect_ratio: null,
          ad_format: null,
        })),
      });
    }
  });

  app.use(express.static(publicDir));

  app.post('/api/reviews/clean', (req, res) => {
    try {
      const body = cleanBodySchema.parse(req.body);
      const result = cleanRowsFromCsvText(body.csvText);
      recipeLog('POST /api/reviews/clean ok', {
        rowCount: result.rows.length,
        skippedByRating: result.skippedByRating,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recipeWarn('POST /api/reviews/clean failed', message);
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/benefits/analyze', async (req, res) => {
    try {
      const body = analyzeRowsBodySchema.parse(req.body);
      const { extractions, benefits } = await runBenefitAnalyze(body.rows);
      recipeLog('POST /api/benefits/analyze ok', {
        rows: body.rows.length,
        extractions: extractions.length,
        benefits: benefits.length,
      });
      res.json({ extractions, benefits });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recipeWarn('POST /api/benefits/analyze failed', message);
      if (err instanceof Error && err.stack) {
        recipeWarn(
          'POST /api/benefits/analyze stack',
          err.stack.split('\n').slice(0, 6).join('\n'),
        );
      }
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/generate/start', async (req, res) => {
    try {
      const body = generateBodySchema.parse(req.body);
      const rows = await enqueueAdsForSelectedBenefits(
        body.selectedBenefits,
        body.templateIds,
        body.rows,
        body.extractions,
      );
      recipeLog('POST /api/generate/start ok', { rowCount: rows.length });
      res.json({ rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recipeWarn('POST /api/generate/start failed', message);
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/generate/status', async (req, res) => {
    try {
      const body = generationStatusBodySchema.parse(req.body);
      const { rows, allTerminal } = await getBenefitGenerationStatus(body.rows);
      recipeLog('POST /api/generate/status ok', {
        rowCount: rows.length,
        allTerminal,
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
