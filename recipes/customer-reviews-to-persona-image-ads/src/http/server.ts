import express from 'express';
import { join } from 'node:path';
import { z } from 'zod';
import { recipeLog, recipeWarn } from '../lib/debug-log.js';
import { getRecipeEnvStatus } from '../lib/env.js';
import { selectedPersonasRequestSchema } from '../lib/generate-personas.js';
import {
  getProduct,
  getProductVariant,
  listAllBrands,
  listAllProducts,
  listAudiencesForProduct,
  listDesignTemplates,
  listProductVariantsForProduct,
} from '../lib/staticadslab-client.js';
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

async function validatePersonaGenerationWorkspace(
  apiKey: string,
  w: { brandId: string; productId: string; productVariantId?: string },
): Promise<void> {
  const product = await getProduct(apiKey, w.productId);
  if (product.brand_id !== w.brandId) {
    throw new Error('The selected product does not belong to the selected brand.');
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

  app.get('/api/config/env-status', (_req, res) => {
    res.json(getRecipeEnvStatus());
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
      const personas = await inferPersonasFromReviews(body.reviews);
      recipeLog('POST /api/personas ok', {
        reviewCount: body.reviews.length,
        personaCount: personas.length,
      });
      res.json({ personas });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      recipeWarn('POST /api/personas failed', message);
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/generate/start', async (req, res) => {
    try {
      const body = selectedPersonasRequestSchema.parse(req.body);
      const key = process.env.API_KEY_STATIC_ADS_LAB?.trim();
      if (!key) throw new Error('API_KEY_STATIC_ADS_LAB is not set on the server.');
      await validatePersonaGenerationWorkspace(key, {
        brandId: body.brandId,
        productId: body.productId,
        productVariantId: body.productVariantId,
      });
      const rows = await enqueueAdsForSelectedPersonas(body);
      recipeLog('POST /api/generate/start ok', {
        personaSlots: body.personas.length,
        rowCount: rows.length,
      });
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
      const { rows, allTerminal } = await getGenerationStatus(body.rows);
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
