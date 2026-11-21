import { DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { rational } from '~/rational/rational';
import { RouteResult } from '~/state/routes/route';
import { RouteComparison } from '~/state/routes/route-comparison';
import { ItemId } from '~/tests/item-id';
import { RecipeId } from '~/tests/recipe-id';
import { TestModule } from '~/tests/test-module';

import { RoutesDialog, RoutesDialogData } from './routes-dialog';

describe('RoutesDialog', () => {
  let component: RoutesDialog;
  let fixture: ComponentFixture<RoutesDialog>;
  let routeComparison: RouteComparison;

  const result = (
    id: string,
    override: Partial<RouteResult> = {},
  ): RouteResult => ({
    route: { id, choices: [[ItemId.PetroleumGas, id]] },
    resultType: 'solved',
    cost: rational.one,
    buildings: rational.one,
    machines: [{ id: ItemId.AssemblingMachine1, value: rational.one }],
    power: rational.one,
    pollution: rational.zero,
    rawInputs: [{ id: ItemId.CrudeOil, value: rational.one }],
    locationIds: [],
    current: false,
    ...override,
  });

  const results = [
    result(RecipeId.BasicOilProcessing, { cost: rational(2) }),
    result(RecipeId.AdvancedOilProcessing, {
      current: true,
      buildings: rational(3),
      locationIds: ['nauvis'],
    }),
    result(RecipeId.CoalLiquefaction, { resultType: 'failed' }),
  ];

  beforeEach(async () => {
    const data: RoutesDialogData = {
      header: 'routes.header',
      headerParams: { name: 'Petroleum gas' },
      itemId: ItemId.PetroleumGas,
      rate: rational.one,
    };
    await TestBed.configureTestingModule({
      imports: [TestModule, RoutesDialog],
      providers: [{ provide: DIALOG_DATA, useValue: data }],
    }).compileComponents();

    routeComparison = TestBed.inject(RouteComparison);
    spyOn(routeComparison, 'compare').and.returnValue({
      results,
      truncated: true,
    });
    fixture = TestBed.createComponent(RoutesDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(routeComparison.compare).toHaveBeenCalledWith(
      ItemId.PetroleumGas,
      rational.one,
    );
  });

  it('should sort results', () => {
    expect(component['results']().map((r) => r.route.id)).toEqual([
      RecipeId.AdvancedOilProcessing,
      RecipeId.BasicOilProcessing,
      RecipeId.CoalLiquefaction,
    ]);
    component['sort'].set('buildings');
    fixture.detectChanges();
    expect(component['results']()[0].route.id).toEqual(
      RecipeId.BasicOilProcessing,
    );
  });

  describe('apply', () => {
    it('should apply the route and close the dialog', () => {
      spyOn(routeComparison, 'applyRoute');
      spyOn(component['dialogRef'], 'close');
      component.apply(results[0].route);
      expect(routeComparison.applyRoute).toHaveBeenCalledWith(results[0].route);
      expect(component['dialogRef'].close).toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should reset all routes and close the dialog', () => {
      spyOn(routeComparison, 'resetRoutes');
      spyOn(component['dialogRef'], 'close');
      component.reset();
      expect(routeComparison.resetRoutes).toHaveBeenCalledWith(
        results.map((r) => r.route),
      );
      expect(component['dialogRef'].close).toHaveBeenCalled();
    });
  });
});
