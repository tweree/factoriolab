import { baseId } from '~/data/schema/quality';
import { AdjustedDataset } from '~/state/settings/dataset';

import { Route, RouteChoices, RouteEnumeration } from './route';

export const ROUTE_MAX_DEPTH = 2;
export const ROUTE_MAX_COUNT = 24;

export interface RouteEnumerationOptions {
  /** Maximum number of nested decisions along a single path */
  maxDepth?: number;
  /** Maximum number of routes to return */
  maxCount?: number;
  /** Items that should be treated as inputs */
  excludedItemIds?: Set<string>;
}

/** Returns all recipes in the dataset that net-produce an item */
export function routeProducers(
  itemId: string,
  data: AdjustedDataset,
): string[] {
  return (data.itemRecipeIds[itemId] ?? []).filter((r) =>
    data.adjustedRecipe[r].produces.has(itemId),
  );
}

/**
 * Returns recipes that are reasonable alternatives to produce an item: Any
 * recipe in the dataset (including excluded recipes) that net-produces the
 * item, ignoring recycling recipes and recipes of a different quality.
 */
export function routeAlternatives(
  itemId: string,
  data: AdjustedDataset,
): string[] {
  const isBase = baseId(itemId) === itemId;
  return routeProducers(itemId, data).filter(
    (r) =>
      !data.adjustedRecipe[r].flags.has('recycling') &&
      (!isBase || baseId(r) === r),
  );
}

/**
 * Merges two sets of choices, returns undefined if they conflict (the same
 * item is produced by different recipes)
 */
export function mergeChoices(
  a: RouteChoices,
  b: RouteChoices,
): RouteChoices | undefined {
  const result = { ...a };
  for (const [itemId, recipeId] of Object.entries(b)) {
    if (result[itemId] != null && result[itemId] !== recipeId) return undefined;
    result[itemId] = recipeId;
  }

  return result;
}

/**
 * Enumerates production routes for an item. A route is a set of recipe
 * choices for items in the production chain that have more than one
 * alternative recipe. Items beyond the maximum decision depth are left for
 * the solver to decide.
 */
export function enumerateRoutes(
  itemId: string,
  data: AdjustedDataset,
  options: RouteEnumerationOptions = {},
): RouteEnumeration {
  const maxDepth = options.maxDepth ?? ROUTE_MAX_DEPTH;
  const maxCount = options.maxCount ?? ROUTE_MAX_COUNT;
  const excludedItemIds = options.excludedItemIds ?? new Set<string>();
  const memo = new Map<string, RouteChoices[]>();
  const inProgress = new Set<string>();
  let truncated = false;

  function limit(list: RouteChoices[], budget: number): RouteChoices[] {
    if (list.length <= budget) return list;
    truncated = true;
    return list.slice(0, budget);
  }

  /**
   * Expand routes for an item. The budget limits the number of returned
   * routes, and is shared evenly between alternative recipes so that each
   * alternative is represented.
   */
  function expand(id: string, depth: number, budget: number): RouteChoices[] {
    if (inProgress.has(id) || excludedItemIds.has(id)) return [{}];

    const key = `${id}|${depth.toString()}|${budget.toString()}`;
    const cached = memo.get(key);
    if (cached) return cached;

    const alternatives = routeAlternatives(id, data);
    const decision = alternatives.length > 1;
    if (alternatives.length === 0 || (decision && depth >= maxDepth))
      return [{}];

    inProgress.add(id);
    const nextDepth = decision ? depth + 1 : depth;
    const share = Math.max(1, Math.floor(budget / alternatives.length));
    let result: RouteChoices[] = [];
    for (const recipeId of alternatives) {
      let combos: RouteChoices[] = [decision ? { [id]: recipeId } : {}];
      const recipe = data.adjustedRecipe[recipeId];
      for (const inputId of Object.keys(recipe.in)) {
        if (inputId === id) continue;
        const inputRoutes = expand(inputId, nextDepth, share);
        const next: RouteChoices[] = [];
        for (const a of combos) {
          for (const b of inputRoutes) {
            const merged = mergeChoices(a, b);
            if (merged) next.push(merged);
          }
        }

        combos = limit(next, share);
      }

      result.push(...combos);
    }

    result = limit(result, budget);
    inProgress.delete(id);
    memo.set(key, result);
    return result;
  }

  const order: string[] = [];
  const routes = new Map<string, Route>();
  for (const choices of expand(itemId, 0, maxCount)) {
    // Order choices by first appearance, so the target decision comes first
    for (const id of Object.keys(choices))
      if (!order.includes(id)) order.push(id);

    const entries = Object.entries(choices).sort(
      (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]),
    );
    const id = entries.map(([i, r]) => `${i}:${r}`).join(',');
    if (!routes.has(id)) routes.set(id, { id, choices: entries });
  }

  return { routes: Array.from(routes.values()), truncated };
}

/**
 * Returns a copy of the dataset where each chosen item may only be produced
 * by its chosen recipe (this also prevents recycling recipes from producing
 * the item).
 */
export function forceRouteChoices(
  data: AdjustedDataset,
  choices: [string, string][],
): AdjustedDataset {
  const itemAvailableRecipeIds = { ...data.itemAvailableRecipeIds };
  const itemAvailableIoRecipeIds = { ...data.itemAvailableIoRecipeIds };
  for (const [itemId, recipeId] of choices) {
    itemAvailableRecipeIds[itemId] = [recipeId];
    itemAvailableIoRecipeIds[itemId] = itemAvailableIoRecipeIds[itemId].filter(
      (r) => r === recipeId || !data.adjustedRecipe[r].produces.has(itemId),
    );
  }

  /**
   * Chosen recipes may be excluded in the settings, in which case they are
   * missing from the input/output lists of their ingredients and products.
   */
  for (const [, recipeId] of choices) {
    const recipe = data.adjustedRecipe[recipeId];
    for (const ioId of Object.keys(recipe.output)) {
      const ids = itemAvailableIoRecipeIds[ioId];
      if (!ids.includes(recipeId))
        itemAvailableIoRecipeIds[ioId] = [recipeId, ...ids];
    }
  }

  return { ...data, itemAvailableRecipeIds, itemAvailableIoRecipeIds };
}
