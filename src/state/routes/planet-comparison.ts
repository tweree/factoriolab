import { computed, inject, Service } from '@angular/core';

import { AdjustedRecipe } from '~/data/schema/recipe';
import { Rational, rational } from '~/rational/rational';
import { Solver } from '~/solver/solver';

import {
  isRecipeObjective,
  ObjectiveState,
  RecipeObjective,
} from '../objectives/objective';
import { ObjectiveType } from '../objectives/objective-type';
import { ObjectiveUnit } from '../objectives/objective-unit';
import { ObjectivesStore } from '../objectives/objectives-store';
import { PreferencesStore } from '../preferences/preferences-store';
import { RecipeSettings } from '../recipes/recipe-settings';
import { RecipesStore } from '../recipes/recipes-store';
import { FACTORIO_FLUID_COST_RATIO } from '../settings/cost-settings';
import { AdjustedDataset } from '../settings/dataset';
import { Settings } from '../settings/settings';
import { SettingsStore } from '../settings/settings-store';
import { isAsteroidRecipe } from './asteroids';
import { RouteAmount, RouteResult } from './route';
import { RouteComparison } from './route-comparison';

export const SPACE_PLATFORM = 'space-platform';

export interface ComparisonContext {
  settings: Settings;
  recipesSettings: Record<string, RecipeSettings>;
  data: AdjustedDataset;
  /** Dataset restricted to a location, cached */
  restricted: (locationId: string) => AdjustedDataset;
}

export type PlanetSortKey = 'buildings' | 'resources' | 'rockets';

export interface PlanetResult extends RouteResult {
  locationId: string;
  /** Whether the target item itself can be produced at this location */
  feasible: boolean;
  /** Recipes used to produce the target item */
  recipeIds: string[];
  /** Total raw resources and imports, fluids weighted by 1/10 */
  resources: Rational;
  /** Rockets required to import items, per display rate */
  rockets: Rational;
  /** Whether some imports cannot be transported by rocket (e.g. fluids) */
  unshippable: boolean;
}

/** Whether a recipe can be used at the passed location */
export function isRecipeAllowed(
  recipe: AdjustedRecipe,
  locationId: string,
  data: AdjustedDataset,
): boolean {
  if (recipe.locations != null && !recipe.locations.includes(locationId))
    return false;

  // Asteroid collection is only available in space
  if (isAsteroidRecipe(recipe) && locationId !== SPACE_PLATFORM) return false;

  const producers = recipe.producers ?? [];
  return (
    producers.length === 0 ||
    producers.some((p) => {
      const locations = data.machineRecord[p]?.locations;
      return locations == null || locations.includes(locationId);
    })
  );
}

/**
 * Returns a copy of the dataset where only recipes that can be used at the
 * passed location are available
 */
export function restrictToLocation(
  data: AdjustedDataset,
  locationId: string,
): AdjustedDataset {
  const allowed: Record<string, boolean> = {};
  const isAllowed = (id: string): boolean =>
    (allowed[id] ??= isRecipeAllowed(
      data.adjustedRecipe[id],
      locationId,
      data,
    ));

  const itemAvailableRecipeIds: Record<string, string[]> = {};
  const itemAvailableIoRecipeIds: Record<string, string[]> = {};
  for (const [id, ids] of Object.entries(data.itemAvailableRecipeIds))
    itemAvailableRecipeIds[id] = ids.filter(isAllowed);
  for (const [id, ids] of Object.entries(data.itemAvailableIoRecipeIds))
    itemAvailableIoRecipeIds[id] = ids.filter(isAllowed);

  return { ...data, itemAvailableRecipeIds, itemAvailableIoRecipeIds };
}

/**
 * Ranks a planet result: Results that are self-sufficient come first, then
 * results that require imports, then results that cannot produce the item
 */
export function planetRank(result: PlanetResult): number {
  if (!result.feasible) return 2;
  return result.imports.length ? 1 : 0;
}

/** Sorts planet results by rank, then by the passed key */
export function sortPlanetResults(
  results: PlanetResult[],
  key: PlanetSortKey,
): PlanetResult[] {
  const value = (r: PlanetResult): Rational => {
    switch (key) {
      case 'buildings':
        return r.buildings;
      case 'resources':
        return r.resources;
      case 'rockets':
        return r.rockets;
    }
  };

  return [...results].sort((a, b) => {
    const rank = planetRank(a) - planetRank(b);
    if (rank !== 0) return rank;
    return value(a).sub(value(b)).toNumber();
  });
}

/**
 * Compares producing an item at each enabled location, by solving the
 * production chain with only the recipes available at that location. Any
 * items that cannot be produced locally are treated as imports.
 */
