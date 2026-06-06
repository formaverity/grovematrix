// ecology.js — Tiered, transparent ecological benefits estimator for urban trees.
//
// Pure function: computeBenefits(marker) → { metrics, tier, confidenceWeight, inputs, assumptions }
//
// Three tiers, driven by data_status and available structural fields:
//
//   verified  — DBH measured + species known → Jenkins et al. 2003 biomass allometry
//   partial   — allometric structure (crown dimensions) + species known → crown-area models
//   sample    — canopy radius only → backward-compatible placeholder formulas
//
// IMPORTANT: all outputs are estimates, never field measurements.
// Every constant is commented with its source.

import COEFF_DATA from '../data/species-coefficients.json';
import LOCALE     from '../data/locale-config.json';

// ── Physical constants ────────────────────────────────────────────────────────

const KG_TO_LB = 2.20462;

// Gallons of water per sq-ft per inch of rainfall.
// Derivation: 1 in × 1 ft² = (1/12) ft³ × 7.48052 gal/ft³ = 0.6234 gal/ft²/in
const GAL_PER_SQFT_PER_IN = 0.6234;

// Annual rainfall from locale config (editable in src/data/locale-config.json)
const ANNUAL_RAIN_IN = LOCALE.annualRainfallIn;

// ── Coefficient lookup ────────────────────────────────────────────────────────

function getCoeff(species) {
  const key   = (species ?? '').trim();
  const group = COEFF_DATA.speciesGroups[key] ?? COEFF_DATA._genericFallback;
  return { ...COEFF_DATA.groups[group], _group: group, _species: key || null };
}

// ── Annual DBH increment (approximate urban tree growth rates) ────────────────
// Source: McPherson, E.G. et al. (2016) Urban Tree Database and Allometric Equations.
// USDA Forest Service Gen. Tech. Rep. PSW-GTR-253. Table averages for NE US street trees.

function annualDbhIncrementIn(dbhIn) {
  if (dbhIn < 4)  return 0.55;
  if (dbhIn < 8)  return 0.40;
  if (dbhIn < 14) return 0.28;
  if (dbhIn < 22) return 0.18;
  return 0.10;
}

// ── Jenkins et al. 2003 biomass equation ─────────────────────────────────────
// ln(biomass_kg) = β0 + β1 × ln(DBH_cm)   [DBH in cm, biomass in kg]
// Valid range: DBH 2.5–70 cm (≈ 1–28 inches).

function jenkinsBiomassKg(dbhCm, coeff) {
  if (dbhCm < 2) return 0;
  return Math.exp(coeff.biomassB0 + coeff.biomassB1 * Math.log(dbhCm));
}

// ── Tier determination ────────────────────────────────────────────────────────
// Reads both camelCase (dbhIn, crownSpreadFt, dataStatus) and snake_case
// (dbh_in, crown_spread_ft, data_status) so the function is safe regardless of
// which normalization path produced the marker object.

function determineTier(marker) {
  const dbh    = marker.dbhIn         ?? marker.dbh_in;
  const crown  = marker.crownSpreadFt ?? marker.crown_spread_ft;
  const status = marker.dataStatus    ?? marker.data_status;

  const hasDbh     = dbh != null && Number.isFinite(Number(dbh)) && Number(dbh) > 0;
  const hasSpecies = marker.species && marker.species !== 'Unknown';
  const hasCrown   = crown != null && Number.isFinite(Number(crown));

  if (hasDbh && hasSpecies) return 'verified';
  if (hasSpecies && hasCrown) return 'partial';
  if (hasSpecies && status === 'partial') return 'partial';
  return 'sample';
}

// ── Verified: full biomass allometry ─────────────────────────────────────────

