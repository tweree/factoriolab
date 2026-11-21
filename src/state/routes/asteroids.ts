import { Recipe } from '~/data/schema/recipe';
import { rational } from '~/rational/rational';

export const ASTEROID_CHUNK_SUFFIX = '-asteroid-chunk';
export const ASTEROID_COLLECTOR = 'asteroid-collector';

/**
 * Assumed asteroid chunks gathered per asteroid collector per second. The
 * actual rate depends on the space location, platform speed and collector
 * placement, which are not part of the data.
 */
export const ASTEROID_COLLECTOR_RATE = rational(1n, 5n);

/**
 * Whether a recipe represents collecting asteroid chunks in space (in orbit
 * of a location, or along a space route): It has no producers, no
 * ingredients, and only produces asteroid chunks.
 */
export function isAsteroidRecipe(recipe: Recipe): boolean {
  const outputs = Object.keys(recipe.out);
  return (
    !recipe.producers?.length &&
    Object.keys(recipe.in).length === 0 &&
    outputs.length > 0 &&
    outputs.every((i) => i.endsWith(ASTEROID_CHUNK_SUFFIX))
  );
}
