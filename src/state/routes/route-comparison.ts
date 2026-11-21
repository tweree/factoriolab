import { computed, inject, Service } from '@angular/core';

import { Rational, rational } from '~/rational/rational';
import { SimplexResult } from '~/solver/simplex-result';
import { Solver } from '~/solver/solver';
import { toRecordEntries } from '~/utils/record';
import { updateSetIds } from '~/utils/set';

import { ObjectiveState } from '../objectives/objective';
import { ObjectiveType } from '../objectives/objective-type';
import { ObjectiveUnit } from '../objectives/objective-unit';
import { ObjectivesStore } from '../objectives/objectives-store';
import { PreferencesStore } from '../preferences/preferences-store';
import { RecipeSettings } from '../recipes/recipe-settings';
import { RecipesStore } from '../recipes/recipes-store';
import { SettingsStore } from '../settings/settings-store';
import {
  ASTEROID_COLLECTOR,
  ASTEROID_COLLECTOR_RATE,
  isAsteroidRecipe,
} from './asteroids';
import { Route, RouteAmount, RouteResult, RouteSortKey } from './route';
import {
  enumerateRoutes,
  forceRouteChoices,
  routeAlternatives,
  routeProducers,
} from './route-enumeration';

export interface RouteComparisonResult {
  results: RouteResult[];
  truncated: boolean;
}

function toAmounts(record: Record<string, Rational>): RouteAmount[] {
  return toRecordEntries(record)
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => b.value.sub(a.value).toNumber());
}

function addAmount(
  record: Record<string, Rational>,
  id: string,
  value: Rational,
): void {
  record[id] = (record[id] ?? rational.zero).add(value);
}

function sumAmounts(amounts: RouteAmount[]): Rational {
  return amounts.reduce((e, a) => e.add(a.value), rational.zero);
}

/** Sorts route results by the passed key; failed routes are listed last */
export function sortRouteResults(
  results: RouteResult[],
  key: RouteSortKey,
): RouteResult[] {
  const value = (r: RouteResult): Rational => {
    switch (key) {
      case 'cost':
        return r.cost ?? rational.zero;
      case 'buildings':
        return r.buildings;
      case 'power':
        return r.power;
      case 'raw':
        return sumAmounts(r.rawInputs).add(sumAmounts(r.imports));
    }
  };

  return [...results].sort((a, b) => {
    const aSolved = a.resultType === 'solved' ? 0 : 1;
    const bSolved = b.resultType === 'solved' ? 0 : 1;
    if (aSolved !== bSolved) return aSolved - bSolved;
    return value(a).sub(value(b)).toNumber();
  });
}

/**
 * Compares alternative production routes for an item by solving the
 * production chain once per route, with each route's recipe choices forced.
 */
@Service()
export class RouteComparison {
  private readonly objectivesStore = inject(ObjectivesStore);
  private readonly preferencesStore = inject(PreferencesStore);
  private readonly recipesStore = inject(RecipesStore);
  private readonly settingsStore = inject(SettingsStore);
  private readonly solver = inject(Solver);

  /** Items that can be produced by more than one (non-recycling) recipe */
  readonly itemsWithRoutes = computed(() => {
    const data = this.recipesStore.adjustedDataset();
    const steps = this.objectivesStore.steps();
    const result = new Set<string>();
    for (const step of steps) {
      if (step.itemId && routeAlternatives(step.itemId, data).length > 1)
        result.add(step.itemId);
    }

    return result;
  });

  /**
   * Compare routes to produce an item
   * @param itemId Item to produce
   * @param rate Rate to produce, in items per second
   */
  compare(itemId: string, rate: Rational): RouteComparisonResult {
    const data = this.recipesStore.adjustedDataset();
    const settings = this.settingsStore.settings();
    const recipesSettings = this.recipesStore.settings();
    const glpkAlgorithm = this.preferencesStore.glpkAlgorithm();
    const dispRateVal = this.settingsStore.displayRateInfo().value;

    const currentRecipeIds = new Set<string>();
    for (const step of this.objectivesStore.matrixResult().steps) {
      if (step.recipeId && step.machines?.nonzero())
        currentRecipeIds.add(step.recipeId);
    }

    const objective: ObjectiveState = {
      id: 'route',
      targetId: itemId,
      value: rate,
      unit: ObjectiveUnit.Items,
      type: ObjectiveType.Output,
    };

    const { routes, truncated } = enumerateRoutes(itemId, data, {
      excludedItemIds: settings.excludedItemIds,
    });

    const results = routes.map((route) => {
      const forced = forceRouteChoices(data, route.choices);
      const result = this.solver.solve(
        [objective],
        settings,
        forced,
        false,
        glpkAlgorithm,
      );
      const current = route.choices.every(
        ([i, r]) =>
          currentRecipeIds.has(r) &&
          routeProducers(i, data).every(
            (a) => a === r || !currentRecipeIds.has(a),
          ),
      );
      return this.summarize(
        route,
        result,
        recipesSettings,
        dispRateVal,
        current,
      );
    });

    return { results, truncated };
  }

