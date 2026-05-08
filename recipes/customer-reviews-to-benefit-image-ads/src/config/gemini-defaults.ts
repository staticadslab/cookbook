/** Default when `GEMINI_MODEL` is unset — keep in sync with recipe README. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

export function resolveGeminiModelId(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}
