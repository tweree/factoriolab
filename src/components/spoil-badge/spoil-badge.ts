import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { formatSpoilTime, spoilInfo } from '~/state/routes/spoilage';
import { TranslatePipe } from '~/translate/translate-pipe';

import { Tooltip } from '../tooltip/tooltip';

/** Shows how fast an item spoils, if it spoils */
@Component({
  selector: 'lab-spoil-badge',
  imports: [Tooltip, TranslatePipe],
  template: `
    @if (info(); as info) {
      <span
        class="rounded-xs px-1 text-xs whitespace-nowrap"
        [class.bg-complement-700]="info.risk === 'critical'"
        [class.text-white]="info.risk === 'critical'"
        [class.border]="info.risk === 'warning'"
        [class.border-complement-400]="info.risk === 'warning'"
        [class.text-complement-300]="info.risk === 'warning'"
        [class.bg-gray-700]="info.risk === 'low'"
        [labTooltip]="'spoilage.' + info.risk | translate: { time: time() }"
        >⌛ {{ time() }}</span
      >
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center self-center' },
})
export class SpoilBadge {
  readonly itemId = input.required<string>();

  protected readonly info = computed(() => spoilInfo(this.itemId()));
  protected readonly time = computed(() => {
    const info = this.info();
    return info ? formatSpoilTime(info.time) : '';
  });
}
