import { baseId } from '~/data/schema/quality';

/**
 * Approximate spoil times in Factorio: Space Age, in seconds. Spoil times are
 * not part of the data, so these are maintained manually.
 */
export const SPOIL_TIMES: Record<string, number> = {
  'iron-bacteria': 60,
  'copper-bacteria': 60,
  'yumako-mash': 180,
  jelly: 240,
  nutrients: 300,
  'pentapod-egg': 900,
  'biter-egg': 1800,
  yumako: 3600,
  jellynut: 3600,
  'agricultural-science-pack': 3600,
  bioflux: 7200,
};

/** Items that spoil faster than this cannot reasonably be shipped */
export const SPOIL_CRITICAL = 15 * 60;
/** Items that spoil faster than this need fast transport */
export const SPOIL_WARNING = 2 * 60 * 60;

export type SpoilRisk = 'critical' | 'warning' | 'low';

export interface SpoilInfo {
  /** Spoil time in seconds */
  time: number;
  risk: SpoilRisk;
}

/** Spoil information for an item, or undefined if it does not spoil */
export function spoilInfo(itemId: string): SpoilInfo | undefined {
  const time = SPOIL_TIMES[baseId(itemId)] as number | undefined;
  if (time == null) return undefined;
  const risk: SpoilRisk =
    time < SPOIL_CRITICAL
      ? 'critical'
      : time < SPOIL_WARNING
        ? 'warning'
        : 'low';
  return { time, risk };
}

/** Format a spoil time, e.g. 90 => "1.5 min", 3600 => "1 h" */
export function formatSpoilTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toString()} s`;
  if (seconds < 3600) return `${(seconds / 60).toLocaleString()} min`;
  return `${(seconds / 3600).toLocaleString()} h`;
}
