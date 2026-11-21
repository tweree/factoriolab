import { AdjustedRecipe, finalizeRecipe } from '~/data/schema/recipe';
import { rational } from '~/rational/rational';
import { AdjustedDataset } from '~/state/settings/dataset';

import {
  enumerateRoutes,
  forceRouteChoices,
  mergeChoices,
  routeAlternatives,
  routeProducers,
} from './route-enumeration';

function recipe(
  id: string,
  inputs: Record<string, number>,
  outputs: Record<string, number>,
  flags: string[] = [],
): AdjustedRecipe {
  const toRational = (r: Record<string, number>): AdjustedRecipe['in'] =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, rational(v)]));
  const result = {
    id,
    name: id,
    time: rational.one,
    in: toRational(inputs),
    out: toRational(outputs),
    flags: new Set(flags),
    produces: new Set<string>(),
    output: {},
  } as unknown as AdjustedRecipe;
  finalizeRecipe(result);
  return result;
}

function dataset(
  recipes: AdjustedRecipe[],
  excludedRecipeIds: string[] = [],
): AdjustedDataset {
  const adjustedRecipe: Record<string, AdjustedRecipe> = {};
  const itemRecipeIds: Record<string, string[]> = {};
  const itemAvailableRecipeIds: Record<string, string[]> = {};
  const itemAvailableIoRecipeIds: Record<string, string[]> = {};
  const ensure = (id: string): void => {
    itemRecipeIds[id] ??= [];
    itemAvailableRecipeIds[id] ??= [];
    itemAvailableIoRecipeIds[id] ??= [];
  };
  for (const r of recipes) {
    adjustedRecipe[r.id] = r;
    for (const id of [...Object.keys(r.in), ...Object.keys(r.out)]) ensure(id);
    for (const id of Object.keys(r.out)) itemRecipeIds[id].push(r.id);
    if (excludedRecipeIds.includes(r.id)) continue;
    for (const id of r.produces) itemAvailableRecipeIds[id].push(r.id);
    for (const id of Object.keys(r.output))
      itemAvailableIoRecipeIds[id].push(r.id);
  }

  return {
    adjustedRecipe,
    itemRecipeIds,
    itemAvailableRecipeIds,
    itemAvailableIoRecipeIds,
  } as unknown as AdjustedDataset;
}

/** Plate via furnace or via molten metal, molten metal via ore or lava */
const plateData = (): AdjustedDataset =>
  dataset([
    recipe('furnace', { ore: 1 }, { plate: 1 }),
    recipe('casting', { molten: 10 }, { plate: 1 }),
    recipe('melting', { ore: 1 }, { molten: 10 }),
    recipe('lava', { lava: 10 }, { molten: 10, stone: 1 }),
    recipe('mining', {}, { ore: 1 }, ['mining']),
    recipe('pump', {}, { lava: 10 }),
    recipe('stone', {}, { stone: 1 }, ['mining']),
  ]);

const ids = (data: AdjustedDataset, itemId: string): string[][] =>
  enumerateRoutes(itemId, data).routes.map((r) =>
    r.choices.map((c) => c.join(':')),
  );

