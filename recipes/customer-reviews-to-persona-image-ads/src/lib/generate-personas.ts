import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { resolveGeminiModelId } from '../config/gemini-defaults.js';
import { MAX_TEMPLATES_PER_RUN, PERSONA_SLOT_COUNT } from '../config/recipe-constants.js';
import { recipeLog } from './debug-log.js';
import { requireEnv } from './env.js';

/** How many personas Gemini must return (user later picks a subset in the UI). */
export const TARGET_PERSONA_COUNT = 10;

export const personaSchema = z.object({
  shortLabel: z
    .string()
    .max(120)
    .describe(
      'Short label for the Static Ads Lab audience name (keep concise; ideal under ~60 chars).',
    ),
  narrative: z
    .string()
    .describe(
      'Full persona: who they are, motivations, pains, objections, buying context.',
    ),
  confidence: z.number().min(0).max(1).describe('Confidence score between 0 and 1.'),
  testimonials: z
    .array(z.string())
    .describe('Review quotes that support this persona (verbatim or close; more is better).'),
});

const personasOutputSchema = z.object({
  personas: z
    .array(personaSchema)
    .min(TARGET_PERSONA_COUNT)
    .max(TARGET_PERSONA_COUNT),
});

export type Persona = z.infer<typeof personaSchema>;

/** Body for POST /api/generate/start — personas plus workspace/template picks from the UI. */
export const selectedPersonasRequestSchema = z.object({
  personas: z.array(personaSchema).length(PERSONA_SLOT_COUNT),
  brandId: z.string().min(1),
  productId: z.string().min(1),
  productVariantId: z.string().optional(),
  templateIds: z.array(z.string().min(1)).min(1).max(MAX_TEMPLATES_PER_RUN),
});

export type SelectedPersonasGenerationRequest = z.infer<
  typeof selectedPersonasRequestSchema
>;

function loadInferPersonasPrompt(): string {
  const path = resolve(process.cwd(), 'prompts/infer-personas.md');
  return readFileSync(path, 'utf8');
}

/**
 * Call Gemini with structured output to derive personas from cleaned review text.
 */
export async function generatePersonasFromReviews(reviews: string[]): Promise<Persona[]> {
  if (reviews.length === 0) {
    throw new Error('No reviews to analyze — check your CSV and rating filter.');
  }

  const apiKey = requireEnv('API_KEY_GOOGLE_GEMINI');
  const google = createGoogleGenerativeAI({ apiKey });
  const modelId = resolveGeminiModelId();

  const system = loadInferPersonasPrompt();
  const reviewBlob = reviews.map((r, i) => `--- Review ${i + 1} ---\n${r}`).join('\n\n');

  recipeLog('Gemini generateObject starting', {
    modelId,
    reviewCount: reviews.length,
    promptCharsApprox: reviewBlob.length + system.length,
  });
  const started = Date.now();

  const { object } = await generateObject({
    model: google(modelId),
    schema: personasOutputSchema,
    system,
    prompt: `You have ${reviews.length} customer reviews below. Infer exactly ${TARGET_PERSONA_COUNT} distinct buyer personas from this evidence.\n\n${reviewBlob}`,
  });

  recipeLog('Gemini generateObject finished', {
    ms: Date.now() - started,
    personaCount: object.personas.length,
    shortLabels: object.personas.map((p) => p.shortLabel),
  });

  return object.personas;
}
