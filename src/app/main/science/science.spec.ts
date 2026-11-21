import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { rational } from '~/rational/rational';
import { SciencePlanner } from '~/state/science/science-planner';
import { TestModule } from '~/tests/test-module';

import { Science } from './science';

describe('Science', () => {
  let component: Science;
  let fixture: ComponentFixture<Science>;
  let planner: SciencePlanner;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestModule, Science],
    }).compileComponents();

    planner = TestBed.inject(SciencePlanner);
    spyOn(planner, 'compare').and.returnValue([]);
    fixture = TestBed.createComponent(Science);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should set the rate', () => {
    component.setRate(rational(5));
    expect(planner.rate()).toEqual(rational(5));
  });

  it('should list location names', () => {
    expect(component.locationNames(['nauvis', 'x'])).toEqual('Nauvis, x');
  });

  it('should open a location in the list', async () => {
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    spyOn(planner, 'openInList');
    const summary = {
      locationId: 'nauvis',
      packIds: [],
      buildings: rational.zero,
      resources: rational.zero,
      shipRockets: rational.zero,
      rocketParts: rational.zero,
      imports: [],
    };
    await component.openInList(summary);
    expect(planner.openInList).toHaveBeenCalledWith(summary);
    expect(router.navigate).toHaveBeenCalled();
  });
});