  summarize(
    route: Route,
    result: SimplexResult,
    recipesSettings: Record<string, RecipeSettings>,
    dispRateVal: Rational,
    current: boolean,
  ): RouteResult {
    let buildings = rational.zero;
    let power = rational.zero;
    let pollution = rational.zero;
    const machines: Record<string, Rational> = {};
    const rawInputs: Record<string, Rational> = {};
    const imports: Record<string, Rational> = {};
    const locationIds = new Set<string>();

    if (result.resultType === 'solved') {
      // Items that are produced by any recipe in the solution
      const producedIds = new Set<string>();
      for (const step of result.steps) {
        if (step.recipe && step.machines?.nonzero())
          Object.keys(step.recipe.out).forEach((i) => producedIds.add(i));
      }

      for (const step of result.steps) {
        if (step.power) power = power.add(step.power);
        if (step.pollution) pollution = pollution.add(step.pollution);

        const recipe = step.recipe;
        if (recipe && step.machines?.nonzero()) {
          recipe.locations?.forEach((l) => locationIds.add(l));

          if (isAsteroidRecipe(recipe)) {
            // Estimate asteroid collectors from the collected chunks
            const chunks = toRecordEntries(recipe.out)
              .reduce((e, [, v]) => e.add(v), rational.zero)
              .mul(step.machines)
              .div(recipe.time);
            const count = chunks.div(ASTEROID_COLLECTOR_RATE).ceil();
            buildings = buildings.add(count);
            addAmount(machines, ASTEROID_COLLECTOR, count);
          }

          const machineId = recipesSettings[recipe.id]?.machineId;
          if (machineId != null && recipe.producers?.length) {
            const count = step.machines.ceil();
            buildings = buildings.add(count);
            addAmount(machines, machineId, count);
          }

          if (recipe.flags.has('mining') || !Object.keys(recipe.in).length) {
            const quantity = step.machines.div(recipe.time).mul(dispRateVal);
            for (const [outId, out] of toRecordEntries(recipe.out))
              addAmount(rawInputs, outId, out.mul(quantity));
          }
        } else if (
          step.itemId &&
          step.items &&
          step.recipeId == null &&
          !producedIds.has(step.itemId)
        ) {
          addAmount(imports, step.itemId, step.items.mul(dispRateVal));
        }
      }
    }

    return {
      route,
      resultType: result.resultType,
      cost: result.cost,
      buildings,
      machines: toAmounts(machines),
      power,
      pollution: pollution.mul(dispRateVal),
      rawInputs: toAmounts(rawInputs),
      imports: toAmounts(imports),
      locationIds: Array.from(locationIds),
      current,
    };
  }

  /**
   * Apply a route by excluding all other recipes that produce each chosen item,
   * including recycling recipes
   */
  applyRoute(route: Route): void {
    const data = this.recipesStore.adjustedDataset();
    const settings = this.settingsStore.settings();
    let value = settings.excludedRecipeIds;
    for (const [itemId, recipeId] of route.choices) {
      const others = routeProducers(itemId, data).filter((r) => r !== recipeId);
      value = updateSetIds(others, true, value);
      value = updateSetIds(recipeId, false, value);
    }

    this.settingsStore.updateField(
      'excludedRecipeIds',
      value,
      settings.defaultExcludedRecipeIds,
    );
  }

  /**
   * Reset recipe exclusions for all items with choices in the passed routes to
   * their defaults, letting the solver decide again
   */
  resetRoutes(routes: Route[]): void {
    const data = this.recipesStore.adjustedDataset();
    const settings = this.settingsStore.settings();
    const defaults = settings.defaultExcludedRecipeIds;
    const itemIds = new Set(routes.flatMap((r) => r.choices.map(([i]) => i)));
    let value = settings.excludedRecipeIds;
    for (const itemId of itemIds) {
      for (const recipeId of routeProducers(itemId, data))
        value = updateSetIds(recipeId, defaults.has(recipeId), value);
    }

    this.settingsStore.updateField('excludedRecipeIds', value, defaults);
  }
}
