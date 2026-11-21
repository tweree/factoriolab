import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { rational } from '~/rational/rational';
import { DistributionPlanner } from '~/state/distribution/distribution-planner';
import { TestModule } from '~/tests/test-module';

import { Distribution } from './distribution';

describe('Distribution', () => {
  let component: Distribution;
  let fixture: ComponentFixture<Distribution>;
  let planner: DistributionPlanner;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestModule, Distribution],
    }).compileComponents();

    planner = TestBed.inject(DistributionPlanner);
    fixture = TestBed.createComponent(Distribution);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should list destination options', () => {
    spyOn(planner, 'locationIds').and.returnValue(['nauvis', 'x']);
    component = TestBed.createComponent(Distribution).componentInstance;
    expect(component['destinationOptions']().map((o) => o.label)).toEqual([
      'Nauvis',
      'x',
    ]);
    expect(component.locationName('x')).toEqual('x');
  });

  it('should open a location in the list', async () => {
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    spyOn(planner, 'openInList');
    const location = {
      locationId: 'nauvis',
      buildings: rational.zero,
      machines: [],
      recipes: [],
      rawInputs: [],
      imports: [],
      power: rational.zero,
    };
    await component.openInList(location);
    expect(router.navigate).toHaveBeenCalled();
    expect(planner.openInList).toHaveBeenCalledWith(location);
  });
});
