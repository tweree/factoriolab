import { baseId } from '~/data/schema/quality';
import { AdjustedRecipe } from '~/data/schema/recipe';
import { Rational, rational } from '~/rational/rational';
import { SimplexResult } from '~/solver/simplex-result';
import { toRecordEntries } from '~/utils/record';

import { RecipeSettings } from '../recipes/recipe-settings';
import {
  ASTEROID_COLLECTOR,
  ASTEROID_COLLECTOR_RATE,
  isAsteroidRecipe,
} from '../routes/asteroids';
import {
  isShippable,
  restrictToLocation,
  ROCKET_PART,
  shippingInfo,
  SPACE_PLATFORM,
} from '../routes/planet-comparison';
import { RouteAmount } from '../routes/route';
import { AdjustedDataset } from '../settings/dataset';

export const LOCATION_SEPARATOR = '@';
export const SHIP_RECIPE_PREFIX = 'ship|';
/** Small cost per shipped item per second, to avoid pointless shipping */
export const SHIP_COST = rational(1n, 1000n);

/** Id of an item or recipe at a location */
export function locatedId(id: string, locationId: string): string {
  return `${id}${LOCATION_SEPARATOR}${locationId}`;
}

/** Split a located id into its id and location */
export function splitLocatedId(id: string): [string, string] {
  const i = id.lastIndexOf(LOCATION_SEPARATOR);
  return [id.substring(0, i), id.substring(i + 1)];
}

export function shipRecipeId(itemId: string, from: string, to: string): string {
  return `${SHIP_RECIPE_PREFIX}${itemId}|${from}|${to}`;
}

/** Parse a ship recipe id into item id, source and destination */
export function parseShipRecipeId(
  id: string,
): [string, string, string] | undefined {
  if (!id.startsWith(SHIP_RECIPE_PREFIX)) return undefined;
  const [itemId, from, to] = id.substring(SHIP_RECIPE_PREFIX.length).split('|');
  return [itemId, from, to];
}

function locateRecord(
  record: Partial<Record<string, Rational>>,
  locationId: string,
): Record<string, Rational> {
  const result: Record<string, Rational> = {};
  for (const [id, value] of toRecordEntries(record))
    result[locatedId(id, locationId)] = value;
  return result;
}

/** Copy of a recipe at a location, with ingredients and products renamed */
export function locateRecipe(
  recipe: AdjustedRecipe,
  locationId: string,
): AdjustedRecipe {
  return {
    ...recipe,
    id: locatedId(recipe.id, locationId),
    in: locateRecord(recipe.in, locationId),
    out: locateRecord(recipe.out, locationId),
    catalyst: recipe.catalyst
      ? locateRecord(recipe.catalyst, locationId)
      : undefined,
    produces: new Set(
      Array.from(recipe.produces).map((i) => locatedId(i, locationId)),
    ),
    output: locateRecord(recipe.output, locationId),
  };
}

/**
 * Build a dataset where every item and recipe exists once per location, plus
 * recipes to ship items between locations. Shipping from a planet consumes
 * rocket parts at the source; shipping from a space platform is free.
 */
