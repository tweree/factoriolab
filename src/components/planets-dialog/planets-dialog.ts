import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { faLocationDot, faXmark } from '@fortawesome/free-solid-svg-icons';

import { Option } from '~/option/option';
import { Rational } from '~/rational/rational';
import { ObjectivesStore } from '~/state/objectives/objectives-store';
import {
  PlanetComparison,
  planetRank,
  PlanetSortKey,
  sortPlanetResults,
} from '~/state/routes/planet-comparison';
import { SettingsStore } from '~/state/settings/settings-store';
import { TranslateParams } from '~/translate/translate';
import { TranslatePipe } from '~/translate/translate-pipe';

import { Button } from '../button/button';
import { DialogData } from '../dialog/dialog';
import { FormField } from '../form-field/form-field';
import { Icon } from '../icon/icon';
import { Select } from '../select/select';
import { SpoilBadge } from '../spoil-badge/spoil-badge';
import { PowerPipe } from '../steps/pipes/power-pipe';
import { RatePipe } from '../steps/pipes/rate-pipe';
import { Tooltip } from '../tooltip/tooltip';

/** Compare an item if `itemId` and `rate` are set, otherwise the factory */
export interface PlanetsDialogData extends DialogData {
  header: string;
  headerParams?: TranslateParams;
  itemId?: string;
  /** Rate to produce, in items per second */
  rate?: Rational;
}

export const planetSortOptions: Option<PlanetSortKey>[] = [
  { value: 'buildings', label: 'planets.buildings' },
  { value: 'resources', label: 'planets.resources' },
  { value: 'rockets', label: 'planets.rockets' },
];

@Component({
  selector: 'lab-planets-dialog',
  imports: [
    SpoilBadge,
    FormsModule,
    Button,
    FormField,
    Icon,
    PowerPipe,
    RatePipe,
    Select,
    Tooltip,
    TranslatePipe,
  ],
  templateUrl: './planets-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex w-5xl max-w-full flex-col gap-3 overflow-hidden p-3 pt-px sm:gap-6 sm:p-6 sm:pt-px',
  },
})
export class PlanetsDialog {
  protected readonly dialogRef = inject(DialogRef);
  protected readonly dialogData = inject<PlanetsDialogData>(DIALOG_DATA);
  protected readonly objectivesStore = inject(ObjectivesStore);
  protected readonly planetComparison = inject(PlanetComparison);
  protected readonly settingsStore = inject(SettingsStore);

  protected readonly faLocationDot = faLocationDot;
  protected readonly faXmark = faXmark;
  protected readonly planetSortOptions = planetSortOptions;

  protected readonly data = this.settingsStore.dataset;
  protected readonly sort = signal<PlanetSortKey>('buildings');

  protected readonly comparison = computed(() => {
    const { itemId, rate } = this.dialogData;
    if (itemId != null && rate != null)
      return this.planetComparison.compare(itemId, rate);
    return this.planetComparison.compareFactory();
  });

  /** Location id if the factory is restricted to a single location */
  protected readonly restrictedId = computed(() => {
    const ids = Array.from(this.settingsStore.settings().locationIds);
    return ids.length === 1 ? ids[0] : undefined;
  });

  protected readonly results = computed(() =>
    sortPlanetResults(this.comparison(), this.sort()),
  );

  restrictTo(locationId: string): void {
    this.planetComparison.restrictTo(locationId);
    this.dialogRef.close();
  }

  /** Location id of the best result, if any result is self-sufficient */
  protected readonly bestId = computed(() => {
    const best = this.results()[0];
    return best && planetRank(best) === 0 ? best.locationId : undefined;
  });
}
