import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { DEFAULT_MOD, modRecord } from '~/data/datasets';
import { Migration } from '~/state/router/migration';
import { RouterSync } from '~/state/router/router-sync';
import { coalesce } from '~/utils/nullish';

export const idGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const migration = inject(Migration);
  const routerSync = inject(RouterSync);

  const id = route.params['id'] as string | undefined;

  // Migrate old states
  switch (id) {
    case 'list':
    case 'wizard':
    case 'flow':
    case 'data': {
      const result = async (): Promise<UrlTree> => {
        const unzipParams = await routerSync.unzipQueryParams(
          route.queryParams,
        );
        const { modId, params } = migration.migrate(undefined, unzipParams);
        const queryParams = params.z
          ? await routerSync.getHashParams(params)
          : params;
        return router.createUrlTree([coalesce(modId, '1.1'), id], {
          queryParams,
        });
      };
      return result();
    }
  }

  // Redirect old game shortcuts and unsupported datasets to the default mod
  if (id == null || modRecord[id] == null)
    return router.createUrlTree([DEFAULT_MOD]);

  return true;
};
