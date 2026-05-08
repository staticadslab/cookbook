import { PERSONA_SLOT_COUNT, RECIPE_IDS } from '../config/recipe-constants.js';
import { recipeLog } from './debug-log.js';
import type { Persona } from './generate-personas.js';
import {
  createAudience,
  createImageAd,
  type CreateImageAdPayload,
  type SalImageAd,
} from './staticadslab-client.js';

/** One grid cell after SAL accepts the image-ad create (before queue finishes). */
export type QueuedImageAdRow = {
  imageAdId: string;
  jobId?: string;
  personaShortLabel: string;
  designTemplateId: string;
};

function audienceDescriptionFromPersona(persona: Persona): string {
  const bullets = persona.testimonials.map((t) => `- ${t}`).join('\n');
  return `${persona.narrative}\n\nSupporting testimonials:\n${bullets}`;
}

function imageAdPromptFromPersona(persona: Persona): string {
  const quotes = persona.testimonials
    .slice(0, 8)
    .map((t) => `"${t.replaceAll('"', "'")}"`)
    .join('\n');
  return [
    'Generate a Meta image ad aligned to this buyer persona and social proof.',
    '',
    'Persona:',
    persona.narrative,
    '',
    'Customer quotes to lean on:',
    quotes,
  ].join('\n');
}

/** llms.txt recommends ~8 parallel POSTs as a safe default for image-ad creates. */
const MAX_PARALLEL_IMAGE_AD_POSTS = 8;

/**
 * Run async tasks with at most `limit` in flight at once (order of completion may differ from input).
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * For each persona: create a SAL audience (sequential — small N).
 * POST image-ad creates with bounded concurrency; returns ids immediately. The UI polls
 * `GET /v1/image-ads?ids=...` via the server until each row is terminal.
 */
export async function enqueueImageAdsForPersonas(
  apiKey: string,
  personas: Persona[],
): Promise<QueuedImageAdRow[]> {
  if (personas.length !== PERSONA_SLOT_COUNT) {
    throw new Error(`Expected exactly ${PERSONA_SLOT_COUNT} personas, got ${personas.length}`);
  }

  const templateIds = [...RECIPE_IDS.designTemplateIds];
  if (templateIds.length === 0) {
    throw new Error('RECIPE_IDS.designTemplateIds must contain at least one template id');
  }

  recipeLog('generateImageAds grid (enqueue only)', {
    personas: personas.length,
    templates: templateIds.length,
    totalImageAds: personas.length * templateIds.length,
  });

  const withAudiences: { persona: Persona; audienceId: string }[] = [];

  // POC tradeoff: every run creates fresh audiences, so re-running with the same
  // personas leaves duplicates in the SAL workspace. A production version would
  // dedupe by `name` (or maintain a persona -> audience_id mapping) before POSTing.
  for (const persona of personas) {
    const audience = await createAudience(apiKey, {
      product_id: RECIPE_IDS.productId,
      name: persona.shortLabel.slice(0, 255),
      description: audienceDescriptionFromPersona(persona),
    });
    recipeLog('SAL audience created', {
      audienceId: audience.id,
      name: persona.shortLabel,
    });
    withAudiences.push({ persona, audienceId: audience.id });
  }

  type CreateSpec = {
    persona: Persona;
    designTemplateId: string;
    payload: CreateImageAdPayload;
  };

  const createSpecs: CreateSpec[] = [];
  for (const { persona, audienceId } of withAudiences) {
    for (const designTemplateId of templateIds) {
      const payload: CreateImageAdPayload = {
        design_template_id: designTemplateId,
        brand_id: RECIPE_IDS.brandId,
        product_id: RECIPE_IDS.productId,
        audience_id: audienceId,
        prompt: imageAdPromptFromPersona(persona),
      };
      if (RECIPE_IDS.productVariantId) {
        payload.product_variant_id = RECIPE_IDS.productVariantId;
      }
      createSpecs.push({ persona, designTemplateId, payload });
    }
  }

  recipeLog('SAL batch POST /v1/image-ads', {
    count: createSpecs.length,
    maxParallel: MAX_PARALLEL_IMAGE_AD_POSTS,
  });

  const createdRows = await mapWithLimit(
    createSpecs,
    MAX_PARALLEL_IMAGE_AD_POSTS,
    async (spec) => {
      const created = await createImageAd(apiKey, spec.payload);
      return { persona: spec.persona, designTemplateId: spec.designTemplateId, created };
    },
  );

  return createdRows.map((row) => ({
    imageAdId: row.created.id,
    jobId: row.created.job_id,
    personaShortLabel: row.persona.shortLabel,
    designTemplateId: row.designTemplateId,
  }));
}
