import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TestModule } from '~/tests/test-module';
import { setInputs } from '~/tests/utils';

import { SpoilBadge } from './spoil-badge';

describe('SpoilBadge', () => {
  let fixture: ComponentFixture<SpoilBadge>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestModule, SpoilBadge],
    }).compileComponents();
    fixture = TestBed.createComponent(SpoilBadge);
  });

  it('should show the spoil time for spoiling items', () => {
    setInputs(fixture, { itemId: 'biter-egg' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('30 min');
  });

  it('should render nothing for items that do not spoil', () => {
    setInputs(fixture, { itemId: 'iron-plate' });
    fixture.detectChanges();
    expect(fixture.componentInstance['time']()).toEqual('');
    expect(fixture.nativeElement.textContent.trim()).toEqual('');
  });
});
