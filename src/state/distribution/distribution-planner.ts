import { computed, inject, Service, signal } from '@angular/core';

import { Rational, rational } from '~/rational/rational';
import { Solver } from '~/solver/solver';

import { isRecipeObjective, ObjectiveState } from '../objectives/objective';
import { ObjectiveType } from '../objectives/objective-type';
import { ObjectiveUnit } from '../objectives/objective-unit';
import { ObjectivesStore } from '../objectives/objectives-store';
import { PreferencesStore } from '../preferences/preferences-store';
import { PlanetComparison } from '../routes/planet-comparison';
import { SettingsStore } from '../settings/settings-store';
import {
  buildDistributionDataset,
  DistributionLocation,
  DistributionResult,
  locatedId,
  summarizeDistribution,
} from './distribution';

export const DEFAULT_DESTINATION = 'nauvis';

/**
 * Distributes the production of the current objectives across locations: The
 * solver decides where each item is produced and which items are shipped,
 * delivering the objectives to the destination.
 */
@Service()
export class DistributionPlanner {
  private readonly objectivesStore = inject(ObjectivesStore);
  private readonly planetComparison = inject(PlanetComparison);
  private readonly preferencesStore = inject(PreferencesStore);
  private readonly settingsStore = inject(SettingsStore);
  private readonly solver = inject(Solver);

  readonly destination = signal<string | undefined>(undefined);
  readonly result = signal<DistributionResult | undefined>(undefined);
  /** Duration of the last calculation, in milliseconds */
  readonly time = signal(0);

  readonly locationIds = computed(() => this.planetComparison.allLocationIds());

  readonly effectiveDestination = computed(() => {
    const ids = this.locationIds();
    const destination = this.destination();
    if (destination != null && ids.includes(destination)) return destination;
    return ids.includes(DEFAULT_DESTINATION) ? DEFAULT_DESTINATION : ids[0];
  });

  /** Item objectives; recipe objectives are not supported */
  readonly objectives = computed(() =>
    this.objectivesStore
      .normalizedObjectives()
      .filter((o) => !isRecipeObjective(o)),
  );

  readonly hasRecipeObjectives = computed(() =>
    this.objectivesStore.normalizedObjectives().some(isRecipeObjective),
  );

  calculate(): void {
    const destination = this.effectiveDestination();
    const context = this.planetComparison.createContext();
    const start = Date.now();
    const data = buildDistributionDataset(context.data, this.locationIds());
    const objectives: ObjectiveState[] = this.objectives().map((o) => ({
      ...o,
      targetId: locatedId(o.targetId, destination),
    }));
    const settings = {
      ...context.settings,
      excludedItemIds: new Set<string>(),
    };
    const result = this.solver.solve(
      objectives,
      settings,
      data,
      false,
      this.preferencesStore.glpkAlgorithm(),
    );
    this.result.set(
      summarizeDistribution(
        result,
        data,
        context.recipesSettings,
        this.settingsStore.displayRateInfo().value,
      ),
    );
    this.time.set(Date.now() - start);
  }

  /**
   * Replace the objectives with what a location produces for other locations
   * (and the objectives, if it is the destination), and restrict to it
   */
  openInList(location: DistributionLocation): void {
    const result = this.result();
    if (result == null) return;
    const amounts: Record<string, Rational> = {};
    for (const s of result.shipments.filter(
      (s) => s.from === location.locationId,
    ))
      amounts[s.itemId] = (amounts[s.itemId] ?? rational.zero).add(s.amount);

    const base = this.objectivesStore.baseObjectives();
    this.objectivesStore.set({});
    if (location.locationId === this.effectiveDestination())
      for (const o of base) this.objectivesStore.add(o);
    for (const [targetId, value] of Object.entries(amounts))
      this.objectivesStore.add({
        targetId,
        value,
        unit: ObjectiveUnit.Items,
        type: ObjectiveType.Output,
      });
    this.planetComparison.restrictTo(location.locationId);
  }
}
