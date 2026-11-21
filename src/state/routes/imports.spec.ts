import { rational } from '~/rational/rational';

import { importRecipe, isImportRecipe } from './imports';

describe('imports', () => {
  it('should create and detect import recipes', () => {
    const recipe = importRecipe('x', rational(5));
    expect(isImportRecipe(recipe)).toBeTrue();
    expect(recipe.out).toEqual({ x: rational.one });
    expect(recipe.produces).toEqual(new Set(['x']));
    expect(recipe.cost).toEqual(rational(5));
    expect(isImportRecipe({ id: 'x' })).toBeFalse();
  });
});