function computeVerified(marker) {
  const dbhIn  = Number(marker.dbhIn ?? marker.dbh_in);
  const dbhCm  = dbhIn * 2.54;
  const coeff  = getCoeff(marker.species);

  // Aboveground biomass (Jenkins et al. 2003)
  const biomassKg       = jenkinsBiomassKg(dbhCm, coeff);
  const carbonStoredLb  = Math.round(biomassKg * coeff.carbonFraction * KG_TO_LB);

  // Annual sequestration: incremental biomass from typical yearly DBH growth
  const incrIn          = annualDbhIncrementIn(dbhIn);
  const biomassNextKg   = jenkinsBiomassKg((dbhIn + incrIn) * 2.54, coeff);
  const annualCarbonLb  = Math.max(1, Math.round((biomassNextKg - biomassKg) * coeff.carbonFraction * KG_TO_LB));

  // Crown dimensions — measured/allometric if present, else infer from canopy radius
  const crownSpreadFt   = Number((marker.crownSpreadFt ?? marker.crown_spread_ft) ?? (marker.canopyRadiusFt ?? 14) * 2);
  const crownRadiusFt   = crownSpreadFt / 2;
  const crownAreaSqft   = Math.PI * crownRadiusFt ** 2;

  // Stormwater: canopy-interception model
  // Annual intercepted = crown area × rainfall × 0.6234 gal/ft²/in × interception fraction
  const annualStormwaterGal = Math.round(
    crownAreaSqft * ANNUAL_RAIN_IN * GAL_PER_SQFT_PER_IN * coeff.interceptionFraction,
  );

  const shadeSqft    = Math.round(crownAreaSqft);
  const heightFt     = Number(marker.heightFt ?? marker.height_ft ?? 35);
  const coolingScore = Math.min(100, Math.round((crownAreaSqft / 200) * (1 + heightFt / 60)));

  return {
    metrics: { carbonStoredLb, annualCarbonLb, annualStormwaterGal, shadeSqft, coolingScore },
    tier: 'verified',
    confidenceWeight: 0.90,
    inputs: { dbhIn, crownSpreadFt, species: marker.species, group: coeff._group },
    assumptions: [
      `Biomass: Jenkins et al. 2003 (${coeff._group} allometry)`,
      `Carbon fraction: ${coeff.carbonFraction} (IPCC Tier 1)`,
      `Rainfall: ${ANNUAL_RAIN_IN}"/yr (${LOCALE.location})`,
      `Canopy interception: ${Math.round(coeff.interceptionFraction * 100)}% of precipitation`,
      crownSpreadFt !== Number(marker.crownSpreadFt ?? marker.crown_spread_ft)
        ? 'Crown spread: inferred from canopy radius'
        : 'Crown spread: measured or allometric input',
    ],
  };
}

// ── Partial: crown-area model (no measured DBH) ───────────────────────────────

function computePartial(marker) {
  const coeff         = getCoeff(marker.species);
  const crownSpreadFt = Number((marker.crownSpreadFt ?? marker.crown_spread_ft) ?? (marker.canopyRadiusFt ?? 14) * 2);
  const crownRadiusFt = crownSpreadFt / 2;
  const crownAreaSqft = Math.PI * crownRadiusFt ** 2;

  // Carbon proxy: ~3.0 lb stored carbon per sq ft of crown projection.
  // Rough empirical average for mid-canopy urban hardwoods in the NE US.
  // Source: UFORE/i-Tree Eco regional averages; treated as lower-fidelity estimate.
  const carbonStoredLb = Math.round(crownAreaSqft * 3.0);

  // Annual sequestration: ~5.5% of standing carbon for mid-life urban trees
  // Source: Urban tree growth rate composite, McPherson et al. 2016 NE region.
  const annualCarbonLb = Math.max(1, Math.round(carbonStoredLb * 0.055));

  const annualStormwaterGal = Math.round(
    crownAreaSqft * ANNUAL_RAIN_IN * GAL_PER_SQFT_PER_IN * coeff.interceptionFraction,
  );

  const shadeSqft    = Math.round(crownAreaSqft);
  const heightFt     = Number(marker.heightFt ?? marker.height_ft ?? 25);
  const coolingScore = Math.min(100, Math.round((crownAreaSqft / 200) * (1 + heightFt / 60)));

  return {
    metrics: { carbonStoredLb, annualCarbonLb, annualStormwaterGal, shadeSqft, coolingScore },
    tier: 'partial',
    confidenceWeight: 0.60,
    inputs: { crownSpreadFt, species: marker.species, group: coeff._group },
    assumptions: [
      'Biomass: crown-area proxy (~3 lb C/ft²); no DBH — measure for better accuracy',
      `Rainfall: ${ANNUAL_RAIN_IN}"/yr (${LOCALE.location})`,
      `Canopy interception: ${Math.round(coeff.interceptionFraction * 100)}% of precipitation`,
    ],
  };
}