describe('route-enumeration', () => {
  describe('routeProducers', () => {
    it('should return recipes that net-produce the item', () => {
      const data = dataset([
        recipe('a', {}, { x: 1 }),
        recipe('b', { x: 2 }, { x: 1 }),
        recipe('c', { x: 1 }, { y: 1 }),
      ]);
      expect(routeProducers('x', data)).toEqual(['a']);
    });

    it('should handle items without recipes', () => {
      expect(routeProducers('missing', dataset([]))).toEqual([]);
    });
  });

  describe('routeAlternatives', () => {
    it('should ignore recycling and quality recipes for base items', () => {
      const data = dataset([
        recipe('a', {}, { x: 1 }),
        recipe('a-recycling', { y: 1 }, { x: 1 }, ['recycling']),
        recipe('a(1)', {}, { x: 1 }),
        recipe('b(1)', {}, { 'x(1)': 1 }),
      ]);
      expect(routeAlternatives('x', data)).toEqual(['a']);
      expect(routeAlternatives('x(1)', data)).toEqual(['b(1)']);
    });
  });

  describe('mergeChoices', () => {
    it('should merge compatible choices', () => {
      expect(mergeChoices({ a: '1' }, { a: '1', b: '2' })).toEqual({
        a: '1',
        b: '2',
      });
    });

    it('should return undefined on conflict', () => {
      expect(mergeChoices({ a: '1' }, { a: '2' })).toBeUndefined();
    });
  });

  describe('enumerateRoutes', () => {
    it('should enumerate nested decisions', () => {
      expect(ids(plateData(), 'plate')).toEqual([
        ['plate:furnace'],
        ['plate:casting', 'molten:melting'],
        ['plate:casting', 'molten:lava'],
      ]);
    });

    it('should limit the decision depth', () => {
      const result = enumerateRoutes('plate', plateData(), { maxDepth: 1 });
      expect(result.routes.map((r) => r.id)).toEqual([
        'plate:furnace',
        'plate:casting',
      ]);
    });

    it('should treat excluded items as inputs', () => {
      const result = enumerateRoutes('plate', plateData(), {
        excludedItemIds: new Set(['molten']),
      });
      expect(result.routes.map((r) => r.id)).toEqual([
        'plate:furnace',
        'plate:casting',
      ]);
    });

    it('should truncate when exceeding the maximum count', () => {
      const result = enumerateRoutes('plate', plateData(), { maxCount: 2 });
      expect(result.truncated).toBeTrue();
      expect(result.routes.map((r) => r.id)).toEqual([
        'plate:furnace',
        'plate:casting,molten:melting',
      ]);
    });

    it('should return an empty route for raw items', () => {
      const result = enumerateRoutes('raw', dataset([]));
      expect(result).toEqual({
        routes: [{ id: '', choices: [] }],
        truncated: false,
      });
    });

    it('should skip conflicting combinations and reuse results', () => {
      const data = dataset([
        recipe('assemble', { gear: 1, rod: 1 }, { part: 1 }),
        recipe('gear', { iron: 1 }, { gear: 1 }),
        recipe('rod', { iron: 1 }, { rod: 1 }),
        recipe('iron-a', {}, { iron: 1 }),
        recipe('iron-b', {}, { iron: 1 }),
      ]);
      expect(ids(data, 'part')).toEqual([['iron:iron-a'], ['iron:iron-b']]);
    });

    it('should handle cycles and catalysts', () => {
      const data = dataset([
        recipe('x-from-y', { y: 1 }, { x: 1 }),
        recipe('x-direct', {}, { x: 1 }),
        recipe('y-from-x', { x: 1 }, { y: 1 }),
        recipe('y-breed', { y: 1, food: 1 }, { y: 2 }),
      ]);
      expect(ids(data, 'x')).toEqual([
        ['x:x-from-y', 'y:y-from-x'],
        ['x:x-from-y', 'y:y-breed'],
        ['x:x-direct'],
      ]);
    });
  });

  describe('forceRouteChoices', () => {
    it('should only allow the chosen recipe to produce the item', () => {
      const data = dataset(
        [
          recipe('a', {}, { x: 1 }),
          recipe('b', { z: 1 }, { x: 1 }),
          recipe('c', { x: 1 }, { y: 1 }),
        ],
        ['b'],
      );
      const result = forceRouteChoices(data, [['x', 'b']]);
      expect(result.itemAvailableRecipeIds['x']).toEqual(['b']);
      expect(result.itemAvailableIoRecipeIds['x']).toEqual(['b', 'c']);
      expect(result.itemAvailableIoRecipeIds['z']).toEqual(['b']);
      // Original data is not modified
      expect(data.itemAvailableRecipeIds['x']).toEqual(['a']);
    });

    it('should not duplicate recipes that are already available', () => {
      const data = dataset([
        recipe('a', {}, { x: 1 }),
        recipe('b', {}, { x: 1 }),
      ]);
      const result = forceRouteChoices(data, [['x', 'a']]);
      expect(result.itemAvailableIoRecipeIds['x']).toEqual(['a']);
    });
  });
});
