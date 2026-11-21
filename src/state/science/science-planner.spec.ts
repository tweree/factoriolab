import { TestBed } from '@angular/core/testing';
import { loadModule } from 'glpk-ts';

import { rational } from '~/rational/rational';
import { ItemId } from '~/tests/item-id';
import { TestModule } from '~/tests/test-module';

import { ObjectivesStore } from '../objectives/objectives-store';
import {
  ComparisonContext,
  ImportCost,
  PlanetComparison,
  PlanetResult,
  SPACE_PLATFORM,
} from '../routes/planet-comparison';
import { AdjustedDataset } from '../settings/dataset';
import { SettingsStore } from '../settings/settings-store';
import {
  buildSciencePlan,
  importSources,
  packLocations,
  ROCKET_PART,
  ScienceOption,
  sciencePackIds,
  SciencePlanner,
  sortScienceOptions,
} from './science-planner';

const AUTOMATION = 'automation-science-pack';
const LOGISTIC = 'logistic-science-pack';

function planet(override: Partial<PlanetResult>): PlanetResult {
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
    locationId: 'nauvis',
    feasible: true,
    recipeIds: [],
    resources: rational.zero,
    rockets: rational.zero,
    unshippable: false,
    importCosts: { buildings: zeroCost(), resources: zeroCost() },
    ...override,
  };
}

function zeroCost(): ImportCost {
  return {
    buildings: rational.zero,
    resources: rational.zero,
    sources: {},
    unsourced: [],
  };
}

function option(override: Partial<ScienceOption>): ScienceOption {
  return {
    ...planet(override),
    shipRockets: rational.zero,
    rocketParts: rational.zero,
    importSources: {},
    ...override,
  };
}

