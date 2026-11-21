import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { faList, faPlay } from '@fortawesome/free-solid-svg-icons';

import { Button } from '~/components/button/button';
import { FormField } from '~/components/form-field/form-field';
import { Icon } from '~/components/icon/icon';
import { Select } from '~/components/select/select';
import { SpoilBadge } from '~/components/spoil-badge/spoil-badge';
import { PowerPipe } from '~/components/steps/pipes/power-pipe';
import { RatePipe } from '~/components/steps/pipes/rate-pipe';
import { Tooltip } from '~/components/tooltip/tooltip';
import { Option } from '~/option/option';
import { DistributionLocation } from '~/state/distribution/distribution';
import { DistributionPlanner } from '~/state/distribution/distribution-planner';
import { ObjectivesStore } from '~/state/objectives/objectives-store';
import { SettingsStore } from '~/state/settings/settings-store';
import { TranslatePipe } from '~/translate/translate-pipe';

@Component({
  selector: 'lab-distribution',
  imports: [
    FormsModule,
    Button,
    FormField,
    Icon,
    PowerPipe,
    RatePipe,
    Select,
    SpoilBadge,
    Tooltip,
    TranslatePipe,
  ],
  templateUrl: './distribution.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-4 sm:gap-6' },
})
export class Distribution {
  private readonly router = inject(Router);
  protected readonly planner = inject(DistributionPlanner);
  protected readonly objectivesStore = inject(ObjectivesStore);
  protected readonly settingsStore = inject(SettingsStore);

  protected readonly data = this.settingsStore.dataset;
  protected readonly faList = faList;
  protected readonly faPlay = faPlay;

  protected readonly destinationOptions = computed(() => {
    const record = this.data().locationRecord;
    return this.planner.locationIds().map((id): Option => ({
      value: id,
      label: record[id]?.name ?? id,
      icon: id,
      iconType: 'location',
    }));
  });

  locationName(id: string): string {
    return this.data().locationRecord[id]?.name ?? id;
  }

  async openInList(location: DistributionLocation): Promise<void> {
    // Navigate first: Changing objectives updates the URL, which would cancel
    // a navigation that is already in progress
    await this.router.navigate([this.settingsStore.modId(), 'list'], {
      queryParamsHandling: 'preserve',
    });
    this.planner.openInList(location);
  }
}