export function buildDistributionDataset(
  data: AdjustedDataset,
  locationIds: string[],
): AdjustedDataset {
  const adjustedRecipe: Record<string, AdjustedRecipe> = {};
  const itemRecord: AdjustedDataset['itemRecord'] = {};
  const itemIds: string[] = [];
  const available: Record<string, string[]> = {};
  const io: Record<string, string[]> = {};
  const push = (
    record: Record<string, string[]>,
    id: string,
    r: string,
  ): void => {
    (record[id] ??= []).push(r);
  };

  for (const locationId of locationIds) {
    const restricted = restrictToLocation(data, locationId);
    for (const itemId of data.itemIds) {
      const id = locatedId(itemId, locationId);
      itemIds.push(id);
      itemRecord[id] = { ...data.itemRecord[itemId], id };
      available[id] = [];
      io[id] = [];
    }

    const recipeIds = new Set(
      Object.values(restricted.itemAvailableRecipeIds).flat(),
    );
    for (const recipeId of recipeIds) {
      const recipe = locateRecipe(data.adjustedRecipe[recipeId], locationId);
      adjustedRecipe[recipe.id] = recipe;
    }

    for (const [itemId, ids] of Object.entries(
      restricted.itemAvailableRecipeIds,
    ))
      for (const r of ids)
        push(
          available,
          locatedId(itemId, locationId),
          locatedId(r, locationId),
        );
    for (const [itemId, ids] of Object.entries(
      restricted.itemAvailableIoRecipeIds,
    ))
      for (const r of ids)
        if (recipeIds.has(r))
          push(io, locatedId(itemId, locationId), locatedId(r, locationId));
  }

  for (const itemId of data.itemIds) {
    if (baseId(itemId) !== itemId || !isShippable(itemId, data)) continue;
    const shipping = shippingInfo(itemId, data);
    if (shipping == null) continue;
    for (const from of locationIds) {
      for (const to of locationIds) {
        if (from === to) continue;
        const id = shipRecipeId(itemId, from, to);
        const source = locatedId(itemId, from);
        const target = locatedId(itemId, to);
        const one = rational.one;
        const recipeIn: Record<string, Rational> = { [source]: one };
        const output: Record<string, Rational> = {
          [source]: rational(-1n),
          [target]: one,
        };
        if (from !== SPACE_PLATFORM) {
          const parts = shipping.parts.div(shipping.capacity);
          const partId = locatedId(ROCKET_PART, from);
          recipeIn[partId] = parts;
          output[partId] = rational.zero.sub(parts);
          push(io, partId, id);
        }

        adjustedRecipe[id] = {
          id,
          name: id,
          category: '',
          row: 0,
          time: one,
          in: recipeIn,
          out: { [target]: one },
          flags: new Set(),
          produces: new Set([target]),
          output,
          cost: SHIP_COST,
        } as unknown as AdjustedRecipe;
        push(available, target, id);
        push(io, target, id);
        push(io, source, id);
      }
    }
  }

  return {
    ...data,
    itemIds,
    itemRecord,
    adjustedRecipe,
    itemAvailableRecipeIds: available,
    itemAvailableIoRecipeIds: io,
  };
}

export interface DistributionShipment {
  itemId: string;
  from: string;
  to: string;
  /** Amount per display rate */
  amount: Rational;
  /** Rockets per display rate, zero if dropped from a space platform */
  rockets: Rational;
}

export interface DistributionRecipe {
  recipeId: string;
  machineId?: string;
  /** Machines, not rounded */
  machines: Rational;
}

export interface DistributionLocation {
  locationId: string;
  buildings: Rational;
  machines: RouteAmount[];
  recipes: DistributionRecipe[];
  rawInputs: RouteAmount[];
  imports: RouteAmount[];
  power: Rational;
}

export interface DistributionResult {
  resultType: SimplexResult['resultType'];
  locations: DistributionLocation[];
  shipments: DistributionShipment[];
  buildings: Rational;
  /** Rockets per display rate */
  rockets: Rational;
}

function sortedAmounts(record: Record<string, Rational>): RouteAmount[] {
  return toRecordEntries(record)
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => b.value.sub(a.value).toNumber());
}

