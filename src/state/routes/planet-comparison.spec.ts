import { TestBed } from '@angular/core/testing';
import { loadModule } from 'glpk-ts';

import { AdjustedRecipe } from '~/data/schema/recipe';
import { rational } from '~/rational/rational';
import { SimplexResult } from '~/solver/simplex-result';
import { Solver } from '~/solver/solver';
import { ItemId } from '~/tests/item-id';
import { RecipeId } from '~/tests/recipe-id';
import { TestModule } from '~/tests/test-module';

import { ObjectiveType } from '../objectives/objective-type';
import { ObjectiveUnit } from '../objectives/objective-unit';
import { ObjectivesStore } from '../objectives/objectives-store';
import { AdjustedDataset } from '../settings/dataset';
import { SettingsStore } from '../settings/settings-store';
import { IMPORT_RECIPE_PREFIX } from './imports';
import {
  hasLocalRecipe,
  ImportCost,
  isRecipeAllowed,
  isShippable,
  PlanetComparison,
  planetRank,
  PlanetResult,
  restrictToLocation,
  ROCKET_PART,
  shippingInfo,
  sortPlanetResults,
  SPACE_PLATFORM,
  totalBuildings,
  totalResources,
  weightedTotal,
  withoutImports,
} from './planet-comparison';
import { RouteResult } from './route';
import { RouteComparison } from './route-comparison';

const recipe = (r: Partial<AdjustedRecipe>): AdjustedRecipe =>
  ({ id: 'r', in: {}, out: {}, ...r }) as AdjustedRecipe;

const data = {
  locationRecord: { nauvis: { id: 'nauvis', name: 'Nauvis' } },
  machineRecord: {
    furnace: { locations: ['nauvis'] },
    crusher: { locations: [SPACE_PLATFORM] },
    assembler: {},
  },
  adjustedRecipe: {
    a: recipe({ id: 'a' }),
    b: recipe({ id: 'b', locations: [SPACE_PLATFORM] }),
  },
  itemIds: ['x', 'y'],
  itemRecord: { x: { stack: rational.one, rocketCapacity: rational(10) } },
  itemAvailableRecipeIds: { x: ['a', 'b'] },
  itemAvailableIoRecipeIds: { x: ['a', 'b'], y: ['b'] },
} as unknown as AdjustedDataset;

const zeroCost = (): ImportCost => ({
  buildings: rational.zero,
  resources: rational.zero,
  sources: {},
  unsourced: [],
});

function summary(override: Partial<RouteResult>): RouteResult {
  return {
    route: { id: '', choices: [] },
    resultType: 'solved',
    buildings: rational.zero,
    buildingsExact: rational.zero,
    machines: [],
    power: rational.zero,
    pollution: rational.zero,
    rawInputs: [],
    imports: [],
    locationIds: [],
    current: false,
    ...override,
  };
}

function planet(override: Partial<PlanetResult>): PlanetResult {
  return {
    ...summary({}),
    locationId: 'l',
    feasible: true,
    recipeIds: [],
    resources: rational.zero,
    rockets: rational.zero,
    unshippable: false,
    importCosts: { buildings: zeroCost(), resources: zeroCost() },
    ...override,
  };
}

