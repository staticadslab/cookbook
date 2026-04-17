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

/**
 * For each persona: create a SAL audience (sequential — small N).
 * POST every image-ad row in parallel. Returns ids immediately; the UI polls
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

  type CreatedRow = {
    persona: Persona;
    designTemplateId: string;
    created: SalImageAd;
  };

  const createTasks: Promise<CreatedRow>[] = [];
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

      createTasks.push(
        (async () => {
          const created = await createImageAd(apiKey, payload);
          return { persona, designTemplateId, created };
        })(),
      );
    }
  }

  recipeLog('SAL batch POST /v1/image-ads', { count: createTasks.length });
  const createdRows = await Promise.all(createTasks);

  return createdRows.map((row) => ({
    imageAdId: row.created.id,
    jobId: row.created.job_id,
    personaShortLabel: row.persona.shortLabel,
    designTemplateId: row.designTemplateId,
  }));
}
