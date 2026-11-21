import { computed, inject, Service } from '@angular/core';

import { baseId } from '~/data/schema/quality';
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
import { importRecipe, isImportRecipe } from './imports';
import { RouteAmount, RouteResult } from './route';
import { RouteComparison } from './route-comparison';
import { spoilInfo } from './spoilage';

export const SPACE_PLATFORM = 'space-platform';

export interface ComparisonContext {
  settings: Settings;
  recipesSettings: Record<string, RecipeSettings>;
  data: AdjustedDataset;
  /** Dataset restricted to a location, cached */
  restricted: (locationId: string) => AdjustedDataset;
  /** Cost to produce and ship one item per second, by `itemId|sourceId` */
  unitCosts: Map<string, UnitCost | undefined>;
}

export const ROCKET_PART = 'rocket-part';

/** Criteria used to pick the source of imports */
export type ImportCriterion = 'buildings' | 'resources';
export const importCriteria: ImportCriterion[] = ['buildings', 'resources'];

/** Cost to produce one item per second at a source and ship it */
export interface UnitCost {
  buildings: Rational;
  resources: Rational;
}

/** Estimated cost of producing imports at other locations */
export interface ImportCost {
  /** Estimated buildings at source locations (not rounded) */
  buildings: Rational;
  /** Resources at source locations, plus imports without a source */
  resources: Rational;
  /** Chosen source location for each import */
  sources: Record<string, string>;
  /** Imports that no location can produce */
  unsourced: string[];
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
  /** Estimated cost of imports, choosing sources by each criterion */
  importCosts: Record<ImportCriterion, ImportCost>;
}

/** Buildings including the estimated buildings for imports */
export function totalBuildings(r: PlanetResult): Rational {
  return r.buildings.add(r.importCosts.buildings.buildings);
}

/** Resources including the resources for imports */
export function totalResources(r: PlanetResult): Rational {
  return r.resources.add(r.importCosts.resources.resources);
}

/** Rocket capacity and parts per rocket to ship an item, if possible */
export function shippingInfo(
  itemId: string,
  data: AdjustedDataset,
): { capacity: Rational; parts: Rational } | undefined {
  const capacity = data.itemRecord[itemId]?.rocketCapacity;
  const parts = Object.values(data.machineRecord).find((m) => m.silo)?.silo
    ?.parts;
  return capacity?.nonzero() && parts != null && data.itemRecord[ROCKET_PART]
    ? { capacity, parts }
    : undefined;
}

