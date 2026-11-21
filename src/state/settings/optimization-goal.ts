import { Option } from '~/option/option';
import { rational } from '~/rational/rational';

import { CostSettings } from './cost-settings';

/** What the solver should minimize */
export type OptimizationGoal = 'balanced' | 'buildings' | 'resources';

type GoalCosts = Pick<CostSettings, 'factor' | 'machine' | 'footprint'>;

/**
 * Cost settings for each goal. Machines cost `machine` each (multiplied by
 * their size if `footprint` is nonzero), mined resources cost `factor`
 * multiplied by their declared cost per item.
 */
export const optimizationGoalCosts: Record<OptimizationGoal, GoalCosts> = {
  balanced: {
    factor: rational.one,
    machine: rational.one,
    footprint: rational.one,
  },
  buildings: {
    factor: rational(1n, 1000n),
    machine: rational.one,
    footprint: rational.zero,
  },
  resources: {
    factor: rational.one,
    machine: rational(1n, 100n),
    footprint: rational.zero,
  },
};

export const optimizationGoalOptions: Option<OptimizationGoal>[] = [
  {
    value: 'balanced',
    label: 'settings.optimizationGoal.balanced',
    tooltip: 'settings.optimizationGoal.balancedTooltip',
  },
  {
    value: 'buildings',
    label: 'settings.optimizationGoal.buildings',
    tooltip: 'settings.optimizationGoal.buildingsTooltip',
  },
  {
    value: 'resources',
    label: 'settings.optimizationGoal.resources',
    tooltip: 'settings.optimizationGoal.resourcesTooltip',
  },
];

/** Returns the goal matching the passed costs, or undefined if customized */
export function getOptimizationGoal(
  costs: CostSettings,
): OptimizationGoal | undefined {
  return optimizationGoalOptions
    .map((o) => o.value)
    .find((goal) => {
      const goalCosts = optimizationGoalCosts[goal];
      return (Object.keys(goalCosts) as (keyof GoalCosts)[]).every((k) =>
        costs[k].eq(goalCosts[k]),
      );
    });
}

/** Returns the passed costs updated for the goal */
export function applyOptimizationGoal(
  costs: CostSettings,
  goal: OptimizationGoal,
): CostSettings {
  return { ...costs, ...optimizationGoalCosts[goal] };
}
