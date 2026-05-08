import express from 'express';
import { join } from 'node:path';
import { z } from 'zod';
import { MAX_TEMPLATES_PER_RUN } from '../config/recipe-constants.js';
import { discoveredBenefitSchema } from '../lib/benefit-discover-pass2.js';
import { pass1ExtractionSchema } from '../lib/benefit-extraction-pass1.js';
import { recipeLog, recipeWarn } from '../lib/debug-log.js';
import { getRecipeEnvStatus } from '../lib/env.js';
import {
  getAudience,
  getProduct,
  getProductVariant,
  listAllBrands,
  listAllProducts,
  listAudiencesForProduct,
  listDesignTemplates,
  listProductVariantsForProduct,
} from '../lib/staticadslab-client.js';
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

const workspacePickSchema = z.object({
  brandId: z.string().min(1),
  productId: z.string().min(1),
  audienceId: z.string().min(1),
  productVariantId: z.string().optional(),
});

const generateBodySchema = z.object({
  rows: z.array(reviewRowSchema).min(1),
  extractions: z.array(pass1ExtractionSchema).min(1),
  selectedBenefits: z.array(discoveredBenefitSchema).min(1),
  templateIds: z.array(z.string().min(1)).min(1).max(MAX_TEMPLATES_PER_RUN),
  workspace: workspacePickSchema,
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

async function validateBenefitWorkspace(
  apiKey: string,
  w: z.infer<typeof workspacePickSchema>,
): Promise<void> {
  const product = await getProduct(apiKey, w.productId);
  if (product.brand_id !== w.brandId) {
    throw new Error('The selected product does not belong to the selected brand.');
  }
  const audience = await getAudience(apiKey, w.audienceId);
  if (audience.product_id !== w.productId) {
    throw new Error('The selected audience does not belong to the selected product.');
  }
  const pv = w.productVariantId?.trim() ?? '';
  if (pv.length > 0) {
    const variant = await getProductVariant(apiKey, pv);
    if (variant.product_id !== w.productId) {
      throw new Error(
        'The selected product variant does not belong to the selected product.',
      );
    }
  }
}

export function createServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  const publicDir = join(process.cwd(), 'public');

  app.get('/api/config/env-status', async (_req, res) => {
    res.json(await getRecipeEnvStatus());
  });

  app.get('/api/workspace/catalog', async (_req, res) => {
    const key = process.env.API_KEY_STATIC_ADS_LAB?.trim();
    if (!key) {
      res
        .status(400)
        .json({ error: 'Set API_KEY_STATIC_ADS_LAB on the server to load your workspace.' });
      return;
    }
    try {
      const [brands, products, designTemplates] = await Promise.all([
        listAllBrands(key),
        listAllProducts(key),
        listDesignTemplates(key, { status: 'completed' }),
      ]);
      recipeLog('GET /api/workspace/catalog ok', {
        brands: brands.length,
        products: products.length,
        designTemplates: designTemplates.length,
      });
      res.json({
        brands: brands.map((b) => ({ id: b.id, name: b.name })),
        products: products.map((p) => ({
          id: p.id,
          brand_id: p.brand_id,
          name: p.name,
        })),
        designTemplates: designTemplates.map((t) => ({
          id: t.id,
          status: t.status,
          preview_url: t.preview_url,
          reference_image_url: t.reference_image_url,
          aspect_ratio: t.aspect_ratio,
          ad_format: t.ad_format,
          industry: t.industry,
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recipeWarn('GET /api/workspace/catalog failed', message);
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/workspace/product/:productId/context', async (req, res) => {
    const key = process.env.API_KEY_STATIC_ADS_LAB?.trim();
    if (!key) {
      res
        .status(400)
        .json({ error: 'Set API_KEY_STATIC_ADS_LAB on the server to load product context.' });
      return;
    }
    const productId = String(req.params.productId ?? '').trim();
    if (!productId) {
      res.status(400).json({ error: 'product id is required' });
      return;
    }
    try {
      const [variants, audiences] = await Promise.all([
        listProductVariantsForProduct(key, productId),
        listAudiencesForProduct(key, productId),
      ]);
      recipeLog('GET /api/workspace/product/context ok', {
        productId,
        variants: variants.length,
        audiences: audiences.length,
      });
      res.json({
        variants: variants.map((v) => ({
          id: v.id,
          product_id: v.product_id,
          name: v.name,
        })),
        audiences: audiences.map((a) => ({
          id: a.id,
          product_id: a.product_id,
          name: a.name,
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recipeWarn('GET /api/workspace/product/context failed', message);
      res.status(400).json({ error: message });
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
      const key = process.env.API_KEY_STATIC_ADS_LAB?.trim();
      if (!key) throw new Error('API_KEY_STATIC_ADS_LAB is not set on the server.');
      await validateBenefitWorkspace(key, body.workspace);
      const pv = body.workspace.productVariantId?.trim() ?? '';
      const rows = await enqueueAdsForSelectedBenefits(
        {
          brandId: body.workspace.brandId,
          productId: body.workspace.productId,
          audienceId: body.workspace.audienceId,
          ...(pv.length > 0 ? { productVariantId: pv } : {}),
        },
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
