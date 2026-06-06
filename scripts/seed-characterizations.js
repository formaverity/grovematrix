#!/usr/bin/env node
// seed-characterizations.js
//
// Assigns plausible, internally-consistent SYNTHETIC characterizations to every
// tree_markers row in Supabase. All seeded rows carry:
//   capture->>'source' = 'synthetic-seed'
// so they can be purged at launch with:
//   DELETE FROM tree_markers WHERE capture->>'source' = 'synthetic-seed';
//
// Tier mix (deterministic per marker_code):
//   ~70% verified  — species + measured DBH → Jenkins et al. allometry
//   ~20% partial   — species + crown estimate, no DBH
//   ~10% sample    — untouched canopy-radius proxy
//
// Usage:
//   node scripts/seed-characterizations.js            # seed all markers
//   node scripts/seed-characterizations.js --reset    # revert seeded rows to raw sample
//   node scripts/seed-characterizations.js --dry-run  # preview, no writes
//
// Prerequisites:
//   Run sql/add-tree-analytics-fields.sql first (adds dbh_in, data_status, etc.)
//   Run sql/2026-06_add-tree-characterization.sql first (adds crown_spread_ft, etc.)
//
// For writes under RLS, add SUPABASE_SERVICE_ROLE_KEY to .env.local.
// The anon key will be used if the service role key is absent — writes may fail
// under RLS unless the policy allows anon updates.

'use strict';

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── Load .env.local (same approach as other scripts) ────────────────────────

(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
})();

// ── Static data (loaded from src/data/ — same source of truth as the app) ──

const SPECIES_LIST = require('../src/data/nj-street-trees.json').species;
const COEFF_DATA   = require('../src/data/species-coefficients.json');
const LOCALE       = require('../src/data/locale-config.json');

// ── Deterministic PRNG (mulberry32, seeded per marker_code) ─────────────────

function makePrng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  }
  return h;
}

// ── Species picker (weighted by boost, same palette as the 4A flow) ──────────

const SPECIES_TOTAL = SPECIES_LIST.reduce((s, sp) => s + sp.boost, 0);

function pickSpecies(rng) {
  let r = rng() * SPECIES_TOTAL;
  for (const sp of SPECIES_LIST) {
    r -= sp.boost;
    if (r <= 0) return sp;
  }
  return SPECIES_LIST[SPECIES_LIST.length - 1];
}

// ── DBH distribution (right-skewed: most trees young/medium) ─────────────────

function pickDbhIn(rng) {
  const r = rng();
  let raw;
  if      (r < 0.30) raw = 3  + rng() * 5;  // 3–8"   young
  else if (r < 0.70) raw = 8  + rng() * 8;  // 8–16"  medium
  else if (r < 0.90) raw = 16 + rng() * 8;  // 16–24" mature
  else               raw = 24 + rng() * 6;  // 24–30" large
  return Math.round(raw * 10) / 10;          // 1 decimal
}

// ── Condition picker ──────────────────────────────────────────────────────────

function pickCondition(rng) {
  const r = rng();
  if (r < 0.40) return 'Good';
  if (r < 0.70) return 'Fair';
  if (r < 0.88) return 'Young/Establishing';
  if (r < 0.96) return 'Poor';
  return 'Critical';
}

// ── Tier picker (~70% verified, ~20% partial, ~10% sample) ───────────────────

function pickTier(rng) {
  const r = rng();
  if (r < 0.10) return 'sample';
  if (r < 0.30) return 'partial';
  return 'verified';
}

// ── Allometry (mirrors src/lib/allometry.js exactly) ─────────────────────────

