/** Prefix all recipe logs so they are easy to filter in the terminal. */
const PREFIX = '[reviews-to-persona-image-ads]';

export function recipeLog(...args: unknown[]): void {
  console.log(PREFIX, ...args);
}

export function recipeWarn(...args: unknown[]): void {
  console.warn(PREFIX, ...args);
}
