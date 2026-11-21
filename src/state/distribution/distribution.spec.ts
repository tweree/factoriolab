import { AdjustedRecipe, finalizeRecipe } from '~/data/schema/recipe';
import { rational } from '~/rational/rational';
import { SimplexResult } from '~/solver/simplex-result';

import { SPACE_PLATFORM } from '../routes/planet-comparison';
import { AdjustedDataset } from '../settings/dataset';
import {
  buildDistributionDataset,
  locatedId,
  locateRecipe,
  parseShipRecipeId,
  shipRecipeId,
  splitLocatedId,
  summarizeDistribution,
} from './distribution';

function recipe(
  id: string,
  inputs: Record<string, number>,
  outputs: Record<string, number>,
  extra: Partial<AdjustedRecipe> = {},
): AdjustedRecipe {
  const toRational = (r: Record<string, number>): AdjustedRecipe['in'] =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, rational(v)]));
  const result = {
    id,
    name: id,
    time: rational.one,
    in: toRational(inputs),
    out: toRational(outputs),
    flags: new Set<string>(),
    produces: new Set<string>(),
    output: {},
    ...extra,
  } as unknown as AdjustedRecipe;
  finalizeRecipe(result);
  return result;
}

function dataset(): AdjustedDataset {
  const recipes = [
    recipe('mine', {}, { ore: 1 }, { locations: ['a'], producers: ['drill'] }),
    recipe('smelt', { ore: 1 }, { plate: 1 }, { producers: ['furnace'] }),
  ];
  const itemAvailableRecipeIds: Record<string, string[]> = {
    ore: ['mine'],
    plate: ['smelt'],
    'rocket-part': [],
    'ore(1)': [],
    fluid: [],
  };
  const itemAvailableIoRecipeIds: Record<string, string[]> = {
    ore: ['mine', 'smelt'],
    plate: ['smelt'],
    'rocket-part': [],
    'ore(1)': [],
    fluid: [],
  };
  return {
    itemIds: ['ore', 'plate', 'rocket-part', 'ore(1)', 'fluid'],
    itemRecord: {
      ore: { id: 'ore', stack: rational(50), rocketCapacity: rational(10) },
      plate: { id: 'plate', stack: rational(50), rocketCapacity: rational(10) },
      'rocket-part': { id: 'rocket-part', stack: rational.one },
      'ore(1)': { id: 'ore(1)', rocketCapacity: rational(10) },
      fluid: { id: 'fluid' },
    },
    machineRecord: {
      drill: {},
      furnace: {},
      silo: { silo: { parts: rational(10) } },
    },
    locationRecord: {},
    adjustedRecipe: Object.fromEntries(recipes.map((r) => [r.id, r])),
    itemAvailableRecipeIds,
    itemAvailableIoRecipeIds,
  } as unknown as AdjustedDataset;
}