describe('planet-comparison', () => {
  describe('isRecipeAllowed', () => {
    it('should check recipe locations', () => {
      const r = recipe({ locations: ['vulcanus'] });
      expect(isRecipeAllowed(r, 'nauvis', data)).toBeFalse();
      expect(isRecipeAllowed(r, 'vulcanus', data)).toBeTrue();
    });

    it('should only allow asteroid collection in space', () => {
      const r = recipe({
        id: 'solar-system-edge',
        out: { 'metallic-asteroid-chunk': rational.one },
      });
      expect(isRecipeAllowed(r, 'nauvis', data)).toBeFalse();
      expect(isRecipeAllowed(r, SPACE_PLATFORM, data)).toBeTrue();
    });

    it('should check machine locations', () => {
      expect(
        isRecipeAllowed(recipe({ producers: ['crusher'] }), 'nauvis', data),
      ).toBeFalse();
      expect(
        isRecipeAllowed(
          recipe({ producers: ['crusher', 'furnace'] }),
          'nauvis',
          data,
        ),
      ).toBeTrue();
      expect(
        isRecipeAllowed(recipe({ producers: ['assembler'] }), 'nauvis', data),
      ).toBeTrue();
      expect(
        isRecipeAllowed(recipe({ producers: ['missing'] }), 'nauvis', data),
      ).toBeTrue();
    });
  });

  describe('restrictToLocation', () => {
    it('should filter available recipes', () => {
      const result = restrictToLocation(data, 'nauvis');
      expect(result.itemAvailableRecipeIds).toEqual({ x: ['a'] });
      expect(result.itemAvailableIoRecipeIds).toEqual({ x: ['a'], y: [] });
    });

    it('should exclude consumers of unshippable items not produced locally', () => {
      const d = {
        ...data,
        itemIds: ['x', 'fluid'],
        adjustedRecipe: {
          a: recipe({ id: 'a', in: { fluid: rational.one } }),
          c: recipe({ id: 'c' }),
        },
        itemAvailableRecipeIds: { x: ['a', 'c'], fluid: [] },
        itemAvailableIoRecipeIds: { x: ['a', 'c'], fluid: ['a'] },
      } as unknown as AdjustedDataset;
      const result = restrictToLocation(d, 'nauvis');
      expect(result.itemAvailableRecipeIds['x']).toEqual(['c']);
      expect(result.itemAvailableIoRecipeIds['fluid']).toEqual([]);
    });

    it('should add import recipes for shippable items', () => {
      const result = restrictToLocation(data, 'nauvis', rational(5));
      const id = `${IMPORT_RECIPE_PREFIX}x`;
      expect(result.itemAvailableRecipeIds['x']).toEqual(['a', id]);
      expect(result.itemAvailableIoRecipeIds['x']).toEqual(['a', id]);
      expect(result.adjustedRecipe[id].cost).toEqual(rational(5));
      expect(result.itemAvailableRecipeIds['y']).toBeUndefined();
      expect(hasLocalRecipe(result, 'x')).toBeTrue();
      const noLocal = withoutImports(
        { ...result, itemAvailableRecipeIds: { x: [id] } },
        ['x', 'y'],
      );
      expect(hasLocalRecipe(noLocal, 'x')).toBeFalse();
      expect(noLocal.itemAvailableIoRecipeIds['y']).toEqual([]);
    });

    it('should add import recipes for items without recipes', () => {
      const d = {
        ...data,
        itemAvailableRecipeIds: {},
        itemAvailableIoRecipeIds: {},
      };
      const result = restrictToLocation(d, 'nauvis', rational.one);
      expect(result.itemAvailableRecipeIds['x']).toEqual([
        `${IMPORT_RECIPE_PREFIX}x`,
      ]);
    });
  });

  describe('helpers', () => {
    it('should check whether items can be shipped', () => {
      expect(isShippable('x', data)).toBeTrue();
      expect(isShippable('y', data)).toBeFalse();
      expect(isShippable('iron-bacteria', data)).toBeFalse();
    });

    it('should weight fluids in totals', () => {
      expect(
        weightedTotal(
          [
            { id: 'x', value: rational(5) },
            { id: 'y', value: rational(10) },
          ],
          data,
        ),
      ).toEqual(rational(6));
    });

    it('should add import costs to totals', () => {
      const r = planet({
        buildings: rational(2),
        resources: rational(3),
        importCosts: {
          buildings: { ...zeroCost(), buildings: rational(1) },
          resources: { ...zeroCost(), resources: rational(4) },
        },
      });
      expect(totalBuildings(r)).toEqual(rational(3));
      expect(totalResources(r)).toEqual(rational(7));
    });
  });

  describe('planetRank', () => {
    it('should rank self-sufficient, importing, and infeasible results', () => {
      expect(planetRank(planet({}))).toEqual(0);
      expect(
        planetRank(
          planet({
            importCosts: {
              buildings: { ...zeroCost(), unsourced: ['x'] },
              resources: zeroCost(),
            },
          }),
        ),
      ).toEqual(1);
      expect(planetRank(planet({ feasible: false }))).toEqual(2);
    });
  });

  describe('sortPlanetResults', () => {
    const a = planet({
      locationId: 'a',
      buildings: rational(1),
      resources: rational(3),
      rockets: rational(2),
    });
    const b = planet({
      locationId: 'b',
      buildings: rational(2),
      resources: rational(1),
      rockets: rational(1),
    });
    const c = planet({ locationId: 'c', feasible: false });
    const sorted = (key: Parameters<typeof sortPlanetResults>[1]): string[] =>
      sortPlanetResults([c, b, a], key).map((r) => r.locationId);

    it('should sort by rank and key', () => {
      expect(sorted('buildings')).toEqual(['a', 'b', 'c']);
      expect(sorted('resources')).toEqual(['b', 'a', 'c']);
      expect(sorted('rockets')).toEqual(['b', 'a', 'c']);
    });
  });

  describe('PlanetComparison', () => {
    let service: PlanetComparison;

    beforeEach(async () => {
      await loadModule('glpk.all.wasm');
      TestBed.configureTestingModule({ imports: [TestModule] });
      service = TestBed.inject(PlanetComparison);
    });

    it('should list all dataset locations', () => {
      expect(service.allLocationIds()).toEqual(['nauvis']);
    });

    it('should cache restricted datasets in a context', () => {
      const context = service.createContext();
      expect(context.restricted('nauvis')).toBe(context.restricted('nauvis'));
    });

    it('should list enabled locations', () => {
      expect(service.locationIds()).toEqual(['nauvis']);
      expect(service.available()).toBeFalse();
    });

    function spyLocations(enabled: string[]): void {
      const settingsStore = TestBed.inject(SettingsStore);
      spyOn(settingsStore, 'dataset').and.returnValue({
        ...settingsStore.dataset(),
        locationIds: ['a', 'b', 'c'],
      });
      spyOn(settingsStore, 'settings').and.returnValue({
        ...settingsStore.settings(),
        locationIds: new Set(enabled),
      });
    }

    it('should list multiple enabled locations', () => {
      spyLocations(['a', 'b']);
      expect(service.locationIds()).toEqual(['a', 'b']);
    });

    it('should list all locations if restricted to one location', () => {
      spyLocations(['a']);
      expect(service.locationIds()).toEqual(['a', 'b', 'c']);
    });

    it('should compare the factory objectives', () => {
      const objectives = TestBed.inject(ObjectivesStore).normalizedObjectives();
      spyOn(service, 'compareObjectives').and.returnValue([]);
      expect(service.compareFactory()).toEqual([]);
      expect(service.compareObjectives).toHaveBeenCalledWith(objectives);
    });

    it('should check recipe objectives and ignore non-output objectives', () => {
      spyOn(service, 'locationIds').and.returnValue(['p1', 'p2']);
      spyOn(service, 'importCosts').and.returnValue({
        buildings: zeroCost(),
        resources: zeroCost(),
      });
      spyOn(TestBed.inject(Solver), 'solve').and.returnValue({
        resultType: 'solved',
        steps: [],
      });
      spyOn(TestBed.inject(RouteComparison), 'summarize').and.returnValue(
        summary({ imports: [{ id: ItemId.Coal, value: rational.one }] }),
      );
      const results = service.compareObjectives([
        {
          id: '1',
          targetId: RecipeId.IronPlate,
          value: rational.one,
          unit: ObjectiveUnit.Machines,
          type: ObjectiveType.Output,
          recipe: recipe({ id: RecipeId.IronPlate, locations: ['p1'] }),
        },
        {
          id: '2',
          targetId: ItemId.Coal,
          value: rational.one,
          unit: ObjectiveUnit.Items,
          type: ObjectiveType.Input,
        },
      ]);
      expect(results.map((r) => r.feasible)).toEqual([true, false]);
    });

    it('should restrict the factory to a location', () => {
      const settingsStore = TestBed.inject(SettingsStore);
      spyOn(settingsStore, 'updateField');
      service.restrictTo('p1');
      expect(settingsStore.updateField).toHaveBeenCalledWith(
        'locationIds',
        new Set(['p1']),
        settingsStore.settings().defaultLocationIds,
      );
    });

    it('should compare each location', () => {
      spyOn(service, 'locationIds').and.returnValue(['p1', 'p2', 'p3']);
      spyOn(service, 'importCosts').and.returnValue({
        buildings: zeroCost(),
        resources: zeroCost(),
      });
      const plate = recipe({
        id: RecipeId.IronPlate,
        produces: new Set([ItemId.IronPlate]),
      });
      const other = recipe({ id: 'other', produces: new Set() });
      const imported = recipe({
        id: `${IMPORT_RECIPE_PREFIX}${ItemId.IronPlate}`,
        produces: new Set([ItemId.IronPlate]),
      });
      const result: SimplexResult = {
        resultType: 'solved',
        steps: [
          { id: '0', recipe: plate, machines: rational.one },
          { id: '1', recipe: plate },
          { id: '2', recipe: other, machines: rational.one },
          { id: '3', itemId: ItemId.IronPlate },
          { id: '4', recipe: imported, machines: rational.one },
        ],
      };
      spyOn(TestBed.inject(Solver), 'solve').and.returnValue(result);
      const summaries = [
        summary({
          imports: [
            { id: ItemId.IronPlate, value: rational(2000) },
            { id: ItemId.PetroleumGas, value: rational(10) },
            { id: 'unknown', value: rational(10) },
          ],
          rawInputs: [{ id: ItemId.CrudeOil, value: rational(100) }],
        }),
        summary({}),
        summary({ resultType: 'failed' }),
      ];
      spyOn(TestBed.inject(RouteComparison), 'summarize').and.returnValues(
        ...summaries,
      );

      const results = service.compare(ItemId.IronPlate, rational.one);
      expect(results.map((r) => r.locationId)).toEqual(['p1', 'p2', 'p3']);
      expect(results[0]).toEqual(
        jasmine.objectContaining({
          feasible: false,
          rockets: rational(2),
          unshippable: true,
          resources: rational(10),
          recipeIds: [RecipeId.IronPlate],
        }),
      );
      expect(results[1].feasible).toBeTrue();
      expect(results[1].unshippable).toBeFalse();
      expect(results[2].feasible).toBeFalse();
    });

    describe('shippingInfo', () => {
      it('should require rocket capacity, a silo and rocket parts', () => {
        const context = service.createContext();
        expect(shippingInfo(ItemId.IronPlate, context.data)).toBeDefined();
        expect(shippingInfo(ItemId.PetroleumGas, context.data)).toBeUndefined();
        expect(
          shippingInfo(ItemId.IronPlate, {
            ...context.data,
            machineRecord: {},
          }),
        ).toBeUndefined();
      });
    });

    describe('importCosts', () => {
      it('should choose the cheapest source for each criterion', () => {
        spyOn(service, 'allLocationIds').and.returnValue(['l', 'a', 'b', 'c']);
        spyOn(service, 'unitCost').and.callFake((itemId, sourceId) => {
          if (itemId === 'none' || sourceId === 'c') return undefined;
          return sourceId === 'a'
            ? { buildings: rational(1), resources: rational(10) }
            : { buildings: rational(2), resources: rational(5) };
        });
        const dispRate = TestBed.inject(SettingsStore).displayRateInfo().value;
        const result = service.importCosts(
          [
            { id: 'x', value: dispRate.mul(rational(2)) },
            { id: 'none', value: rational(3) },
          ],
          'l',
          service.createContext(),
        );
        expect(result.buildings.sources).toEqual({ x: 'a' });
        expect(result.buildings.buildings).toEqual(rational(2));
        expect(result.resources.sources).toEqual({ x: 'b' });
        expect(result.resources.resources).toEqual(
          rational(10).add(rational(3, 10)),
        );
        expect(result.buildings.unsourced).toEqual(['none']);
      });
    });

    describe('unitCost', () => {
      it('should solve and cache the cost of producing and shipping', () => {
        const context = service.createContext();
        const solve = spyOn(TestBed.inject(Solver), 'solve').and.callThrough();
        const cost = service.unitCost(ItemId.IronPlate, 'nauvis', context);
        expect(cost?.buildings.gt(rational.zero)).toBeTrue();
        expect(solve.calls.mostRecent().args[0].map((o) => o.targetId)).toEqual(
          [ItemId.IronPlate, ROCKET_PART],
        );
        expect(service.unitCost(ItemId.IronPlate, 'nauvis', context)).toBe(
          cost,
        );
        expect(solve).toHaveBeenCalledTimes(1);
      });

      it('should not add rocket parts when shipping from a space platform', () => {
        const context = service.createContext();
        const nauvis = context.restricted('nauvis');
        context.restricted = (): AdjustedDataset => nauvis;
        const solve = spyOn(TestBed.inject(Solver), 'solve').and.callThrough();
        service.unitCost(ItemId.IronPlate, SPACE_PLATFORM, context);
        expect(solve.calls.mostRecent().args[0]).toHaveSize(1);
      });

      it('should reject sources that import the item or rocket parts', () => {
        const context = service.createContext();
        const summarize = spyOn(TestBed.inject(RouteComparison), 'summarize');
        summarize.and.returnValue(
          summary({ imports: [{ id: ROCKET_PART, value: rational.one }] }),
        );
        expect(
          service.unitCost(ItemId.IronPlate, 'nauvis', context),
        ).toBeUndefined();
        summarize.and.returnValue(
          summary({ imports: [{ id: ItemId.Coal, value: rational.one }] }),
        );
        expect(
          service.unitCost(ItemId.CopperPlate, 'nauvis', context),
        ).toBeDefined();
      });

      it('should return undefined if the item cannot be provided', () => {
        const context = service.createContext();
        expect(
          service.unitCost(ItemId.PetroleumGas, 'nauvis', context),
        ).toBeUndefined();
        spyOn(TestBed.inject(Solver), 'solve').and.returnValue({
          resultType: 'failed',
          steps: [],
        });
        expect(
          service.unitCost(ItemId.IronPlate, 'nauvis', context),
        ).toBeUndefined();
      });
    });
  });
});