/** Summarize a distribution solution per location, plus shipments */
export function summarizeDistribution(
  result: SimplexResult,
  data: AdjustedDataset,
  recipesSettings: Record<string, RecipeSettings>,
  dispRateVal: Rational,
): DistributionResult {
  interface Totals {
    buildings: Rational;
    machines: Record<string, Rational>;
    recipes: DistributionRecipe[];
    rawInputs: Record<string, Rational>;
    imports: Record<string, Rational>;
    power: Rational;
  }
  const totals = new Map<string, Totals>();
  const get = (locationId: string): Totals => {
    let t = totals.get(locationId);
    if (t == null) {
      t = {
        buildings: rational.zero,
        machines: {},
        recipes: [],
        rawInputs: {},
        imports: {},
        power: rational.zero,
      };
      totals.set(locationId, t);
    }

    return t;
  };
  const add = (
    record: Record<string, Rational>,
    id: string,
    value: Rational,
  ): void => {
    record[id] = (record[id] ?? rational.zero).add(value);
  };

  const shipments: DistributionShipment[] = [];
  let buildings = rational.zero;
  let rockets = rational.zero;
  if (result.resultType === 'solved') {
    const producedIds = new Set<string>();
    for (const step of result.steps)
      if (step.recipe && step.machines?.nonzero())
        Object.keys(step.recipe.out).forEach((i) => producedIds.add(i));

    for (const step of result.steps) {
      const recipe = step.recipe;
      if (recipe && step.machines?.nonzero()) {
        const ship = parseShipRecipeId(recipe.id);
        if (ship) {
          const [itemId, from, to] = ship;
          const amount = step.machines.div(recipe.time).mul(dispRateVal);
          const capacity =
            data.itemRecord[locatedId(itemId, from)]?.rocketCapacity;
          const shipRockets =
            from !== SPACE_PLATFORM && capacity?.nonzero()
              ? amount.div(capacity)
              : rational.zero;
          rockets = rockets.add(shipRockets);
          shipments.push({ itemId, from, to, amount, rockets: shipRockets });
          continue;
        }

        const [recipeId, locationId] = splitLocatedId(recipe.id);
        const t = get(locationId);
        if (step.power) t.power = t.power.add(step.power);

        if (
          isAsteroidRecipe({
            ...recipe,
            out: Object.fromEntries(
              toRecordEntries(recipe.out).map(([k, v]) => [
                splitLocatedId(k)[0],
                v,
              ]),
            ),
          })
        ) {
          const chunks = toRecordEntries(recipe.out)
            .reduce((e, [, v]) => e.add(v), rational.zero)
            .mul(step.machines)
            .div(recipe.time);
          const count = chunks.div(ASTEROID_COLLECTOR_RATE).ceil();
          t.buildings = t.buildings.add(count);
          add(t.machines, ASTEROID_COLLECTOR, count);
        }

        const machineId = recipesSettings[recipeId]?.machineId;
        if (machineId != null && recipe.producers?.length) {
          const count = step.machines.ceil();
          t.buildings = t.buildings.add(count);
          add(t.machines, machineId, count);
        }

        t.recipes.push({ recipeId, machineId, machines: step.machines });

        if (recipe.flags.has('mining') || !Object.keys(recipe.in).length) {
          const quantity = step.machines.div(recipe.time).mul(dispRateVal);
          for (const [outId, out] of toRecordEntries(recipe.out))
            add(t.rawInputs, splitLocatedId(outId)[0], out.mul(quantity));
        }
      } else if (
        step.itemId &&
        step.items &&
        step.recipeId == null &&
        !producedIds.has(step.itemId)
      ) {
        const [itemId, locationId] = splitLocatedId(step.itemId);
        add(get(locationId).imports, itemId, step.items.mul(dispRateVal));
      }
    }
  }

  const locations = Array.from(totals.entries()).map(
    ([locationId, t]): DistributionLocation => {
      buildings = buildings.add(t.buildings);
      return {
        locationId,
        buildings: t.buildings,
        machines: sortedAmounts(t.machines),
        recipes: t.recipes.sort((a, b) =>
          b.machines.sub(a.machines).toNumber(),
        ),
        rawInputs: sortedAmounts(t.rawInputs),
        imports: sortedAmounts(t.imports),
        power: t.power,
      };
    },
  );

  return {
    resultType: result.resultType,
    locations: locations.sort((a, b) =>
      b.buildings.sub(a.buildings).toNumber(),
    ),
    shipments: shipments.sort((a, b) => b.amount.sub(a.amount).toNumber()),
    buildings,
    rockets,
  };
}
