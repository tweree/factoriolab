import { Recipe } from '~/data/schema/recipe';
import { rational } from '~/rational/rational';

import { isAsteroidRecipe } from './asteroids';

describe('asteroids', () => {
  const recipe = (r: Partial<Recipe>): Recipe =>
    ({ id: 'r', in: {}, out: {}, ...r }) as Recipe;

  describe('isAsteroidRecipe', () => {
    it('should detect asteroid collection recipes', () => {
      expect(
        isAsteroidRecipe(
          recipe({ out: { 'oxide-asteroid-chunk': rational.one } }),
        ),
      ).toBeTrue();
    });

    it('should reject other recipes', () => {
      expect(isAsteroidRecipe(recipe({}))).toBeFalse();
      expect(
        isAsteroidRecipe(recipe({ out: { water: rational.one } })),
      ).toBeFalse();
      expect(
        isAsteroidRecipe(
          recipe({
            in: { ice: rational.one },
            out: { 'oxide-asteroid-chunk': rational.one },
          }),
        ),
      ).toBeFalse();
      expect(
        isAsteroidRecipe(
          recipe({
            producers: ['crusher'],
            out: { 'oxide-asteroid-chunk': rational.one },
          }),
        ),
      ).toBeFalse();
    });
  });
});
