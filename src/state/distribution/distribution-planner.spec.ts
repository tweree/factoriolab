import { TestBed } from '@angular/core/testing';
import { loadModule } from 'glpk-ts';

import { rational } from '~/rational/rational';
import { ItemId } from '~/tests/item-id';
import { RecipeId } from '~/tests/recipe-id';
import { TestModule } from '~/tests/test-module';

import { ObjectiveSettings } from '../objectives/objective';
import { ObjectiveType } from '../objectives/objective-type';
import { ObjectiveUnit } from '../objectives/objective-unit';
import { ObjectivesStore } from '../objectives/objectives-store';
import { PlanetComparison } from '../routes/planet-comparison';
import { DistributionLocation, DistributionResult } from './distribution';
import { DistributionPlanner } from './distribution-planner';

describe('DistributionPlanner', () => {
  let planner: DistributionPlanner;
  let objectivesStore: ObjectivesStore;
  let planetComparison: PlanetComparison;

  const itemObjective: ObjectiveSettings = {
    id: '1',
    targetId: ItemId.IronPlate,
    value: rational.one,
    unit: ObjectiveUnit.Items,
    type: ObjectiveType.Output,
  };
  const recipeObjective = {
    ...itemObjective,
    id: '2',
    targetId: RecipeId.IronPlate,
    unit: ObjectiveUnit.Machines,
  } as ObjectiveSettings;

  beforeEach(async () => {
    await loadModule('glpk.all.wasm');
    TestBed.configureTestingModule({ imports: [TestModule] });
    planner = TestBed.inject(DistributionPlanner);
    objectivesStore = TestBed.inject(ObjectivesStore);
    planetComparison = TestBed.inject(PlanetComparison);
  });

  describe('effectiveDestination', () => {
    it('should default to Nauvis', () => {
      expect(planner.effectiveDestination()).toEqual('nauvis');
      planner.destination.set('missing');
      expect(planner.effectiveDestination()).toEqual('nauvis');
    });

    it('should use a valid destination', () => {
      spyOn(planetComparison, 'allLocationIds').and.returnValue(['a', 'b']);
      planner.destination.set('b');
      expect(planner.effectiveDestination()).toEqual('b');
    });

    it('should fall back to the first location', () => {
      spyOn(planetComparison, 'allLocationIds').and.returnValue(['a', 'b']);
      expect(planner.effectiveDestination()).toEqual('a');
    });
  });

  describe('objectives', () => {
    it('should ignore recipe objectives', () => {
      spyOn(objectivesStore, 'normalizedObjectives').and.returnValue([
        itemObjective,
        recipeObjective,
      ]);
      expect(planner.objectives()).toEqual([itemObjective]);
      expect(planner.hasRecipeObjectives()).toBeTrue();
    });
  });

  describe('calculate', () => {
    it('should solve the distribution', () => {
      spyOn(objectivesStore, 'normalizedObjectives').and.returnValue([
        itemObjective,
      ]);
      planner.calculate();
      const result = planner.result();
      expect(result?.resultType).toEqual('solved');
      expect(result?.locations.map((l) => l.locationId)).toEqual(['nauvis']);
      expect(planner.time()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('openInList', () => {
    const location = (locationId: string): DistributionLocation => ({
      locationId,
      buildings: rational.zero,
      machines: [],
      recipes: [],
      rawInputs: [],
      imports: [],
      power: rational.zero,
    });

    it('should do nothing without a result', () => {
      spyOn(objectivesStore, 'set');
      planner.openInList(location('nauvis'));
      expect(objectivesStore.set).not.toHaveBeenCalled();
    });

    it('should set objectives for shipments and the destination', () => {
      spyOn(planetComparison, 'restrictTo');
      const result: DistributionResult = {
        resultType: 'solved',
        locations: [],
        shipments: [
          {
            itemId: ItemId.IronPlate,
            from: 'vulcanus',
            to: 'nauvis',
            amount: rational(2),
            rockets: rational.zero,
          },
          {
            itemId: ItemId.IronPlate,
            from: 'vulcanus',
            to: 'gleba',
            amount: rational(3),
            rockets: rational.zero,
          },
          {
            itemId: ItemId.Coal,
            from: 'nauvis',
            to: 'vulcanus',
            amount: rational(1),
            rockets: rational.zero,
          },
        ],
        buildings: rational.zero,
        rockets: rational.zero,
      };
      planner.result.set(result);
      objectivesStore.set({ '1': { ...itemObjective, targetId: ItemId.Coal } });

      planner.openInList(location('vulcanus'));
      expect(
        Object.values(objectivesStore.state()).map((o) => [
          o.targetId,
          o.value,
        ]),
      ).toEqual([[ItemId.IronPlate, rational(5)]]);
      expect(planetComparison.restrictTo).toHaveBeenCalledWith('vulcanus');

      objectivesStore.set({ '1': { ...itemObjective, targetId: ItemId.Coal } });
      planner.openInList(location('nauvis'));
      expect(
        Object.values(objectivesStore.state()).map((o) => o.targetId),
      ).toEqual([ItemId.Coal, ItemId.Coal]);
    });
  });
});
