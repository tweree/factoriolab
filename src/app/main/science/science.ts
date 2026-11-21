import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { faList } from '@fortawesome/free-solid-svg-icons';

import { Button } from '~/components/button/button';
import { Checkbox } from '~/components/checkbox/checkbox';
import { FormField } from '~/components/form-field/form-field';
import { Icon } from '~/components/icon/icon';
import { InputNumber } from '~/components/input-number/input-number';
import { Select } from '~/components/select/select';
import { SpoilBadge } from '~/components/spoil-badge/spoil-badge';
import { RatePipe } from '~/components/steps/pipes/rate-pipe';
import { Tooltip } from '~/components/tooltip/tooltip';
import { Option } from '~/option/option';
import { Rational, rational } from '~/rational/rational';
import {
  totalBuildings,
  totalResources,
} from '~/state/routes/planet-comparison';
import {
  SCIENCE_DESTINATION,
  ScienceCriterion,
  SciencePlanetSummary,
  SciencePlanner,
} from '~/state/science/science-planner';
import { SettingsStore } from '~/state/settings/settings-store';
import { TranslatePipe } from '~/translate/translate-pipe';

export const scienceCriterionOptions: Option<ScienceCriterion>[] = [
  { value: 'buildings', label: 'science.fewestBuildings' },
  { value: 'resources', label: 'science.fewestResources' },
];

@Component({
  selector: 'lab-science',
  imports: [
    SpoilBadge,
    FormsModule,
    Button,
    Checkbox,
    FormField,
    Icon,
    InputNumber,
    RatePipe,
    Select,
    Tooltip,
    TranslatePipe,
  ],
  templateUrl: './science.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4 sm:gap-6' },
})
export class Science {
  private readonly router = inject(Router);
  protected readonly planner = inject(SciencePlanner);
  protected readonly settingsStore = inject(SettingsStore);

  protected readonly data = this.settingsStore.dataset;
  protected readonly displayRateInfo = this.settingsStore.displayRateInfo;
  protected readonly faList = faList;
  protected readonly criterionOptions = scienceCriterionOptions;
  protected readonly destination = SCIENCE_DESTINATION;
  protected readonly totalBuildings = totalBuildings;
  protected readonly totalResources = totalResources;
  protected readonly rational = rational;

  locationNames(ids: string[]): string {
    const record = this.data().locationRecord;
    return ids.map((i) => record[i]?.name ?? i).join(', ');
  }

  setRate(value: Rational): void {
    this.planner.rate.set(value);
  }

  async openInList(summary: SciencePlanetSummary): Promise<void> {
    // Navigate first: Changing objectives updates the URL, which would cancel
    // a navigation that is already in progress
    await this.router.navigate([this.settingsStore.modId(), 'list'], {
      queryParamsHandling: 'preserve',
    });
    this.planner.openInList(summary);
  }
}
