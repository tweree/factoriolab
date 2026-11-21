import { DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { rational } from '~/rational/rational';
import {
  PlanetComparison,
  PlanetResult,
} from '~/state/routes/planet-comparison';
import { SettingsStore } from '~/state/settings/settings-store';
import { ItemId } from '~/tests/item-id';
import { RecipeId } from '~/tests/recipe-id';
import { TestModule } from '~/tests/test-module';

import { PlanetsDialog, PlanetsDialogData } from './planets-dialog';

describe('PlanetsDialog', () => {
  let component: PlanetsDialog;
  let fixture: ComponentFixture<PlanetsDialog>;
  let compare: jasmine.Spy;

  const result = (
    locationId: string,
    override: Partial<PlanetResult> = {},
  ): PlanetResult => ({
    route: { id: locationId, choices: [] },
    resultType: 'solved',
    buildings: rational.one,
    machines: [{ id: ItemId.AssemblingMachine1, value: rational.one }],
    power: rational.one,
    pollution: rational.zero,
    rawInputs: [{ id: ItemId.CrudeOil, value: rational.one }],
    imports: [],
    locationIds: [],
    current: false,
    locationId,
    feasible: true,
    recipeIds: [RecipeId.IronPlate],
    resources: rational.one,
    rockets: rational.zero,
    unshippable: false,
    ...override,
  });

  beforeEach(async () => {
    const data: PlanetsDialogData = {
      header: 'planets.header',
      headerParams: { name: 'Iron plate' },
      itemId: ItemId.IronPlate,
      rate: rational.one,
    };
    await TestBed.configureTestingModule({
      imports: [TestModule, PlanetsDialog],
      providers: [{ provide: DIALOG_DATA, useValue: data }],
    }).compileComponents();

    compare = spyOn(TestBed.inject(PlanetComparison), 'compare');
    compare.and.returnValue([
      result('nauvis', {
        buildings: rational(3),
        imports: [{ id: ItemId.Coal, value: rational.one }],
        rockets: rational.one,
        unshippable: true,
      }),
      result('nauvis-2', { buildings: rational(2) }),
      result('nauvis-3', { feasible: false }),
      result('nauvis-4', { resultType: 'failed', feasible: false }),
    ]);
    fixture = TestBed.createComponent(PlanetsDialog);
    component = fixture.componentInstance;
  });

  function render(): void {
    fixture.detectChanges();
  }

  it('should sort results and determine the best location', () => {
    render();
    expect(component['results']().map((r) => r.locationId)).toEqual([
      'nauvis-2',
      'nauvis',
      'nauvis-3',
      'nauvis-4',
    ]);
    expect(component['bestId']()).toEqual('nauvis-2');
    component['sort'].set('resources');
    expect(component['results']()[0].locationId).toEqual('nauvis-2');
  });

  it('should restrict the factory to a location', () => {
    render();
    const planetComparison = TestBed.inject(PlanetComparison);
    spyOn(planetComparison, 'restrictTo');
    spyOn(component['dialogRef'], 'close');
    component.restrictTo('nauvis');
    expect(planetComparison.restrictTo).toHaveBeenCalledWith('nauvis');
    expect(component['dialogRef'].close).toHaveBeenCalled();
  });

  it('should determine the restricted location', () => {
    render();
    const settingsStore = TestBed.inject(SettingsStore);
    const settings = spyOn(settingsStore, 'settings').and.returnValue({
      ...settingsStore.settings(),
      locationIds: new Set(['nauvis']),
    });
    expect(component['restrictedId']()).toEqual('nauvis');
    settings.and.returnValue({
      ...settingsStore.settings(),
      locationIds: new Set(['nauvis', 'vulcanus']),
    });
    fixture = TestBed.createComponent(PlanetsDialog);
    expect(fixture.componentInstance['restrictedId']()).toBeUndefined();
  });

  it('should compare the factory if no item is passed', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TestModule, PlanetsDialog],
      providers: [
        { provide: DIALOG_DATA, useValue: { header: 'planets.headerFactory' } },
      ],
    }).compileComponents();
    const factory = spyOn(
      TestBed.inject(PlanetComparison),
      'compareFactory',
    ).and.returnValue([result('nauvis')]);
    const f = TestBed.createComponent(PlanetsDialog);
    f.detectChanges();
    expect(factory).toHaveBeenCalled();
    expect(f.componentInstance['results']()).toHaveSize(1);
  });

  it('should not determine a best location if none are self-sufficient', () => {
    compare.and.returnValue([result('nauvis', { feasible: false })]);
    render();
    expect(component['bestId']()).toBeUndefined();
    compare.and.returnValue([]);
    fixture = TestBed.createComponent(PlanetsDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component['bestId']()).toBeUndefined();
  });
});
