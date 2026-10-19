/**
 * Jurisdiction rules: when does a speed become a criminal charge?
 *
 * Two rules of discipline here:
 *  1. Only entries whose statute text was read are marked `verified`. Everything
 *     else is present but inert, so the app stays silent rather than guessing.
 *  2. "Reckless driving" is not the only charge that exists. North Carolina's
 *     speed-only misdemeanor is a *speeding* charge under G.S. 20-141(j1), not
 *     reckless driving — calling it reckless would be factually wrong.
 *
 * This is informational, not legal advice.
 */

export type ChargeComparison = 'gte' | 'gt';

export interface SpeedChargeRule {
  id: string;
  /** Miles over the posted limit. Read together with `comparison`. */
  overMph?: number;
  /** Absolute speed, regardless of the posted limit. Always "greater than". */
  absoluteMph?: number;
  comparison: ChargeComparison;
  /** What is spoken, e.g. "a Class 3 misdemeanor". */
  label: string;
  /** Short charge name for UI, e.g. "Speeding (misdemeanor)". */
  chargeName: string;
  citation: string;
  classOfOffence?: string;
  verified: boolean;
  /** ISO date the statute text was last read. */
  verifiedOn: string | null;
  notes?: string;
}

export interface Jurisdiction {
  code: string;
  name: string;
  charges: SpeedChargeRule[];
  notes?: string;
}

/**
 * North Carolina — where the user drives.
 *
 * G.S. 20-141(j1): a person is guilty of a Class 3 misdemeanor when driving
 * "more than 15 mph over the established speed limit" or "over 80 mph on a
 * highway". Note "more than", so exactly 15 over is not covered (16+ is).
 *
 * G.S. 20-140 reckless driving is discretionary ("careless and heedless ...
 * willful or wanton disregard") and has no speed trigger, so it is deliberately
 * NOT encoded: no mph number can prove it.
 */
const NC: Jurisdiction = {
  code: 'NC',
  name: 'North Carolina',
  charges: [
    {
      id: 'nc-20-141-j1-over',
      overMph: 15,
      comparison: 'gt',
      label: 'speeding, a Class 3 misdemeanor',
      chargeName: 'Speeding — Class 3 misdemeanor',
      citation: 'N.C. Gen. Stat. § 20-141(j1)',
      classOfOffence: 'Class 3 misdemeanor',
      verified: true,
      verifiedOn: '2026-10-19',
      notes: '"More than 15 mph over" — 16+ triggers it; exactly 15 does not.',
    },
    {
      id: 'nc-20-141-j1-absolute',
      absoluteMph: 80,
      comparison: 'gt',
      label: 'speeding, a Class 3 misdemeanor',
      chargeName: 'Speeding over 80 mph — Class 3 misdemeanor',
      citation: 'N.C. Gen. Stat. § 20-141(j1)',
      classOfOffence: 'Class 3 misdemeanor',
      verified: true,
      verifiedOn: '2026-10-19',
      notes: '"Over 80 mph on a highway" — 81+ triggers it regardless of the limit.',
    },
    {
      id: 'nc-20-140-reckless',
      comparison: 'gte',
      label: 'a possible reckless driving charge',
      chargeName: 'Reckless driving (discretionary)',
      citation: 'N.C. Gen. Stat. § 20-140',
      classOfOffence: 'Class 2 misdemeanor',
      verified: false,
      verifiedOn: null,
      notes:
        'Discretionary: willful or wanton disregard. No mph number proves it, so this rule is never used to announce a charge.',
    },
  ],
};

/**
 * Virginia — verified, kept because the user drives out of state.
 *
 * Va. Code § 46.2-862: reckless driving when 20 mph or more over the limit, or
 * in excess of 85 mph regardless of the posted limit. Class 1 misdemeanor.
 */
