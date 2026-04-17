import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveGeminiModelId } from '../config/gemini-defaults.js';
import { PERSONA_SLOT_COUNT } from '../config/recipe-constants.js';
import { getRecipeConstantsIssues } from './check-recipe-constants.js';

/**
 * Minimal `.env` loader (no extra dependency). Does not override existing process.env.
 */
function applyDotenvFile(filename: string, overrideExisting: boolean): void {
  const envPath = resolve(process.cwd(), filename);
  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (overrideExisting || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Load `.env`, then `.env.local` (local wins for the same key).
 */
export function loadEnvFromDotenvFile(): void {
  applyDotenvFile('.env', false);
  applyDotenvFile('.env.local', true);
}

function isSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/**
 * For GET /api/config/env-status — names only, never values.
 * Helps the static UI show a banner without exposing secrets to the browser.
 */
export function getRecipeEnvStatus(): {
  missing: string[];
  canInferPersonas: boolean;
  canGenerateAds: boolean;
  /** Model id used for persona inference (public; override with GEMINI_MODEL). */
  geminiModelId: string;
  /** Lines to show if `recipe-constants.ts` still has missing or empty SAL ids. */
  recipeConstantsIssues: string[];
  /** True when SAL-related constants look configured (Generate step may still fail for other reasons). */
  recipeConstantsReady: boolean;
  /** Same as `PERSONA_SLOT_COUNT` in `recipe-constants.ts` (UI must select this many personas). */
  personaSlotCount: number;
} {
  const geminiOk = isSet('API_KEY_GOOGLE_GEMINI');
  const salOk = isSet('API_KEY_STATIC_ADS_LAB');
  const missing: string[] = [];
  if (!geminiOk) missing.push('API_KEY_GOOGLE_GEMINI');
  if (!salOk) missing.push('API_KEY_STATIC_ADS_LAB');
  const recipeConstantsIssues = getRecipeConstantsIssues();
  const recipeConstantsReady = recipeConstantsIssues.length === 0;
  return {
    missing,
    canInferPersonas: geminiOk,
    canGenerateAds: geminiOk && salOk && recipeConstantsReady,
    geminiModelId: resolveGeminiModelId(),
    recipeConstantsIssues,
    recipeConstantsReady,
    personaSlotCount: PERSONA_SLOT_COUNT,
  };
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
