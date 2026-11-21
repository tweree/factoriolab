import { computed, inject, Service, signal } from '@angular/core';

import { baseId } from '~/data/schema/quality';
import { Rational, rational } from '~/rational/rational';
import { toRecordEntries } from '~/utils/record';

import { ObjectiveState } from '../objectives/objective';
import { ObjectiveType } from '../objectives/objective-type';
import { ObjectiveUnit } from '../objectives/objective-unit';
import { ObjectivesStore } from '../objectives/objectives-store';
import {
  ComparisonContext,
  hasLocalRecipe,
  isRecipeAllowed,
  PlanetComparison,
  planetRank,
  PlanetResult,
  ROCKET_PART,
  shippingInfo,
  SPACE_PLATFORM,
  totalBuildings,
  totalResources,
} from '../routes/planet-comparison';
import { RouteAmount } from '../routes/route';
import { routeProducers } from '../routes/route-enumeration';
import { AdjustedDataset } from '../settings/dataset';
import { SettingsStore } from '../settings/settings-store';

export { ROCKET_PART } from '../routes/planet-comparison';

/** Science packs are always delivered to this location */
export const SCIENCE_DESTINATION = 'nauvis';

export type ScienceCriterion = 'buildings' | 'resources';

export interface ScienceOption extends PlanetResult {
  /** Rockets required to ship the packs to the destination, per display rate */
  shipRockets: Rational;
  /** Rocket parts produced at this location for shipping, per display rate */
  rocketParts: Rational;
  /** For each import, the locations that can produce it */
  importSources: Record<string, string[]>;
}

export interface SciencePackPlan {
  itemId: string;
  /** Options sorted by rank and criterion, the first is the best */
  options: ScienceOption[];
}

export interface SciencePlanetSummary {
  locationId: string;
  packIds: string[];
  /** Buildings including estimated buildings for imports */
  buildings: Rational;
  /** Resources including resources for imports */
  resources: Rational;
  /** Estimated buildings at other locations for imports */
  importBuildings: Rational;
  /** Resources at other locations for imports */
  importResources: Rational;
  shipRockets: Rational;
  rocketParts: Rational;
  imports: RouteAmount[];
}

export interface SciencePlan {
  packs: SciencePackPlan[];
  planets: SciencePlanetSummary[];
  buildings: Rational;
  resources: Rational;
  /** Totals if each pack is made at the destination wherever possible */
  baselineBuildings: Rational;
  baselineResources: Rational;
}

/** Items consumed by technologies, in dataset order */
export function sciencePackIds(data: AdjustedDataset): string[] {
  const ids = new Set<string>();
  for (const recipe of Object.values(data.adjustedRecipe)) {
    if (!recipe.flags.has('technology')) continue;
    for (const id of Object.keys(recipe.in)) ids.add(id);
  }

  return data.itemIds.filter(
    (i) => ids.has(i) && baseId(i) === i && routeProducers(i, data).length,
  );
}

/** Locations where the item can be produced by its final recipe */
export function packLocations(
  itemId: string,
  data: AdjustedDataset,
  locationIds: string[],
): string[] {
  const recipes = routeProducers(itemId, data).map(
    (r) => data.adjustedRecipe[r],
  );
  return locationIds.filter((l) =>
    recipes.some((r) => isRecipeAllowed(r, l, data)),
  );
}

/** Locations that have a recipe to produce the item, destination first */
export function importSources(
  itemId: string,
  context: ComparisonContext,
  locationIds: string[],
): string[] {
  const sources = locationIds.filter((l) =>
    hasLocalRecipe(context.restricted(l), itemId),
  );
  return sources.sort(
    (a, b) =>
      (a === SCIENCE_DESTINATION ? 0 : 1) - (b === SCIENCE_DESTINATION ? 0 : 1),
  );
}

/** Buildings or resources of an option, including imports */
export function scienceTotal(
  option: PlanetResult,
  criterion: ScienceCriterion,
): Rational {
  return criterion === 'buildings'
    ? totalBuildings(option)
    : totalResources(option);
}

export function sortScienceOptions(
  options: ScienceOption[],
  criterion: ScienceCriterion,
): ScienceOption[] {
  return [...options].sort((a, b) => {
    const rank = planetRank(a) - planetRank(b);
    if (rank !== 0) return rank;
    return scienceTotal(a, criterion)
      .sub(scienceTotal(b, criterion))
      .toNumber();
  });
}

function addAmounts(
  target: Record<string, Rational>,
  amounts: RouteAmount[],
): void {
  for (const a of amounts)
    target[a.id] = (target[a.id] ?? rational.zero).add(a.value);
}