const ALLOMETRY = {
  'acer rubrum':             { hA: 1.55, hB: 12, csA: 0.85, csB:  7, cbRatio: 0.28 },
  'acer platanoides':        { hA: 1.50, hB: 11, csA: 0.88, csB:  7, cbRatio: 0.27 },
  'acer saccharinum':        { hA: 1.70, hB: 12, csA: 0.95, csB:  8, cbRatio: 0.30 },
  'acer saccharum':          { hA: 1.45, hB: 14, csA: 0.82, csB:  9, cbRatio: 0.29 },
  'platanus × acerifolia':   { hA: 1.80, hB: 10, csA: 1.00, csB:  8, cbRatio: 0.32 },
  'platanus occidentalis':   { hA: 1.75, hB: 11, csA: 0.98, csB:  8, cbRatio: 0.30 },
  'quercus palustris':       { hA: 1.55, hB: 15, csA: 0.90, csB: 10, cbRatio: 0.27 },
  'quercus rubra':           { hA: 1.50, hB: 16, csA: 0.92, csB: 10, cbRatio: 0.26 },
  'quercus bicolor':         { hA: 1.40, hB: 14, csA: 0.88, csB:  9, cbRatio: 0.26 },
  'quercus alba':            { hA: 1.42, hB: 14, csA: 0.90, csB: 10, cbRatio: 0.27 },
  'zelkova serrata':         { hA: 1.48, hB: 11, csA: 0.88, csB:  7, cbRatio: 0.28 },
  'ulmus americana':         { hA: 1.60, hB: 12, csA: 1.05, csB:  9, cbRatio: 0.30 },
  'ulmus parvifolia':        { hA: 1.40, hB: 10, csA: 0.90, csB:  7, cbRatio: 0.27 },
  'gleditsia triacanthos':   { hA: 1.55, hB: 10, csA: 0.82, csB:  7, cbRatio: 0.30 },
  'tilia cordata':           { hA: 1.42, hB: 12, csA: 0.80, csB:  7, cbRatio: 0.25 },
  'liquidambar styraciflua': { hA: 1.55, hB: 13, csA: 0.72, csB:  6, cbRatio: 0.28 },
  'liriodendron tulipifera': { hA: 1.80, hB: 10, csA: 0.70, csB:  5, cbRatio: 0.32 },
  'ginkgo biloba':           { hA: 1.38, hB: 12, csA: 0.62, csB:  5, cbRatio: 0.27 },
  'betula nigra':            { hA: 1.55, hB: 10, csA: 0.78, csB:  6, cbRatio: 0.29 },
  'prunus serotina':         { hA: 1.40, hB: 12, csA: 0.70, csB:  7, cbRatio: 0.26 },
  'celtis occidentalis':     { hA: 1.45, hB: 12, csA: 0.80, csB:  7, cbRatio: 0.27 },
  'pyrus calleryana':        { hA: 1.25, hB:  8, csA: 0.70, csB:  5, cbRatio: 0.25 },
  'styphnolobium japonicum': { hA: 1.50, hB: 11, csA: 0.82, csB:  7, cbRatio: 0.28 },
  'nyssa sylvatica':         { hA: 1.45, hB: 13, csA: 0.72, csB:  7, cbRatio: 0.27 },
  '_generic_hardwood':       { hA: 1.55, hB: 12, csA: 0.82, csB:  7, cbRatio: 0.27 },
};

function r1(n) { return Math.round(n * 10) / 10; }

function structureFromDbh(scientific, dbhIn) {
  const key = scientific.toLowerCase().trim();
  const p = ALLOMETRY[key] ?? ALLOMETRY['_generic_hardwood'];
  const h  = p.hA * dbhIn + p.hB;
  const cs = p.csA * dbhIn + p.csB;
  return {
    height_ft:            r1(Math.max(5,  h)),
    crown_spread_ft:      r1(Math.max(4,  cs)),
    crown_base_height_ft: r1(Math.max(2,  p.cbRatio * h)),
  };
}

// ── Inline ecology (mirrors src/lib/ecology.js — CJS-compatible) ─────────────

const KG_TO_LB           = 2.20462;
const GAL_PER_SQFT_PER_IN = 0.6234;
const ANNUAL_RAIN_IN      = LOCALE.annualRainfallIn;

function getCoeff(scientific) {
  const group = COEFF_DATA.speciesGroups[scientific] ?? COEFF_DATA._genericFallback;
  return COEFF_DATA.groups[group];
}

function jenkinsBiomassKg(dbhCm, c) {
  if (dbhCm < 2) return 0;
  return Math.exp(c.biomassB0 + c.biomassB1 * Math.log(dbhCm));
}

function annualDbhInc(dbhIn) {
  if (dbhIn < 4)  return 0.55;
  if (dbhIn < 8)  return 0.40;
  if (dbhIn < 14) return 0.28;
  if (dbhIn < 22) return 0.18;
  return 0.10;
}