// ── Sample: backward-compatible canopy-only placeholder ───────────────────────

function computeSample(marker) {
  // Preserves the pre-Phase-5 estimateBenefits() behavior exactly.
  const radius           = Number(marker.canopyRadiusFt ?? marker.canopy_radius_ft ?? 14);
  const shadeSqft        = Math.round(Math.PI * radius * radius);
  const annualStormwaterGal = Math.round(shadeSqft * 1.25);
  const annualCarbonLb   = Math.round(radius * 2.8);
  const carbonStoredLb   = Math.round(radius * radius * 1.7);
  const coolingScore     = Math.min(100, Math.round(35 + radius * 2.4));

  return {
    metrics: { carbonStoredLb, annualCarbonLb, annualStormwaterGal, shadeSqft, coolingScore },
    tier: 'sample',
    confidenceWeight: 0.30,
    inputs: { canopyRadiusFt: radius },
    assumptions: [
      'Canopy-radius proxy only (no species or structural data)',
      'Characterize this tree to unlock allometric estimates',
    ],
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute ecological benefit estimates for a single marker.
 *
 * @param {object} marker  Normalized marker object from the store
 * @returns {{ metrics, tier, confidenceWeight, inputs, assumptions }}
 *
 * metrics keys: carbonStoredLb, annualCarbonLb, annualStormwaterGal, shadeSqft, coolingScore
 * tier: 'verified' | 'partial' | 'sample'
 * confidenceWeight: 0–1 (drives visual intensity in service-field layer)
 */
export function computeBenefits(marker) {
  const tier = determineTier(marker);
  if (tier === 'verified') return computeVerified(marker);
  if (tier === 'partial')  return computePartial(marker);
  return computeSample(marker);
}

// Convenience: apply computeBenefits and merge flat metrics + meta into a marker object.
export function applyBenefits(marker) {
  const result = computeBenefits(marker);
  return {
    ...marker,
    ...result.metrics,
    // Camelcase aliases (existing store fields)
    annualStormwaterGal:    result.metrics.annualStormwaterGal,
    annualCarbonLb:         result.metrics.annualCarbonLb,
    carbonStoredLb:         result.metrics.carbonStoredLb,
    coolingScore:           result.metrics.coolingScore,
    shadeSqft:              result.metrics.shadeSqft,
    benefits_tier:          result.tier,
    benefits_confidence:    result.confidenceWeight,
    benefits_assumptions:   result.assumptions,
  };
}

// Confidence labels for display
export const TIER_LABELS = {
  verified: 'measured DBH + species',
  partial:  'allometric estimate',
  sample:   'canopy-only proxy',
};

export const METRIC_LABELS = {
  carbonStoredLb:       { label: 'Carbon stored',     unit: 'lb',      short: 'C' },
  annualCarbonLb:       { label: 'Annual sequester.',  unit: 'lb/yr',   short: 'C/yr' },
  annualStormwaterGal:  { label: 'Stormwater',         unit: 'gal/yr',  short: 'H₂O' },
  shadeSqft:            { label: 'Shade area',          unit: 'sq ft',   short: 'shade' },
  coolingScore:         { label: 'Cooling proxy',       unit: '/100',    short: 'cool' },
};
