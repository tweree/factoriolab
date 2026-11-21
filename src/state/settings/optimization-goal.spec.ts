import { rational } from '~/rational/rational';

import {
  applyOptimizationGoal,
  getOptimizationGoal,
  optimizationGoalCosts,
} from './optimization-goal';
import { initialSettingsState } from './settings-state';

describe('optimization-goal', () => {
  const costs = initialSettingsState.costs;

  describe('getOptimizationGoal', () => {
    it('should match the default costs to the balanced goal', () => {
      expect(getOptimizationGoal(costs)).toEqual('balanced');
    });

    it('should match each goal', () => {
      expect(
        getOptimizationGoal(applyOptimizationGoal(costs, 'buildings')),
      ).toEqual('buildings');
      expect(
        getOptimizationGoal(applyOptimizationGoal(costs, 'resources')),
      ).toEqual('resources');
    });

    it('should return undefined for custom costs', () => {
      expect(
        getOptimizationGoal({ ...costs, machine: rational(5) }),
      ).toBeUndefined();
    });
  });

  describe('applyOptimizationGoal', () => {
    it('should only change goal related costs', () => {
      const result = applyOptimizationGoal(
        { ...costs, surplus: rational(3) },
        'resources',
      );
      expect(result.machine).toEqual(optimizationGoalCosts.resources.machine);
      expect(result.surplus).toEqual(rational(3));
    });
  });
});