describe('distribution', () => {
  describe('ids', () => {
    it('should locate and split ids', () => {
      expect(locatedId('ore', 'a')).toEqual('ore@a');
      expect(splitLocatedId('ore@a')).toEqual(['ore', 'a']);
      expect(parseShipRecipeId(shipRecipeId('ore', 'a', 'b'))).toEqual([
        'ore',
        'a',
        'b',
      ]);
      expect(parseShipRecipeId('smelt@a')).toBeUndefined();
    });
  });

  describe('locateRecipe', () => {
    it('should rename ingredients, products and catalysts', () => {
      const r = recipe('smelt', { ore: 1 }, { plate: 1 });
      const located = locateRecipe(r, 'a');
      expect(located.id).toEqual('smelt@a');
      expect(Object.keys(located.in)).toEqual(['ore@a']);
      expect(located.produces).toEqual(new Set(['plate@a']));
      expect(located.catalyst).toBeUndefined();
      const catalyst = locateRecipe(
        { ...r, catalyst: { ore: rational.one } },
        'a',
      );
      expect(catalyst.catalyst).toEqual({ 'ore@a': rational.one });
    });
  });

  describe('buildDistributionDataset', () => {
    it('should duplicate recipes per location and add shipping', () => {
      const data = buildDistributionDataset(dataset(), ['a', SPACE_PLATFORM]);
      expect(data.adjustedRecipe['mine@a']).toBeDefined();
      expect(data.adjustedRecipe['mine@space-platform']).toBeUndefined();
      expect(data.itemAvailableRecipeIds['plate@a']).toContain('smelt@a');

      const fromPlanet =
        data.adjustedRecipe[shipRecipeId('ore', 'a', SPACE_PLATFORM)];
      expect(fromPlanet.in).toEqual({
        'ore@a': rational.one,
        'rocket-part@a': rational.one,
      });
      expect(data.itemAvailableIoRecipeIds['rocket-part@a']).toContain(
        fromPlanet.id,
      );

      const fromSpace =
        data.adjustedRecipe[shipRecipeId('ore', SPACE_PLATFORM, 'a')];
      expect(fromSpace.in).toEqual({ 'ore@space-platform': rational.one });
      expect(data.itemAvailableRecipeIds['ore@a']).toContain(fromSpace.id);

      expect(
        data.adjustedRecipe[shipRecipeId('ore(1)', 'a', SPACE_PLATFORM)],
      ).toBeUndefined();
      expect(
        data.adjustedRecipe[shipRecipeId('rocket-part', 'a', SPACE_PLATFORM)],
      ).toBeUndefined();
      expect(data.itemIds).toContain('fluid@space-platform');
    });

    it('should skip shipping without rocket silos', () => {
      const data = buildDistributionDataset(
        { ...dataset(), machineRecord: {} },
        ['a', 'b'],
      );
      expect(
        Object.keys(data.adjustedRecipe).some((id) => id.startsWith('ship|')),
      ).toBeFalse();
    });
  });

  describe('summarizeDistribution', () => {
    it('should summarize locations and shipments', () => {
      const data = buildDistributionDataset(dataset(), [
        'a',
        'b',
        SPACE_PLATFORM,
      ]);
      const smelt = locateRecipe(
        recipe('smelt', { ore: 1 }, { plate: 1 }, { producers: ['furnace'] }),
        'a',
      );
      const mine = locateRecipe(
        recipe('mine', {}, { ore: 2 }, { flags: new Set(['mining']) }),
        'a',
      );
      const asteroids = locateRecipe(
        recipe('nauvis', {}, { 'metallic-asteroid-chunk': 1 }),
        SPACE_PLATFORM,
      );
      const result: SimplexResult = {
        resultType: 'solved',
        steps: [
          {
            id: '0',
            recipe: smelt,
            machines: rational(3, 2),
            power: rational(5),
          },
          { id: '1', recipe: mine, machines: rational.one },
          { id: '2', recipe: asteroids, machines: rational.one },
          {
            id: '3',
            recipe: data.adjustedRecipe[shipRecipeId('plate', 'a', 'b')],
            machines: rational(1, 6),
          },
          {
            id: '4',
            recipe:
              data.adjustedRecipe[shipRecipeId('ore', SPACE_PLATFORM, 'a')],
            machines: rational(1, 6),
          },
          {
            id: '5',
            recipe: {
              ...data.adjustedRecipe[shipRecipeId('ore', 'a', 'b')],
              id: shipRecipeId('fluid', 'a', 'b'),
            },
            machines: rational(1, 6),
          },
          { id: '6', recipe: smelt },
          { id: '7', itemId: 'gear@b', items: rational(1, 60) },
          { id: '8', itemId: 'plate@a', items: rational.one },
          { id: '9', itemId: 'empty@a' },
        ],
      };
      const summary = summarizeDistribution(
        result,
        data,
        { smelt: { machineId: 'furnace' } },
        rational(60),
      );

      expect(summary.buildings).toEqual(rational(7));
      expect(summary.rockets).toEqual(rational.one);
      expect(summary.shipments.map((s) => [s.itemId, s.from, s.to])).toEqual([
        ['plate', 'a', 'b'],
        ['ore', SPACE_PLATFORM, 'a'],
        ['fluid', 'a', 'b'],
      ]);
      expect(summary.shipments[1].rockets).toEqual(rational.zero);
      expect(summary.shipments[2].rockets).toEqual(rational.zero);
      const a = summary.locations.find((l) => l.locationId === 'a');
      expect(a?.buildings).toEqual(rational(2));
      expect(a?.power).toEqual(rational(5));
      expect(a?.rawInputs).toEqual([{ id: 'ore', value: rational(120) }]);
      const space = summary.locations.find(
        (l) => l.locationId === SPACE_PLATFORM,
      );
      expect(space?.machines).toEqual([
        { id: 'asteroid-collector', value: rational(5) },
      ]);
      const b = summary.locations.find((l) => l.locationId === 'b');
      expect(b?.imports).toEqual([{ id: 'gear', value: rational.one }]);
    });

    it('should return empty results for failed solutions', () => {
      const summary = summarizeDistribution(
        { resultType: 'failed', steps: [] },
        dataset(),
        {},
        rational.one,
      );
      expect(summary.locations).toEqual([]);
      expect(summary.buildings).toEqual(rational.zero);
    });
  });
});