/** Sum of amounts, with fluids weighted by the fluid cost ratio */
export function weightedTotal(
  amounts: RouteAmount[],
  data: AdjustedDataset,
): Rational {
  return amounts.reduce(
    (e, a) =>
      e.add(
        data.itemRecord[a.id]?.stack == null
          ? a.value.mul(FACTORIO_FLUID_COST_RATIO)
          : a.value,
      ),
    rational.zero,
  );
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

/** Whether an item can be shipped by rocket between locations */
export function isShippable(itemId: string, data: AdjustedDataset): boolean {
  return (
    !!data.itemRecord[itemId]?.rocketCapacity?.nonzero() &&
    spoilInfo(itemId)?.risk !== 'critical'
  );
}

/**
 * Returns a copy of the dataset where only recipes that can be used at the
 * passed location are available. If an import cost is passed, adds synthetic
 * import recipes for items that can be shipped.
 */
export function restrictToLocation(
  data: AdjustedDataset,
  locationId: string,
  importCost?: Rational,
): AdjustedDataset {
  const allowed: Record<string, boolean> = {};
  const isAllowed = (id: string): boolean =>
    (allowed[id] ??= isRecipeAllowed(
      data.adjustedRecipe[id],
      locationId,
      data,
    ));

  const itemAvailableRecipeIds: Record<string, string[]> = {};
  for (const [id, ids] of Object.entries(data.itemAvailableRecipeIds))
    itemAvailableRecipeIds[id] = ids.filter(isAllowed);

  // Items that cannot be shipped (fluids, or items that spoil too fast) can
  // only be used if they can be produced at this location, otherwise exclude
  // recipes that consume them
  const unusable = new Set(
    data.itemIds.filter(
      (i) => !isShippable(i, data) && itemAvailableRecipeIds[i]?.length === 0,
    ),
  );
  const isUsable = (id: string): boolean =>
    isAllowed(id) &&
    Object.keys(data.adjustedRecipe[id].in).every((i) => !unusable.has(i));

  const itemAvailableIoRecipeIds: Record<string, string[]> = {};
  for (const [id, ids] of Object.entries(itemAvailableRecipeIds))
    itemAvailableRecipeIds[id] = ids.filter(isUsable);
  for (const [id, ids] of Object.entries(data.itemAvailableIoRecipeIds))
    itemAvailableIoRecipeIds[id] = ids.filter(isUsable);

  if (importCost == null)
    return { ...data, itemAvailableRecipeIds, itemAvailableIoRecipeIds };

  const adjustedRecipe = { ...data.adjustedRecipe };
  for (const itemId of data.itemIds.filter(
    (i) => baseId(i) === i && isShippable(i, data),
  )) {
    const recipe = importRecipe(itemId, importCost);
    adjustedRecipe[recipe.id] = recipe;
    itemAvailableRecipeIds[itemId] = [
      ...(itemAvailableRecipeIds[itemId] ?? []),
      recipe.id,
    ];
    itemAvailableIoRecipeIds[itemId] = [
      ...(itemAvailableIoRecipeIds[itemId] ?? []),
      recipe.id,
    ];
  }

  return {
    ...data,
    adjustedRecipe,
    itemAvailableRecipeIds,
    itemAvailableIoRecipeIds,
  };
}

/** Returns a copy of the dataset where the passed items cannot be imported */
export function withoutImports(
  data: AdjustedDataset,
  itemIds: Iterable<string>,
): AdjustedDataset {
  const itemAvailableRecipeIds = { ...data.itemAvailableRecipeIds };
  const itemAvailableIoRecipeIds = { ...data.itemAvailableIoRecipeIds };
  const local = (ids: string[] | undefined): string[] =>
    (ids ?? []).filter((r) => !isImportRecipe({ id: r }));
  for (const id of itemIds) {
    itemAvailableRecipeIds[id] = local(itemAvailableRecipeIds[id]);
    itemAvailableIoRecipeIds[id] = local(itemAvailableIoRecipeIds[id]);
  }

  return { ...data, itemAvailableRecipeIds, itemAvailableIoRecipeIds };
}

/** Whether a restricted dataset has a recipe (not an import) for the item */
export function hasLocalRecipe(
  restricted: AdjustedDataset,
  itemId: string,
): boolean {
  return (restricted.itemAvailableRecipeIds[itemId] ?? []).some(
    (r) => !isImportRecipe({ id: r }),
  );
}

/**
 * Ranks a planet result: Results first, then results with imports that no
 * location can produce, then results that cannot produce the item
 */
export function planetRank(result: PlanetResult): number {
  if (!result.feasible) return 2;
  return result.importCosts.buildings.unsourced.length ? 1 : 0;
}

/** Sorts planet results by rank, then by the passed key */
export function sortPlanetResults(
  results: PlanetResult[],
  key: PlanetSortKey,
): PlanetResult[] {
  const value = (r: PlanetResult): Rational => {
    switch (key) {
      case 'buildings':
        return totalBuildings(r);
      case 'resources':
        return totalResources(r);
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
        result = restrictToLocation(
          data,
          locationId,
          settings.costs.unproduceable,
        );
        cache.set(locationId, result);
      }

      return result;
    };
    return {
      settings,
      recipesSettings,
      data,
      restricted,
      unitCosts: new Map(),
    };
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

    return locationIds.map((locationId): PlanetResult => {
      // Objective targets must be produced locally, not imported
      const restricted = withoutImports(
        context.restricted(locationId),
        targetIds,
      );
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

      const resources = weightedTotal(summary.rawInputs, data);

      const recipeIds: string[] = [];
      for (const step of result.steps) {
        const recipe = step.recipe;
        if (
          recipe &&
          !isImportRecipe(recipe) &&
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
        importCosts: this.importCosts(summary.imports, locationId, context),
      };
    });
  }

  /**
   * Estimate the cost of producing imports at other locations and shipping
   * them, choosing the cheapest source by each criterion. Costs are scaled
   * from the cost of one item per second, and imports of the source itself
   * are not considered.
   */
  importCosts(
    imports: RouteAmount[],
    locationId: string,
    context: ComparisonContext,
  ): Record<ImportCriterion, ImportCost> {
    const dispRateVal = this.settingsStore.displayRateInfo().value;
    const sourceIds = this.allLocationIds().filter((l) => l !== locationId);
    const result = {} as Record<ImportCriterion, ImportCost>;
    for (const criterion of importCriteria) {
      const cost: ImportCost = {
        buildings: rational.zero,
        resources: rational.zero,
        sources: {},
        unsourced: [],
      };
      for (const i of imports) {
        let best: [string, UnitCost] | undefined;
        for (const sourceId of sourceIds) {
          const unit = this.unitCost(i.id, sourceId, context);
          if (unit && (best == null || unit[criterion].lt(best[1][criterion])))
            best = [sourceId, unit];
        }

        if (best == null) {
          cost.unsourced.push(i.id);
          cost.resources = cost.resources.add(weightedTotal([i], context.data));
          continue;
        }

        const rate = i.value.div(dispRateVal);
        cost.sources[i.id] = best[0];
        cost.buildings = cost.buildings.add(best[1].buildings.mul(rate));
        cost.resources = cost.resources.add(best[1].resources.mul(rate));
      }

      result[criterion] = cost;
    }

    return result;
  }

  /**
   * Cost to produce one item per second at a source location and ship it,
   * including rocket parts unless shipped from a space platform. Undefined if
   * the item cannot be produced or shipped from that location.
   */
  unitCost(
    itemId: string,
    sourceId: string,
    context: ComparisonContext,
  ): UnitCost | undefined {
    const key = `${itemId}|${sourceId}`;
    if (context.unitCosts.has(key)) return context.unitCosts.get(key);

    let cost: UnitCost | undefined;
    const { data } = context;
    const restricted = context.restricted(sourceId);
    const shipping = shippingInfo(itemId, data);
    if (
      shipping &&
      isShippable(itemId, data) &&
      hasLocalRecipe(restricted, itemId)
    ) {
      const objectives = [this.objective(itemId, rational.one)];
      if (sourceId !== SPACE_PLATFORM)
        objectives.push(
          this.objective(ROCKET_PART, shipping.parts.div(shipping.capacity)),
        );
      const result = this.solver.solve(
        objectives,
        context.settings,
        withoutImports(restricted, [itemId, ROCKET_PART]),
        false,
        this.preferencesStore.glpkAlgorithm(),
      );
      const summary = this.routeComparison.summarize(
        { id: sourceId, choices: [] },
        result,
        context.recipesSettings,
        this.settingsStore.displayRateInfo().value,
        false,
      );
      if (
        summary.resultType === 'solved' &&
        !summary.imports.some((i) => i.id === itemId || i.id === ROCKET_PART)
      )
        cost = {
          buildings: summary.buildingsExact,
          resources: weightedTotal(summary.rawInputs, data),
        };
    }

    context.unitCosts.set(key, cost);
    return cost;
  }

  private objective(targetId: string, value: Rational): ObjectiveState {
    return {
      id: targetId,
      targetId,
      value,
      unit: ObjectiveUnit.Items,
      type: ObjectiveType.Output,
    };
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
