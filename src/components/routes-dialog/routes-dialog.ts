import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  faCheck,
  faRotateLeft,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';

import { Option } from '~/option/option';
import { Rational } from '~/rational/rational';
import { ObjectivesStore } from '~/state/objectives/objectives-store';
import { PreferencesStore } from '~/state/preferences/preferences-store';
import { Route, RouteSortKey } from '~/state/routes/route';
import {
  RouteComparison,
  sortRouteResults,
} from '~/state/routes/route-comparison';
import { SettingsStore } from '~/state/settings/settings-store';
import { TranslateParams } from '~/translate/translate';
import { TranslatePipe } from '~/translate/translate-pipe';

import { Button } from '../button/button';
import { DialogData } from '../dialog/dialog';
import { FormField } from '../form-field/form-field';
import { Icon } from '../icon/icon';
import { Select } from '../select/select';
import { PowerPipe } from '../steps/pipes/power-pipe';
import { RatePipe } from '../steps/pipes/rate-pipe';
import { Tooltip } from '../tooltip/tooltip';

export interface RoutesDialogData extends DialogData {
  header: string;
  headerParams: TranslateParams;
  itemId: string;
  /** Rate to produce, in items per second */
  rate: Rational;
}

export const routeSortOptions: Option<RouteSortKey>[] = [
  { value: 'cost', label: 'routes.sortCost' },
  { value: 'buildings', label: 'routes.buildings' },
  { value: 'power', label: 'routes.power' },
  { value: 'raw', label: 'routes.rawInputs' },
];

@Component({
  selector: 'lab-routes-dialog',
  imports: [
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
  templateUrl: './routes-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex w-5xl max-w-full flex-col gap-3 overflow-hidden p-3 pt-px sm:gap-6 sm:p-6 sm:pt-px',
  },
})
export class RoutesDialog {
  protected readonly dialogRef = inject(DialogRef);
  protected readonly dialogData = inject<RoutesDialogData>(DIALOG_DATA);
  protected readonly objectivesStore = inject(ObjectivesStore);
  protected readonly preferencesStore = inject(PreferencesStore);
  protected readonly routeComparison = inject(RouteComparison);
  protected readonly settingsStore = inject(SettingsStore);

  protected readonly faCheck = faCheck;
  protected readonly faRotateLeft = faRotateLeft;
  protected readonly faXmark = faXmark;
  protected readonly routeSortOptions = routeSortOptions;

  protected readonly data = this.settingsStore.dataset;
  protected readonly sort = signal<RouteSortKey>('cost');

  protected readonly comparison = computed(() =>
    this.routeComparison.compare(this.dialogData.itemId, this.dialogData.rate),
  );

  protected readonly results = computed(() =>
    sortRouteResults(this.comparison().results, this.sort()),
  );

  apply(route: Route): void {
    this.routeComparison.applyRoute(route);
    this.dialogRef.close();
  }

  reset(): void {
    this.routeComparison.resetRoutes(
      this.comparison().results.map((r) => r.route),
    );
    this.dialogRef.close();
  }
}