function benefitColumnsVerified(scientific, dbhIn, crownSpreadFt) {
  const dbhCm  = dbhIn * 2.54;
  const c      = getCoeff(scientific);
  const bkg    = jenkinsBiomassKg(dbhCm, c);
  const bkgNxt = jenkinsBiomassKg((dbhIn + annualDbhInc(dbhIn)) * 2.54, c);
  const cr     = crownSpreadFt / 2;
  const area   = Math.PI * cr * cr;
  return {
    carbon_stored_lb:      Math.round(bkg * c.carbonFraction * KG_TO_LB),
    annual_carbon_lb:      Math.max(1, Math.round((bkgNxt - bkg) * c.carbonFraction * KG_TO_LB)),
    annual_stormwater_gal: Math.round(area * ANNUAL_RAIN_IN * GAL_PER_SQFT_PER_IN * c.interceptionFraction),
    shade_sqft:            Math.round(area),
    cooling_score:         Math.min(100, Math.round((area / 200) * (1 + dbhIn / 60))),
  };
}

function benefitColumnsPartial(scientific, crownSpreadFt) {
  const c    = getCoeff(scientific);
  const cr   = crownSpreadFt / 2;
  const area = Math.PI * cr * cr;
  const csl  = Math.round(area * 3.0);
  return {
    carbon_stored_lb:      csl,
    annual_carbon_lb:      Math.max(1, Math.round(csl * 0.055)),
    annual_stormwater_gal: Math.round(area * ANNUAL_RAIN_IN * GAL_PER_SQFT_PER_IN * c.interceptionFraction),
    shade_sqft:            Math.round(area),
    cooling_score:         Math.min(100, Math.round((area / 200) * 1.4)),
  };
}

function benefitColumnsSample(canopyRadiusFt) {
  const r = canopyRadiusFt ?? 14;
  const area = Math.PI * r * r;
  return {
    carbon_stored_lb:      Math.round(r * r * 1.7),
    annual_carbon_lb:      Math.round(r * 2.8),
    annual_stormwater_gal: Math.round(area * 1.25),
    shade_sqft:            Math.round(area),
    cooling_score:         Math.min(100, Math.round(35 + r * 2.4)),
  };
}

// ── Core: build the Supabase update payload for one marker ───────────────────

const NOW = new Date().toISOString();

function buildPayload(row) {
  const id  = row.marker_code ?? row.id;
  const rng = makePrng(fnv1a32(id));
  const tier = pickTier(rng);

  if (tier === 'sample') return null; // leave untouched

  const sp        = pickSpecies(rng);
  const condition = pickCondition(rng);

  if (tier === 'partial') {
    // Species known, no DBH — use a realistic estimated crown spread (12–30 ft)
    const crownSpreadFt = r1(12 + rng() * 18);
    const benefits = benefitColumnsPartial(sp.scientific, crownSpreadFt);
    return {
      marker_code:          id,
      common_name:          sp.common,
      species:              sp.scientific,
      condition,
      data_status:          'partial',
      species_source:       'synthetic',
      structure_source:     'synthetic',
      species_confidence:   0.75,
      dbh_in:               null,
      height_ft:            null,
      crown_spread_ft:      crownSpreadFt,
      crown_base_height_ft: null,
      capture:              { source: 'synthetic-seed', tier: 'partial', seededAt: NOW },
      ...benefits,
    };
  }

  // verified — species + DBH + allometric structure
  const dbhIn  = pickDbhIn(rng);
  const struct = structureFromDbh(sp.scientific, dbhIn);
  const benefits = benefitColumnsVerified(sp.scientific, dbhIn, struct.crown_spread_ft);
  return {
    marker_code:          id,
    common_name:          sp.common,
    species:              sp.scientific,
    condition,
    data_status:          'verified',
    species_source:       'synthetic',
    structure_source:     'synthetic',
    species_confidence:   0.90,
    dbh_in:               dbhIn,
    ...struct,
    capture:              { source: 'synthetic-seed', tier: 'verified', dbhIn, seededAt: NOW },
    ...benefits,
  };
}

// ── Reset payload: revert a seeded row to raw sample state ───────────────────

const RESET_FIELDS = {
  common_name:          'Unknown',
  species:              'Unknown',
  condition:            'Unsurveyed',
  data_status:          'sample',
  species_source:       'manual',
  structure_source:     'manual',
  species_confidence:   null,
  dbh_in:               null,
  height_ft:            null,
  crown_spread_ft:      null,
  crown_base_height_ft: null,
  capture:              null,
  photo_url:            null,
  carbon_stored_lb:     null,
  annual_carbon_lb:     null,
  annual_stormwater_gal:null,
  shade_sqft:           null,
  cooling_score:        null,
};

