import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'list',
    loadComponent: () =>
      import('~/components/steps/steps').then((c) => c.Steps),
  },
  {
    path: 'flow',
    loadComponent: () => import('./flow/flow').then((c) => c.Flow),
  },
  {
    path: 'science',
    loadComponent: () => import('./science/science').then((c) => c.Science),
  },
  {
    path: 'distribution',
    loadComponent: () =>
      import('./distribution/distribution').then((c) => c.Distribution),
  },
  {
    path: 'data',
    loadChildren: () => import('./data/data.routes').then((m) => m.routes),
  },
];
