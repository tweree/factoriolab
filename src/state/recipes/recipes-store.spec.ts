import { TestBed } from '@angular/core/testing';

import { SettingsStore } from '~/state/settings/settings-store';
import { RecipeId } from '~/tests/recipe-id';
import { TestModule } from '~/tests/test-module';

import { RecipesStore } from './recipes-store';

describe('RecipesStore', () => {
  let service: RecipesStore;
  let settingsStore: SettingsStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TestModule] });
    service = TestBed.inject(RecipesStore);
    settingsStore = TestBed.inject(SettingsStore);
  });

  describe('adjustDatasetFor', () => {
    it('should compute recipe settings and the adjusted dataset', () => {
      const result = service.adjustDatasetFor(settingsStore.settings());
      expect(result.recipesSettings[RecipeId.IronPlate]).toBeDefined();
      expect(result.data.adjustedRecipe[RecipeId.IronPlate]).toBeDefined();
    });
  });
});
