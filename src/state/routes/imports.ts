import { AdjustedRecipe } from '~/data/schema/recipe';
import { Rational, rational } from '~/rational/rational';

export const IMPORT_RECIPE_PREFIX = 'import|';

/** Whether a recipe is a synthetic recipe representing an import */
export function isImportRecipe(recipe: { id: string }): boolean {
  return recipe.id.startsWith(IMPORT_RECIPE_PREFIX);
}

/**
 * Create a synthetic recipe that imports an item: One item per second with no
 * ingredients and no machines, at the passed cost. This lets the solver import
 * any item, even if the location has a recipe for it that cannot run there.
 */
export function importRecipe(itemId: string, cost: Rational): AdjustedRecipe {
  const one = rational.one;
  return {
    id: `${IMPORT_RECIPE_PREFIX}${itemId}`,
    name: itemId,
    category: '',
    row: 0,
    time: one,
    in: {},
    out: { [itemId]: one },
    catalyst: {},
    flags: new Set(),
    produces: new Set([itemId]),
    output: { [itemId]: one },
    cost,
  } as unknown as AdjustedRecipe;
}
