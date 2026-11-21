import { Rational } from '~/rational/rational';
import { SimplexResultType } from '~/solver/simplex-result-type';

/** Forced recipe choices of a production route, keyed by item id */
export type RouteChoices = Record<string, string>;

export interface Route {
  /** Unique key derived from the choices */
  id: string;
  /** Ordered list of [itemId, recipeId] decisions, starting at the target */
  choices: [string, string][];
}

export interface RouteEnumeration {
  routes: Route[];
  /** Whether additional routes were omitted due to limits */
  truncated: boolean;
}

export interface RouteAmount {
  id: string;
  value: Rational;
}

export interface RouteResult {
  route: Route;
  resultType: SimplexResultType;
  /** Solver objective cost, lower is preferred by the solver */
  cost?: Rational;
  /** Total number of buildings (each step rounded up) */
  buildings: Rational;
  /** Buildings per machine id */
  machines: RouteAmount[];
  /** Power consumption, in kW */
  power: Rational;
  /** Pollution, per display rate */
  pollution: Rational;
  /** Raw resources and unproduceable inputs, per display rate */
  rawInputs: RouteAmount[];
  /** Locations required by recipes in this route */
  locationIds: string[];
  /** Whether this route matches the current solution */
  current: boolean;
}

export type RouteSortKey = 'cost' | 'buildings' | 'power' | 'raw';