// ── JSON fallback helpers ─────────────────────────────────────────────────────
// Merge payload into a JSON marker record, keeping position/id intact.

function mergeIntoJsonMarker(jsonMarker, payload) {
  if (!payload) return jsonMarker; // sample tier — no change
  const {
    common_name, species, condition, data_status,
    species_source, structure_source, species_confidence,
    dbh_in, height_ft, crown_spread_ft, crown_base_height_ft,
    capture, carbon_stored_lb, annual_carbon_lb,
    annual_stormwater_gal, shade_sqft, cooling_score,
  } = payload;

  return {
    ...jsonMarker,
    // Primary camelCase form that normalizeMarker uses
    commonName: common_name,
    condition,
    species,
    // Both naming conventions so determineTier can read either
    dbh_in,          dbhIn: dbh_in,
    height_ft,       heightFt: height_ft,
    crown_spread_ft, crownSpreadFt: crown_spread_ft,
    crown_base_height_ft, crownBaseFt: crown_base_height_ft,
    data_status,     dataStatus: data_status,
    species_source,  speciesSource: species_source,
    structure_source,structureSource: structure_source,
    species_confidence,
    capture,
    // Pre-computed benefit columns (same names as app camelCase fields)
    carbonStoredLb:      carbon_stored_lb,
    annualCarbonLb:      annual_carbon_lb,
    annualStormwaterGal: annual_stormwater_gal,
    shadeSqft:           shade_sqft,
    coolingScore:        cooling_score,
  };
}

