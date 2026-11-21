import { TestBed } from '@angular/core/testing';
import { loadModule } from 'glpk-ts';

import { AdjustedRecipe } from '~/data/schema/recipe';
import { rational } from '~/rational/rational';
import { SimplexResult } from '~/solver/simplex-result';
import { Step } from '~/solver/step';
import { ItemId } from '~/tests/item-id';
import { RecipeId } from '~/tests/recipe-id';
import { TestModule } from '~/tests/test-module';

import { ObjectivesStore } from '../objectives/objectives-store';
import { RecipeSettings } from '../recipes/recipe-settings';
import { RecipesStore } from '../recipes/recipes-store';
import { SettingsStore } from '../settings/settings-store';
import { importRecipe } from './imports';
import { Route, RouteResult } from './route';
import { RouteComparison, sortRouteResults } from './route-comparison';
import { routeProducers } from './route-enumeration';

describe('RouteComparison', () => {
  let service: RouteComparison;
  let objectivesStore: ObjectivesStore;
  let settingsStore: SettingsStore;

  beforeEach(async () => {
    await loadModule('glpk.all.wasm');
    TestBed.configureTestingModule({ imports: [TestModule] });
    service = TestBed.inject(RouteComparison);
    objectivesStore = TestBed.inject(ObjectivesStore);
    settingsStore = TestBed.inject(SettingsStore);
  });

  const route: Route = { id: 'r', choices: [] };

  function result(override: Partial<RouteResult>): RouteResult {
    return {
      route,
      resultType: 'solved',
      cost: rational.zero,
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

  describe('sortRouteResults', () => {
    const a = result({
      route: { id: 'a', choices: [] },
      cost: rational(2),
      buildings: rational(1),
      power: rational(3),
      rawInputs: [{ id: 'x', value: rational(1) }],
    });
    const b = result({
      route: { id: 'b', choices: [] },
      cost: undefined,
      buildings: rational(2),
      power: rational(1),
      rawInputs: [{ id: 'x', value: rational(1) }],
      imports: [{ id: 'y', value: rational(1) }],
    });
    const failed = result({
      route: { id: 'f', choices: [] },
      resultType: 'failed',
    });
    const sorted = (key: Parameters<typeof sortRouteResults>[1]): string[] =>
      sortRouteResults([failed, a, b], key).map((r) => r.route.id);

    it('should sort by each key, listing failed results last', () => {
      expect(sorted('cost')).toEqual(['b', 'a', 'f']);
      expect(sorted('buildings')).toEqual(['a', 'b', 'f']);
      expect(sorted('power')).toEqual(['b', 'a', 'f']);
      expect(sorted('raw')).toEqual(['a', 'b', 'f']);
      expect(
        sortRouteResults([a, failed], 'cost').map((r) => r.route.id),
      ).toEqual(['a', 'f']);
    });
  });

  describe('itemsWithRoutes', () => {
    it('should find items with alternative recipes', () => {
      spyOn(objectivesStore, 'steps').and.returnValue([
        { id: '0', itemId: ItemId.PetroleumGas },
        { id: '1', itemId: ItemId.IronPlate },
        { id: '2', recipeId: RecipeId.IronPlate },
      ]);
      expect(service.itemsWithRoutes()).toEqual(new Set([ItemId.PetroleumGas]));
    });
  });

  describe('compare', () => {
    it('should solve each route and detect the current route', () => {
      const spy = spyOn(objectivesStore, 'matrixResult').and.returnValue({
        steps: [],
        resultType: 'skipped',
      });
      const initial = service.compare(ItemId.PetroleumGas, rational.one);
      expect(initial.results.length).toBeGreaterThan(1);
      expect(initial.results.some((r) => r.resultType === 'solved')).toBeTrue();
      expect(initial.results.every((r) => !r.current)).toBeTrue();

      const target = initial.results[0].route;
      const steps: Step[] = target.choices.map(([, r]) => ({
        id: r,
        recipeId: r,
        machines: rational.one,
      }));
      steps.push({ id: 'zero', recipeId: 'other', machines: rational.zero });
      steps.push({ id: 'item', itemId: ItemId.PetroleumGas });
      steps.push({ id: 'none', recipeId: 'other' });
      spy.and.returnValue({ steps, resultType: 'solved' });
      const next = service.compare(ItemId.PetroleumGas, rational.one);
      expect(next.results.find((r) => r.route.id === target.id)?.current).toBe(
        true,
      );

      // Another producer of a chosen item is used, route is no longer current
      const [itemId, recipeId] = target.choices[0];
      const data = TestBed.inject(RecipesStore).adjustedDataset();
      const other = routeProducers(itemId, data).find((r) => r !== recipeId);
      steps.push({ id: 'other', recipeId: other, machines: rational.one });
      spy.and.returnValue({ steps, resultType: 'solved' });
      const last = service.compare(ItemId.PetroleumGas, rational.one);
      expect(last.results.find((r) => r.route.id === target.id)?.current).toBe(
        false,
      );
    });
  });

  describe('summarize', () => {
    const recipe = (r: Partial<AdjustedRecipe>): AdjustedRecipe =>
      ({
        id: 'r',
        time: rational.one,
        in: {},
        out: {},
        flags: new Set(),
        ...r,
      }) as AdjustedRecipe;

    it('should aggregate buildings, power, pollution, and raw inputs', () => {
      const drill = recipe({
        id: 'drill',
        in: { acid: rational.one },
        out: { ore: rational(2) },
        flags: new Set(['mining']),
        producers: ['drill'],
        locations: ['nauvis'],
      });
      const pump = recipe({ id: 'pump', out: { water: rational(10) } });
      const smelt = recipe({
        id: 'smelt',
        in: { ore: rational.one },
        out: { plate: rational.one },
        producers: ['furnace'],
      });
      const unused = recipe({ id: 'unused', producers: ['furnace'] });
      const asteroids = recipe({
        id: 'nauvis',
        out: {
          'metallic-asteroid-chunk': rational(1, 2),
          'carbonic-asteroid-chunk': rational(1, 2),
        },
      });
      const sim: SimplexResult = {
        resultType: 'solved',
        cost: rational(5),
        steps: [
          {
            id: '0',
            recipe: drill,
            recipeId: 'drill',
            machines: rational(3, 2),
            power: rational(10),
            pollution: rational(1),
          },
          { id: '1', recipe: pump, recipeId: 'pump', machines: rational.one },
          {
            id: '2',
            recipe: smelt,
            recipeId: 'smelt',
            machines: rational(1, 2),
            power: rational(5),
          },
          {
            id: '3',
            recipe: unused,
            recipeId: 'unused',
            machines: rational.zero,
          },
          { id: '4', itemId: 'acid', items: rational(2) },
          { id: '5', itemId: 'acid', items: rational(1) },
          { id: '6', itemId: 'plate', items: rational(1) },
          { id: '7', itemId: 'empty' },
          { id: '8', recipe: unused, recipeId: 'unused' },
          {
            id: '9',
            recipe: asteroids,
            recipeId: 'nauvis',
            machines: rational(1, 2),
          },
        ],
      };
      const settings: Record<string, RecipeSettings> = {
        drill: { machineId: 'drill' },
        pump: { machineId: 'pump' },
        smelt: { machineId: 'furnace' },
      };
      const summary = service.summarize(
        route,
        sim,
        settings,
        rational(60),
        true,
      );
      expect(summary).toEqual({
        route,
        resultType: 'solved',
        cost: rational(5),
        buildings: rational(6),
        buildingsExact: rational(9, 2),
        machines: [
          { id: 'asteroid-collector', value: rational(3) },
          { id: 'drill', value: rational(2) },
          { id: 'furnace', value: rational.one },
        ],
        power: rational(15),
        pollution: rational(60),
        rawInputs: [
          { id: 'water', value: rational(600) },
          { id: 'ore', value: rational(180) },
          { id: 'metallic-asteroid-chunk', value: rational(15) },
          { id: 'carbonic-asteroid-chunk', value: rational(15) },
        ],
        imports: [{ id: 'acid', value: rational(180) }],
        locationIds: ['nauvis'],
        current: true,
      });
    });

    it('should count import recipes as imports', () => {
      const imported = importRecipe('plate', rational(5));
      const summary = service.summarize(
        route,
        {
          resultType: 'solved',
          steps: [
            { id: '0', recipe: imported, machines: rational(2) },
            { id: '1', recipe: importRecipe('gear', rational(5)) },
            { id: '2', itemId: 'plate', items: rational(2) },
          ],
        },
        {},
        rational(60),
        false,
      );
      expect(summary.imports).toEqual([{ id: 'plate', value: rational(120) }]);
      expect(summary.buildings).toEqual(rational.zero);
    });

    it('should return empty values for failed results', () => {
      const summary = service.summarize(
        route,
        { steps: [], resultType: 'failed' },
        {},
        rational.one,
        false,
      );
      expect(summary.buildings).toEqual(rational.zero);
      expect(summary.rawInputs).toEqual([]);
    });
  });

  describe('applyRoute', () => {
    it('should exclude other producers of chosen items', () => {
      spyOn(settingsStore, 'updateField');
      service.applyRoute({
        id: 'x',
        choices: [[ItemId.PetroleumGas, RecipeId.AdvancedOilProcessing]],
      });
      const value = (
        settingsStore.updateField as jasmine.Spy
      ).calls.mostRecent().args[1] as Set<string>;
      expect(value.has(RecipeId.AdvancedOilProcessing)).toBeFalse();
      expect(value.has(RecipeId.BasicOilProcessing)).toBeTrue();
    });
  });

  describe('resetRoutes', () => {
    it('should reset producers of chosen items to defaults', () => {
      const data = TestBed.inject(RecipesStore).adjustedDataset();
      const producers = routeProducers(ItemId.PetroleumGas, data);
      settingsStore.apply({ excludedRecipeIds: new Set(producers) });
      spyOn(settingsStore, 'updateField');
      service.resetRoutes([
        {
          id: 'x',
          choices: [[ItemId.PetroleumGas, RecipeId.AdvancedOilProcessing]],
        },
      ]);
      const value = (
        settingsStore.updateField as jasmine.Spy
      ).calls.mostRecent().args[1] as Set<string>;
      expect(value).toEqual(new Set());
    });
  });
});