const VA: Jurisdiction = {
  code: 'VA',
  name: 'Virginia',
  charges: [
    {
      id: 'va-46.2-862-over',
      overMph: 20,
      comparison: 'gte',
      label: 'reckless driving, a Class 1 misdemeanor',
      chargeName: 'Reckless driving by speed',
      citation: 'Va. Code § 46.2-862',
      classOfOffence: 'Class 1 misdemeanor',
      verified: true,
      verifiedOn: '2026-10-19',
      notes: '"20 mph or more over" — exactly 20 triggers it.',
    },
    {
      id: 'va-46.2-862-absolute',
      absoluteMph: 85,
      comparison: 'gt',
      label: 'reckless driving, a Class 1 misdemeanor',
      chargeName: 'Reckless driving by speed',
      citation: 'Va. Code § 46.2-862',
      classOfOffence: 'Class 1 misdemeanor',
      verified: true,
      verifiedOn: '2026-10-19',
      notes: '"In excess of 85 mph" — 86+ triggers it regardless of the posted limit.',
    },
  ],
};

/**
 * States with a discretionary reckless-driving standard and no statutory mph
 * trigger. Listed so the app can say "no speed-only charge here" instead of
 * silently looking broken, and so nobody adds a made-up threshold later.
 */
const DISCRETIONARY_ONLY = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV',
  'NH', 'NJ', 'NM', 'NY', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX',
  'UT', 'VT', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

const JURISDICTIONS: Record<string, Jurisdiction> = { NC, VA };

export function getJurisdiction(code: string | null | undefined): Jurisdiction | null {
  if (!code) return null;
  const key = code.trim().toUpperCase();
  const j = JURISDICTIONS[key];
  return j ?? null;
}

/** True when we know the state has no speed-only statutory charge. */
export function isDiscretionaryOnly(code: string | null | undefined): boolean {
  if (!code) return false;
  return DISCRETIONARY_ONLY.has(code.trim().toUpperCase());
}

/**
 * The rule that should fire at this speed, if any. Only verified, speed-only
 * rules are considered; the most serious applicable rule wins.
 */
export function chargeForSpeed(
  code: string | null | undefined,
  speedMph: number,
  limitMph: number,
): SpeedChargeRule | null {
  const j = getJurisdiction(code);
  if (!j) return null;
  const over = speedMph - limitMph;

  const applicable = j.charges.filter((rule) => {
    if (!rule.verified) return false;
    if (rule.overMph !== undefined) {
      return rule.comparison === 'gt' ? over > rule.overMph : over >= rule.overMph;
    }
    if (rule.absoluteMph !== undefined) {
      return speedMph > rule.absoluteMph;
    }
    return false;
  });

  if (!applicable.length) return null;

  // Prefer the absolute rule when it fired (it applies regardless of the limit),
  // otherwise the over-limit rule. They carry the same label in practice.
  return (
    applicable.find((r) => r.absoluteMph !== undefined && speedMph > (r.absoluteMph ?? 0)) ??
    applicable[0]
  );
}

/**
 * Map a jurisdiction onto policy config fields. Returns the thresholds the
 * policy understands, or nulls when nothing is verified for that state — the
 * app must then stay silent rather than invent a number.
 */
export function chargeConfigFor(code: string | null | undefined): {
  chargeThresholdMph: number | null;
  chargeThresholdMode: ChargeComparison;
  chargeAbsoluteMph: number | null;
} {
  const j = getJurisdiction(code);
  if (!j) {
    return { chargeThresholdMph: null, chargeThresholdMode: 'gte', chargeAbsoluteMph: null };
  }
  const over = j.charges.find((r) => r.verified && r.overMph !== undefined);
  const abs = j.charges.find((r) => r.verified && r.absoluteMph !== undefined);
  return {
    chargeThresholdMph: over?.overMph ?? null,
    chargeThresholdMode: over?.comparison ?? 'gte',
    chargeAbsoluteMph: abs?.absoluteMph ?? null,
  };
}

/** Spoken label for the state's charge, or a neutral fallback. */
export function chargeLabelFor(code: string | null | undefined): string {
  const rule = getJurisdiction(code)?.charges.find((r) => r.verified && r.overMph !== undefined);
  return rule?.label ?? 'a possible traffic charge';
}