describe('science-planner', () => {
  let planner: SciencePlanner;
  let planetComparison: PlanetComparison;
  let context: ComparisonContext;

  beforeEach(async () => {
    await loadModule('glpk.all.wasm');
    TestBed.configureTestingModule({ imports: [TestModule] });
    planner = TestBed.inject(SciencePlanner);
    planetComparison = TestBed.inject(PlanetComparison);
    context = planetComparison.createContext();
  });

  describe('sciencePackIds', () => {
    it('should find items consumed by technologies', () => {
      const ids = sciencePackIds(context.data);
      expect(ids).toContain(AUTOMATION);
      expect(ids).not.toContain(ItemId.IronPlate);
      expect(ids.some((i) => i.includes('('))).toBeFalse();
    });
  });

  describe('packLocations', () => {
    it('should return locations where the pack can be produced', () => {
      expect(packLocations(AUTOMATION, context.data, ['nauvis', 'x'])).toEqual([
        'nauvis',
        'x',
      ]);
      expect(packLocations('missing', context.data, ['nauvis'])).toEqual([]);
    });
  });

  describe('importSources', () => {
    it('should list locations that can produce the item, destination first', () => {
      const restricted = (l: string): AdjustedDataset =>
        ({
          itemAvailableRecipeIds: l === 'b' ? {} : { x: ['r'] },
        }) as unknown as AdjustedDataset;
      const ctx = { ...context, restricted };
      expect(importSources('x', ctx, ['a', 'b', 'nauvis'])).toEqual([
        'nauvis',
        'a',
      ]);
    });
  });

  describe('sortScienceOptions', () => {
    it('should sort by rank and criterion', () => {
      const a = option({
        locationId: 'a',
        buildings: rational(2),
        resources: rational(1),
      });
      const b = option({
        locationId: 'b',
        buildings: rational(1),
        resources: rational(2),
      });
      const c = option({ locationId: 'c', feasible: false });
      const ids = (key: 'buildings' | 'resources'): string[] =>
        sortScienceOptions([c, a, b], key).map((o) => o.locationId);
      expect(ids('buildings')).toEqual(['b', 'a', 'c']);
      expect(ids('resources')).toEqual(['a', 'b', 'c']);
    });
  });

  describe('buildSciencePlan', () => {
    it('should summarize locations and the baseline', () => {
      const plan = buildSciencePlan(
        [
          {
            itemId: 'p1',
            options: [option({ locationId: 'nauvis', buildings: rational(2) })],
          },
          {
            itemId: 'p2',
            options: [
              option({
                locationId: 'vulcanus',
                buildings: rational(1),
                resources: rational(3),
                shipRockets: rational(1, 10),
                rocketParts: rational(5),
                imports: [{ id: 'x', value: rational(1) }],
                importCosts: {
                  buildings: { ...zeroCost(), buildings: rational(2) },
                  resources: { ...zeroCost(), resources: rational(1) },
                },
              }),
              option({ locationId: 'nauvis', buildings: rational(4) }),
            ],
          },
          {
            itemId: 'p3',
            options: [
              option({
                locationId: 'vulcanus',
                buildings: rational(1),
                imports: [
                  { id: 'x', value: rational(2) },
                  { id: 'y', value: rational(5) },
                ],
              }),
              option({ locationId: 'nauvis', feasible: false }),
            ],
          },
          { itemId: 'p4', options: [] },
        ],
        'buildings',
      );

      expect(plan.buildings).toEqual(rational(6));
      expect(plan.resources).toEqual(rational(3));
      expect(plan.baselineBuildings).toEqual(rational(7));
      expect(plan.baselineResources).toEqual(rational.zero);
      expect(plan.planets.map((p) => p.locationId)).toEqual([
        'nauvis',
        'vulcanus',
      ]);
      const vulcanus = plan.planets[1];
      expect(vulcanus.packIds).toEqual(['p2', 'p3']);
      expect(vulcanus.shipRockets).toEqual(rational(1, 10));
      expect(vulcanus.importBuildings).toEqual(rational(2));
      expect(vulcanus.buildings).toEqual(rational(4));
      expect(vulcanus.imports).toEqual([
        { id: 'y', value: rational(5) },
        { id: 'x', value: rational(3) },
      ]);
    });
  });

  describe('SciencePlanner', () => {
    it('should default to one pack per second', () => {
      const dispRate = TestBed.inject(SettingsStore).displayRateInfo().value;
      expect(planner.effectiveRate()).toEqual(dispRate);
      planner.rate.set(rational(5));
      expect(planner.effectiveRate()).toEqual(rational(5));
    });

    it('should select packs', () => {
      expect(planner.selectedIds()).toEqual(planner.packIds());
      planner.togglePack(AUTOMATION, false);
      expect(planner.selectedIds()).not.toContain(AUTOMATION);
      planner.togglePack(AUTOMATION, true);
      expect(planner.selectedIds()).toContain(AUTOMATION);
      planner.selectAll(false);
      expect(planner.selectedIds()).toEqual([]);
      planner.selectAll(true);
      expect(planner.selectedIds()).toEqual(planner.packIds());
    });

    it('should compute options and the plan for selected packs', () => {
      const compare = spyOn(planner, 'compare').and.callFake((id) => [
        option({ locationId: id === AUTOMATION ? 'nauvis' : 'vulcanus' }),
      ]);
      planner.selection.set(new Set([AUTOMATION, LOGISTIC]));
      const plan = planner.plan();
      expect(compare).toHaveBeenCalledTimes(planner.packIds().length);
      expect(plan.packs.map((p) => p.itemId)).toEqual([AUTOMATION, LOGISTIC]);
      expect(plan.planets.map((p) => p.locationId)).toEqual([
        'nauvis',
        'vulcanus',
      ]);
    });

    describe('compare', () => {
      beforeEach(() => {
        spyOn(planetComparison, 'allLocationIds').and.returnValue([
          'nauvis',
          'vulcanus',
          SPACE_PLATFORM,
        ]);
      });

      it('should add rocket parts for shipping to the destination', () => {
        const compareObjectives = spyOn(
          planetComparison,
          'compareObjectives',
        ).and.callFake((objectives, _, ids) => [
          planet({
            locationId: ids?.[0],
            imports:
              objectives.length > 1
                ? [{ id: ItemId.IronPlate, value: rational.one }]
                : [],
          }),
        ]);
        const options = planner.compare(AUTOMATION, rational(1000), context);
        expect(options.map((o) => o.locationId)).toEqual([
          'nauvis',
          'vulcanus',
          SPACE_PLATFORM,
        ]);
        expect(options[0].shipRockets).toEqual(rational.zero);
        expect(options[1].shipRockets).toEqual(rational.one);
        expect(options[1].rocketParts).toEqual(rational(100));
        expect(options[1].importSources[ItemId.IronPlate]).toContain('nauvis');
        expect(options[2].shipRockets).toEqual(rational.zero);
        const objectives = compareObjectives.calls.argsFor(1)[0];
        expect(objectives.map((o) => o.targetId)).toEqual([
          AUTOMATION,
          ROCKET_PART,
        ]);
      });

      it('should skip shipping if rockets are unavailable', () => {
        spyOn(planetComparison, 'compareObjectives').and.callFake(
          (_, __, ids) => [planet({ locationId: ids?.[0] })],
        );
        const noRocketPart = {
          ...context,
          data: {
            ...context.data,
            itemRecord: {
              ...context.data.itemRecord,
              [ROCKET_PART]: undefined,
            },
          },
        } as unknown as ComparisonContext;
        const noSilo = {
          ...context,
          data: { ...context.data, machineRecord: {} },
        };
        for (const ctx of [noRocketPart, noSilo]) {
          const options = planner.compare(AUTOMATION, rational.one, ctx);
          expect(options[1].shipRockets).toEqual(rational.zero);
        }

        const fluid = planner.compare(
          ItemId.PetroleumGas,
          rational.one,
          context,
        );
        expect(fluid.every((o) => o.shipRockets.isZero())).toBeTrue();
        expect(planner.compare('missing', rational.one, context)).toEqual([]);
      });
    });

    describe('openInList', () => {
      it('should replace objectives and restrict the location', () => {
        const objectivesStore = TestBed.inject(ObjectivesStore);
        spyOn(planetComparison, 'restrictTo');
        planner.rate.set(rational(60));
        const summary = {
          locationId: 'vulcanus',
          packIds: [AUTOMATION],
          buildings: rational.zero,
          resources: rational.zero,
          importBuildings: rational.zero,
          importResources: rational.zero,
          shipRockets: rational(6, 100),
          rocketParts: rational(6),
          imports: [],
        };
        planner.openInList(summary);
        const targets = Object.values(objectivesStore.state()).map((o) => [
          o.targetId,
          o.value,
        ]);
        expect(targets).toEqual([
          [AUTOMATION, rational(60)],
          [ROCKET_PART, rational(6)],
        ]);
        expect(planetComparison.restrictTo).toHaveBeenCalledWith('vulcanus');

        planner.openInList({ ...summary, rocketParts: rational.zero });
        expect(Object.keys(objectivesStore.state())).toHaveSize(1);
      });
    });
  });
});