function resetJsonMarker(jsonMarker) {
  const clean = { ...jsonMarker };
  const drop = [
    'commonName', 'species', 'condition',
    'dbh_in','dbhIn','height_ft','heightFt',
    'crown_spread_ft','crownSpreadFt','crown_base_height_ft','crownBaseFt',
    'data_status','dataStatus','species_source','speciesSource',
    'structure_source','structureSource','species_confidence','capture',
    'carbonStoredLb','annualCarbonLb','annualStormwaterGal','shadeSqft','coolingScore',
  ];
  for (const k of drop) delete clean[k];
  return {
    ...clean,
    commonName: 'Unknown',
    species:    'Unknown',
    condition:  'Unsurveyed',
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args   = process.argv.slice(2);
  const reset  = args.includes('--reset');
  const dryRun = args.includes('--dry-run');

  // Init Supabase — service role key preferred (bypasses RLS)
  const url        = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey    = process.env.VITE_SUPABASE_ANON_KEY;
  const key        = serviceKey ?? anonKey;

  if (!url || !key) {
    console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY) in .env.local');
    process.exit(1);
  }
  if (!serviceKey) {
    console.warn('⚠  SUPABASE_SERVICE_ROLE_KEY not found — using anon key. Writes may fail under RLS.');
  } else {
    console.log('Using service role key.');
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Load markers (Supabase primary, JSON fallback)
  let rows;
  const { data: sbRows, error: sbErr } = await supabase
    .from('tree_markers')
    .select('marker_code, canopy_radius_ft, capture')
    .order('marker_code', { ascending: true });

  const jsonPath = path.join(__dirname, '..', 'public', 'data', 'tree-markers.json');
  let jsonMarkers = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  if (sbErr || !sbRows || sbRows.length === 0) {
    console.warn('Supabase fetch failed or empty — using JSON fallback for marker list:', sbErr?.message ?? '(empty)');
    rows = jsonMarkers.map((m) => ({
      marker_code:      m.id ?? m.marker_code,
      canopy_radius_ft: m.canopyRadiusFt ?? m.canopy_radius_ft ?? 14,
      capture:          m.capture ?? null,
    }));
  } else {
    rows = sbRows;
    console.log(`Fetched ${rows.length} markers from Supabase.`);
  }

  // ── Reset mode ─────────────────────────────────────────────────────────────
  if (reset) {
    const seeded = rows.filter((r) => r.capture?.source === 'synthetic-seed');
    console.log(`\n--reset: reverting ${seeded.length} seeded markers to raw sample state.`);

    if (!dryRun) {
      let ok = 0, fail = 0;
      for (const row of seeded) {
        const { error } = await supabase
          .from('tree_markers')
          .update(RESET_FIELDS)
          .eq('marker_code', row.marker_code);
        if (error) {
          console.error(`  ✗ ${row.marker_code}: ${error.message}`);
          fail++;
        } else {
          ok++;
          if (ok % 20 === 0) console.log(`  Reverted ${ok}/${seeded.length}...`);
        }
      }
      console.log(`\nSupabase: reverted ${ok}, errors ${fail}.`);

      // Rewrite JSON
      const seededIds = new Set(seeded.map((r) => r.marker_code));
      const updatedJson = jsonMarkers.map((m) => {
        const id = m.id ?? m.marker_code;
        return seededIds.has(id) ? resetJsonMarker(m) : m;
      });
      fs.writeFileSync(jsonPath, JSON.stringify(updatedJson, null, 2));
      console.log(`JSON fallback reverted: ${jsonPath}`);
    } else {
      console.log('(dry-run — no writes performed)');
    }
    return;
  }

  // ── Seed mode ──────────────────────────────────────────────────────────────
  const payloads = [];
  const tierCounts = { verified: 0, partial: 0, sample: 0 };

  for (const row of rows) {
    const p = buildPayload(row);
    if (p) {
      payloads.push(p);
      tierCounts[p.data_status]++;
    } else {
      tierCounts.sample++;
    }
  }

  console.log(`\nTier distribution (${rows.length} total):`);
  console.log(`  verified: ${tierCounts.verified}  (${pct(tierCounts.verified, rows.length)})`);
  console.log(`  partial:  ${tierCounts.partial}  (${pct(tierCounts.partial, rows.length)})`);
  console.log(`  sample:   ${tierCounts.sample}  (${pct(tierCounts.sample, rows.length)})`);

  if (dryRun) {
    console.log('\n(dry-run — sample of first 5 payloads:)');
    payloads.slice(0, 5).forEach((p) => {
      console.log(`  ${p.marker_code}: ${p.data_status} | ${p.species} | dbh=${p.dbh_in ?? '—'}" | crown=${p.crown_spread_ft}ft | C=${p.carbon_stored_lb}lb`);
    });
    console.log('\n(dry-run — no writes performed)');
    return;
  }

  // Write to Supabase
  console.log(`\nWriting ${payloads.length} characterizations to Supabase...`);
  let ok = 0, fail = 0;

  for (const payload of payloads) {
    const { marker_code, ...fields } = payload;
    const { error } = await supabase
      .from('tree_markers')
      .update(fields)
      .eq('marker_code', marker_code);
    if (error) {
      console.error(`  ✗ ${marker_code}: ${error.message}`);
      fail++;
    } else {
      ok++;
      if (ok % 20 === 0) console.log(`  Updated ${ok}/${payloads.length}...`);
    }
  }
  console.log(`\nSupabase: updated ${ok}, errors ${fail}.`);

  if (fail > 0) {
    console.warn('\n⚠  Some updates failed. If RLS is blocking writes, add SUPABASE_SERVICE_ROLE_KEY to .env.local.');
  }

  // Rewrite JSON fallback
  const payloadMap = new Map(payloads.map((p) => [p.marker_code, p]));
  const updatedJson = jsonMarkers.map((m) => {
    const id = m.id ?? m.marker_code;
    const payload = payloadMap.get(id);
    return mergeIntoJsonMarker(m, payload);
  });
  fs.writeFileSync(jsonPath, JSON.stringify(updatedJson, null, 2));
  console.log(`JSON fallback updated: ${jsonPath}`);

  // Summary: verify that a sample verified tree would compute at the right tier
  const sampleVerified = payloads.find((p) => p.data_status === 'verified');
  if (sampleVerified) {
    const hasDbh     = sampleVerified.dbh_in != null && sampleVerified.dbh_in > 0;
    const hasSpecies = sampleVerified.species && sampleVerified.species !== 'Unknown';
    console.log(`\nTier check (spot): ${sampleVerified.marker_code} — dbh=${sampleVerified.dbh_in}" species="${sampleVerified.species}" → determineTier would resolve: ${hasDbh && hasSpecies ? 'verified ✓' : 'WRONG — check field names'}`);
  }

  console.log('\nSeed complete. Purge later with:');
  console.log("  DELETE FROM tree_markers WHERE capture->>'source' = 'synthetic-seed';");
}

function pct(n, total) {
  return `${Math.round((n / total) * 100)}%`;
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
