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
import {
  isRecipeAllowed,
  PlanetComparison,
  planetRank,
  PlanetResult,
  restrictToLocation,
  sortPlanetResults,
  SPACE_PLATFORM,
} from './planet-comparison';
import { RouteResult } from './route';
import { RouteComparison } from './route-comparison';

const recipe = (r: Partial<AdjustedRecipe>): AdjustedRecipe =>
  ({ id: 'r', ...r }) as AdjustedRecipe;

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
  itemAvailableRecipeIds: { x: ['a', 'b'] },
  itemAvailableIoRecipeIds: { x: ['a', 'b'], y: ['b'] },
} as unknown as AdjustedDataset;

function summary(override: Partial<RouteResult>): RouteResult {
  return {
    route: { id: '', choices: [] },
    resultType: 'solved',
    buildings: rational.zero,
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
      const r = recipe({ id: 'nauvis' });
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
  });

  describe('planetRank', () => {
    it('should rank self-sufficient, importing, and infeasible results', () => {
      expect(planetRank(planet({}))).toEqual(0);
      expect(
        planetRank(planet({ imports: [{ id: 'x', value: rational.one }] })),
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
      const plate = recipe({
        id: RecipeId.IronPlate,
        produces: new Set([ItemId.IronPlate]),
      });
      const other = recipe({ id: 'other', produces: new Set() });
      const result: SimplexResult = {
        resultType: 'solved',
        steps: [
          { id: '0', recipe: plate, machines: rational.one },
          { id: '1', recipe: plate },
          { id: '2', recipe: other, machines: rational.one },
          { id: '3', itemId: ItemId.IronPlate },
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
          resources: rational(2012),
          recipeIds: [RecipeId.IronPlate],
        }),
      );
      expect(results[1].feasible).toBeTrue();
      expect(results[1].unshippable).toBeFalse();
      expect(results[2].feasible).toBeFalse();
    });
  });
});