/** Summarize the chosen options per location and compare to the baseline */
export function buildSciencePlan(
  packs: SciencePackPlan[],
  criterion: ScienceCriterion,
): SciencePlan {
  const planets = new Map<
    string,
    { summary: SciencePlanetSummary; imports: Record<string, Rational> }
  >();
  let buildings = rational.zero;
  let resources = rational.zero;
  let baselineBuildings = rational.zero;
  let baselineResources = rational.zero;

  for (const pack of packs) {
    const best = pack.options[0];
    if (best == null) continue;
    const imports = best.importCosts[criterion];
    buildings = buildings.add(best.buildings).add(imports.buildings);
    resources = resources.add(best.resources).add(imports.resources);

    const baseline =
      pack.options.find(
        (o) => o.locationId === SCIENCE_DESTINATION && o.feasible,
      ) ?? best;
    const baselineImports = baseline.importCosts[criterion];
    baselineBuildings = baselineBuildings
      .add(baseline.buildings)
      .add(baselineImports.buildings);
    baselineResources = baselineResources
      .add(baseline.resources)
      .add(baselineImports.resources);

    let entry = planets.get(best.locationId);
    if (entry == null) {
      entry = {
        summary: {
          locationId: best.locationId,
          packIds: [],
          buildings: rational.zero,
          resources: rational.zero,
          importBuildings: rational.zero,
          importResources: rational.zero,
          shipRockets: rational.zero,
          rocketParts: rational.zero,
          imports: [],
        },
        imports: {},
      };
      planets.set(best.locationId, entry);
    }

    const planet = entry.summary;
    planet.packIds.push(pack.itemId);
    planet.buildings = planet.buildings
      .add(best.buildings)
      .add(imports.buildings);
    planet.resources = planet.resources
      .add(best.resources)
      .add(imports.resources);
    planet.importBuildings = planet.importBuildings.add(imports.buildings);
    planet.importResources = planet.importResources.add(imports.resources);
    planet.shipRockets = planet.shipRockets.add(best.shipRockets);
    planet.rocketParts = planet.rocketParts.add(best.rocketParts);
    addAmounts(entry.imports, best.imports);
  }

  for (const entry of planets.values()) {
    entry.summary.imports = toRecordEntries(entry.imports)
      .map(([id, value]) => ({ id, value }))
      .sort((a, b) => b.value.sub(a.value).toNumber());
  }

  return {
    packs,
    planets: Array.from(planets.values()).map((e) => e.summary),
    buildings,
    resources,
    baselineBuildings,
    baselineResources,
  };
}

/**
 * Plans where to produce science packs. Packs are delivered to Nauvis: packs
 * produced on other planets are shipped by rocket, and the rocket parts for
 * those rockets are produced at the same location. Packs produced on a space
 * platform are dropped to the destination without rockets.
 */
@Service()
export class SciencePlanner {
  private readonly objectivesStore = inject(ObjectivesStore);
  private readonly planetComparison = inject(PlanetComparison);
  private readonly settingsStore = inject(SettingsStore);

  /** Rate per pack, in display rate units; defaults to one per second */
  readonly rate = signal<Rational | undefined>(undefined);
  /** Selected pack ids; undefined selects all packs */
  readonly selection = signal<Set<string> | undefined>(undefined);
  readonly criterion = signal<ScienceCriterion>('buildings');

  readonly effectiveRate = computed(
    () => this.rate() ?? this.settingsStore.displayRateInfo().value,
  );

  readonly context = computed(() => this.planetComparison.createContext());

  readonly packIds = computed(() => sciencePackIds(this.context().data));

  readonly selectedIds = computed(() => {
    const selection = this.selection();
    const ids = this.packIds();
    return selection == null ? ids : ids.filter((i) => selection.has(i));
  });

  /** Options for every pack, independent of selection and criterion */
  readonly options = computed(() => {
    const context = this.context();
    const rate = this.effectiveRate();
    return this.packIds().reduce<Record<string, ScienceOption[]>>((e, id) => {
      e[id] = this.compare(id, rate, context);
      return e;
    }, {});
  });

  readonly plan = computed(() => {
    const options = this.options();
    const criterion = this.criterion();
    return buildSciencePlan(
      this.selectedIds().map((itemId) => ({
        itemId,
        options: sortScienceOptions(options[itemId], criterion),
      })),
      criterion,
    );
  });

  /**
   * Compare producing a pack at each location where it can be produced
   * @param rate Rate in display rate units
   */
  compare(
    itemId: string,
    rate: Rational,
    context: ComparisonContext,
  ): ScienceOption[] {
    const { data } = context;
    const dispRateVal = this.settingsStore.displayRateInfo().value;
    const allIds = this.planetComparison.allLocationIds();
    const shipping = shippingInfo(itemId, data);

    return packLocations(itemId, data, allIds).flatMap((locationId) => {
      const objectives: ObjectiveState[] = [
        this.objective(itemId, rate.div(dispRateVal)),
      ];

      let shipRockets = rational.zero;
      let rocketParts = rational.zero;
      if (
        locationId !== SCIENCE_DESTINATION &&
        locationId !== SPACE_PLATFORM &&
        shipping
      ) {
        shipRockets = rate.div(shipping.capacity);
        rocketParts = shipRockets.mul(shipping.parts);
        objectives.push(
          this.objective(ROCKET_PART, rocketParts.div(dispRateVal)),
        );
      }

      const [result] = this.planetComparison.compareObjectives(
        objectives,
        context,
        [locationId],
      );
      const sources: Record<string, string[]> = {};
      for (const i of result.imports)
        sources[i.id] = importSources(i.id, context, allIds);

      return [{ ...result, shipRockets, rocketParts, importSources: sources }];
    });
  }

  /** Replace the objectives with the packs of a location and restrict to it */
  openInList(summary: SciencePlanetSummary): void {
    const rate = this.effectiveRate();
    this.objectivesStore.set({});
    for (const targetId of summary.packIds)
      this.objectivesStore.add(this.base(targetId, rate));
    if (summary.rocketParts.nonzero())
      this.objectivesStore.add(this.base(ROCKET_PART, summary.rocketParts));
    this.planetComparison.restrictTo(summary.locationId);
  }

  togglePack(itemId: string, value: boolean): void {
    const current = new Set(this.selectedIds());
    if (value) current.add(itemId);
    else current.delete(itemId);
    this.selection.set(current);
  }

  selectAll(value: boolean): void {
    this.selection.set(value ? undefined : new Set());
  }

  private base(targetId: string, value: Rational): Omit<ObjectiveState, 'id'> {
    return {
      targetId,
      value,
      unit: ObjectiveUnit.Items,
      type: ObjectiveType.Output,
    };
  }

  private objective(targetId: string, value: Rational): ObjectiveState {
    return { id: targetId, ...this.base(targetId, value) };
  }
}
