const PREFIX = '[reviews-to-benefit-image-ads]';

export function recipeLog(...args: unknown[]): void {
  console.log(PREFIX, ...args);
}

export function recipeWarn(...args: unknown[]): void {
  console.warn(PREFIX, ...args);
}