@Service()
export class PlanetComparison {
  private readonly objectivesStore = inject(ObjectivesStore);
  private readonly preferencesStore = inject(PreferencesStore);
  private readonly recipesStore = inject(RecipesStore);
  private readonly routeComparison = inject(RouteComparison);
  private readonly settingsStore = inject(SettingsStore);
  private readonly solver = inject(Solver);

  /**
   * Locations to compare: The enabled locations, or all locations if the
   * factory is restricted to a single location
   */
  readonly locationIds = computed(() => {
    const data = this.settingsStore.dataset();
    const enabled = this.settingsStore.settings().locationIds;
    const ids = data.locationIds.filter((l) => enabled.has(l));
    return ids.length > 1 ? ids : data.locationIds;
  });

  readonly available = computed(() => this.locationIds().length > 1);

  /** All locations in the dataset */
  readonly allLocationIds = computed(
    () => this.settingsStore.dataset().locationIds,
  );

  /**
   * Compare producing an item at each location
   * @param itemId Item to produce
   * @param rate Rate to produce, in items per second
   */
  compare(itemId: string, rate: Rational): PlanetResult[] {
    const objective: ObjectiveState = {
      id: 'planet',
      targetId: itemId,
      value: rate,
      unit: ObjectiveUnit.Items,
      type: ObjectiveType.Output,
    };
    return this.compareObjectives([objective]);
  }

  /**
   * Create a context for comparisons, using a dataset with all locations so
   * that locations that are not enabled in the settings can be compared.
   * Reuse a context for multiple comparisons to avoid recomputing datasets.
   */
  createContext(): ComparisonContext {
    const settings = this.settingsStore.allLocationsSettings();
    const { recipesSettings, data } =
      this.recipesStore.adjustDatasetFor(settings);
    const cache = new Map<string, AdjustedDataset>();
    const restricted = (locationId: string): AdjustedDataset => {
      let result = cache.get(locationId);
      if (result == null) {
        result = restrictToLocation(data, locationId);
        cache.set(locationId, result);
      }

      return result;
    };
    return { settings, recipesSettings, data, restricted };
  }

  /** Compare the current objectives (the whole factory) at each location */
  compareFactory(): PlanetResult[] {
    return this.compareObjectives(this.objectivesStore.normalizedObjectives());
  }

  /**
   * Compare producing a set of normalized objectives at each location. A
   * location is feasible if all output item objectives can be produced locally
   * and all recipe objectives are allowed there.
   */
  compareObjectives(
    objectives: ObjectiveState[],
    context = this.createContext(),
    locationIds = this.locationIds(),
  ): PlanetResult[] {
    const { settings, recipesSettings, data } = context;
    const glpkAlgorithm = this.preferencesStore.glpkAlgorithm();
    const dispRateVal = this.settingsStore.displayRateInfo().value;

    const targetIds = new Set<string>();
    const recipeObjectives: RecipeObjective[] = [];
    for (const o of objectives) {
      if (isRecipeObjective(o)) recipeObjectives.push(o);
      else if (o.type === ObjectiveType.Output) targetIds.add(o.targetId);
    }

    const weight = (a: RouteAmount): Rational =>
      data.itemRecord[a.id]?.stack == null
        ? a.value.mul(FACTORIO_FLUID_COST_RATIO)
        : a.value;

    return locationIds.map((locationId): PlanetResult => {
      const restricted = context.restricted(locationId);
      const result = this.solver.solve(
        objectives,
        settings,
        restricted,
        false,
        glpkAlgorithm,
      );
      const summary = this.routeComparison.summarize(
        { id: locationId, choices: [] },
        result,
        recipesSettings,
        dispRateVal,
        false,
      );

      let rockets = rational.zero;
      let unshippable = false;
      for (const i of summary.imports) {
        const capacity = data.itemRecord[i.id]?.rocketCapacity;
        if (capacity?.nonzero()) rockets = rockets.add(i.value.div(capacity));
        else unshippable = true;
      }

      const resources = [...summary.rawInputs, ...summary.imports].reduce(
        (e, a) => e.add(weight(a)),
        rational.zero,
      );

      const recipeIds: string[] = [];
      for (const step of result.steps) {
        const recipe = step.recipe;
        if (
          recipe &&
          step.machines?.nonzero() &&
          Array.from(targetIds).some((t) => recipe.produces.has(t))
        )
          recipeIds.push(recipe.id);
      }

      return {
        ...summary,
        locationId,
        feasible:
          summary.resultType === 'solved' &&
          !summary.imports.some((i) => targetIds.has(i.id)) &&
          recipeObjectives.every((o) =>
            isRecipeAllowed(o.recipe, locationId, data),
          ),
        recipeIds,
        resources,
        rockets,
        unshippable,
      };
    });
  }

  /** Restrict the factory to the passed location */
  restrictTo(locationId: string): void {
    const settings = this.settingsStore.settings();
    this.settingsStore.updateField(
      'locationIds',
      new Set([locationId]),
      settings.defaultLocationIds,
    );
  }
}
